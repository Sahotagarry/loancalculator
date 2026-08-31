import { and, asc, eq, isNull, or } from "drizzle-orm";
import {
  db,
  loanEventsTable,
  loansTable,
  rateRefreshRunsTable,
  rateResetFindingsTable,
} from "@workspace/db";
import {
  appendLoanEventSet,
  EventTimelineError,
  proposedFromStored,
  type ProposedRateResetEvent,
} from "./loan-events";
import {
  fetchPrimeObservation,
  fetchPrimeObservationRange,
  PrimeObservationError,
  type PrimeObservation,
} from "./prime-rates";
import { calculateAmortization } from "@workspace/amortization";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export function findingIsSatisfiedByAppliedReset(
  finding: { loanId: string; observationDate: string; contractualEffectiveDate: string; status: string },
  applied: { loanId: string; requestedDate: string; effectiveDate: string },
): boolean {
  return finding.status === "unresolved" &&
    finding.loanId === applied.loanId &&
    (
      finding.contractualEffectiveDate === applied.effectiveDate ||
      finding.observationDate === applied.requestedDate
    );
}

async function activeEvents(
  tx: Tx,
  loan: typeof loansTable.$inferSelect,
): Promise<Array<typeof loanEventsTable.$inferSelect>> {
  return loan.activeEventSetId
    ? tx
        .select()
        .from(loanEventsTable)
        .where(eq(loanEventsTable.setId, loan.activeEventSetId))
        .orderBy(asc(loanEventsTable.sequence))
    : [];
}

function contractualEffectiveDate(
  loan: typeof loansTable.$inferSelect,
  requestedDate: string,
  observation: PrimeObservation,
): string {
  const convention = loan.rateEffectiveConvention ?? "observation_date";
  if (convention === "observation_date") return requestedDate;
  const date = new Date(`${requestedDate}T00:00:00Z`);
  if (convention === "next_business_day") {
    do date.setUTCDate(date.getUTCDate() + 1);
    while (date.getUTCDay() === 0 || date.getUTCDay() === 6);
    return date.toISOString().slice(0, 10);
  }
  const schedule = calculateAmortization(
    Number(loan.principal) - Number(loan.downPayment),
    Number(loan.interestRate), loan.amortizationYears, loan.termMonths != null ? loan.termMonths / 12 : loan.termYears,
    new Date(`${loan.startDate}T00:00:00Z`), loan.ioMonths,
    loan.specificIoMonths ? loan.specificIoMonths.split(",").map(Number).filter(Number.isFinite) : [],
    Number(loan.balloonPayment), loan.paymentFrequency as "monthly" | "semi-monthly" | "bi-weekly" | "weekly",
    loan.paymentOverride == null ? null : Number(loan.paymentOverride), loan.graceMonths,
    loan.graceInterestTreatment === "none" ? "none" : "capitalized",
    {
      paymentTiming: loan.paymentTiming === "beginning" ? "beginning" : "end",
      graceTermMode: loan.graceTermMode === "added" ? "added" : "included",
      firstPaymentDate: loan.firstPaymentDate ? new Date(`${loan.firstPaymentDate}T00:00:00Z`) : undefined,
      semiMonthlyDueDays: loan.semiMonthlyFirstDueDay != null && loan.semiMonthlySecondDueDay != null
        ? [loan.semiMonthlyFirstDueDay, loan.semiMonthlySecondDueDay] : undefined,
    },
  );
  const requested = new Date(`${requestedDate}T00:00:00Z`).getTime();
  const due = schedule.schedule.find((row) => !row.isGrace && row.date.getTime() >= requested)?.date;
  if (!due) throw new EventTimelineError("No contractual scheduled payment remains for next_payment_date", 409);
  return due.toISOString().slice(0, 10);
}

async function appendRate(
  tx: Tx,
  loan: typeof loansTable.$inferSelect,
  rate: Omit<ProposedRateResetEvent, "sequence">,
) {
  if (!loan.currentRevisionId) throw new EventTimelineError("Loan has no current contract revision", 409);
  const previous = await activeEvents(tx, loan);
  const sameActive = previous.find(
    (event) =>
      event.kind === "rate_reset" &&
      event.effectiveDate === rate.effectiveDate &&
      event.rateOrigin === rate.rateOrigin &&
      (rate.rateOrigin === "automatic" ||
        Number(event.resultingRate) === rate.resultingRate),
  );
  if (sameActive) return { applied: false, event: sameActive };
  if (rate.rateOrigin === "automatic") {
    const latestRate = previous
      .filter((event) => event.kind === "rate_reset")
      .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))[0];
    if (latestRate && Number(latestRate.resultingRate) === rate.resultingRate) {
      return { applied: false, event: latestRate };
    }
  }
  const replacement = previous.find(
    (event) => event.kind === "rate_reset" && event.effectiveDate === rate.effectiveDate,
  );
  if (rate.rateOrigin === "automatic" && replacement) {
    // A sourced/restored segment already satisfies this date, and an override
    // always takes precedence over unattended refresh.
    return { applied: false, event: replacement };
  }
  const retained = previous.filter((event) => event.id !== replacement?.id);
  const nextSequence = Math.max(0, ...retained.map((event) => event.sequence)) + 1;
  const event: ProposedRateResetEvent = {
    ...rate,
    sequence: nextSequence,
    supersedesEventId: replacement?.id ?? null,
    originEventId: replacement?.originEventId ?? replacement?.id ?? null,
  };
  const set = await appendLoanEventSet(tx, loan.id, {
    expectedVersion: loan.activeEventSetVersion,
    termRevisionId: loan.currentRevisionId,
    reason: rate.reason,
    source: rate.source,
    author: rate.author,
    events: [...retained.map((stored) => proposedFromStored(stored, null)), event],
  });
  return { applied: true, event: set.events.find((item) => item.sequence === nextSequence)! };
}

export async function applySourcedReset(
  loanId: string,
  requestedDate: string,
  observation?: PrimeObservation,
  origin: "automatic" | "restore" = "automatic",
  author = "automatic-rate-refresh",
) {
  observation ??= await fetchPrimeObservation(requestedDate);
  return db.transaction(async (tx) => {
    const [loan] = await tx.select().from(loansTable).where(eq(loansTable.id, loanId));
    if (!loan) throw new EventTimelineError("Loan not found", 404);
    if (loan.rateType !== "prime_linked") throw new EventTimelineError("Loan is not prime-linked", 409);
    if (loan.rateBenchmark !== "boc_v80691311" || loan.benchmarkEquivalentToContractualPrime !== true) {
      throw new EventTimelineError(
        loan.rateBenchmark === "boc_v122495"
          ? "Bank of Canada V122495 is retired; explicitly adopt and confirm boc_v80691311 or provide a documented override"
          : "The selected public benchmark is not the lender's contractual prime; explicitly adopt boc_v80691311 or provide a documented override",
        409,
      );
    }
    const spread = Number(loan.rateSpread);
    if (!Number.isFinite(spread)) throw new EventTimelineError("Prime-linked loan has no contractual spread", 409);
    const effectiveDate = resolveContractualEffectiveDate(loan, requestedDate);
    const result = await appendRate(tx, loan, {
      kind: "rate_reset",
      effectiveDate,
      observationDate: observation.observationDate,
      publishedDate: observation.publishedDate,
      fetchedAt: observation.fetchedAt,
      benchmarkRate: observation.rate,
      spread,
      resultingRate: Number((observation.rate + spread).toFixed(4)),
      benchmark: "Bank of Canada chartered bank prime",
      sourceUrl: observation.sourceUrl,
      sourceSeries: observation.sourceSeries,
      rateOrigin: origin,
      ordering: "before_scheduled_payment",
      treatment: (loan.ratePaymentTreatment ?? "keep_payment") as "keep_payment" | "keep_maturity",
      classification: "ordinary",
      source: "Bank of Canada Valet API",
      reason: origin === "restore" ? "Restored sourced benchmark rate" : "Contractual benchmark reset",
      authoredAt: observation.fetchedAt,
      author,
    });
    await tx
      .update(rateResetFindingsTable)
      .set({ status: "resolved", resolvedAt: new Date() })
      .where(
        and(
          eq(rateResetFindingsTable.loanId, loan.id),
          eq(rateResetFindingsTable.status, "unresolved"),
          or(
            // Multiple due requests may converge on one next-payment effective
            // date. The one immutable segment satisfies every such finding.
            eq(rateResetFindingsTable.contractualEffectiveDate, effectiveDate),
            // Preserve safe compatibility with findings keyed by the exact
            // request under earlier reconciliation behavior.
            eq(rateResetFindingsTable.observationDate, requestedDate),
          ),
        ),
      );
    return result;
  });
}

export async function overrideRate(
  loanId: string,
  input: { effectiveDate: string; benchmarkRate: number; reason: string; author: string; sourceUrl: string },
) {
  return db.transaction(async (tx) => {
    const [loan] = await tx.select().from(loansTable).where(eq(loansTable.id, loanId));
    if (!loan) throw new EventTimelineError("Loan not found", 404);
    if (loan.rateType !== "prime_linked") throw new EventTimelineError("Loan is not prime-linked", 409);
    if (!input.reason.trim() || !input.author.trim() || !input.sourceUrl.trim()) {
      throw new EventTimelineError("Override reason, author, and evidence URL are required");
    }
    const spread = Number(loan.rateSpread);
    return appendRate(tx, loan, {
      kind: "rate_reset",
      effectiveDate: input.effectiveDate,
      observationDate: input.effectiveDate,
      publishedDate: null,
      fetchedAt: new Date(),
      benchmarkRate: input.benchmarkRate,
      spread,
      resultingRate: Number((input.benchmarkRate + spread).toFixed(4)),
      benchmark: loan.contractualPrimeName ?? "Lender contractual prime",
      sourceUrl: input.sourceUrl,
      sourceSeries: "contractual_override",
      rateOrigin: "override",
      ordering: "before_scheduled_payment",
      treatment: (loan.ratePaymentTreatment ?? "keep_payment") as "keep_payment" | "keep_maturity",
      classification: "ordinary",
      source: "Documented accountant override",
      reason: input.reason,
      authoredAt: new Date(),
      author: input.author,
    });
  });
}

export function restorePrimeObservationError(error: PrimeObservationError): EventTimelineError {
  if (error.retryable) {
    return new EventTimelineError(
      "Sourced restoration is temporarily unavailable because the Bank of Canada source could not be reached; retry when the source is available",
      503,
    );
  }
  return new EventTimelineError(
    "Sourced restoration is unavailable until a Bank of Canada observation exists for the requested effective date; do not forecast or hold a current rate",
    422,
  );
}

export async function restoreSourcedRate(
  loanId: string,
  effectiveDate: string,
  author: string,
  now = new Date(),
) {
  if (effectiveDate > now.toISOString().slice(0, 10)) {
    throw new EventTimelineError(
      "Sourced restoration is unavailable until an observation exists for this future effective date",
      422,
    );
  }
  let observation: PrimeObservation;
  try {
    observation = await fetchPrimeObservation(effectiveDate);
  } catch (error) {
    if (error instanceof PrimeObservationError) throw restorePrimeObservationError(error);
    throw error;
  }
  return applySourcedReset(loanId, effectiveDate, observation, "restore", author);
}

export async function refreshDueRateResets(requestedDate = new Date().toISOString().slice(0, 10)) {
  const [run] = await db
    .insert(rateRefreshRunsTable)
    .values({ status: "running", evidence: { requestedDate, series: "V80691311" } })
    .returning();
  const loans = await db
    .select()
    .from(loansTable)
    .where(and(eq(loansTable.rateType, "prime_linked"), isNull(loansTable.deletedAt)));
  let applied = 0;
  let unresolved = 0;
  const errors: Array<{ loanId: string; error: string }> = [];
  for (const loan of loans) {
    if (loan.rateResetFrequency === "immediate") {
      const from = loan.rateRefreshCheckpointDate ?? loan.startDate;
      try {
        // A single validated range request makes multi-year initial backfill
        // operational; only observed value changes become contractual segments.
        const lookback = new Date(`${from}T00:00:00Z`);
        lookback.setUTCDate(lookback.getUTCDate() - 31);
        const observations = await fetchPrimeObservationRange(
          lookback.toISOString().slice(0, 10),
          requestedDate,
        );
        const opening = observations.filter((item) => item.observationDate <= from).at(-1);
        if (!opening) {
          throw new Error(`No validated prime observation on or before ${from}`);
        }
        const candidates = [
          { requestedDate: from, observation: opening },
          ...observations.filter((item) => item.observationDate > from)
            .map((observation) => ({ requestedDate: observation.observationDate, observation })),
        ];
        let prior: number | undefined;
        for (const { requestedDate: candidateDate, observation } of candidates) {
          if (prior !== undefined && prior === observation.rate) continue;
          prior = observation.rate;
          const result = await applySourcedReset(loan.id, candidateDate, observation);
          if (result.applied) applied++;
        }
        // Advance only after all events have committed; a failed range leaves
        // the checkpoint unchanged so the next run resumes safely.
        await db.update(loansTable).set({ rateRefreshCheckpointDate: requestedDate })
          .where(eq(loansTable.id, loan.id));
      } catch (error) {
        unresolved++;
        const reason = error instanceof Error ? error.message : "Unknown retrieval failure";
        errors.push({ loanId: loan.id, error: reason });
        await db.insert(rateResetFindingsTable).values({
          loanId: loan.id, observationDate: from, contractualEffectiveDate: resolveContractualEffectiveDate(loan, from), reason, runId: run.id,
        }).onConflictDoNothing();
      }
      continue;
    }
    for (const dueDate of generateDueDates(
      loan.startDate,
      requestedDate,
      loan.rateResetFrequency ?? "immediate",
    )) {
      const resolvedEffectiveDate = resolveContractualEffectiveDate(loan, dueDate);
      const existing = await db
        .select({ id: loanEventsTable.id, rateOrigin: loanEventsTable.rateOrigin })
        .from(loanEventsTable)
        .where(
          and(
            eq(loanEventsTable.loanId, loan.id),
            eq(loanEventsTable.kind, "rate_reset"),
            eq(loanEventsTable.effectiveDate, resolvedEffectiveDate),
          ),
        )
        .limit(1);
      if (existing.length) {
        // The immutable segment (including an override, which automatic
        // refresh must not replace) satisfies every request converging here.
        await db
          .update(rateResetFindingsTable)
          .set({ status: "resolved", resolvedAt: new Date() })
          .where(
            and(
              eq(rateResetFindingsTable.loanId, loan.id),
              eq(rateResetFindingsTable.contractualEffectiveDate, resolvedEffectiveDate),
              eq(rateResetFindingsTable.status, "unresolved"),
            ),
          );
        continue;
      }
      try {
        const result = await applySourcedReset(loan.id, dueDate);
        if (result.applied) applied++;
      } catch (error) {
        unresolved++;
        const reason = error instanceof Error ? error.message : "Unknown retrieval failure";
        errors.push({ loanId: loan.id, error: reason });
        await db.insert(rateResetFindingsTable).values({
          loanId: loan.id,
          observationDate: dueDate,
          contractualEffectiveDate: resolvedEffectiveDate,
          reason,
          runId: run.id,
        }).onConflictDoNothing();
      }
    }
  }
  const status = unresolved === 0 ? "succeeded" : applied > 0 ? "partial" : "failed";
  const [complete] = await db
    .update(rateRefreshRunsTable)
    .set({
      completedAt: new Date(),
      status,
      attempted: loans.length,
      applied,
      unresolved,
      evidence: { requestedDate, series: "V80691311", errors },
    })
    .where(eq(rateRefreshRunsTable.id, run.id))
    .returning();
  return complete;
}

/** Resolve a convention before retrieval, so source outages retain the true
 * accounting effective date in reconciliation evidence. */
export function resolveContractualEffectiveDate(
  loan: typeof loansTable.$inferSelect,
  requestedDate: string,
): string {
  const convention = loan.rateEffectiveConvention ?? "observation_date";
  if (convention === "observation_date") return requestedDate;
  if (convention === "next_business_day") {
    const date = new Date(`${requestedDate}T00:00:00Z`);
    do date.setUTCDate(date.getUTCDate() + 1); while (date.getUTCDay() === 0 || date.getUTCDay() === 6);
    return date.toISOString().slice(0, 10);
  }
  // use the same canonical calendar resolver, with an inert observation.
  return contractualEffectiveDate(loan, requestedDate, {
    observationDate: requestedDate, publishedDate: null, fetchedAt: new Date(), rate: 0, sourceUrl: "", sourceSeries: "V80691311",
  });
}

/** Deterministic contractual reset calendar. Month additions deliberately
 * clamp to the target month's end (Jan 31 -> Feb 28/29, never March). */
export function generateDueDates(startDate: string, runDate: string, frequency: string): string[] {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${runDate}T00:00:00Z`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start > end) return [];
  if (frequency === "immediate") {
    const result: string[] = [];
    for (const day = new Date(start); day <= end; day.setUTCDate(day.getUTCDate() + 1)) {
      result.push(day.toISOString().slice(0, 10));
    }
    return result;
  }
  const interval = frequency === "monthly" ? 1 : frequency === "quarterly" ? 3 : 12;
  const result: string[] = [];
  for (let offset = 0; ; offset += interval) {
    const month = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + offset, 1));
    const last = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)).getUTCDate();
    const due = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), Math.min(start.getUTCDate(), last)));
    if (due > end) return result;
    result.push(due.toISOString().slice(0, 10));
  }
}
