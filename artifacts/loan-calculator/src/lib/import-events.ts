import type { LoanEventInput, SuggestedLoanEvent } from "@workspace/api-client-react";

export type ConfirmedImportEvent = SuggestedLoanEvent & {
  treatment: NonNullable<SuggestedLoanEvent["treatment"]>;
  classification: NonNullable<SuggestedLoanEvent["classification"]>;
};

/** Suggestions are deliberately inert until every uncertain accounting choice is explicit. */
export function canPersistImportedEvents(events: ConfirmedImportEvent[], acknowledged: boolean): boolean {
  return acknowledged && events.every((event) => !!event.treatment && !!event.classification && event.classification === "ordinary");
}

export function importedEventsToInputs(events: ConfirmedImportEvent[]): LoanEventInput[] {
  return normalizeEventSequences(events.map((event, index) => ({
    kind: event.kind,
    effectiveDate: event.effectiveDate,
    ordering: event.ordering,
    sequence: index + 1,
    amount: event.amount,
    treatment: event.treatment,
    classification: event.classification,
    source: event.source,
    reason: event.reason,
    authoredAt: new Date().toISOString(),
  })));
}

/** Canonical API ordering uses a positive, one-based sequence within a date/phase. */
export function normalizeEventSequences(events: LoanEventInput[]): LoanEventInput[] {
  const phase = (event: LoanEventInput) => event.ordering === "before_scheduled_payment" ? 0 : 1;
  return events
    .map((event, index) => ({ event, index }))
    .sort((a, b) =>
      a.event.effectiveDate.localeCompare(b.event.effectiveDate) ||
      phase(a.event) - phase(b.event) ||
      a.event.sequence - b.event.sequence ||
      a.index - b.index,
    )
    .map(({ event }, index) => ({ ...event, sequence: index + 1 }));
}