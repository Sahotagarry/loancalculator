import { parseISO, addMonths, addYears, isAfter, isBefore } from "date-fns";
import { calculateProspectiveModificationSchedule } from "@workspace/amortization";
import { isOperatingLeaseLoan, PROSPECTIVE_EIR_EVIDENCE_WARNING } from "./aspe-utils";

/* ── Types ───────────────────────────────────────────────────── */

export type DiagnosticSeverity = "error" | "warning" | "info";

export interface DiagnosticFinding {
  id: string;
  severity: DiagnosticSeverity;
  message: string;
  suggestion: string;
  actionHref?: string;
  actionLabel?: string;
}

export interface LoanDiagnosticInput {
  id: string;
  name: string;
  description?: string | null;
  counterparty?: string | null;
  isCapitalLease: boolean;
  principal: string | number;
  interestRate: string | number;
  rateType?: "fixed" | "prime_linked" | string | null;
  rateBenchmark?: string | null;
  contractualPrimeName?: string | null;
  benchmarkEquivalentToContractualPrime?: boolean | null;
  rateSpread?: string | number | null;
  rateResetFrequency?: string | null;
  rateEffectiveConvention?: string | null;
  ratePaymentTreatment?: string | null;
  initialFvRateAssumption?: Record<string, unknown> | null;
  rateTimelineEvents?: Array<{ effectiveDate: string; observationDate?: string | null; setId?: string | null }> | null;
  activeRateSetId?: string | null;
  amortizationYears: number;
  termYears: number;
  startDate: string;
  paymentFrequency: string;
  paymentTiming?: "beginning" | "end" | null;
  graceTermMode?: "included" | "added" | null;
  firstPaymentDate?: string | null;
  semiMonthlyFirstDueDay?: number | null;
  semiMonthlySecondDueDay?: number | null;
  graceMonths?: number | null;
  balloonPayment?: string | number | null;
  transferOfOwnership?: boolean;
  bargainPurchaseOption?: boolean;
  leaseTermPct?: string | number | null;
  pvPctFairValue?: string | number | null;
  fairValue?: string | number | null;
  specializedAsset?: boolean;
  assetDescription?: string | null;
  assetCost?: string | number | null;
  assetUsefulLife?: number | null;
  capitalLeaseRationale?: string | null;
  monthlyPayment?: string | number | null;
  termMonths?: number | null;
  isOfficeProperty?: boolean;
  freeRentMonths?: number;
  rentEscalationRate?: string | number | null;
  tenantImprovementAllowance?: string | number | null;
  otherInducements?: string | number | null;
  fvRate?: string | number | null;
  fvDecision?: string | null;
  fvDecisionNote?: string | null;
  securityClauses?: string[] | null;
  collateralType?: string | null;
  collateralDescription?: string | null;
  collateralDepreciableCost?: string | number | null;
  collateralUsefulLifeYears?: number | null;
  collateralMethod?: string | null;
  collateralDecliningRate?: string | number | null;
  collateralInServiceDate?: string | null;
  fvDecisionHistory?: any; // FairValueDecisionHistory
  dismissedFindings?: string[] | null;
  currentRevisionId?: string | null;
  activeEventSetId?: string | null;
  activeEventSetVersion?: number | null;
  activeEventSetHash?: string | null;
  activeEvents?: Array<{
    id: string; effectiveDate: string; amount: number; sequence: number;
    ordering: "before_scheduled_payment" | "after_scheduled_payment";
    treatment: "keep_payment" | "keep_maturity"; classification: "ordinary" | "agreement_change";
    termRevisionId: string;
  }> | null;
  predecessorAgreementId?: string | null;
  modificationEffectiveDate?: string | null;
  modificationAssessment?: {
    status?: string;
    conclusion?: { accountingTreatment?: string; rationale?: string };
    evidence?: {
      quantitativeTest?: {
        carryingAmount?: number;
        retainedFeesAndCosts?: number;
        newFeesAndCosts?: number;
        modifiedCashFlows?: Array<{
          date: string;
          amount: number;
          description?: string;
          sourceReference?: string;
        }>;
        sameDayPaymentTreatment?: "include" | "exclude";
      } | null;
    };
  } | null;
}

export interface FileDiagnosticInput {
  id: string;
  clientId: string;
  fiscalYearEnd: string;
  trivialThreshold?: number | null;
  materiality?: number | null;
  dismissedFindings?: string[] | null;
}

export type LoanKind = "loan" | "capital_lease" | "operating_lease";

export interface LoanDiagnosticsResult {
  loanId: string;
  loanName: string;
  kind: LoanKind;
  kindLabel: string;
  findings: DiagnosticFinding[];
  dismissed: DiagnosticFinding[];
}

export interface FileDiagnosticsResult {
  fileFindings: DiagnosticFinding[];
  fileDismissed: DiagnosticFinding[];
  loans: LoanDiagnosticsResult[];
  totals: { errors: number; warnings: number; infos: number };
}

/* ── Helpers ─────────────────────────────────────────────────── */

function num(v: string | number | null | undefined): number {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function blank(v: string | null | undefined): boolean {
  return v == null || v.trim() === "";
}

export function getLoanKind(loan: LoanDiagnosticInput): LoanKind {
  if (loan.isCapitalLease) return "capital_lease";
  if (isOperatingLeaseLoan({ ...loan, isCapitalLease: !!loan.isCapitalLease })) {
    return "operating_lease";
  }
  return "loan";
}

const KIND_LABELS: Record<LoanKind, string> = {
  loan: "Loan",
  capital_lease: "Capital Lease",
  operating_lease: "Operating Lease",
};

/* ── Loan-level checks ───────────────────────────────────────── */

export function runLoanDiagnostics(
  loan: LoanDiagnosticInput,
  file: FileDiagnosticInput,
): LoanDiagnosticsResult {
  const kind = getLoanKind(loan);
  const findings: DiagnosticFinding[] = [];
  const fye = parseISO(file.fiscalYearEnd);
  const start = loan.startDate ? parseISO(loan.startDate) : null;

  const add = (id: string, severity: DiagnosticSeverity, message: string, suggestion: string, actionHref?: string, actionLabel?: string) =>
    findings.push({ id, severity, message, suggestion, actionHref, actionLabel });

  /* Common checks */
  if (blank(loan.counterparty)) {
    add(
      "counterparty",
      "warning",
      kind === "loan" ? "No lender recorded" : "No lessor recorded",
      "Add the lender/lessor name so the workpaper and note disclosure identify the counterparty.",
    );
  }
  if (blank(loan.description)) {
    add(
      "description",
      "info",
      "No description recorded",
      "A short description (purpose, asset financed) makes workpapers easier for reviewers to follow.",
    );
  }
  if (start && isAfter(start, fye)) {
    add(
      "start-after-fye",
      "warning",
      "Start date is after this file's fiscal year end",
      "This item has no activity in the current year. Confirm the start date or the file's year end.",
    );
  }
  if (loan.firstPaymentDate && isNaN(parseISO(loan.firstPaymentDate).getTime())) {
    add("first-payment-date-invalid", "error", "First payment date is invalid", "Enter a valid contractual first payment date, or clear it only when retaining a legacy schedule anchor.");
  }
  if (loan.paymentFrequency === "semi-monthly") {
    const first = loan.semiMonthlyFirstDueDay;
    const second = loan.semiMonthlySecondDueDay;
    if (first == null || second == null) {
      add("semi-monthly-due-days-missing", "warning", "Semi-monthly due days are not recorded", "Record both contractual due days (1–31); do not infer them from the payment frequency.");
    } else if (first < 1 || first > 31 || second < 1 || second > 31 || first === second) {
      add("semi-monthly-due-days-invalid", "error", "Semi-monthly due days are invalid", "Enter two distinct due days from 1 through 31.");
    }
  }
  if ((loan.graceMonths ?? 0) > 0 && loan.graceTermMode === "included" && loan.termYears * 12 <= loan.graceMonths!) {
    add("grace-term-inconsistent", "error", "Included grace period consumes the stated term", "Increase the stated term, reduce grace months, or mark grace as added to the term.");
  }
  const events = loan.activeEvents ?? [];
  const transitionParts = [
    !!loan.predecessorAgreementId,
    !!loan.modificationEffectiveDate,
    !!loan.modificationAssessment,
  ];
  if (transitionParts.some(Boolean) && !transitionParts.every(Boolean)) {
    add(
      "modification-assessment-unresolved",
      "error",
      "Agreement transition is linked but its assessment is unresolved",
      "Select the predecessor, effective date, and confirmed modification assessment together.",
    );
  } else if (transitionParts.every(Boolean) && loan.modificationAssessment?.status !== "confirmed") {
    add(
      "modification-assessment-unconfirmed",
      "error",
      "Linked predecessor assessment is not confirmed",
      "Confirm whether the change is a modification continuation or an extinguishment before reporting it.",
    );
  } else if (
    loan.modificationAssessment?.status === "confirmed" &&
    loan.modificationAssessment.conclusion?.accountingTreatment === "new_lease" &&
    kind === "loan"
  ) {
    add(
      "new-lease-classification-inconsistent",
      "error",
      "New-lease treatment is selected for a successor classified as a loan",
      "ASPE 3065 new-lease treatment requires a capital or operating lease successor; correct the classification or conclude debt accounting.",
    );
  }
  if (
    loan.modificationAssessment?.status === "confirmed" &&
    loan.modificationAssessment.conclusion?.accountingTreatment === "continuation"
  ) {
    try {
      const quantitative = loan.modificationAssessment.evidence?.quantitativeTest;
      if (
        !loan.modificationEffectiveDate ||
        !quantitative ||
        !Array.isArray(quantitative.modifiedCashFlows) ||
        quantitative.modifiedCashFlows.length === 0
      ) {
        throw new Error("Incomplete prospective effective-interest evidence");
      }
      calculateProspectiveModificationSchedule({
        effectiveDate: parseISO(loan.modificationEffectiveDate),
        openingCarryingAmount: quantitative.carryingAmount!,
        retainedFeesAndCosts: quantitative.retainedFeesAndCosts!,
        newFeesAndCosts: quantitative.newFeesAndCosts!,
        modifiedCashFlows: quantitative.modifiedCashFlows.map((flow) => ({
          date: parseISO(flow.date),
          amount: flow.amount,
          description: flow.description ?? "",
          sourceReference: flow.sourceReference ?? "",
        })),
        sameDayPaymentTreatment: quantitative.sameDayPaymentTreatment!,
      });
    } catch {
      add(
        "prospective-eir-evidence-invalid",
        "error",
        PROSPECTIVE_EIR_EVIDENCE_WARNING,
        "Correct the carrying amount, fee and cost treatment, same-day treatment, and dated modified cash flows, then reconfirm the assessment.",
      );
    }
  }
  if (events.length > 0 && !loan.activeEventSetId) {
    add("event-set-missing", "error", "Active payment events have no active event-set evidence", "Refresh the loan and confirm the event set was saved as a successor version.");
  }
  if (events.length > 0 && (!loan.activeEventSetHash || loan.activeEventSetVersion == null)) {
    add("event-set-fingerprint-missing", "warning", "Payment-event set fingerprint or version is missing", "Record a versioned event set so the schedule calculation can be reproduced.");
  }
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (isNaN(parseISO(event.effectiveDate).getTime()) || event.amount <= 0) {
      add("event-invalid-values", "error", "A payment event has an invalid date or non-positive amount", "Correct the event in a successor event set.");
      break;
    }
    if (event.termRevisionId !== loan.currentRevisionId) {
      add("event-stale-revision", "warning", "A payment event is linked to a stale contract revision", "Review the event against the current contractual terms and create a successor event set if appropriate.");
      break;
    }
    if (event.classification === "agreement_change") {
      add("event-agreement-change", "warning", "A principal payment is classified as an agreement change", "Complete the renewal/modification assessment before treating this as an ordinary prepayment.");
      break;
    }
    const prior = events[i - 1];
    if (prior && `${prior.effectiveDate}|${prior.ordering}|${prior.sequence}` >= `${event.effectiveDate}|${event.ordering}|${event.sequence}`) {
      add("event-ordering", "error", "Active payment events are not in canonical order", "Create a successor set ordered by effective date, before/after scheduled payment, then sequence.");
      break;
    }
  }

  if (loan.rateType === "prime_linked") {
    if (!loan.rateBenchmark || !loan.contractualPrimeName || loan.rateSpread == null ||
        !loan.rateResetFrequency || !loan.rateEffectiveConvention || !loan.ratePaymentTreatment) {
      add("prime-reset-terms-missing", "error", "Prime-linked loan is missing contractual reset terms", "Record the benchmark, lender prime distinction, spread, reset frequency, effective-date convention, and payment treatment.");
    }
    if (!loan.initialFvRateAssumption || Object.keys(loan.initialFvRateAssumption).length === 0) {
      add("prime-fv-assumption-not-frozen", "error", "Prime-linked day-one FV assumption is not frozen", "Approve and save the recognition-date expected-rate assumption separately from realized resets.");
    }
    if (loan.benchmarkEquivalentToContractualPrime !== true &&
        loan.rateBenchmark && !((loan.rateTimelineEvents ?? []).some((e) => !!e.observationDate))) {
      add("lender-prime-unsupported", "warning", "Public benchmark equivalence to lender prime is unconfirmed", "Do not use the public benchmark as a fallback; obtain lender-equivalence evidence or enter a documented override.");
    }
    if ((loan.rateTimelineEvents ?? []).some((e) => !e.observationDate)) {
      add("prime-observation-unresolved", "error", "A required prime reset observation is unresolved", "Retrieve the observation or enter an evidenced override from its contractual effective date.");
    }
    if (loan.activeRateSetId && (loan.rateTimelineEvents ?? []).some((e) => e.setId && e.setId !== loan.activeRateSetId)) {
      add("rate-timeline-stale-revision", "warning", "Rate timeline includes a stale event-set revision", "Use the active event-set fingerprint for the calculation; retain prior events as historical evidence only.");
    }
  }

  if (kind === "loan") {
    /* Fair value assessment (ASPE 3856) */
    const fvUrl = `/client/${(file as any).clientId || "..."}/file/${(file as any).id || "..."}/loan/${loan.id}#fv-decision`;
    if (loan.fvDecisionHistory) {
      const history = loan.fvDecisionHistory;
      if (history.status === "incomplete") {
        const rate = num(loan.interestRate);
        const fvSeverity: DiagnosticSeverity = rate < 1 ? "error" : rate <= 3 ? "warning" : "info";
        add(
          "fv-pending",
          fvSeverity,
          "Fair value assessment not completed (ASPE 3856)",
          rate > 3
            ? "The stated rate is above 3%, so the fair value difference is likely small — complete the assessment or dismiss this if not applicable."
            : "Open the loan and complete the fair value assessment: adopt a market-rate schedule, or document why the difference is trivial/immaterial.",
          fvUrl,
          "Complete assessment"
        );
      } else if (history.status === "stale") {
        add(
          "fv-stale",
          "warning",
          "Fair value assessment is stale",
          `The assessment must be reviewed because: ${history.staleReasons.join("; ") || "underlying evidence changed"}.`,
          fvUrl,
          "Review assessment"
        );
      }

      const currentDecision = history.current;
      if (currentDecision) {
        if (currentDecision.treatment === "use_fv" && num(currentDecision.marketEffectiveRate) === 0) {
          add(
            "fv-rate-missing",
            "error",
            "Fair value adopted but no market rate entered",
            "Enter the market interest rate used to book the fair value schedule.",
            fvUrl,
            "Edit market rate"
          );
        }
        if (currentDecision.treatment !== "use_fv" && blank(currentDecision.rationaleNote)) {
          add(
            "fv-note-missing",
            "warning",
            `Fair value difference marked ${currentDecision.treatment} with no supporting note`,
            "Add a short note documenting the rationale so the file supports the conclusion.",
            fvUrl,
            "Add supporting note"
          );
        }
      }
    } else {
      // Fallback for when history is not available
      if (blank(loan.fvDecision)) {
        const rate = num(loan.interestRate);
        const fvSeverity: DiagnosticSeverity = rate < 1 ? "error" : rate <= 3 ? "warning" : "info";
        add(
          "fv-pending",
          fvSeverity,
          "Fair value assessment not completed (ASPE 3856)",
          rate > 3
            ? "The stated rate is above 3%, so the fair value difference is likely small — complete the assessment or dismiss this if not applicable."
            : "Open the loan and complete the fair value assessment: adopt a market-rate schedule, or document why the difference is trivial/immaterial.",
        );
      } else {
        if (loan.fvDecision === "use_fv" && num(loan.fvRate) === 0) {
          add(
            "fv-rate-missing",
            "error",
            "Fair value adopted but no market rate entered",
            "Enter the market interest rate used to book the fair value schedule.",
          );
        }
        if (loan.fvDecision !== "use_fv" && blank(loan.fvDecisionNote)) {
          add(
            "fv-note-missing",
            "warning",
            `Fair value difference marked ${loan.fvDecision === "trivial" ? "trivial" : "immaterial"} with no supporting note`,
            "Add a short note documenting the rationale so the file supports the conclusion.",
          );
        }
      }
    }

    if (num(loan.interestRate) === 0) {
      add(
        "zero-rate",
        "warning",
        "Interest rate is 0% on a loan",
        "Zero-rate related-party or forgivable loans usually need a fair value adjustment — confirm the rate and the ASPE 3856 assessment.",
      );
    }
    /* Security */
    const hasSecurity =
      (loan.securityClauses?.length ?? 0) > 0 ||
      !blank(loan.collateralType) ||
      !blank(loan.collateralDescription);
    if (!hasSecurity) {
      add(
        "security-missing",
        "warning",
        "No security / collateral documented",
        "Record the security clauses or pledged collateral — ASPE 3856 requires disclosure of security for indebtedness.",
      );
    }
    /* Specific charge claimed but no matching collateral asset: the note
       would name pledged assets without their NBV — a disclosure deficiency. */
    const clauses = loan.securityClauses ?? [];
    const hasEquipCharge = clauses.includes("Specific charge on equipment");
    const hasRealPropCharge = clauses.includes(
      "Specific charge / mortgage on real property (land & building)",
    );
    const collType = loan.collateralType ?? "";
    const equipTracked = collType === "equipment";
    const realPropTracked =
      collType === "building" || collType === "land" || collType === "land_and_building";
    if (hasEquipCharge && !equipTracked) {
      add(
        "charge-equip-no-nbv",
        "warning",
        "Specific charge on equipment claimed but no equipment collateral is set up",
        "ASPE 3856 requires disclosing the net book value of pledged assets. Set the collateral asset type to Equipment and enter its cost and depreciation inputs, or remove the specific charge clause.",
      );
    }
    if (hasRealPropCharge && !realPropTracked) {
      add(
        "charge-realprop-no-nbv",
        "warning",
        "Specific charge on real property claimed but no property collateral is set up",
        "ASPE 3856 requires disclosing the net book value of pledged assets. Set the collateral asset type to Building, Land, or Land & Building and enter its costs, or remove the specific charge clause.",
      );
    }
    if (!blank(loan.collateralType) && blank(loan.collateralDescription)) {
      add(
        "collateral-desc",
        "info",
        "Collateral type set but no description",
        "Add a brief description of the pledged asset for the note disclosure.",
      );
    }
    if (
      !blank(loan.collateralType) &&
      loan.collateralType !== "land" &&
      num(loan.collateralDepreciableCost) > 0
    ) {
      const slMissing = loan.collateralMethod !== "declining_balance" && !loan.collateralUsefulLifeYears;
      const dbMissing = loan.collateralMethod === "declining_balance" && num(loan.collateralDecliningRate) === 0;
      if (slMissing || dbMissing) {
        add(
          "collateral-depr",
          "warning",
          "Collateral depreciation inputs incomplete",
          slMissing
            ? "Enter the useful life so the collateral's net book value can be calculated."
            : "Enter the declining-balance rate so the collateral's net book value can be calculated.",
        );
      }
    }
    /* Maturity / balloon */
    if (loan.termYears > 0 && loan.termYears < loan.amortizationYears && num(loan.balloonPayment) === 0 && start) {
      const maturity = addYears(start, loan.termYears);
      if (isBefore(maturity, fye)) {
        add(
          "term-expired",
          "warning",
          "Loan term has matured before this fiscal year end",
          "The term is shorter than the amortization and has ended — confirm renewal terms and update the rate/term if it was renewed.",
        );
      }
    }
  }

  if (kind === "capital_lease") {
    const criteriaMet =
      loan.transferOfOwnership === true ||
      loan.bargainPurchaseOption === true ||
      num(loan.leaseTermPct) >= 75 ||
      num(loan.pvPctFairValue) >= 90 ||
      loan.specializedAsset === true;
    if (!criteriaMet) {
      add(
        "cap-no-criteria",
        "error",
        "Classified as a capital lease but no ASPE 3065 criterion is met",
        "Re-run the lease assessment — either a criterion should be documented or the lease may be operating.",
      );
    }
    if (blank(loan.capitalLeaseRationale)) {
      add(
        "cap-rationale",
        "warning",
        "No classification rationale documented (ASPE 3065)",
        "Re-run the lease assessment or add a rationale so the file supports capital treatment.",
      );
    }
    if (blank(loan.assetDescription)) {
      add(
        "cap-asset-desc",
        "warning",
        "Leased asset not described",
        "Add a description of the leased asset for the note disclosure and depreciation workpaper.",
      );
    }
    if (num(loan.assetCost) === 0 || !loan.assetUsefulLife) {
      add(
        "cap-depr",
        "warning",
        "Leased asset cost or useful life missing",
        "Enter the asset cost and useful life so the depreciation schedule on the leased asset can be prepared.",
      );
    }
    if (num(loan.pvPctFairValue) >= 90 && num(loan.fairValue) === 0) {
      add(
        "cap-fv",
        "info",
        "PV ≥ 90% criterion used but the asset's fair value is not recorded",
        "Record the asset's fair value to support the present-value test.",
      );
    }
  }

  if (kind === "operating_lease") {
    if (num(loan.monthlyPayment) === 0) {
      add(
        "op-payment",
        "error",
        "Monthly payment is missing or zero",
        "Enter the base monthly rent so expense and commitments can be calculated.",
      );
    }
    if (!loan.termMonths || loan.termMonths <= 0) {
      add(
        "op-term",
        "error",
        "Lease term (months) is missing",
        "Enter the lease term so straight-line expense and the commitments table can be prepared.",
      );
    }
    if (start && loan.termMonths && loan.termMonths > 0) {
      const leaseEnd = addMonths(start, loan.termMonths);
      const priorFyStart = addYears(fye, -1);
      if (isBefore(leaseEnd, priorFyStart)) {
        add(
          "op-expired",
          "info",
          "Lease term ended before this fiscal year",
          "This lease is fully expired — confirm whether it was renewed or can be removed from the file.",
        );
      }
    }
    if (
      loan.isOfficeProperty &&
      (loan.freeRentMonths ?? 0) === 0 &&
      num(loan.rentEscalationRate) === 0 &&
      num(loan.tenantImprovementAllowance) === 0 &&
      num(loan.otherInducements) === 0
    ) {
      add(
        "op-inducements",
        "info",
        "Office/property lease with no inducements or escalations recorded",
        "Confirm there are no free-rent periods, escalations, or tenant allowances — these change the straight-line calculation.",
      );
    }
  }

  const order: Record<DiagnosticSeverity, number> = { error: 0, warning: 1, info: 2 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);

  const dismissedIds = new Set(loan.dismissedFindings ?? []);
  const active = findings.filter((f) => !dismissedIds.has(f.id));
  const dismissed = findings.filter((f) => dismissedIds.has(f.id));

  return {
    loanId: loan.id,
    loanName: loan.name,
    kind,
    kindLabel: KIND_LABELS[kind],
    findings: active,
    dismissed,
  };
}

/* ── File-level checks ───────────────────────────────────────── */

export function runFileDiagnostics(
  file: FileDiagnosticInput,
  loans: LoanDiagnosticInput[],
): FileDiagnosticsResult {
  const fileFindings: DiagnosticFinding[] = [];

  if (file.materiality == null) {
    fileFindings.push({
      id: "file-materiality",
      severity: "warning",
      message: "Materiality not set for this file",
      suggestion:
        'Set materiality (Edit button in the header) — it supports "immaterial" fair value conclusions and review scoping.',
    });
  }
  if (file.trivialThreshold == null) {
    fileFindings.push({
      id: "file-trivial",
      severity: "warning",
      message: "Trivial threshold not set for this file",
      suggestion:
        'Set the trivial threshold (Edit button in the header) — it supports "trivial" fair value conclusions.',
    });
  }
  if (loans.length === 0) {
    fileFindings.push({
      id: "file-empty",
      severity: "info",
      message: "No loans or leases in this file yet",
      suggestion: "Add the client's loans and leases to begin the year-end file.",
    });
  }

  const loanResults = loans.map((l) => runLoanDiagnostics(l, file));

  const fileDismissedIds = new Set(file.dismissedFindings ?? []);
  const activeFileFindings = fileFindings.filter((f) => !fileDismissedIds.has(f.id));
  const fileDismissed = fileFindings.filter((f) => fileDismissedIds.has(f.id));

  const totals = { errors: 0, warnings: 0, infos: 0 };
  for (const f of [...activeFileFindings, ...loanResults.flatMap((r) => r.findings)]) {
    if (f.severity === "error") totals.errors++;
    else if (f.severity === "warning") totals.warnings++;
    else totals.infos++;
  }

  return { fileFindings: activeFileFindings, fileDismissed, loans: loanResults, totals };
}
