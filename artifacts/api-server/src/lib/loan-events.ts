import { createHash } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import {
  db,
  loanContractRevisionsTable,
  loanEventsTable,
  loanEventSetsTable,
  loansTable,
  type InsertLoanEvent,
} from "@workspace/db";

type ProposedEventBase = {
  effectiveDate: Date | string;
  ordering: "before_scheduled_payment" | "after_scheduled_payment";
  sequence: number;
  classification: "ordinary" | "agreement_change";
  source: string;
  reason: string;
  authoredAt: Date | string;
  author?: string | null;
  supersedesEventId?: string | null;
  originEventId?: string | null;
};

export type ProposedPrincipalEvent = ProposedEventBase & {
  kind: "principal_prepayment";
  amount: number;
  treatment: "keep_payment" | "keep_maturity";
};

export type ProposedRateResetEvent = ProposedEventBase & {
  kind: "rate_reset";
  observationDate: Date | string;
  publishedDate?: Date | string | null;
  fetchedAt: Date | string;
  benchmarkRate: number;
  spread: number;
  resultingRate: number;
  benchmark: string;
  sourceUrl: string;
  sourceSeries: string;
  rateOrigin: "automatic" | "override" | "restore";
  treatment: "keep_payment" | "keep_maturity";
};

// Backward-compatible Task 29 name for callers that only author principal
// events. The internal timeline accepts both event kinds.
export type ProposedLoanEvent = ProposedPrincipalEvent;
export type ProposedTimelineEvent = ProposedPrincipalEvent | ProposedRateResetEvent;

export type ProposedLoanEventSet = {
  expectedVersion: number;
  termRevisionId: string;
  reason: string;
  source: string;
  author?: string | null;
  events: ProposedTimelineEvent[];
};

export class EventTimelineError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

const dateOnly = (value: Date | string): string => {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new EventTimelineError("effectiveDate must be a valid date");
    return value.toISOString().slice(0, 10);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new EventTimelineError("effectiveDate must be a valid YYYY-MM-DD date");
  }
  if (new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw new EventTimelineError("effectiveDate must be a real calendar date");
  }
  return value;
};

const instant = (value: Date | string): string => {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new EventTimelineError("authoredAt must be a valid date-time");
  return parsed.toISOString();
};

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

const orderingRank = {
  before_scheduled_payment: 0,
  after_scheduled_payment: 1,
} as const;

export function normalizeLoanEvents(events: ProposedTimelineEvent[]) {
  const normalized = events.map((event) => {
    if (!Number.isInteger(event.sequence) || event.sequence <= 0) {
      throw new EventTimelineError("sequence must be a positive integer");
    }
    if (event.kind === "principal_prepayment") {
      if (!Number.isFinite(event.amount) || event.amount <= 0) {
        throw new EventTimelineError("amount must be greater than zero");
      }
      if (event.amount > 9_999_999_999_999.99) {
        throw new EventTimelineError("amount exceeds the supported monetary range");
      }
      if (Math.abs(Math.round(event.amount * 100) / 100 - event.amount) > 1e-9) {
        throw new EventTimelineError("amount must have no more than two decimal places");
      }
    } else {
      for (const [name, value] of Object.entries({
        benchmarkRate: event.benchmarkRate,
        spread: event.spread,
        resultingRate: event.resultingRate,
      })) {
        if (!Number.isFinite(value) || value < -100 || value > 100) {
          throw new EventTimelineError(`${name} must be a valid percentage`);
        }
      }
      if (Math.abs(event.benchmarkRate + event.spread - event.resultingRate) > 0.0001) {
        throw new EventTimelineError("resultingRate must equal benchmarkRate plus spread");
      }
      if (!event.benchmark.trim() || !event.sourceSeries.trim() || !event.sourceUrl.trim()) {
        throw new EventTimelineError("rate reset benchmark and source evidence are required");
      }
    }
    if (!event.source.trim()) throw new EventTimelineError("event source is required");
    if (!event.reason.trim()) throw new EventTimelineError("event reason is required");
    if (event.classification === "agreement_change") {
      throw new EventTimelineError(
        "This event changes the agreement. Complete the renewal/modification assessment workflow before recording it.",
        409,
      );
    }
    const common = {
      ...event,
      effectiveDate: dateOnly(event.effectiveDate),
      source: event.source.trim(),
      reason: event.reason.trim(),
      authoredAt: instant(event.authoredAt),
      author: event.author?.trim() || null,
      supersedesEventId: event.supersedesEventId ?? null,
      originEventId: event.originEventId ?? null,
    };
    return event.kind === "principal_prepayment"
      ? { ...common, amount: Number(event.amount.toFixed(2)) }
      : {
          ...common,
          observationDate: dateOnly(event.observationDate),
          publishedDate: event.publishedDate ? dateOnly(event.publishedDate) : null,
          fetchedAt: instant(event.fetchedAt),
          benchmarkRate: Number(event.benchmarkRate.toFixed(4)),
          spread: Number(event.spread.toFixed(4)),
          resultingRate: Number(event.resultingRate.toFixed(4)),
          benchmark: event.benchmark.trim(),
          sourceUrl: event.sourceUrl.trim(),
          sourceSeries: event.sourceSeries.trim(),
        };
  });
  normalized.sort(
    (a, b) =>
      a.effectiveDate.localeCompare(b.effectiveDate) ||
      orderingRank[a.ordering] - orderingRank[b.ordering] ||
      a.sequence - b.sequence,
  );
  const sequences = new Set<number>();
  const positions = new Set<string>();
  const duplicates = new Set<string>();
  for (const event of normalized) {
    if (sequences.has(event.sequence)) {
      throw new EventTimelineError(`duplicate sequence ${event.sequence}`);
    }
    sequences.add(event.sequence);
    const position = `${event.effectiveDate}:${event.ordering}:${event.sequence}`;
    if (positions.has(position)) throw new EventTimelineError(`duplicate event position ${position}`);
    positions.add(position);
    const duplicate = stableJson({
      effectiveDate: event.effectiveDate,
      ordering: event.ordering,
      kind: event.kind,
      amount: event.kind === "principal_prepayment" ? event.amount : null,
      resultingRate: event.kind === "rate_reset" ? event.resultingRate : null,
      treatment: event.treatment,
      classification: event.classification,
    });
    if (duplicates.has(duplicate)) {
      throw new EventTimelineError(
        event.kind === "principal_prepayment"
          ? "duplicate principal prepayment event"
          : "duplicate rate reset event",
      );
    }
    duplicates.add(duplicate);
  }
  return normalized;
}

export function fingerprintLoanEvents(
  termRevisionId: string,
  events: ProposedTimelineEvent[],
): string {
  return createHash("sha256")
    .update(stableJson({ termRevisionId, events: normalizeLoanEvents(events) }))
    .digest("hex");
}

type EventTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function validateEventSetContext(
  tx: EventTransaction,
  loanId: string,
  input: ProposedLoanEventSet,
) {
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 0) {
    throw new EventTimelineError("expectedVersion must be a non-negative integer");
  }
  if (!input.reason.trim()) throw new EventTimelineError("event set reason is required");
  if (!input.source.trim()) throw new EventTimelineError("event set source is required");
  await tx.execute(sql`select id from loans where id = ${loanId} for update`);
  const [loan] = await tx
    .select()
    .from(loansTable)
    .where(eq(loansTable.id, loanId))
    .limit(1);
  if (!loan) throw new EventTimelineError("Loan not found", 404);
  if (loan.activeEventSetId) {
    await tx.execute(
      sql`select id from loan_event_sets where id = ${loan.activeEventSetId} for update`,
    );
  }
  if (loan.activeEventSetVersion !== input.expectedVersion) {
    throw new EventTimelineError(
      `Event timeline version conflict: expected ${input.expectedVersion}, current version is ${loan.activeEventSetVersion}`,
      409,
    );
  }
  if (!loan.currentRevisionId || input.termRevisionId !== loan.currentRevisionId) {
    throw new EventTimelineError(
      "termRevisionId must reference the loan's current contractual-term revision",
    );
  }
  const [revision] = await tx
    .select({ id: loanContractRevisionsTable.id })
    .from(loanContractRevisionsTable)
    .where(
      and(
        eq(loanContractRevisionsTable.id, input.termRevisionId),
        eq(loanContractRevisionsTable.loanId, loanId),
      ),
    );
  if (!revision) throw new EventTimelineError("Referenced term revision does not belong to this loan");
  const events = normalizeLoanEvents(input.events);
  return {
    loan,
    events,
    nextVersion: loan.activeEventSetVersion + 1,
    fingerprint: fingerprintLoanEvents(input.termRevisionId, events),
  };
}

export async function appendLoanEventSet(
  tx: EventTransaction,
  loanId: string,
  input: ProposedLoanEventSet,
) {
  const validated = await validateEventSetContext(tx, loanId, input);
  const [set] = await tx
    .insert(loanEventSetsTable)
    .values({
      loanId,
      termRevisionId: input.termRevisionId,
      version: validated.nextVersion,
      fingerprint: validated.fingerprint,
      supersedesSetId: validated.loan.activeEventSetId,
      reason: input.reason.trim(),
      source: input.source.trim(),
      author: input.author?.trim() || null,
    })
    .returning();
  const events = validated.events.length
    ? await tx
        .insert(loanEventsTable)
        .values(
          validated.events.map((event) => ({
            ...event,
            setId: set.id,
            loanId,
            termRevisionId: input.termRevisionId,
            amount: event.kind === "principal_prepayment" ? event.amount.toFixed(2) : null,
            benchmarkRate: event.kind === "rate_reset" ? event.benchmarkRate.toFixed(4) : null,
            spread: event.kind === "rate_reset" ? event.spread.toFixed(4) : null,
            resultingRate: event.kind === "rate_reset" ? event.resultingRate.toFixed(4) : null,
            authoredAt: new Date(event.authoredAt),
            fetchedAt: event.kind === "rate_reset" ? new Date(event.fetchedAt) : null,
            publishedDate:
              event.kind === "rate_reset" && event.publishedDate
                ? dateOnly(event.publishedDate)
                : null,
          }) as InsertLoanEvent),
        )
        .returning()
    : [];
  await tx
    .update(loansTable)
    .set({
      activeEventSetId: set.id,
      activeEventSetVersion: set.version,
      activeEventSetHash: set.fingerprint,
    })
    .where(eq(loansTable.id, loanId));
  return { ...set, events };
}

export function proposedFromStored(
  event: typeof loanEventsTable.$inferSelect,
  supersedesEventId: string | null,
): ProposedTimelineEvent {
  const common = {
    effectiveDate: event.effectiveDate,
    ordering: event.ordering as ProposedTimelineEvent["ordering"],
    sequence: event.sequence,
    treatment: event.treatment as "keep_payment" | "keep_maturity",
    classification: event.classification as ProposedTimelineEvent["classification"],
    source: event.source,
    reason: event.reason,
    authoredAt: event.authoredAt,
    author: event.author,
    originEventId: event.originEventId ?? event.id,
    supersedesEventId,
  };
  if (event.kind === "rate_reset") {
    return {
      ...common,
      kind: "rate_reset",
      observationDate: event.observationDate!,
      publishedDate: event.publishedDate,
      fetchedAt: event.fetchedAt!,
      benchmarkRate: Number(event.benchmarkRate),
      spread: Number(event.spread),
      resultingRate: Number(event.resultingRate),
      benchmark: event.benchmark!,
      sourceUrl: event.sourceUrl!,
      sourceSeries: event.sourceSeries!,
      rateOrigin: event.rateOrigin as ProposedRateResetEvent["rateOrigin"],
    };
  }
  return {
    ...common,
    kind: "principal_prepayment",
    amount: Number(event.amount),
  };
}

export async function cloneActiveLoanEvents(
  tx: EventTransaction,
  sourceLoanId: string,
  targetLoanId: string,
  targetTermRevisionId: string,
) {
  const sourceLoan = await tx.query.loansTable.findFirst({
    where: (loan, { eq }) => eq(loan.id, sourceLoanId),
  });
  const activeSet = sourceLoan?.activeEventSetId
    ? await tx.query.loanEventSetsTable.findFirst({
        where: (set, { eq }) => eq(set.id, sourceLoan.activeEventSetId!),
      })
    : undefined;
  if (!activeSet) return;
  const sourceEvents = await tx
    .select()
    .from(loanEventsTable)
    .where(eq(loanEventsTable.setId, activeSet.id))
    .orderBy(asc(loanEventsTable.sequence));
  await appendLoanEventSet(tx, targetLoanId, {
    expectedVersion: 0,
    termRevisionId: targetTermRevisionId,
    reason: activeSet.reason,
    source: activeSet.source,
    author: activeSet.author,
    events: sourceEvents.map((event) => proposedFromStored(event, null)),
  });
}

/** Rebinds a loan's immutable active timeline whenever its contract revision changes. */
export async function rebindActiveLoanEvents(
  tx: EventTransaction,
  loanId: string,
  targetTermRevisionId: string,
) {
  const sourceLoan = await tx.query.loansTable.findFirst({
    where: (loan, { eq }) => eq(loan.id, loanId),
  });
  if (!sourceLoan?.activeEventSetId) return;
  const activeSet = await tx.query.loanEventSetsTable.findFirst({
    where: (set, { eq }) => eq(set.id, sourceLoan.activeEventSetId!),
  });
  if (!activeSet || activeSet.termRevisionId === targetTermRevisionId) return;
  const sourceEvents = await tx
    .select()
    .from(loanEventsTable)
    .where(eq(loanEventsTable.setId, activeSet.id))
    .orderBy(asc(loanEventsTable.sequence));
  await appendLoanEventSet(tx, loanId, {
    expectedVersion: sourceLoan.activeEventSetVersion,
    termRevisionId: targetTermRevisionId,
    reason: activeSet.reason,
    source: activeSet.source,
    author: activeSet.author,
    events: sourceEvents.map((event) => proposedFromStored(event, event.id)),
  });
}

/** Lazily repairs pre-foundation records so exposed active evidence is never stale. */
export async function ensureActiveEventSetCurrentRevision(
  tx: EventTransaction,
  loan: typeof loansTable.$inferSelect,
) {
  if (!loan.activeEventSetId || !loan.currentRevisionId) return loan;
  const activeSet = await tx.query.loanEventSetsTable.findFirst({
    where: (set, { eq }) => eq(set.id, loan.activeEventSetId!),
  });
  if (!activeSet || activeSet.termRevisionId === loan.currentRevisionId) return loan;
  await rebindActiveLoanEvents(tx, loan.id, loan.currentRevisionId);
  const [rebound] = await tx.select().from(loansTable).where(eq(loansTable.id, loan.id));
  return rebound ?? loan;
}