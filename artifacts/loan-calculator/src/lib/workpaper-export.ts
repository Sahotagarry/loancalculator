import { savedLeaseConclusion } from "./lease-assessment-values";
import { saveAs } from "file-saver";
import { PrintReport, type PrintTable, type Orientation } from "./print-report";
import { printRateTimeline } from "./print-rate-evidence";
import { printPayments, scheduleOrientation } from "./loan-print";
import { format, parseISO, subYears, isAfter } from "date-fns";
import { formatCurrency } from "@/lib/format";
import { type AmortizationRow } from "@workspace/amortization";
import { interestMethods, isDaily, leaseScheduleSupportIssue } from "@workspace/amortization";
import {
  buildFairValueAccountingEntries,
  buildLoanSummary,
  buildTransitionJournalEntries,
  calculateBookedSchedule,
  usesFairValue,
  type LoanSummary,
  type CapitalLeaseSummary,
  type OperatingLeaseSummary,
  type BookedScheduleInput,
  type FairValueDecisionHistory,
  type FairValueAccountingEntries,
} from "./aspe-utils";
import { getFiscalYear, getFyEndParts } from "./fiscal";

// Standalone presentation/disclosure exports. Existing lead-sheet and
// supporting-workpaper exports below remain unchanged.
export {
  downloadPresentationDisclosureDocx,
  downloadPresentationDisclosurePdf,
  renderPresentationDisclosureDocx,
  renderPresentationDisclosurePdf,
  buildDisclosureRenderPlan,
  buildPresentationDisclosureDocxPlan,
  buildPresentationDisclosurePdfPlan,
  serializeDisclosureRenderPlan,
} from "./disclosure-export";

/* ────────────────────────────────────────────────────────────────
   Workpaper exports for audit / review engagement files.

   A workpaper is assembled as a list of generic sections so the same
   data renders to both PDF (jspdf-autotable) and Excel (one sheet per
   section). All figures reuse the exact same computation paths as the
   app (calculateBookedSchedule / buildLoanSummary), so the workpaper
   always ties to what is displayed on screen.
   ──────────────────────────────────────────────────────────────── */

export type WorkpaperLoanInput = Omit<Parameters<typeof buildLoanSummary>[0], "activeEvents"> & {
  description?: string | null;
  masterAgreementId?: string | null;
  assetCost?: number | string | null;
  assetUsefulLife?: number | null;
  activeEvents?: Array<{
    id: string;
    effectiveDate: string;
    ordering: "before_scheduled_payment" | "after_scheduled_payment";
    sequence: number;
    amount: number;
    treatment: "keep_payment" | "keep_maturity";
    classification: "ordinary" | "agreement_change";
    source: string;
    reason: string;
  }> | null;
  fvDecisionHistory?: FairValueDecisionHistory | null;
  fairValueAccountingEntries?: FairValueAccountingEntries | null;
};

/** Shared base terms of a master financing agreement; facilities fall back to
 *  these for security/covenant wording when they don't override them. */
export interface WorkpaperMasterInput {
  id: string;
  lender: string;
  description?: string | null;
  facilityLimit?: string | number | null;
  securityDescription?: string | null;
  covenantDescription?: string | null;
}

export interface WorkpaperMeta {
  clientName: string;
  fiscalYearEnd: string; // ISO date string
}

interface WpSection {
  title: string;
  head: string[];
  rows: (string | number)[][];
  notes?: string[];
}

export interface Workpaper {
  loanName: string;
  typeLabel: string;
  clientName: string;
  fyeLabel: string;
  sections: WpSection[];
  printRateEvidence?: PrintTable;
  /** Full booked amortization schedule appendix (loans & capital leases). */
  schedule: AmortizationRow[] | null;
}

const money = (n: number) => formatCurrency(n);
// Excel can consume the same rows without first rounding them for print. Composite
// descriptions always use the existing display formatters, including in Excel.
interface ReportNumbers {
  amount(value: number): number | string;
  deduction(value: number): number | string;
  rate(value: number, places?: number): number | string;
}
const displayNumbers: ReportNumbers = {
  amount: money, deduction: n => `(${money(n)})`, rate: (n, places = 2) => `${n.toFixed(places)}%`,
};
export const excelNumbers: ReportNumbers = { amount: n => n, deduction: n => -n, rate: n => n / 100 };


function fvDecisionLabel(d: string | null | undefined): string {
  switch (d) {
    case "use_fv":
      return "Fair value adopted — booked using the effective-interest method at the market rate";
    case "trivial":
      return "Difference from market rate assessed as trivial — booked at contractual terms";
    case "immaterial":
      return "Fair value difference assessed as immaterial — booked at contractual terms";
    default:
      return "Not assessed — booked at contractual terms";
  }
}

/* ── Per-loan workpaper assembly ─────────────────────────────── */

export function buildLoanWorkpaper(
  loan: WorkpaperLoanInput,
  meta: WorkpaperMeta,
  master?: WorkpaperMasterInput | null,
  cells = displayNumbers,
): Workpaper | null {
  if (loan.leaseEndingTerms && (loan.leaseEndingTerms.status !== "reviewed" || leaseScheduleSupportIssue(loan))) {
    throw new Error(`${loan.name}: resolve and review lease ending terms before exporting accounting figures.`);
  }
  if (!loan.startDate || !meta.fiscalYearEnd) return null;
  const reportYearEnd = parseISO(meta.fiscalYearEnd);
  const summary = buildLoanSummary(loan, reportYearEnd, meta.fiscalYearEnd);
  if (!summary) return null;

  const fyeLabel = format(reportYearEnd, "MMMM d, yyyy");

  const workpaper = "monthlyStraightLineExpense" in summary
    ? buildOperatingLeaseWorkpaper(loan, summary, meta, fyeLabel, reportYearEnd, cells)
    : buildDebtWorkpaper(
        loan,
        summary as LoanSummary | CapitalLeaseSummary,
        meta,
        fyeLabel,
        reportYearEnd,
        master ?? null,
        cells,
      );
  appendTransitionEvidence(workpaper, loan, cells);
  if (loan.isCapitalLease || agreementKind(loan) === "operating_lease") {
    const assessment = savedLeaseConclusion(loan);
    const conflict = assessment.status !== "needs_review" && (assessment.status === "capital") !== loan.isCapitalLease;
    workpaper.sections = workpaper.sections.filter(s => s.title !== "Lease Classification (ASPE 3065)");
    workpaper.sections.splice(1, 0, {
      title: "Lease Classification (ASPE 3065)",
      head: ["Item", "Detail"],
      rows: [
        ["Saved classification", loan.isCapitalLease ? "Capital lease" : "Operating lease"],
        ["Evidence status", assessment.status === "needs_review" || conflict ? "Needs review — historical classification retained" : "Reviewed evidence supports saved classification"],
        ["Conclusion / review explanation", assessment.rationale],
        ["Confirmed supporting reasons", assessment.status === "needs_review" ? "Unavailable until evidence is reviewed" : assessment.reasons.join("; ") || "Reviewed operating conclusion"],
        ["Rentals during the lease term, including any separate upfront payment", assessment.payments ? cells.amount(assessment.payments.rentals) : "Unavailable"],
        ["Qualifying end-of-term amount", assessment.payments ? cells.amount(assessment.payments.ending) : "Unavailable"],
        ["Total minimum lease payments before discounting", assessment.payments ? cells.amount(assessment.payments.rentals + assessment.payments.ending) : "Unavailable"],
        ["Present value of minimum lease payments", assessment.minimum ? cells.amount(assessment.minimum.pv) : "Unavailable"],
        ["90% test — PV of minimum lease payments / fair value", assessment.minimum ? cells.rate(assessment.minimum.percent) : "Unavailable — not a failed test"],
        ["Useful-life comparison", assessment.lifePercent == null ? "Unavailable — not a failed test" : cells.rate(assessment.lifePercent)],
        ...(assessment.required ? [
          ["Included ending amount basis", loan.leaseEndingTerms?.kind === "guaranteed_residual" ? "Full stated residual guarantee — not a purchase" : loan.leaseEndingTerms?.kind === "bargain_purchase" ? "Bargain purchase option" : "Reviewed mandatory ending payment"],
        ] : []),
      ],
      notes: ["ASPE 3065.03(r), .06(c): the formal 90% test includes qualifying ending amounts in minimum lease payments, including the full stated residual guarantee or bargain purchase price. A non-bargain optional purchase and an unguaranteed lessor residual are excluded. If the implicit rate is calculated from fair value and the same cash flows, 100% follows from that calculation and is not independent fair-value evidence. Classification support is separate from opening measurement. Missing historical evidence does not change the saved classification."],
    });
  }
  if (loan.leaseEndingTerms) {
    const ending = loan.leaseEndingTerms;
    workpaper.sections.push({
      title: "Lease Ending Evidence",
      head: ["Item", "Evidence / amount"],
      rows: [
        ["Treatment", String(ending.kind)],
        ["Ending amount", typeof ending.amount === "number" ? ending.amount : "Unresolved"],
        ["Settlement month", typeof ending.settlementMonth === "number" ? ending.settlementMonth : "Unresolved"],
        ["Source", String(ending.source ?? "")],
        ["Calculation", String(ending.explanation ?? "Stated amount")],
        ["Review status", String(ending.status)],
      ],
      notes: ["A sale-shortfall guarantee is not an automatically exercised purchase. Lessor-retained values are excluded from the lessee liability."],
    });
  }
  return workpaper;
}

function agreementKind(loan: WorkpaperLoanInput): "loan" | "capital_lease" | "operating_lease" {
  if (loan.isCapitalLease) return "capital_lease";
  return Number(loan.interestRate) === 0 && loan.monthlyPayment != null && loan.termMonths != null
    ? "operating_lease"
    : "loan";
}

function appendTransitionEvidence(workpaper: Workpaper, loan: WorkpaperLoanInput, cells: ReportNumbers): void {
  const assessment = loan.modificationAssessment;
  const predecessor = loan.predecessorAgreement as WorkpaperLoanInput | null | undefined;
  const effectiveDate = loan.modificationEffectiveDate;
  if (!assessment || assessment.status !== "confirmed" || !predecessor || !effectiveDate) return;

  workpaper.sections.push({
    title: "Agreement Transition Assessment",
    head: ["Item", "Evidence"],
    rows: [
      ["Predecessor agreement", `${predecessor.name} (${loan.predecessorAgreementId ?? predecessor.id ?? "linked"})`],
      ["Effective date", effectiveDate],
      ["Conclusion", `${assessment.conclusion.agreementChangeType} — ${assessment.conclusion.accountingTreatment}`],
      ["Change summary", assessment.evidence.changeSummary],
      ["Rationale", assessment.conclusion.rationale],
      ["Confirmed", `${assessment.confirmedBy} · ${assessment.confirmedAt}`],
      ...(assessment.evidence.quantitativeTest ? [
        ["Original effective rate", cells.rate(assessment.evidence.quantitativeTest.originalEffectiveRate, 4)],
        ["Carrying amount at effective date", cells.amount(assessment.evidence.quantitativeTest.carryingAmount)],
        ["PV — original remaining cash flows", assessment.evidence.quantitativeTest.presentValueOfOriginalRemainingCashFlows == null ? "Not supplied" : cells.amount(assessment.evidence.quantitativeTest.presentValueOfOriginalRemainingCashFlows)],
        ["PV — modified cash flows", assessment.evidence.quantitativeTest.presentValueOfModifiedCashFlows == null ? "Not supplied" : cells.amount(assessment.evidence.quantitativeTest.presentValueOfModifiedCashFlows)],
        ["PV difference / percentage", `${money(assessment.evidence.quantitativeTest.differenceAmount)} / ${assessment.evidence.quantitativeTest.differencePercent.toFixed(4)}%`],
        ["Retained / new fees and costs", `${money(assessment.evidence.quantitativeTest.retainedFeesAndCosts)} / ${money(assessment.evidence.quantitativeTest.newFeesAndCosts)}`],
        ["Settlement consideration", assessment.evidence.quantitativeTest.settlementConsideration == null ? "Not applicable" : cells.amount(assessment.evidence.quantitativeTest.settlementConsideration)],
        ["Quantitative recommendation", assessment.evidence.quantitativeTest.recommendation],
        ["Original remaining cash flows", assessment.evidence.quantitativeTest.originalRemainingCashFlows.map((flow) => `${flow.date} ${money(flow.amount)} (${flow.description}; ${flow.sourceReference})`).join("; ")],
        ["Modified cash flows", assessment.evidence.quantitativeTest.modifiedCashFlows.map((flow) => `${flow.date} ${money(flow.amount)} (${flow.description}; ${flow.sourceReference})`).join("; ")],
        ["Same-day / accrued-interest treatment", `${assessment.evidence.quantitativeTest.sameDayPaymentTreatment} / ${assessment.evidence.quantitativeTest.accruedInterestTreatment}; accrued interest ${money(assessment.evidence.quantitativeTest.accruedInterest)}`],
      ] : []),
      ...(assessment.conclusion.leaseTransition ? [
        ["Lease transition evidence", assessment.conclusion.leaseTransition.terminationEvidenceReference],
        ["Transition entry evidence", `${assessment.conclusion.leaseTransition.entryDate}: ${assessment.conclusion.leaseTransition.debitAccount} / ${assessment.conclusion.leaseTransition.creditAccount} ${money(assessment.conclusion.leaseTransition.amount)}; ${assessment.conclusion.leaseTransition.entryEvidenceReference}`],
        ["Predecessor lease balances", `Deferred rent asset ${money(assessment.conclusion.leaseTransition.predecessorDeferredRentAsset ?? 0)}; liability ${money(assessment.conclusion.leaseTransition.predecessorDeferredRentLiability ?? 0)}; asset cost ${money(assessment.conclusion.leaseTransition.predecessorAssetCost ?? 0)}; accumulated depreciation ${money(assessment.conclusion.leaseTransition.predecessorAccumulatedDepreciation ?? 0)}`],
        ["Successor lease initial amount", cells.amount(assessment.conclusion.leaseTransition.successorInitialAmount)],
      ] : []),
      ...assessment.evidence.contractualChanges.map((change) => [
        change.term,
        `${change.predecessorValue} → ${change.successorValue}; ${change.significance}; source: ${change.sourceReference}`,
      ]),
    ],
    notes: ["The reporting timeline retains predecessor activity through the effective date and successor activity afterward; neither complete agreement is counted twice."],
  });

  const effective = parseISO(effectiveDate);
  const predecessorBooked = calculateBookedSchedule({ ...predecessor, startDate: predecessor.startDate! });
  const predecessorCarryingAmount = predecessorBooked.schedule
    .filter((row) => !isAfter(row.date, effective))
    .slice(-1)[0]?.balance ?? Number(predecessor.principal) - Number(predecessor.downPayment ?? 0);
  const successorInitialAmount = assessment.evidence.quantitativeTest?.successorAmount
    ?? Number(loan.principal) - Number(loan.downPayment ?? 0);
  const predecessorKind = agreementKind(predecessor);
  const successorKind = agreementKind(loan);
  const entries = buildTransitionJournalEntries({
    effectiveDate,
    assessment,
    predecessorKind,
    successorKind,
    predecessorCarryingAmount,
    successorInitialAmount: assessment.conclusion.leaseTransition?.successorInitialAmount ?? successorInitialAmount,
  });
  if (entries.length > 0) {
    workpaper.sections.push({
      title: "Agreement Transition Journal Entries",
      head: ["Entry", "Account", "Debit", "Credit"],
      rows: entries.flatMap((entry) => entry.lines.map((line, index) => [
        index === 0 ? `${entry.date} — ${entry.memo}` : "",
        line.account,
        line.debit ? cells.amount(line.debit) : "",
        line.credit ? cells.amount(line.credit) : "",
      ])),
      notes: [
        assessment.conclusion.accountingTreatment === "continuation"
          ? "Enter retained and incremental fees/costs in the transition helper when supported; they reduce the liability's continued carrying amount and form part of its prospective effective-interest basis."
          : assessment.conclusion.accountingTreatment === "new_lease"
            ? "ASPE 3065 new-lease treatment terminates or derecognizes the predecessor lease and records the successor commencement separately; it does not apply debt continuation or extinguishment accounting."
          : "The extinguishment gain or loss is presented separately from recognition of any successor financing or lease.",
      ],
    });
  }
}

function buildDebtWorkpaper(
  loan: WorkpaperLoanInput,
  summary: LoanSummary | CapitalLeaseSummary,
  meta: WorkpaperMeta,
  fyeLabel: string,
  reportYearEnd: Date,
  master: WorkpaperMasterInput | null,
  cells: ReportNumbers,
): Workpaper {
  const isCapital = summary.isCapitalLease;
  const typeLabel = isCapital ? "Capital Lease" : "Loan";
  const booked = calculateBookedSchedule({ ...loan, startDate: loan.startDate! });
  const principal = Number(loan.principal);
  const downPayment = Number(loan.downPayment ?? 0);
  // Financed amount actually amortized (face principal net of down payment).
  const financed = principal - downPayment;
  const statedRate = Number(loan.interestRate);
  const { month: fyEndMonth, day: fyEndDay } = getFyEndParts(meta.fiscalYearEnd);
  const reportFY = getFiscalYear(reportYearEnd, fyEndMonth, fyEndDay);
  const startDate = parseISO(loan.startDate!);
  const priorYearEnd = subYears(reportYearEnd, 1);
  const startedThisFY = isAfter(startDate, priorYearEnd);

  const sections: WpSection[] = [];

  /* 1 — Terms */
  const termsRows: (string | number)[][] = [
    ["Counterparty", loan.counterparty?.trim() || "—"],
    [isCapital ? "Capitalized amount" : "Principal", cells.amount(principal)],
    ["Stated rate", cells.rate(statedRate)],
    ["Start date", format(startDate, "MMMM d, yyyy")],
    ["Maturity date", summary.maturityDate],
    [
      "Term / amortization",
      loan.termMonths != null && loan.termMonths > 0
        ? `${loan.termMonths} months / ${loan.amortizationYears} yr amortization`
        : `${loan.termYears} yr term / ${loan.amortizationYears} yr amortization`,
    ],
    ["Payment", `${money(summary.regularPayment)} ${summary.paymentFrequency}`],
    ...(!isCapital ? [["Interest calculation", interestMethods[loan.interestMethod ?? "periodic"].label]] : []),
    ["Payment timing", loan.paymentTiming === "beginning" ? "Beginning of each payment period" : "End of each payment period"],
    [
      "First payment date",
      loan.firstPaymentDate ? format(parseISO(loan.firstPaymentDate), "MMMM d, yyyy") : isDaily(loan.interestMethod) ? "Derived from inception, grace and payment timing" : "Not specified — legacy inception-date schedule anchor retained",
    ],
  ];
  if (downPayment > 0) {
    termsRows.splice(2, 0,
      [isCapital ? "Down payment / first payment" : "Down payment", cells.deduction(downPayment)],
      [isCapital ? "Obligation financed" : "Amount financed", cells.amount(financed)],
    );
  }
  if (Number(loan.balloonPayment ?? 0) > 0) {
    termsRows.push(["Balloon payment", cells.amount(Number(loan.balloonPayment))]);
  }
  if ((loan.ioMonths ?? 0) > 0) {
    termsRows.push(["Interest-only period", `${loan.ioMonths} months`]);
  }
  if ((loan.graceMonths ?? 0) > 0) {
    termsRows.push([
      "Payment grace period",
      `${loan.graceMonths} months (${loan.graceInterestTreatment === "none" ? "interest-free" : "interest capitalized"}; ${loan.graceTermMode === "added" ? "extends" : "included in"} stated term)`,
    ]);
  }
  const statedMonths = loan.termMonths ?? Math.round(loan.termYears * 12);
  const repaymentMonths = Math.max(0, statedMonths - (loan.graceTermMode === "included" ? (loan.graceMonths ?? 0) : 0));
  const totalMonths = statedMonths + (loan.graceTermMode === "added" ? (loan.graceMonths ?? 0) : 0);
  termsRows.push(["Repayment / total contractual term", `${repaymentMonths} repayment months / ${totalMonths} total months`]);
  if (loan.rateType === "prime_linked") {
    termsRows.push(
      ["Rate basis", `Prime-linked: public benchmark ${loan.rateBenchmark ?? "—"}; lender contractual prime ${loan.contractualPrimeName ?? "—"}`],
      ["Benchmark equivalence evidence", loan.benchmarkEquivalentToContractualPrime === true ? "Confirmed equivalent to contractual lender prime" : "Not confirmed — lender evidence or override required"],
      ["Spread / resulting rate", `${loan.rateSpread ?? "—"}% / dated timeline`],
      ["Reset rule / payment treatment", `${loan.rateResetFrequency ?? "—"} · ${loan.rateEffectiveConvention ?? "—"} · ${loan.ratePaymentTreatment ?? "—"}`],
      ["Day-one FV assumption", loan.initialFvRateAssumption && Object.keys(loan.initialFvRateAssumption).length ? "Frozen approved assumption retained separately from realized resets" : "Not frozen — review required"],
    );
  }
  if (loan.currentRevisionId || loan.currentRevisionHash || loan.calculationVersion) {
    termsRows.push([
      "Calculation evidence",
      [
        loan.currentRevisionId ? `Revision ${loan.currentRevisionId}` : null,
        loan.currentRevisionHash ? `Hash ${loan.currentRevisionHash}` : null,
        loan.calculationVersion ? `Calculation version ${loan.calculationVersion}` : null,
      ].filter(Boolean).join(" · "),
    ]);
  }
  if (loan.activeEventSetId || (loan.activeEvents?.length ?? 0) > 0) {
    termsRows.push([
      "Event-set evidence",
      [
        loan.activeEventSetId ? `Set ${loan.activeEventSetId}` : null,
        loan.activeEventSetVersion != null ? `Version ${loan.activeEventSetVersion}` : null,
        loan.activeEventSetHash ? `Fingerprint ${loan.activeEventSetHash}` : null,
      ].filter(Boolean).join(" · "),
    ]);
  }
  sections.push({ title: "Terms", head: ["Item", "Detail"], rows: termsRows });
  const rateEvidence = (loan.activeRateEvents ?? loan.rateTimelineEvents ?? []) as Array<any>;
  if (rateEvidence.length > 0) {
    sections.push({
      title: "Contractual Rate Timeline Evidence",
      head: ["Effective", "Observed / published / fetched", "Benchmark / source", "Rate calculation", "Origin / provenance"],
      rows: rateEvidence.map((event) => [
        event.effectiveDate,
        [event.observationDate, event.publishedDate, event.fetchedAt].filter(Boolean).join(" / ") || "—",
        `${event.benchmark ?? "—"} / ${event.sourceSeries ?? event.source ?? "—"}`,
        `${Number(event.benchmarkRate).toFixed(4)}% + ${Number(event.spread).toFixed(4)}% = ${Number(event.resultingContractualRate ?? event.resultingRate).toFixed(4)}%`,
        `${event.rateOrigin ?? "sourced"} · ${event.reason ?? "—"} · ${event.author ?? "—"} · ${event.authoredAt ?? "—"}${event.setId ? ` · set ${event.setId}` : ""}`,
      ]),
      notes: ["All timeline rows, including replaced values when supplied by the endpoint, are retained as audit evidence. The schedule uses the active event set only."],
    });
  }
  if ((loan.activeEvents?.length ?? 0) > 0) {
    sections.push({
      title: "Mid-term Principal Payment Events",
      head: ["Date", "Amount", "Order / treatment", "Classification & provenance"],
      rows: loan.activeEvents!.map((event) => [
        format(parseISO(event.effectiveDate), "MMMM d, yyyy"),
        cells.amount(Number(event.amount)),
        `${event.ordering === "before_scheduled_payment" ? "Before scheduled payment" : "After scheduled payment"} · #${event.sequence} · ${event.treatment === "keep_maturity" ? "Keep maturity / recast" : "Keep payment / earlier payoff"}`,
        `${event.classification} · ${event.source} · ${event.reason}`,
      ]),
      notes: ["Events are immutable evidence. Editing creates a successor event set; the ordered rows above are the set used for this calculation."],
    });
  }

  /* 2 — Fair value assessment (ASPE 3856) — loans only */
  if (!isCapital) {
    const fvRows: (string | number)[][] = [
      ["Assessment", fvDecisionLabel(loan.fvDecision)],
    ];
    if (usesFairValue(loan)) {
      fvRows.push(["Market (effective) rate", cells.rate(Number(loan.fvRate))]);
      if (booked.fairValue != null) {
        fvRows.push(["Fair value at inception", cells.amount(booked.fairValue)]);
        fvRows.push(["Day-one discount", cells.amount(financed - booked.fairValue)]);
      }
    }
    sections.push({
      title: "Fair Value Assessment (ASPE 3856)",
      head: ["Item", "Detail"],
      rows: fvRows,
    });
    if (loan.fvDecisionHistory) {
      const decision = loan.fvDecisionHistory;
      sections.push({
        title: "Fair Value Decision Status & History",
        head: ["Version / status", "Decision evidence"],
        rows: [
          [
            `Current status: ${decision.status}`,
            decision.reviewRequired
              ? `Review required — ${decision.staleReasons.join("; ") || decision.missingRequirements.join("; ")}`
              : "Confirmed evidence remains current",
          ],
          ...decision.history.map((item) => [
            `Version ${item.version} — ${item.treatment}`,
            [
              `${item.confirmedBy} · ${typeof item.confirmedAt === "string" ? item.confirmedAt : item.confirmedAt.toISOString()}`,
              item.rationaleNote || null,
              `contract ${item.contractFingerprint}`,
              item.eventSetFingerprint ? `events ${item.eventSetFingerprint}` : null,
              `reporting ${item.reportingContextFingerprint}`,
              item.modificationFingerprint ? `modification ${item.modificationFingerprint}` : null,
              `evidence ${item.evidenceVersion} / calculation ${item.calculationVersion}`,
              Object.keys(item.evidence).length ? `evidence inputs: ${JSON.stringify(item.evidence)}` : null,
            ].filter(Boolean).join(" · "),
          ]),
        ],
        notes: ["Prior confirmations are retained as history; a changed contract, event set, reporting context, or modification requires a new confirmation rather than overwriting prior evidence."],
      });
    }
  } else {
    sections.push({
      title: "Capital Lease Calculation",
      head: ["Item", "Detail"],
      rows: [
        ["Discount rate used", cells.rate(summary.interestRate)],
        [
          "Total minimum lease payments",
          cells.amount((summary as CapitalLeaseSummary).totalMinimumPayments),
        ],
        ["Implied interest", cells.amount((summary as CapitalLeaseSummary).impliedInterest)],
        ["Obligation at year end (PV)", cells.amount((summary as CapitalLeaseSummary).obligations)],
      ],
      notes: [
        "These amounts relate to recording the capital lease, after classification.",
      ],
    });
  }

  /* 3 — Continuity for the fiscal year */
  const openingBalance = startedThisFY
    ? 0
    : booked.schedule.filter((r) => !isAfter(r.date, priorYearEnd)).slice(-1)[0]?.balance ??
      (booked.usedFairValue && booked.fairValue != null ? booked.fairValue : financed);
  const advances = startedThisFY
    ? booked.usedFairValue && booked.fairValue != null
      ? booked.fairValue
      : financed
    : 0;
  const interestExpenseFY =
    summary.yearlyInterest.find((y) => y.fiscalYear === reportFY)?.amount ?? 0;
  const principalRepaidFY = summary.principalRepaidCurrentFY;
  const closing = summary.balanceAtYearEnd;
  const continuityCheck = openingBalance + advances - principalRepaidFY;
  sections.push({
    title: `Continuity — Year Ended ${fyeLabel}`,
    head: ["Item", "Amount"],
    rows: [
      ["Opening balance", cells.amount(openingBalance)],
      ["Advances / additions during the year", cells.amount(advances)],
      ["Principal repayments", cells.deduction(principalRepaidFY)],
      ["Closing balance per schedule", cells.amount(closing)],
      ["Interest expense for the year", cells.amount(interestExpenseFY)],
    ],
    notes:
      Math.abs(continuityCheck - closing) > 0.02
        ? [
            `Note: opening + advances − repayments = ${money(continuityCheck)} differs from the closing balance by ${money(Math.abs(continuityCheck - closing))} (rounding and/or effective-interest accretion).`,
          ]
        : undefined,
  });

  /* 4 — Balance sheet presentation & 5-year maturity */
  sections.push({
    title: "Balance Sheet Presentation",
    head: ["Item", "Amount"],
    rows: summary.covenantViolation
      ? [
          ["Balance at year end", cells.amount(summary.balanceAtYearEnd)],
          ["Current portion (entire balance — covenant violation)", cells.amount(summary.currentPortion)],
          ["  Scheduled repayments due within one year", cells.amount(summary.scheduledWithinOneYear)],
          ["  Scheduled repayments due beyond one year, callable", cells.amount(summary.scheduledBeyondOneYear)],
          ["Long-term portion", cells.amount(summary.longTermPortion)],
        ]
      : [
          ["Balance at year end", cells.amount(summary.balanceAtYearEnd)],
          ["Current portion (due within 12 months)", cells.amount(summary.currentPortion)],
          ["Long-term portion", cells.amount(summary.longTermPortion)],
        ],
    notes: summary.covenantViolation
      ? [
          "Note: a financial covenant was violated as at year end, so the entire obligation is classified as current (ASPE 1510).",
        ]
      : undefined,
  });
  sections.push({
    title: "Principal Repayments — Next Five Years (Disclosure)",
    head: ["Fiscal year", "Principal"],
    rows: [
      ...summary.yearlyPrincipal.map((y) => [y.label, cells.amount(y.amount)]),
      ["Total", cells.amount(summary.yearlyPrincipal.reduce((s, y) => s + y.amount, 0))],
    ],
  });
  if (isCapital) {
    const cl = summary as CapitalLeaseSummary;
    sections.push({
      title: "Future Minimum Lease Payments (Disclosure)",
      head: ["Fiscal year", "Payment"],
      rows: [
        ...cl.yearlyBlended.map((y) => [y.label, cells.amount(y.amount)]),
        ["Total minimum lease payments", cells.amount(cl.totalMinimumPayments)],
        ["Less: amount representing interest", cells.deduction(cl.impliedInterest)],
        ["Obligation under capital lease", cells.amount(cl.obligations)],
      ],
    });
  }

  /* 5 — Distinct day-one, recurring annual, and cumulative support */
  if (!isCapital && usesFairValue(loan)) {
    const accounting = loan.fairValueAccountingEntries ?? buildFairValueAccountingEntries({
      loan: { ...loan, startDate: loan.startDate! },
      reportingFiscalYearEnd: meta.fiscalYearEnd,
      decisionHistory: loan.fvDecisionHistory,
    });
    if (accounting.dayOne) {
      sections.push({
        title: "Day-one Fair Value Journal Entry",
        head: ["Date / purpose", "Account", "Debit", "Credit"],
        rows: accounting.dayOne.lines.map((line, index) => [
          index === 0 ? `${accounting.dayOne!.date} — ${accounting.dayOne!.label}` : "",
          line.account,
          line.debit ? cells.amount(line.debit) : "",
          line.credit ? cells.amount(line.credit) : "",
        ]),
        notes: ["Recognition-date measurement uses timing-aware, event-adjusted contractual cash flows. For prime-linked instruments, only the frozen approved recognition-date assumptions are used; realized resets are excluded."],
      });
    }
    sections.push({
      title: "Annual Effective-interest / Accretion Journal Entries",
      head: ["Date / purpose", "Account", "Debit", "Credit"],
      rows: accounting.annualEntries.flatMap((entry) => entry.lines.map((line, index) => [
        index === 0 ? `${entry.date} — ${entry.label}` : "",
        line.account,
        line.debit ? cells.amount(line.debit) : "",
        line.credit ? cells.amount(line.credit) : "",
      ])),
      notes: ["Each entry contains only that fiscal year's effective-interest activity less stated contractual interest. Opening retained earnings is not part of the recurring entry."],
    });
    sections.push({
      title: `Cumulative Fair Value Reconciliation — As At ${fyeLabel} (Support Only)`,
      head: ["Fiscal year", "Day one", "Prior years", "Current year", "Remaining discount"],
      rows: accounting.cumulativeSupport.map((item) => [
        String((item.evidence.fiscalYear as number | undefined) ?? item.date),
        cells.amount(item.dayOneDifference),
        cells.amount(item.priorYearsAccretion),
        cells.amount(item.currentYearAccretion),
        cells.amount(item.remainingDiscount),
      ]),
      notes: ["Supporting cumulative catch-up only; do not post it in addition to the distinct day-one and annual entries."],
    });
  }

  /* 6 — Security / collateral */
  const collateralRows: (string | number)[][] = [];
  if (loan.collateralType) {
    collateralRows.push(["Collateral", loan.collateralDescription || loan.collateralType]);
    if (summary.collateralNbv != null) {
      collateralRows.push(["Net book value at year end", cells.amount(summary.collateralNbv)]);
    }
  }
  if (loan.securityClauses && loan.securityClauses.length > 0) {
    collateralRows.push(["Security clauses", loan.securityClauses.join("; ")]);
  } else if (master?.securityDescription) {
    // Facility doesn't state its own security — fall back to the master
    // agreement's shared security wording.
    collateralRows.push(["Security (per master agreement)", master.securityDescription]);
  }
  if (master?.covenantDescription) {
    collateralRows.push(["Covenants (per master agreement)", master.covenantDescription]);
  }
  if (master) {
    collateralRows.push([
      "Master agreement",
      `${master.lender}${master.description ? ` — ${master.description}` : ""}${master.facilityLimit != null ? ` (overall limit ${money(Number(master.facilityLimit))})` : ""}`,
    ]);
  }
  if (collateralRows.length > 0) {
    sections.push({
      title: "Security & Related Assets",
      head: ["Item", "Detail"],
      rows: collateralRows,
      notes: ["Cross-reference the related asset workpaper for cost and accumulated amortization support."],
    });
  }

  /* 7 — Disclosure narrative */
  sections.push({
    title: "Draft Note Disclosure",
    head: ["Narrative"],
    rows: [[summary.description]],
  });

  return {
    loanName: summary.name,
    typeLabel,
    clientName: meta.clientName,
    fyeLabel,
    sections,
    schedule: booked.schedule,
    printRateEvidence: printRateTimeline(loan),
  };
}

function buildOperatingLeaseWorkpaper(
  loan: WorkpaperLoanInput,
  summary: OperatingLeaseSummary,
  meta: WorkpaperMeta,
  fyeLabel: string,
  reportYearEnd: Date,
  cells: ReportNumbers,
): Workpaper {
  const { month: fyEndMonth, day: fyEndDay } = getFyEndParts(meta.fiscalYearEnd);
  const reportFY = getFiscalYear(reportYearEnd, fyEndMonth, fyEndDay);
  const sections: WpSection[] = [];

  const termsRows: (string | number)[][] = [
    ["Lessor", summary.counterparty ?? "—"],
    ["Monthly payment", cells.amount(summary.monthlyPayment)],
    ["Start date", format(parseISO(summary.startDate), "MMMM d, yyyy")],
    ["Term", `${summary.termMonths} months`],
    ["Total lease commitment", cells.amount(summary.totalCommitment)],
  ];
  if (loan.firstPaymentAmount != null)
    termsRows.push(["First financing rental", cells.amount(Number(loan.firstPaymentAmount))]);
  if ((loan.freeRentMonths ?? 0) > 0) termsRows.push(["Free rent period", `${loan.freeRentMonths} months`]);
  if (Number(loan.tenantImprovementAllowance ?? 0) > 0)
    termsRows.push(["Tenant improvement allowance", cells.amount(Number(loan.tenantImprovementAllowance))]);
  if (Number(loan.otherInducements ?? 0) > 0)
    termsRows.push(["Other inducements", cells.amount(Number(loan.otherInducements))]);
  sections.push({ title: "Terms", head: ["Item", "Detail"], rows: termsRows });


  const slExpenseFY =
    summary.yearlyStraightLine.find((y) => y.fiscalYear === reportFY)?.amount ?? 0;
  sections.push({
    title: `Rent Expense — Year Ended ${fyeLabel}`,
    head: ["Item", "Amount"],
    rows: [
      ["Straight-line monthly expense", cells.amount(summary.monthlyStraightLineExpense)],
      ["Straight-line rent expense for the year", cells.amount(slExpenseFY)],
      ["Cash rent for the year", cells.amount(summary.yearlyCash.find((y) => y.fiscalYear === reportFY)?.amount ?? 0)],
      ["Deferred rent (liability) at year end", cells.amount(summary.deferredRentAtYearEnd)],
      ["Total inducements", cells.amount(summary.totalInducements)],
      ["Inducement liability — current", cells.amount(summary.inducementLiabilityCurrent)],
      ["Inducement liability — non-current", cells.amount(summary.inducementLiabilityNonCurrent)],
    ],
    notes: [
      "Rent is recognized on a straight-line basis over the lease term; inducements are amortized as a reduction of rent expense (ASPE 3065.27).",
    ],
  });

  sections.push({
    title: "Future Minimum Lease Payments (Disclosure)",
    head: ["Fiscal year", "Payment"],
    rows: [
      ...summary.yearlyPayments.map((y) => [y.label, cells.amount(y.amount)]),
      ["Total", cells.amount(summary.yearlyPayments.reduce((s, y) => s + y.amount, 0))],
    ],
  });

  sections.push({
    title: "Draft Note Disclosure",
    head: ["Narrative"],
    rows: [[summary.description]],
  });

  return {
    loanName: summary.name,
    typeLabel: "Operating Lease",
    clientName: meta.clientName,
    fyeLabel,
    sections,
    schedule: null,
  };
}

/* ── PDF rendering ───────────────────────────────────────────── */

function workpaperIdentity(wp: Workpaper, inPackage: boolean) {
  return { title: `${inPackage ? "Consolidated Workpapers  /  " : ""}${wp.typeLabel} Workpaper`,
    subject: `${wp.loanName}\n${wp.clientName}`, period: `Year ended ${wp.fyeLabel}` };
}

function renderWorkpaperPdf(report: PrintReport, wp: Workpaper, inPackage: boolean) {
  const identity = workpaperIdentity(wp, inPackage);
  if (inPackage) report.newPart(identity, "portrait");
  // The paper review order is independent of the workbook's tab order.
  const summaryFirst = (s: WpSection) => /^(Continuity|Rent Expense|Balance Sheet Presentation|Principal Repayments|Future Minimum Lease Payments)/.test(s.title) ? 0 : 1;
  let orientation: Orientation = "portrait";
  const sections = [...wp.sections];
  if (wp.printRateEvidence) {
    const i = sections.findIndex(s => s.title === wp.printRateEvidence!.title);
    sections.splice(i < 0 ? sections.length : i, i < 0 ? 0 : 1, wp.printRateEvidence);
  }
  for (const section of sections.sort((a, b) => summaryFirst(a) - summaryFirst(b))) {
    const wide = section.head.length >= 5 && section.head.includes("Origin / provenance");
    const desired = wide ? "landscape" : "portrait";
    if (desired !== orientation) { report.newPart(identity, desired); orientation = desired; }
    const right = section.head.flatMap((h,i) => /^(amount|principal|payment|debit|credit|day one|prior years|current year|remaining discount)$/i.test(h) ? [i] : []);
    report.table({ ...section, widths: section.head.length === 2 ? (right.includes(1) ? [65,35] : [30,70]) : wide ? wp.printRateEvidence?.widths : undefined, right });
  }
  if (wp.schedule?.length) {
    report.newPart(identity, scheduleOrientation(wp.schedule));
    printPayments(report, "Appendix — Full Amortization Schedule", wp.schedule);
  }
}

export function exportLoanWorkpaperPdf(wp: Workpaper): void {
  const report = new PrintReport(workpaperIdentity(wp, false));
  renderWorkpaperPdf(report, wp, false);
  report.finish().save(`${wp.loanName}_Workpaper.pdf`);
}

/* ── Excel rendering ───────────────────────────────────────────── */

export async function exportLoanWorkpaperXlsx(wp: Workpaper): Promise<void> {
  // The table-aware writer is only loaded when downloading an individual workpaper.
  const { buildAgreementWorkbook } = await import("./agreement-workbook");
  const buffer = await buildAgreementWorkbook(wp).xlsx.writeBuffer();
  saveAs(new Blob([new Uint8Array(buffer)], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  }), `${wp.loanName}_Workpaper.xlsx`);
}

/* ── Combined file (lead sheet) exports ──────────────────────── */

export interface FileWorkpaperInput {
  clientName: string;
  fiscalYearEnd: string;
  loans: WorkpaperLoanInput[];
  masters?: WorkpaperMasterInput[];
}

/** Order loans so facilities sit together under their master agreement
 *  (masters in list order, standalone items after), preserving relative order otherwise. */
function orderByMaster(loans: WorkpaperLoanInput[], masters: WorkpaperMasterInput[]): WorkpaperLoanInput[] {
  if (masters.length === 0) return loans;
  const byMaster = new Map(masters.map((m) => [m.id, m]));
  const grouped: WorkpaperLoanInput[] = [];
  for (const m of masters) {
    grouped.push(...loans.filter((l) => l.masterAgreementId === m.id));
  }
  grouped.push(...loans.filter((l) => !l.masterAgreementId || !byMaster.has(l.masterAgreementId)));
  return grouped;
}

export interface LeadSheetData {
  debtRows: (string | number)[][];
  debtTotals: (string | number)[];
  debtBreakdownRows: (string | number)[][];
  debtNotes: string[];
  operatingRows: (string | number)[][];
  operatingTotals: (string | number)[] | null;
  fyeLabel: string;
}

export function buildLeadSheet(input: FileWorkpaperInput, workpapers: Workpaper[],
  cells = displayNumbers,
): LeadSheetData {
  const reportYearEnd = parseISO(input.fiscalYearEnd);
  const { month: fyEndMonth, day: fyEndDay } = getFyEndParts(input.fiscalYearEnd);
  const reportFY = getFiscalYear(reportYearEnd, fyEndMonth, fyEndDay);

  const debtRows: (string | number)[][] = [];
  const operatingRows: (string | number)[][] = [];
  let tBal = 0, tCur = 0, tLt = 0, tInt = 0;
  let tRent = 0, tCommit = 0;
  let tWithin = 0, tBeyond = 0;
  const violatedNames: string[] = [];

  const masterById = new Map((input.masters ?? []).map((m) => [m.id, m]));
  const loanById = new Map(input.loans.map((loan) => [loan.id, loan]));
  const linkedPredecessors = new Set(
    input.loans
      .filter((loan) => loan.modificationAssessment?.status === "confirmed")
      .map((loan) => loan.predecessorAgreementId)
      .filter((id): id is string => !!id),
  );
  for (const loan of orderByMaster(input.loans, input.masters ?? [])) {
    if (linkedPredecessors.has(loan.id)) continue;
    const summary = buildLoanSummary({
      ...loan,
      predecessorAgreement: loan.predecessorAgreementId
        ? loanById.get(loan.predecessorAgreementId) as BookedScheduleInput | undefined
        : loan.predecessorAgreement,
    }, reportYearEnd, input.fiscalYearEnd);
    if (!summary) continue;
    if ("monthlyStraightLineExpense" in summary) {
      const sl = summary.yearlyStraightLine.find((y) => y.fiscalYear === reportFY)?.amount ?? 0;
      operatingRows.push([
        summary.name,
        summary.counterparty ?? "—",
        cells.amount(summary.monthlyPayment),
        cells.amount(sl),
        cells.amount(summary.deferredRentAtYearEnd),
        cells.amount(summary.totalCommitment),
      ]);
      tRent += sl;
      tCommit += summary.totalCommitment;
    } else {
      const s = summary as LoanSummary | CapitalLeaseSummary;
      const interestFY = s.yearlyInterest.find((y) => y.fiscalYear === reportFY)?.amount ?? 0;
      const master = loan.masterAgreementId ? masterById.get(loan.masterAgreementId) : undefined;
      let baseType = s.isCapitalLease ? "Capital lease" : "Loan";
      if (master) baseType = `${baseType} — ${master.lender} master agreement`;
      debtRows.push([
        s.name,
        s.covenantViolation ? `${baseType} — covenant violation` : baseType,
        cells.rate(s.interestRate),
        s.maturityDate,
        cells.amount(s.balanceAtYearEnd),
        cells.amount(s.currentPortion),
        cells.amount(s.longTermPortion),
        cells.amount(interestFY),
      ]);
      tBal += s.balanceAtYearEnd;
      tCur += s.currentPortion;
      tLt += s.longTermPortion;
      tInt += interestFY;
      tWithin += s.scheduledWithinOneYear;
      tBeyond += s.scheduledBeyondOneYear;
      if (s.covenantViolation) violatedNames.push(s.name);
    }
  }

  const debtBreakdownRows: (string | number)[][] =
    tBeyond > 0
      ? [
          ["  Scheduled repayments due within one year", "", "", "", "", cells.amount(tWithin), "", ""],
          [
            "  Scheduled repayments due beyond one year, callable on covenant violation",
            "",
            "",
            "",
            "",
            cells.amount(tBeyond),
            "",
            "",
          ],
        ]
      : [];
  const debtNotes: string[] =
    violatedNames.length > 0
      ? [
          `Covenant violation: ${violatedNames.join(", ")} — a financial covenant was violated as at year end, so the entire obligation is classified as current (ASPE 1510). Amount otherwise due beyond one year but callable: ${money(tBeyond)}.`,
        ]
      : [];

  return {
    debtRows,
    debtTotals: ["Total", "", "", "", cells.amount(tBal), cells.amount(tCur), cells.amount(tLt), cells.amount(tInt)],
    debtBreakdownRows,
    debtNotes,
    operatingRows,
    operatingTotals:
      operatingRows.length > 0
        ? ["Total", "", "", cells.amount(tRent), "", cells.amount(tCommit)]
        : null,
    fyeLabel: workpapers[0]?.fyeLabel ?? format(reportYearEnd, "MMMM d, yyyy"),
  };
}

export const DEBT_LEAD_HEAD = ["Name", "Type", "Rate", "Maturity", "Balance", "Current", "Long-term", "Interest exp."];
export const OP_LEAD_HEAD = ["Name", "Lessor", "Monthly", "SL rent exp.", "Deferred rent", "Commitment"];

export function buildFileWorkpapers(input: FileWorkpaperInput, cells = displayNumbers): Workpaper[] {
  const meta: WorkpaperMeta = { clientName: input.clientName, fiscalYearEnd: input.fiscalYearEnd };
  const masterById = new Map((input.masters ?? []).map((m) => [m.id, m]));
  const loanById = new Map(input.loans.map((loan) => [loan.id, loan]));
  const linkedPredecessors = new Set(
    input.loans
      .filter((loan) => loan.modificationAssessment?.status === "confirmed")
      .map((loan) => loan.predecessorAgreementId)
      .filter((id): id is string => !!id),
  );
  return orderByMaster(input.loans, input.masters ?? [])
    .filter((loan) => !linkedPredecessors.has(loan.id))
    .map((loan) =>
      buildLoanWorkpaper(
        {
          ...loan,
          predecessorAgreement: loan.predecessorAgreementId
            ? loanById.get(loan.predecessorAgreementId) as BookedScheduleInput | undefined
            : loan.predecessorAgreement,
        },
        meta,
        loan.masterAgreementId ? (masterById.get(loan.masterAgreementId) ?? null) : null,
        cells,
      ),
    )
    .filter((wp): wp is Workpaper => wp != null);
}

function renderLeadSheetPdf(input: FileWorkpaperInput, lead: LeadSheetData, inPackage: boolean) {
  const report = new PrintReport({ title: inPackage ? "Consolidated Workpapers  /  Lead Sheet" : "Debt & Lease Lead Sheet",
    subject: input.clientName, period: `Year ended ${lead.fyeLabel}` }, "landscape");
  if (lead.debtRows.length) {
    report.table({ title: "Loans and capital leases", head: ["Agreement", "Type", "Rate", "Maturity", "Balance", "Current", "Long-term", "Interest expense"], rows: lead.debtRows,
      foot: [lead.debtTotals], widths: [20, 13, 7, 12, 12, 12, 12, 12], right: [2, 4, 5, 6, 7] });
    if (lead.debtBreakdownRows.length) report.table({ title: "Scheduled repayments and callable debt", head: ["Classification", "Amount"],
      rows: lead.debtBreakdownRows.map(r => [String(r[0]).trim(), r[5]]), widths: [75,25], right: [1] });
    lead.debtNotes.forEach(note => report.paragraph(note, 9.5));
  }
  if (lead.operatingRows.length) report.table({ title: "Operating leases", head: ["Agreement", "Lessor", "Monthly payment", "Straight-line rent expense", "Deferred rent", "Commitment"], rows: lead.operatingRows,
    foot: lead.operatingTotals ? [lead.operatingTotals] : undefined, widths: [24,20,14,14,14,14], right: [2,3,4,5] });
  return report;
}

export function exportFileWorkpapersPdf(input: FileWorkpaperInput): void {
  const workpapers = buildFileWorkpapers(input);
  if (!workpapers.length) return;
  const report = renderLeadSheetPdf(input, buildLeadSheet(input, workpapers), true);
  for (const wp of workpapers) renderWorkpaperPdf(report, wp, true);
  report.finish().save(`${input.clientName}_Debt_Lease_Workpapers.pdf`);
}

export function exportFileLeadSheetPdf(input: FileWorkpaperInput): void {
  const workpapers = buildFileWorkpapers(input);
  if (!workpapers.length) return;
  renderLeadSheetPdf(input, buildLeadSheet(input, workpapers), false).finish().save(`${input.clientName}_Debt_Lease_Summary.pdf`);
}

async function downloadFileWorkbook(input: FileWorkpaperInput, includeDetails: boolean) {
  const { buildFileWorkbook } = await import('./file-report-workbook');
  const { saveWorkbook } = await import('./excel-report-style');
  const workbook = buildFileWorkbook(input, includeDetails);
  if (!workbook) throw new Error('No reportable agreements were found in this Year-End File.');
  await saveWorkbook(workbook, `${input.clientName}_Debt_Lease_${includeDetails ? "Workpapers" : "Summary"}.xlsx`);
}

export const exportFileWorkpapersXlsx = (input: FileWorkpaperInput) => downloadFileWorkbook(input, true);
export const exportFileLeadSheetXlsx = (input: FileWorkpaperInput) => downloadFileWorkbook(input, false);
