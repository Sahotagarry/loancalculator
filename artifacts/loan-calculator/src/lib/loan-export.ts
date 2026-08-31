import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { format } from "date-fns";
import { formatCurrency } from "@/lib/format";
import type { FairValueAccountingEntries, FairValueDecisionHistory } from "./aspe-utils";

// Clear file-level helpers for consumers that already import export utilities
// from this module; loan schedule exports below remain unchanged.
export {
  downloadPresentationDisclosureDocx,
  downloadPresentationDisclosurePdf,
  renderPresentationDisclosureDocx,
  renderPresentationDisclosurePdf,
  buildPresentationDisclosureDocxPlan,
  buildPresentationDisclosurePdfPlan,
} from "./disclosure-export";

export interface ScheduleRow {
  isGrace?: boolean;
  month: number;
  date: Date;
  payment: number;
  principal: number;
  interest: number;
  totalInterest: number;
  balance: number;
  isInterestOnly: boolean;
  rowType?: "scheduled_payment" | "principal_event" | "accrued_interest_settlement";
  eventOrdering?: "before_scheduled_payment" | "after_scheduled_payment";
  eventSequence?: number;
  eventTreatment?: "keep_payment" | "keep_maturity";
  contractualAnnualRate?: number;
  rateSegments?: ReadonlyArray<{ from: Date; to: Date; annualContractualRate: number; rateResetEventId?: string }>;
}

export interface YearlyTotal {
  label: string;
  principal: number;
  interest: number;
  opening?: number;
  closing?: number;
}

export interface LoanExportMeta {
  name: string;
  principal: number;
  interestRate: number;
  termYears: number;
  currentRevisionId?: string | null;
  currentRevisionHash?: string | null;
  calculationVersion?: string | null;
  activeEventSetId?: string | null;
  activeEventSetVersion?: number | null;
  activeEventSetHash?: string | null;
  activeEvents?: Array<{ effectiveDate: string; amount: number | string; ordering: string; sequence: number; treatment: string; classification: string; source: string; reason: string }>;
  rateType?: string | null;
  rateBenchmark?: string | null;
  contractualPrimeName?: string | null;
  benchmarkEquivalentToContractualPrime?: boolean | null;
  rateSpread?: number | string | null;
  rateResetFrequency?: string | null;
  rateEffectiveConvention?: string | null;
  ratePaymentTreatment?: string | null;
  initialFvRateAssumption?: Record<string, unknown> | null;
  rateTimelineEvents?: Array<{ id: string; setId?: string | null; effectiveDate: string; observationDate?: string | null; publishedDate?: string | null; fetchedAt?: string | null; benchmark?: string | null; sourceSeries?: string | null; source?: string | null; sourceUrl?: string | null; benchmarkRate: number | string; spread: number | string; resultingRate?: number | string | null; resultingContractualRate?: number | string | null; rateOrigin?: string | null; reason?: string | null; author?: string | null; authoredAt?: string | null }>;
  activeRateEvents?: readonly unknown[];
  predecessorAgreementId?: string | null;
  modificationEffectiveDate?: string | null;
  modificationAssessment?: {
    status: string;
    confirmedAt: string;
    confirmedBy: string;
    evidence: { changeSummary: string };
    conclusion: { agreementChangeType: string; accountingTreatment: string; rationale: string };
  } | null;
  /** Prebuilt with buildFairValueAccountingEntries; keeps UI and exports identical. */
  fairValueAccountingEntries?: FairValueAccountingEntries | null;
  fvDecisionHistory?: FairValueDecisionHistory | null;
}

export function exportScheduleXlsx(loanName: string, schedule: ScheduleRow[], evidence?: LoanExportMeta): void {
  const ws = XLSX.utils.json_to_sheet(
    schedule.map((row) => ({
      Period: row.month,
      Date: format(row.date, "MMMM d, yyyy"),
      Payment: row.payment.toFixed(2),
      Principal: row.principal.toFixed(2),
      Interest: row.interest.toFixed(2),
      "Total Interest": row.totalInterest.toFixed(2),
      Balance: row.balance.toFixed(2),
      "Contractual rate": row.contractualAnnualRate == null ? "" : `${row.contractualAnnualRate.toFixed(4)}%`,
      "Rate evidence": row.rateSegments?.map((s) => `${format(s.from, "yyyy-MM-dd")}–${format(s.to, "yyyy-MM-dd")}: ${s.annualContractualRate.toFixed(4)}%${s.rateResetEventId ? ` (${s.rateResetEventId})` : ""}`).join("; ") ?? "",
      Type: row.rowType === "principal_event"
        ? `Principal event (${row.eventOrdering === "before_scheduled_payment" ? "before" : "after"} payment; #${row.eventSequence ?? 0}; ${row.eventTreatment ?? "keep_payment"})`
        : row.rowType === "accrued_interest_settlement" ? "Accrued interest settlement"
        : row.isGrace ? "Grace Period" : row.isInterestOnly ? "Interest Only" : "Standard",
    }))
  );
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Schedule");
  if (evidence) {
    const evidenceRows: (string | number)[][] = [
      ["Calculation evidence", ""],
      ["Contract revision", evidence.currentRevisionId ?? "—"],
      ["Contract revision hash", evidence.currentRevisionHash ?? "—"],
      ["Calculation version", evidence.calculationVersion ?? "—"],
      ["Event set ID", evidence.activeEventSetId ?? "—"],
      ["Event set version", evidence.activeEventSetVersion ?? "—"],
      ["Event set fingerprint", evidence.activeEventSetHash ?? "—"],
      ["Rate basis", evidence.rateType ?? "fixed"],
      ["Public benchmark", evidence.rateBenchmark ?? "—"],
      ["Contractual lender prime", evidence.contractualPrimeName ?? "—"],
      ["Public benchmark equivalent to lender prime", evidence.benchmarkEquivalentToContractualPrime === true ? "Confirmed" : "Not confirmed — lender evidence/override required"],
      ["Contractual spread", evidence.rateSpread ?? "—"],
      ["Reset / effective convention", `${evidence.rateResetFrequency ?? "—"} / ${evidence.rateEffectiveConvention ?? "—"}`],
      ["Rate payment treatment", evidence.ratePaymentTreatment ?? "—"],
      ["Day-one FV assumption frozen", evidence.initialFvRateAssumption && Object.keys(evidence.initialFvRateAssumption).length ? "Yes" : "No"],
      ["Predecessor agreement", evidence.predecessorAgreementId ?? "—"],
      ["Transition effective date", evidence.modificationEffectiveDate ?? "—"],
      ["Transition assessment", evidence.modificationAssessment
        ? `${evidence.modificationAssessment.status}: ${evidence.modificationAssessment.conclusion.agreementChangeType} / ${evidence.modificationAssessment.conclusion.accountingTreatment}`
        : "—"],
      ["Transition evidence", evidence.modificationAssessment?.evidence.changeSummary ?? "—"],
      ["Transition confirmation", evidence.modificationAssessment
        ? `${evidence.modificationAssessment.confirmedBy} · ${evidence.modificationAssessment.confirmedAt}`
        : "—"],
      ["Transition rationale", evidence.modificationAssessment?.conclusion.rationale ?? "—"],
      ["Fair value review status", evidence.fvDecisionHistory?.status ?? "—"],
      ["Fair value review required", evidence.fvDecisionHistory?.reviewRequired == null ? "—" : evidence.fvDecisionHistory.reviewRequired ? "Yes" : "No"],
      ["Fair value stale / missing reasons", evidence.fvDecisionHistory
        ? [...evidence.fvDecisionHistory.staleReasons, ...evidence.fvDecisionHistory.missingRequirements].join("; ") || "—"
        : "—"],
      ...((evidence.fvDecisionHistory?.history ?? []).flatMap((item) => [
        [`FV decision version ${item.version}`, `${item.treatment} · ${item.confirmedBy} · ${typeof item.confirmedAt === "string" ? item.confirmedAt : item.confirmedAt.toISOString()} · ${item.rationaleNote ?? "—"}`],
        [`FV decision evidence ${item.version}`, JSON.stringify(item.evidence)],
      ])),
      [],
      ["Event date", "Amount", "Ordering", "Sequence", "Treatment", "Classification", "Source", "Reason"],
      ...(evidence.activeEvents ?? []).map((event) => [event.effectiveDate, Number(event.amount), event.ordering, event.sequence, event.treatment, event.classification, event.source, event.reason]),
      [],
      ["Rate event ID", "Effective", "Observed", "Published", "Fetched", "Benchmark / series", "Lender/public source", "Benchmark rate", "Spread", "Resulting rate", "Origin / reason", "Author / authored"],
      ...((evidence.rateTimelineEvents ?? evidence.activeRateEvents ?? []) as Array<any>).map((event) => [event.id, event.effectiveDate, event.observationDate ?? "—", event.publishedDate ?? "—", event.fetchedAt ?? "—", `${event.benchmark ?? "—"} / ${event.sourceSeries ?? "—"}`, event.source ?? event.sourceUrl ?? "—", Number(event.benchmarkRate), Number(event.spread), Number(event.resultingContractualRate ?? event.resultingRate), `${event.rateOrigin ?? "—"} / ${event.reason ?? "—"}`, `${event.author ?? "—"} / ${event.authoredAt ?? "—"}`]),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(evidenceRows), "Evidence");
    const accounting = evidence.fairValueAccountingEntries;
    if (accounting) {
      const entryRows: (string | number)[][] = [
        ["Entry type", "Date / purpose", "Account", "Debit", "Credit"],
        ...(accounting.dayOne ? accounting.dayOne.lines.map((line, index) => [
          "Day-one fair value",
          index === 0 ? `${accounting.dayOne!.date} — ${accounting.dayOne!.label}` : "",
          line.account, line.debit || "", line.credit || "",
        ]) : []),
        ...accounting.annualEntries.flatMap((entry) => entry.lines.map((line, index) => [
          "Annual effective-interest",
          index === 0 ? `${entry.date} — ${entry.label}` : "",
          line.account, line.debit || "", line.credit || "",
        ])),
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(entryRows), "FV Journal Entries");
      const supportRows: (string | number)[][] = [
        ["Purpose", "Date", "Day-one difference", "Prior-years accretion", "Current-year accretion", "Cumulative accretion", "Remaining discount"],
        ...accounting.cumulativeSupport.map((item) => [
          item.label, item.date, item.dayOneDifference, item.priorYearsAccretion,
          item.currentYearAccretion, item.cumulativeAccretion, item.remainingDiscount,
        ]),
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(supportRows), "FV Cumulative Support");
    }
  }
  XLSX.writeFile(wb, `${loanName}_Schedule.xlsx`);
}

export function exportSchedulePdf(loan: LoanExportMeta, schedule: ScheduleRow[]): void {
  const doc = new jsPDF();
  doc.setFontSize(18);
  doc.text(loan.name, 14, 22);
  doc.setFontSize(11);
  doc.text(
    `Principal: ${formatCurrency(loan.principal)} | Rate: ${loan.interestRate}% | Term: ${loan.termYears} yrs`,
    14,
    30,
  );
  if (loan.currentRevisionId || loan.activeEventSetId) {
    doc.setFontSize(8);
    doc.text(`Revision ${loan.currentRevisionId ?? "—"} · calculation ${loan.calculationVersion ?? "—"} · event set ${loan.activeEventSetId ?? "—"} v${loan.activeEventSetVersion ?? 0} · ${loan.activeEventSetHash ?? "—"}`, 14, 36);
  }
  autoTable(doc, {
    startY: loan.currentRevisionId || loan.activeEventSetId ? 42 : 40,
    head: [["Period", "Date", "Type", "Payment", "Principal", "Interest", "Balance"]],
    body: schedule.map((row) => [
      row.month,
      format(row.date, "MMMM d, yyyy"),
      row.rowType === "principal_event" ? `Principal event (${row.eventTreatment === "keep_maturity" ? "recast" : "keep payment"})` : row.rowType === "accrued_interest_settlement" ? "Interest settlement" : "Scheduled",
      formatCurrency(row.payment),
      formatCurrency(row.principal),
      formatCurrency(row.interest),
      formatCurrency(row.balance),
    ]),
    theme: "striped",
    headStyles: { fillColor: [24, 95, 45] },
  });
  const accounting = loan.fairValueAccountingEntries;
  if (accounting && (accounting.dayOne || accounting.annualEntries.length > 0)) {
    autoTable(doc, {
      head: [["Entry", "Date", "Account", "Debit", "Credit"]],
      body: [
        ...(accounting.dayOne ? accounting.dayOne.lines.map((line, index) => [
          index === 0 ? "Day-one fair value" : "",
          index === 0 ? accounting.dayOne!.date : "",
          line.account, line.debit ? formatCurrency(line.debit) : "", line.credit ? formatCurrency(line.credit) : "",
        ]) : []),
        ...accounting.annualEntries.flatMap((entry) => entry.lines.map((line, index) => [
          index === 0 ? entry.label : "",
          index === 0 ? entry.date : "",
          line.account, line.debit ? formatCurrency(line.debit) : "", line.credit ? formatCurrency(line.credit) : "",
        ])),
      ],
      theme: "grid",
      headStyles: { fillColor: [24, 95, 45] },
    });
    autoTable(doc, {
      head: [["Cumulative support only", "Date", "Prior years", "Current year", "Remaining discount"]],
      body: accounting.cumulativeSupport.map((item) => [
        item.label, item.date, formatCurrency(item.priorYearsAccretion),
        formatCurrency(item.currentYearAccretion), formatCurrency(item.remainingDiscount),
      ]),
      theme: "grid",
      headStyles: { fillColor: [90, 90, 90] },
    });
  }
  doc.save(`${loan.name}_Schedule.pdf`);
}

export function exportAnnualXlsx(loanName: string, yearlyTotals: YearlyTotal[], evidence?: LoanExportMeta): void {
  const ws = XLSX.utils.json_to_sheet(
    yearlyTotals.map((row) => ({
      "Fiscal Year": row.label,
      "Opening Balance": row.opening != null ? row.opening.toFixed(2) : "",
      Principal: row.principal.toFixed(2),
      Interest: row.interest.toFixed(2),
      Total: (row.principal + row.interest).toFixed(2),
      "Closing Balance": row.closing != null ? row.closing.toFixed(2) : "",
    }))
  );
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Annual");
  if (evidence?.fairValueAccountingEntries) {
    const accounting = evidence.fairValueAccountingEntries;
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ["Entry type", "Date / purpose", "Account", "Debit", "Credit"],
      ...(accounting.dayOne ? accounting.dayOne.lines.map((line, index) => [
        "Day-one fair value", index === 0 ? `${accounting.dayOne!.date} — ${accounting.dayOne!.label}` : "",
        line.account, line.debit || "", line.credit || "",
      ]) : []),
      ...accounting.annualEntries.flatMap((entry) => entry.lines.map((line, index) => [
        "Annual effective-interest", index === 0 ? `${entry.date} — ${entry.label}` : "",
        line.account, line.debit || "", line.credit || "",
      ])),
    ]), "FV Journal Entries");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ["Cumulative support only", "Date", "Prior years", "Current year", "Remaining discount"],
      ...accounting.cumulativeSupport.map((item) => [
        item.label, item.date, item.priorYearsAccretion, item.currentYearAccretion, item.remainingDiscount,
      ]),
    ]), "FV Cumulative Support");
  }
  XLSX.writeFile(wb, `${loanName}_Annual.xlsx`);
}

export function exportAnnualPdf(loanName: string, yearlyTotals: YearlyTotal[], evidence?: LoanExportMeta): void {
  const doc = new jsPDF();
  doc.setFontSize(18);
  doc.text(`${loanName} - Annual Breakdown`, 14, 22);
  autoTable(doc, {
    startY: 40,
    head: [["Fiscal Year", "Opening Balance", "Principal", "Interest", "Total", "Closing Balance"]],
    body: yearlyTotals.map((row) => [
      row.label,
      row.opening != null ? formatCurrency(row.opening) : "-",
      formatCurrency(row.principal),
      formatCurrency(row.interest),
      formatCurrency(row.principal + row.interest),
      row.closing != null ? formatCurrency(row.closing) : "-",
    ]),
    foot: [
      [
        "Total",
        yearlyTotals.length > 0 && yearlyTotals[0].opening != null
          ? formatCurrency(yearlyTotals[0].opening)
          : "-",
        formatCurrency(yearlyTotals.reduce((s, r) => s + r.principal, 0)),
        formatCurrency(yearlyTotals.reduce((s, r) => s + r.interest, 0)),
        formatCurrency(yearlyTotals.reduce((s, r) => s + r.principal + r.interest, 0)),
        yearlyTotals.length > 0 && yearlyTotals[yearlyTotals.length - 1].closing != null
          ? formatCurrency(yearlyTotals[yearlyTotals.length - 1].closing!)
          : "-",
      ],
    ],
    theme: "grid",
    headStyles: { fillColor: [24, 95, 45] },
  });
  const accounting = evidence?.fairValueAccountingEntries;
  if (accounting && (accounting.dayOne || accounting.annualEntries.length > 0)) {
    autoTable(doc, {
      head: [["Entry", "Date", "Account", "Debit", "Credit"]],
      body: [
        ...(accounting.dayOne ? accounting.dayOne.lines.map((line, index) => [
          index === 0 ? "Day-one fair value" : "", index === 0 ? accounting.dayOne!.date : "",
          line.account, line.debit ? formatCurrency(line.debit) : "", line.credit ? formatCurrency(line.credit) : "",
        ]) : []),
        ...accounting.annualEntries.flatMap((entry) => entry.lines.map((line, index) => [
          index === 0 ? entry.label : "", index === 0 ? entry.date : "",
          line.account, line.debit ? formatCurrency(line.debit) : "", line.credit ? formatCurrency(line.credit) : "",
        ])),
      ],
      theme: "grid",
      headStyles: { fillColor: [24, 95, 45] },
    });
    autoTable(doc, {
      head: [["Cumulative support only", "Date", "Prior years", "Current year", "Remaining discount"]],
      body: accounting.cumulativeSupport.map((item) => [
        item.label, item.date, formatCurrency(item.priorYearsAccretion),
        formatCurrency(item.currentYearAccretion), formatCurrency(item.remainingDiscount),
      ]),
      theme: "grid",
      headStyles: { fillColor: [90, 90, 90] },
    });
  }
  doc.save(`${loanName}_Annual.pdf`);
}
