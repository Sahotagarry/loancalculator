import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  loanContractRevisionsTable,
  loansTable,
  type Loan,
} from "@workspace/db";
import { db } from "@workspace/db";
import { rebindActiveLoanEvents } from "./loan-events";

export const CALCULATION_VERSION = "1";

export const SCHEDULE_DRIVING_FIELDS = new Set<keyof Loan>([
  "isCapitalLease",
  "principal",
  "downPayment",
  "interestRate",
  "rateType",
  "rateBenchmark",
  "contractualPrimeName",
  "benchmarkEquivalentToContractualPrime",
  "rateSpread",
  "rateResetFrequency",
  "rateEffectiveConvention",
  "ratePaymentTreatment",
  "initialFvRateAssumption",
  "amortizationYears",
  "termYears",
  "termMonths",
  "startDate",
  "fiscalYearEnd",
  "paymentFrequency",
  "paymentTiming",
  "graceTermMode",
  "firstPaymentDate",
  "semiMonthlyFirstDueDay",
  "semiMonthlySecondDueDay",
  "graceMonths",
  "graceInterestTreatment",
  "ioMonths",
  "specificIoMonths",
  "balloonPayment",
  "transferOfOwnership",
  "bargainPurchaseOption",
  "leaseTermPct",
  "pvPctFairValue",
  "fairValue",
  "specializedAsset",
  "monthlyPayment",
  "paymentOverride",
  "firstPaymentAmount",
  "assetCost",
  "assetUsefulLife",
  "collateralDepreciableCost",
  "collateralLandCost",
  "collateralInServiceDate",
  "collateralMethod",
  "collateralUsefulLifeYears",
  "collateralDecliningRate",
  "collateralSalvageValue",
  "isOfficeProperty",
  "freeRentMonths",
  "rentEscalationRate",
  "rentSteps",
  "tenantImprovementAllowance",
  "camMonthly",
  "otherInducements",
  "inducementReceivedInCash",
  "covenantViolation",
  "predecessorAgreementId",
  "modificationEffectiveDate",
  "modificationAssessment",
]);

export function buildContractSnapshot(loan: Loan): Record<string, unknown> {
  return Object.fromEntries(
    [...SCHEDULE_DRIVING_FIELDS]
      .sort()
      .map((field) => [field, loan[field] ?? null]),
  );
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function hashContractSnapshot(snapshot: Record<string, unknown>): string {
  return createHash("sha256").update(stableJson(snapshot)).digest("hex");
}

type RevisionTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

export async function appendContractRevision(
  tx: RevisionTransaction,
  loan: Loan,
  revisionNumber: number,
  changeReason: string,
): Promise<Loan> {
  const snapshot = buildContractSnapshot(loan);
  const inputHash = hashContractSnapshot(snapshot);
  const [revision] = await tx
    .insert(loanContractRevisionsTable)
    .values({
      loanId: loan.id,
      revisionNumber,
      snapshot,
      inputHash,
      calculationVersion: CALCULATION_VERSION,
      changeReason,
    })
    .returning();
  const [projected] = await tx
    .update(loansTable)
    .set({
      currentRevisionId: revision.id,
      currentRevisionHash: inputHash,
      calculationVersion: CALCULATION_VERSION,
    })
    .where(eq(loansTable.id, loan.id))
    .returning();
  await rebindActiveLoanEvents(tx, loan.id, revision.id);
  const [withEventProjection] = await tx
    .select()
    .from(loansTable)
    .where(eq(loansTable.id, loan.id));
  return withEventProjection ?? projected;
}