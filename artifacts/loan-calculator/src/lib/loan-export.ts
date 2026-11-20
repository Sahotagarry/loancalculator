import { renderSchedulePdf, renderAnnualPdf } from "./loan-print";
import { format } from "date-fns";
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
  rateSegments?: ReadonlyArray<{ from: Date; to: Date; annualContractualRate: number; interest?: number; rateResetEventId?: string }>;
}

export interface YearlyTotal {
  label: string;
  yearEnd?: Date;
  principal: number;
  interest: number;
  opening?: number;
  closing?: number;
}

export interface LoanExportMeta {
  clientName?: string | null;
  fiscalYearEnd?: string | null;
  amortizationYears?: number;
  activeRateSetId?: string | null;
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

export async function exportScheduleXlsx(loanName: string, schedule: ScheduleRow[], evidence?: LoanExportMeta, quickFilename?: string): Promise<void> {
  const { buildScheduleWorkbook } = await import("./loan-report-workbook");
  const { saveWorkbook } = await import("./excel-report-style");
  await saveWorkbook(buildScheduleWorkbook(schedule, evidence, !!quickFilename), quickFilename ?? `${loanName}_Schedule.xlsx`);
}

export function exportSchedulePdf(loan: LoanExportMeta, schedule: ScheduleRow[]): void {
  renderSchedulePdf(loan, schedule).save(`${loan.name}_Schedule.pdf`);
}

export async function exportAnnualXlsx(loanName: string, yearlyTotals: YearlyTotal[], evidence?: LoanExportMeta, quickFilename?: string): Promise<void> {
  const { buildAnnualWorkbook } = await import("./loan-report-workbook");
  const { saveWorkbook } = await import("./excel-report-style");
  await saveWorkbook(buildAnnualWorkbook(yearlyTotals, evidence, !!quickFilename), quickFilename ?? `${loanName}_Annual.xlsx`);
}

export function exportAnnualPdf(loanName: string, yearlyTotals: YearlyTotal[], evidence?: LoanExportMeta): void {
  renderAnnualPdf(loanName, yearlyTotals, evidence).save(`${loanName}_Annual.pdf`);
}
