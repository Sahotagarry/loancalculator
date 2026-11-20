import { formatCurrency as money } from "./format";
import type { LoanExportMeta } from "./loan-export";
import type { PrintReport } from "./print-report";
import { printRateTimeline } from "./print-rate-evidence";

const readable = (v: unknown): string =>
  v instanceof Date
    ? v.toISOString()
    : typeof v === "object" && v !== null
      ? JSON.stringify(v)
      : String(v ?? "—");

export function printLoanEvidence(report: PrintReport, loan?: LoanExportMeta) {
  if (!loan) return;
  const pairs = (title: string, data: Array<[string, unknown]>) => {
    const rows = data
      .filter(([, v]) => v != null && v !== "")
      .map(([k, v]) => [k, readable(v)]);
    if (rows.length)
      report.table({
        title,
        head: ["Item", "Evidence"],
        rows,
        widths: [28, 72],
      });
  };
  const accounting = loan.fairValueAccountingEntries;
  if (accounting) {
    const entries = (title: string, list: typeof accounting.annualEntries) => {
      if (list.length)
        report.table({
          title,
          head: ["Entry", "Date", "Account", "Debit", "Credit"],
          widths: [27, 15, 30, 14, 14],
          right: [3, 4],
          rows: list.flatMap((entry) =>
            entry.lines.map((line) => [
              entry.label,
              entry.date,
              line.account,
              line.debit ? money(line.debit) : "",
              line.credit ? money(line.credit) : "",
            ]),
          ),
        });
    };
    entries(
      "Day-one fair value journal entry",
      accounting.dayOne ? [accounting.dayOne] : [],
    );
    entries(
      "Annual effective-interest journal entries",
      accounting.annualEntries,
    );
    if (accounting.cumulativeSupport.length)
      report.table({
        title: "Cumulative reconciliation — support only, not a journal entry",
        head: [
          "Purpose / date",
          "Day one",
          "Prior years",
          "Current year",
          "Cumulative",
          "Remaining discount",
        ],
        right: [1, 2, 3, 4, 5],
        rows: accounting.cumulativeSupport.map((s) => [
          `${s.label}\n${s.date}`,
          ...[
            s.dayOneDifference,
            s.priorYearsAccretion,
            s.currentYearAccretion,
            s.cumulativeAccretion,
            s.remainingDiscount,
          ].map(money),
        ]),
      });
  }
  pairs("Calculation evidence", [
    ["Contract revision", loan.currentRevisionId],
    ["Contract fingerprint", loan.currentRevisionHash],
    ["Calculation version", loan.calculationVersion],
    ["Event set", loan.activeEventSetId],
    ["Event-set version", loan.activeEventSetVersion],
    ["Event-set fingerprint", loan.activeEventSetHash],
    ["Rate set", loan.activeRateSetId],
  ]);
  if (loan.rateType === "prime_linked")
    pairs("Contractual rate basis", [
      ["Public benchmark", loan.rateBenchmark],
      ["Lender prime", loan.contractualPrimeName],
      [
        "Benchmark equivalence",
        loan.benchmarkEquivalentToContractualPrime
          ? "Confirmed"
          : "Not confirmed",
      ],
      ["Spread (%)", loan.rateSpread],
      ["Reset frequency", loan.rateResetFrequency],
      ["Effective convention", loan.rateEffectiveConvention],
      ["Payment treatment", loan.ratePaymentTreatment],
      ["Frozen day-one assumptions", loan.initialFvRateAssumption],
    ]);
  if (loan.activeEvents?.length)
    report.table({
      title: "Principal payment events",
      head: [
        "Date",
        "Amount",
        "Order and treatment",
        "Classification and source",
      ],
      right: [1],
      rows: loan.activeEvents.map((e) => [
        e.effectiveDate,
        money(Number(e.amount)),
        `${e.ordering} · #${e.sequence} · ${e.treatment}`,
        `${e.classification} · ${e.source} · ${e.reason}`,
      ]),
    });
  const rates = printRateTimeline(loan);
  if (rates) report.table(rates);
  pairs("Agreement transition", [
    ["Predecessor", loan.predecessorAgreementId],
    ["Effective date", loan.modificationEffectiveDate],
    ...Object.entries(loan.modificationAssessment ?? {}),
  ]);
  const decision = loan.fvDecisionHistory ?? accounting?.decisionHistory;
  if (decision) {
    pairs("Fair value review", [
      ["Status", decision.status],
      [
        "Review required",
        decision.reviewRequired == null
          ? null
          : decision.reviewRequired
            ? "Yes"
            : "No",
      ],
      [
        "Review reasons",
        [...decision.staleReasons, ...decision.missingRequirements].join("; "),
      ],
    ]);
    const confirmations =
      decision.current &&
      !decision.history.some((item) => item.id === decision.current?.id)
        ? [decision.current, ...decision.history]
        : decision.history;
    for (const item of confirmations)
      pairs(
        `Fair value confirmation — version ${item.version}`,
        Object.entries(item),
      );
  }
}
