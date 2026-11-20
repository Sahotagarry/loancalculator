import type { CellValue, Workbook } from "exceljs";
import type { LoanExportMeta } from "./loan-export";
import { amount, column, dateFormat, isoDay, rateFormat, reportTable } from "./excel-report-style";

function fraction(value: string | number | null | undefined) {
  return value == null || value === "" ? null : Number(value) / 100;
}
export function addCalculationEvidence(wb: Workbook, evidence: LoanExportMeta) {
  const ws = wb.addWorksheet("Evidence");
  const metadata: CellValue[][] = [
    ["Contract revision", evidence.currentRevisionId ?? "—"],
    ["Contract revision hash", evidence.currentRevisionHash ?? "—"],
    ["Calculation version", evidence.calculationVersion ?? "—"],
    ["Event set ID", evidence.activeEventSetId ?? "—"],
    ["Event set version", evidence.activeEventSetVersion ?? "—"],
    ["Event set fingerprint", evidence.activeEventSetHash ?? "—"],
    ["Rate basis", evidence.rateType ?? "fixed"],
    ["Public benchmark", evidence.rateBenchmark ?? "—"],
    ["Contractual lender prime", evidence.contractualPrimeName ?? "—"],
    [
      "Public benchmark equivalent to lender prime",
      evidence.benchmarkEquivalentToContractualPrime === true
        ? "Confirmed"
        : "Not confirmed — lender evidence/override required",
    ],
    ["Contractual spread", fraction(evidence.rateSpread) ?? "—"],
    [
      "Reset / effective convention",
      `${evidence.rateResetFrequency ?? "—"} / ${evidence.rateEffectiveConvention ?? "—"}`,
    ],
    ["Rate payment treatment", evidence.ratePaymentTreatment ?? "—"],
    [
      "Day-one FV assumption frozen",
      evidence.initialFvRateAssumption && Object.keys(evidence.initialFvRateAssumption).length ? "Yes" : "No",
    ],
    ["Predecessor agreement", evidence.predecessorAgreementId ?? "—"],
    ["Transition effective date", isoDay(evidence.modificationEffectiveDate) ?? "—"],
    [
      "Transition assessment",
      evidence.modificationAssessment
        ? `${evidence.modificationAssessment.status}: ${evidence.modificationAssessment.conclusion.agreementChangeType} / ${evidence.modificationAssessment.conclusion.accountingTreatment}`
        : "—",
    ],
    ["Transition evidence", evidence.modificationAssessment?.evidence.changeSummary ?? "—"],
    [
      "Transition confirmation",
      evidence.modificationAssessment
        ? `${evidence.modificationAssessment.confirmedBy} · ${evidence.modificationAssessment.confirmedAt}`
        : "—",
    ],
    ["Transition rationale", evidence.modificationAssessment?.conclusion.rationale ?? "—"],
    ["Fair value review status", evidence.fvDecisionHistory?.status ?? "—"],
    [
      "Fair value review required",
      evidence.fvDecisionHistory?.reviewRequired == null
        ? "—"
        : evidence.fvDecisionHistory.reviewRequired
          ? "Yes"
          : "No",
    ],
    [
      "Fair value stale / missing reasons",
      evidence.fvDecisionHistory
        ? [
            ...evidence.fvDecisionHistory.staleReasons,
            ...evidence.fvDecisionHistory.missingRequirements,
          ].join("; ") || "—"
        : "—",
    ],
    ...(evidence.fvDecisionHistory?.history ?? []).flatMap((item) => [
      [
        `FV decision version ${item.version}`,
        `${item.treatment} · ${item.confirmedBy} · ${typeof item.confirmedAt === "string" ? item.confirmedAt : item.confirmedAt.toISOString()} · ${item.rationaleNote ?? "—"}`,
      ],
      [`FV decision evidence ${item.version}`, JSON.stringify(item.evidence)],
    ]),
  ];
  const end = reportTable(
    ws,
    "CalculationEvidence",
    1,
    [column("Calculation evidence", 43), column("Detail", 62)],
    metadata,
  );
  metadata.forEach(([key, value], i) => {
    if (key === "Contractual spread" && typeof value === "number") ws.getCell(i + 2, 2).numFmt = rateFormat;
    if (value instanceof Date) ws.getCell(i + 2, 2).numFmt = dateFormat;
  });
  const events = evidence.activeEvents ?? [];
  const eventEnd = reportTable(
    ws,
    "PrincipalEvents",
    end + 3,
    [
      column("Event date", 23, dateFormat),
      amount("Amount", events.length > 0),
      column("Ordering", 28),
      column("Sequence", 14),
      column("Treatment", 21),
      column("Classification", 21),
      column("Source", 32),
      column("Reason", 48),
    ],
    events.map((e) => [
      isoDay(e.effectiveDate),
      Number(e.amount),
      e.ordering,
      e.sequence,
      e.treatment,
      e.classification,
      e.source,
      e.reason,
    ]),
  );
  const rates = (evidence.rateTimelineEvents ?? evidence.activeRateEvents ?? []) as NonNullable<
    LoanExportMeta["rateTimelineEvents"]
  >;
  reportTable(
    ws,
    "RateTimeline",
    eventEnd + 3,
    [
      column("Rate event ID", 25),
      column("Effective", 22, dateFormat),
      column("Observed", 22, dateFormat),
      column("Published", 22, dateFormat),
      column("Fetched", 26),
      column("Benchmark / series", 30),
      column("Lender/public source", 32),
      column("Benchmark rate", 19, rateFormat),
      column("Spread", 17, rateFormat),
      column("Resulting rate", 19, rateFormat),
      column("Origin / reason", 40),
      column("Author / authored", 40),
    ],
    rates.map((e) => [
      e.id,
      isoDay(e.effectiveDate),
      isoDay(e.observationDate),
      isoDay(e.publishedDate),
      e.fetchedAt ?? null,
      `${e.benchmark ?? "—"} / ${e.sourceSeries ?? "—"}`,
      e.source ?? e.sourceUrl ?? "—",
      fraction(e.benchmarkRate),
      fraction(e.spread),
      fraction(e.resultingContractualRate ?? e.resultingRate),
      `${e.rateOrigin ?? "—"} / ${e.reason ?? "—"}`,
      `${e.author ?? "—"} / ${e.authoredAt ?? "—"}`,
    ]),
  );
}
export function addJournalSupport(
  wb: Workbook,
  accounting: LoanExportMeta["fairValueAccountingEntries"],
  annual: boolean,
) {
  if (!accounting) return;
  const journal: CellValue[][] = [];
  for (const entry of [accounting.dayOne, ...accounting.annualEntries]) {
    if (!entry) continue;
    entry.lines.forEach((line, i) =>
      journal.push([
        entry === accounting.dayOne ? "Day-one fair value" : "Annual effective-interest",
        i === 0 ? isoDay(entry.date) : null,
        i === 0 ? entry.label : null,
        line.account,
        line.debit || null,
        line.credit || null,
      ]),
    );
  }
  reportTable(
    wb.addWorksheet("FV Journal Entries"),
    "FVJournal",
    1,
    [
      column("Entry type", 29),
      column("Date", 23, dateFormat),
      column("Purpose", 46),
      column("Account", 43),
      amount("Debit", journal.length > 0),
      amount("Credit", journal.length > 0),
    ],
    journal,
  );
  const support = accounting.cumulativeSupport;
  reportTable(
    wb.addWorksheet("FV Cumulative Support"),
    "FVCumulative",
    1,
    [
      column(annual ? "Cumulative support only" : "Purpose", 47),
      column("Date", 22, dateFormat),
      ...(annual ? [] : [amount("Day-one difference")]),
      amount(annual ? "Prior years" : "Prior-years accretion"),
      amount(annual ? "Current year" : "Current-year accretion"),
      ...(annual ? [] : [amount("Cumulative accretion")]),
      amount("Remaining discount"),
    ],
    support.map((i) => [
      i.label,
      isoDay(i.date),
      ...(annual ? [] : [i.dayOneDifference]),
      i.priorYearsAccretion,
      i.currentYearAccretion,
      ...(annual ? [] : [i.cumulativeAccretion]),
      i.remainingDiscount,
    ]),
  );
}
