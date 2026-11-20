import type { RateTimelineEvent } from "./aspe-utils";
import type { PrintTable } from "./print-report";

/** Preserve supplied historical observations as well as the active set used for calculation. */
export function printRateTimeline(loan: {
  rateTimelineEvents?: readonly RateTimelineEvent[] | null;
  activeRateEvents?: readonly unknown[] | null;
  activeRateSetId?: string | null;
  initialFvRateAssumption?: Record<string, unknown> | null;
}): PrintTable | undefined {
  const events = new Map<string, RateTimelineEvent>();
  for (const event of [
    ...(loan.rateTimelineEvents ?? []),
    ...((loan.activeRateEvents ?? []) as readonly RateTimelineEvent[]),
  ]) {
    events.set(event.id, { ...events.get(event.id), ...event });
  }
  if (!events.size) return;
  const pct = (n: string | number | null | undefined) =>
    n == null ? "—" : `${Number(n).toFixed(4)}%`;
  const notes = [
    "All supplied observations are retained as audit evidence. The schedule uses the active event set only.",
  ];
  if (loan.activeRateSetId)
    notes.push(`Active rate set: ${loan.activeRateSetId}`);
  if (loan.initialFvRateAssumption)
    notes.push(
      `Frozen day-one assumptions: ${JSON.stringify(loan.initialFvRateAssumption)}`,
    );
  return {
    title: "Contractual Rate Timeline Evidence",
    head: [
      "Effective / ordering",
      "Observation dates",
      "Benchmark / source",
      "Rate calculation",
      "Origin / provenance",
    ],
    widths: [17, 19, 22, 18, 24],
    notes,
    rows: [...events.values()].map((e) => [
      [
        e.effectiveDate,
        e.ordering,
        e.sequence == null ? null : `Sequence ${e.sequence}`,
      ]
        .filter(Boolean)
        .join("\n"),
      [
        e.observationDate && `Observed ${e.observationDate}`,
        e.publishedDate && `Published ${e.publishedDate}`,
        e.fetchedAt && `Fetched ${e.fetchedAt}`,
      ]
        .filter(Boolean)
        .join("\n") || "—",
      [e.benchmark, e.sourceSeries, e.source, e.sourceUrl]
        .filter(Boolean)
        .join("\n") || "—",
      `${pct(e.benchmarkRate)} + ${pct(e.spread)} = ${pct(e.resultingContractualRate ?? e.resultingRate)}${e.treatment ? `\n${e.treatment}` : ""}`,
      [
        e.id,
        e.setId && `Set ${e.setId}`,
        e.rateOrigin,
        e.reason,
        e.author,
        e.authoredAt,
      ]
        .filter(Boolean)
        .join("\n"),
    ]),
  };
}
