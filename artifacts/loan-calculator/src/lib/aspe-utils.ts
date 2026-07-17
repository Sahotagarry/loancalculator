import { isAfter, addMonths, subDays, parseISO } from "date-fns";
import { calculateAmortization, calculateFairValueSchedule, type AmortizationRow, type Frequency } from "@workspace/amortization";
import { calculateStraightLineLease, buildYearlyStraightLine } from "./straight-line";
import { getFiscalYear, getFyEndParts } from "./fiscal";

export interface BookedScheduleInput {
  principal: number | string;
  downPayment?: number | string | null;
  interestRate: number | string;
  amortizationYears: number;
  termYears: number;
  startDate: string;
  ioMonths?: number | null;
  specificIoMonths?: string | null;
  balloonPayment?: number | string | null;
  paymentFrequency?: string | null;
  fvDecision?: string | null;
  fvRate?: number | string | null;
  paymentOverride?: number | string | null;
}

/**
 * Returns the booked amortization schedule for a loan/lease. When fair value is
 * adopted (`fvDecision === "use_fv"`), the contractual cash payments are held
 * fixed and the principal/interest split is derived with the effective-interest
 * method at the fair-value rate (see `calculateFairValueSchedule`). Otherwise the
 * contractual schedule is returned. This is the single source of truth so every
 * view (loan detail, file cards, reports) reports identical figures.
 */
export function calculateBookedSchedule(loan: BookedScheduleInput): {
  monthlyPayment: number;
  totalInterest: number;
  totalPayment: number;
  schedule: AmortizationRow[];
  fairValue: number | null;
  usedFairValue: boolean;
} {
  const frequency = (loan.paymentFrequency ?? "monthly") as Frequency;
  const contractual = calculateAmortization(
    Number(loan.principal) - Number(loan.downPayment ?? 0),
    Number(loan.interestRate),
    loan.amortizationYears,
    loan.termYears,
    parseISO(loan.startDate),
    loan.ioMonths ?? 0,
    loan.specificIoMonths ? loan.specificIoMonths.split(",").map(Number).filter((n) => !isNaN(n)) : [],
    Number(loan.balloonPayment ?? 0),
    frequency,
    loan.paymentOverride != null ? Number(loan.paymentOverride) : null,
  );
  const fvRate = loan.fvRate != null ? Number(loan.fvRate) : 0;
  if (loan.fvDecision === "use_fv" && fvRate > 0) {
    const fv = calculateFairValueSchedule(contractual.schedule, fvRate, frequency);
    return {
      monthlyPayment: fv.monthlyPayment,
      totalInterest: fv.totalInterest,
      totalPayment: fv.totalPayment,
      schedule: fv.schedule,
      fairValue: fv.fairValue,
      usedFairValue: true,
    };
  }
  return {
    monthlyPayment: contractual.monthlyPayment,
    totalInterest: contractual.totalInterest,
    totalPayment: contractual.totalPayment,
    schedule: contractual.schedule,
    fairValue: null,
    usedFairValue: false,
  };
}

export interface YearlyBreakdown {
  fiscalYear: number;
  label: string;       // e.g. "2025", "Thereafter"
  amount: number;
}

export interface LoanSummary {
  id: string;
  name: string;
  counterparty: string | null;
  description: string;
  interestRate: number;
  maturityDate: string;
  regularPayment: number;
  paymentFrequency: string;
  balanceAtYearEnd: number;
  // Presented current portion. With a covenant violation this is the entire
  // carrying amount (the lender can demand repayment — ASPE 1510).
  currentPortion: number;
  longTermPortion: number;
  // Whether a financial covenant has been violated at the reporting date.
  covenantViolation: boolean;
  // Scheduled repayments due within one year (the normal current portion).
  scheduledWithinOneYear: number;
  // Scheduled repayments due beyond one year. Zero unless a covenant violation
  // reclassifies otherwise-long-term amounts into current.
  scheduledBeyondOneYear: number;
  yearlyPrincipal: YearlyBreakdown[];
  yearlyInterest: { fiscalYear: number; amount: number }[];
  principalRepaidCurrentFY: number;
  isCapitalLease: boolean;
  isOperatingLease: boolean;
  // Combined net book value of the pledged collateral at the reporting year end
  // (null when no collateral is attached).
  collateralNbv?: number | null;
}

export interface CapitalLeaseSummary extends LoanSummary {
  yearlyBlended: YearlyBreakdown[];
  totalMinimumPayments: number;
  impliedInterest: number;
  obligations: number;
}

export interface OperatingLeaseSummary {
  id: string;
  name: string;
  counterparty: string | null;
  description: string;
  monthlyPayment: number;
  termMonths: number;
  startDate: string;
  yearlyPayments: YearlyBreakdown[];
  totalCommitment: number;
  deferredRentAtYearEnd: number;
  totalInducements: number;
  monthlyStraightLineExpense: number;
  yearlyStraightLine: { fiscalYear: number; amount: number }[];
  inducementLiabilityCurrent: number;
  inducementLiabilityNonCurrent: number;
}

export function buildFiscalYearLabel(
  fiscalYear: number,
  fyEndMonth: number,
  fyEndDay: number
): string {
  const start = new Date(fiscalYear - 1, fyEndMonth, fyEndDay);
  start.setDate(start.getDate() + 1);
  const end = new Date(fiscalYear, fyEndMonth, fyEndDay);
  return `${fiscalYear}`;
}

export function computeMaturityDate(
  startDate: string,
  termYears: number,
  termMonths?: number | null
): Date {
  const start = parseISO(startDate);
  if (termMonths != null && termMonths > 0) {
    return addMonths(start, termMonths);
  }
  return addMonths(start, termYears * 12);
}

export function getFirstRegularPayment(schedule: AmortizationRow[]): number {
  if (schedule.length === 0) return 0;
  // Find first row that isn't interest-only
  const firstRegular = schedule.find((r) => !r.isInterestOnly);
  if (firstRegular) return firstRegular.payment;
  // If all interest-only, use the first payment amount
  return schedule[0].payment;
}

// ---- Security clauses & collateral net book value ----

const UNSECURED_CLAUSE = "Unsecured";
const EQUIPMENT_CHARGE_CLAUSE = "Specific charge on equipment";
const REAL_PROPERTY_CHARGE_CLAUSE =
  "Specific charge / mortgage on real property (land & building)";

const SECURITY_CLAUSE_PHRASES: Record<string, string> = {
  "General security agreement (GSA)": "a general security agreement",
  [REAL_PROPERTY_CHARGE_CLAUSE]: "a specific charge over the real property",
  [EQUIPMENT_CHARGE_CLAUSE]: "a specific charge over equipment",
  "Personal guarantee(s)": "personal guarantee(s)",
  "Assignment of rents / leases": "an assignment of rents and leases",
  "Pledge of investments / shares": "a pledge of investments and shares",
  "Assignment of insurance": "an assignment of insurance",
  "Postponement / subordination of shareholder loans":
    "a postponement of shareholder loans",
  "Corporate guarantee from a related/parent company":
    "a corporate guarantee from a related company",
  "Assignment of specific accounts receivable / contracts":
    "an assignment of specific accounts receivable and contracts",
  "Pledge of cash / GIC": "a pledge of cash and guaranteed investment certificates",
};

export interface CollateralFields {
  collateralType?: string | null;
  collateralDescription?: string | null;
  collateralDepreciableCost?: number | string | null;
  collateralLandCost?: number | string | null;
  collateralInServiceDate?: string | null;
  collateralMethod?: string | null;
  collateralUsefulLifeYears?: number | null;
  collateralDecliningRate?: number | string | null;
  collateralSalvageValue?: number | string | null;
}

function naturalJoin(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function formatMoney(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function collateralNoun(
  type: string | null | undefined,
  description: string | null | undefined
): string {
  const desc = description?.trim();
  if (desc) return desc;
  switch (type) {
    case "equipment":
      return "equipment";
    case "building":
      return "a building";
    case "land":
      return "land";
    case "land_and_building":
      return "land and building";
    default:
      return "collateral";
  }
}

/**
 * Net book value of a depreciable asset at the reporting fiscal year end. The
 * acquisition fiscal year is prorated by the number of months the asset was
 * held (the acquisition month counts as a full month); every subsequent fiscal
 * year through the reporting year is a complete year. Supports straight-line
 * (cost ÷ useful life) and declining balance (rate × opening NBV). NBV is
 * floored at the salvage value.
 */
function depreciableNbv(
  cost: number,
  inServiceDate: string | null | undefined,
  method: string | null | undefined,
  usefulLifeYears: number | null | undefined,
  decliningRatePct: number,
  salvage: number,
  reportYearEnd: Date,
  fyEndMonth: number,
  fyEndDay: number
): number {
  if (!(cost > 0)) return Math.max(0, cost);
  if (!inServiceDate) return cost; // cannot depreciate without an in-service date
  const inService = parseISO(inServiceDate);
  // Placed in service after the reporting year end: not yet depreciated.
  if (isAfter(inService, reportYearEnd)) return cost;

  const salvageFloor = Math.min(Math.max(salvage, 0), cost);
  const depreciableBase = cost - salvageFloor;
  if (depreciableBase <= 0) return cost;

  const useDeclining = method === "declining_balance";
  const rate = decliningRatePct / 100;
  if (useDeclining) {
    if (!(rate > 0)) return cost;
  } else if (!usefulLifeYears || usefulLifeYears <= 0) {
    return cost;
  }

  const acqFY = getFiscalYear(inService, fyEndMonth, fyEndDay);
  const reportFY = getFiscalYear(reportYearEnd, fyEndMonth, fyEndDay);

  // Months held during the acquisition fiscal year (acquisition month counts).
  const acqFyEnd = new Date(acqFY, fyEndMonth, fyEndDay);
  const monthsHeld = Math.min(
    12,
    Math.max(
      0,
      (acqFyEnd.getFullYear() - inService.getFullYear()) * 12 +
        (acqFyEnd.getMonth() - inService.getMonth()) +
        1
    )
  );

  let nbv = cost;
  for (let fy = acqFY; fy <= reportFY; fy++) {
    const fraction = fy === acqFY ? monthsHeld / 12 : 1;
    let dep = useDeclining
      ? nbv * rate * fraction
      : (depreciableBase / usefulLifeYears!) * fraction;
    dep = Math.min(dep, nbv - salvageFloor);
    if (dep < 0) dep = 0;
    nbv -= dep;
  }
  return nbv;
}

export interface AssetDepreciationRow {
  fiscalYear: number;
  openingNbv: number;
  depreciation: number;
  accumulated: number;
  closingNbv: number;
}

/**
 * Full year-by-year depreciation schedule for a depreciable asset, using the
 * exact same conventions as `depreciableNbv` (acquisition fiscal year prorated
 * by months held with the acquisition month counting as a full month,
 * straight-line or declining balance, NBV floored at salvage) so each row's
 * closing NBV ties to the collateral NBV disclosed at that fiscal year end.
 * Returns an empty array when the inputs cannot produce a schedule.
 */
export function buildAssetDepreciationSchedule(
  cost: number,
  inServiceDate: string | null | undefined,
  method: string | null | undefined,
  usefulLifeYears: number | null | undefined,
  decliningRatePct: number,
  salvage: number,
  fyEndMonth: number,
  fyEndDay: number
): AssetDepreciationRow[] {
  if (!(cost > 0) || !inServiceDate) return [];
  const inService = parseISO(inServiceDate);
  if (isNaN(inService.getTime())) return [];

  const salvageFloor = Math.min(Math.max(salvage, 0), cost);
  const depreciableBase = cost - salvageFloor;
  if (depreciableBase <= 0) return [];

  const useDeclining = method === "declining_balance";
  const rate = decliningRatePct / 100;
  if (useDeclining) {
    if (!(rate > 0)) return [];
  } else if (!usefulLifeYears || usefulLifeYears <= 0) {
    return [];
  }

  const acqFY = getFiscalYear(inService, fyEndMonth, fyEndDay);

  // Months held during the acquisition fiscal year (acquisition month counts).
  const acqFyEnd = new Date(acqFY, fyEndMonth, fyEndDay);
  const monthsHeld = Math.min(
    12,
    Math.max(
      0,
      (acqFyEnd.getFullYear() - inService.getFullYear()) * 12 +
        (acqFyEnd.getMonth() - inService.getMonth()) +
        1
    )
  );

  const rows: AssetDepreciationRow[] = [];
  const MAX_YEARS = 100;
  let nbv = cost;
  let accumulated = 0;
  for (let i = 0; i < MAX_YEARS; i++) {
    const fy = acqFY + i;
    const fraction = fy === acqFY ? monthsHeld / 12 : 1;
    let dep = useDeclining
      ? nbv * rate * fraction
      : (depreciableBase / usefulLifeYears!) * fraction;
    dep = Math.min(dep, nbv - salvageFloor);
    if (dep < 0) dep = 0;
    const opening = nbv;
    nbv -= dep;
    accumulated += dep;
    rows.push({
      fiscalYear: fy,
      openingNbv: opening,
      depreciation: dep,
      accumulated,
      closingNbv: nbv,
    });
    if (nbv - salvageFloor <= 0.005) break;
  }
  return rows;
}

/**
 * Combined net book value of the single collateral asset pledged against a
 * loan/lease. "land_and_building" adds the non-amortized land cost to the
 * depreciated building NBV. Returns null when no collateral is attached.
 */
export function computeCollateralNbv(
  c: CollateralFields,
  reportYearEnd: Date,
  fyEndMonth: number,
  fyEndDay: number
): number | null {
  const type = c.collateralType;
  if (!type) return null;

  const land = c.collateralLandCost != null ? Number(c.collateralLandCost) : 0;
  const depCost =
    c.collateralDepreciableCost != null ? Number(c.collateralDepreciableCost) : 0;
  const salvage =
    c.collateralSalvageValue != null ? Number(c.collateralSalvageValue) : 0;
  const life = c.collateralUsefulLifeYears ?? null;
  const rate = c.collateralDecliningRate != null ? Number(c.collateralDecliningRate) : 0;

  if (type === "land") {
    const value = land > 0 ? land : depCost;
    return value > 0 ? value : null;
  }

  const depNbv =
    depCost > 0
      ? depreciableNbv(
          depCost,
          c.collateralInServiceDate,
          c.collateralMethod,
          life,
          rate,
          salvage,
          reportYearEnd,
          fyEndMonth,
          fyEndDay
        )
      : 0;
  const landComponent = type === "land_and_building" ? land : 0;
  const total = depNbv + landComponent;
  return total > 0 ? total : null;
}

/**
 * Builds the trailing security phrase for the disclosure sentence, e.g.
 * " and is secured by a general security agreement and equipment having a net
 * book value of $X at year end." Returns "." when nothing is pledged (capital
 * leases fall back to the standard specific-equipment wording).
 */
function buildSecurityText(
  clauses: string[],
  collateralType: string | null | undefined,
  collateralDescription: string | null | undefined,
  collateralNbv: number | null,
  isCapital: boolean
): string {
  const cleaned = clauses.filter((c) => c && c.trim().length > 0);

  // "Unsecured" as the sole selection overrides everything else.
  if (cleaned.length === 1 && cleaned[0] === UNSECURED_CLAUSE) {
    return " and is unsecured.";
  }
  const effective = cleaned.filter((c) => c !== UNSECURED_CLAUSE);

  const nbvText =
    collateralNbv != null
      ? ` having ${
          collateralType === "land_and_building" ? "a combined " : "a "
        }net book value of ${formatMoney(collateralNbv)} at year end`
      : "";
  const isEquipmentColl = collateralType === "equipment";
  const isRealPropertyColl =
    collateralType === "building" ||
    collateralType === "land" ||
    collateralType === "land_and_building";

  const descriptors: string[] = [];
  let attached = false;
  for (const clause of effective) {
    let phrase = SECURITY_CLAUSE_PHRASES[clause] ?? clause;
    if (collateralNbv != null && !attached) {
      if (
        (clause === EQUIPMENT_CHARGE_CLAUSE && isEquipmentColl) ||
        (clause === REAL_PROPERTY_CHARGE_CLAUSE && isRealPropertyColl)
      ) {
        phrase += nbvText;
        attached = true;
      }
    }
    descriptors.push(phrase);
  }

  // Collateral present but no matching charge clause: add it as its own item.
  if (collateralNbv != null && !attached) {
    descriptors.push(`${collateralNoun(collateralType, collateralDescription)}${nbvText}`);
  }

  if (descriptors.length === 0) {
    return isCapital ? " and is secured by specific equipment." : ".";
  }
  return ` and is secured by ${naturalJoin(descriptors)}.`;
}

export function buildLoanSummary(
  loan: {
    id: string;
    name: string;
    counterparty?: string | null;
    principal: number | string;
    downPayment?: number | string | null;
    interestRate: number | string;
    amortizationYears: number;
    termYears: number;
    startDate: string | null;
    ioMonths?: number | null;
    specificIoMonths?: string | null;
    balloonPayment?: number | string | null;
    paymentFrequency?: string | null;
    isCapitalLease?: boolean | null;
    monthlyPayment?: number | string | null;
    paymentOverride?: number | string | null;
    termMonths?: number | null;
    freeRentMonths?: number | null;
    rentEscalationRate?: number | string | null;
    rentSteps?: Array<{ fromYear: number; toYear: number; monthlyRent: number }> | null;
    tenantImprovementAllowance?: number | string | null;
    otherInducements?: number | string | null;
    fvDecision?: string | null;
    fvRate?: number | string | null;
    covenantViolation?: boolean | null;
    securityClauses?: string[] | null;
    collateralType?: string | null;
    collateralDescription?: string | null;
    collateralDepreciableCost?: number | string | null;
    collateralLandCost?: number | string | null;
    collateralInServiceDate?: string | null;
    collateralMethod?: string | null;
    collateralUsefulLifeYears?: number | null;
    collateralDecliningRate?: number | string | null;
    collateralSalvageValue?: number | string | null;
  },
  reportYearEnd: Date,
  fyEndDate: string
): LoanSummary | CapitalLeaseSummary | OperatingLeaseSummary | null {
  if (!loan.startDate || !fyEndDate) return null;
  const { month: fyEndMonth, day: fyEndDay } = getFyEndParts(fyEndDate);
  // Financed amount actually amortized: face principal net of any down payment.
  const principal = Number(loan.principal) - Number(loan.downPayment ?? 0);
  const rawRate = Number(loan.interestRate);
  const interestRate = (loan.fvDecision === "use_fv" && loan.fvRate != null) ? Number(loan.fvRate) : rawRate;
  const isCapital = !!loan.isCapitalLease;
  const isOperating =
    !isCapital && rawRate === 0 && loan.monthlyPayment != null && loan.termMonths != null;

  if (isOperating) {
    const monthlyPayment = Number(loan.monthlyPayment ?? 0);
    const termMonths = loan.termMonths ?? 0;
    let totalCommitment = monthlyPayment * termMonths;
    const startDate = parseISO(loan.startDate);

    // Build year-by-year operating lease payments
    const yearlyMap = new Map<number, number>();
    const steps = (loan.rentSteps ?? [])
      .filter((s) => s.monthlyRent > 0 && s.fromYear >= 1 && s.toYear >= s.fromYear)
      .sort((a, b) => a.fromYear - b.fromYear);
    for (let i = 0; i < termMonths; i++) {
      const paymentDate = addMonths(startDate, i);
      if (!isAfter(paymentDate, reportYearEnd)) continue; // only future
      const fy = getFiscalYear(paymentDate, fyEndMonth, fyEndDay);
      let rent = monthlyPayment;
      if (steps.length > 0) {
        const leaseYear = Math.floor(i / 12) + 1;
        const step = steps.find((s) => leaseYear >= s.fromYear && leaseYear <= s.toYear);
        rent = step ? step.monthlyRent : steps[steps.length - 1].monthlyRent;
      }
      if (i < (loan.freeRentMonths ?? 0)) rent = 0;
      yearlyMap.set(fy, (yearlyMap.get(fy) ?? 0) + rent);
    }

    // Convert to array, merge "Thereafter" for years beyond the first 5 distinct fiscal years
    const entries = Array.from(yearlyMap.entries()).sort((a, b) => a[0] - b[0]);
    const yearlyPayments: YearlyBreakdown[] = [];
    let thereAfterTotal = 0;
    const maxYears = 5;
    for (let i = 0; i < entries.length; i++) {
      if (i < maxYears) {
        yearlyPayments.push({
          fiscalYear: entries[i][0],
          label: `${entries[i][0]}`,
          amount: entries[i][1],
        });
      } else {
        thereAfterTotal += entries[i][1];
      }
    }
    if (thereAfterTotal > 0) {
      yearlyPayments.push({
        fiscalYear: entries[entries.length - 1]?.[0] ?? 0,
        label: "Thereafter",
        amount: thereAfterTotal,
      });
    }

    // Straight-line expense computation
    const sl = calculateStraightLineLease({
      baseMonthlyRent: monthlyPayment,
      termMonths,
      freeRentMonths: loan.freeRentMonths ?? 0,
      escalationRate: Number(loan.rentEscalationRate ?? 0),
      rentSteps: loan.rentSteps ?? [],
      tenantImprovementAllowance: Number(loan.tenantImprovementAllowance ?? 0),
      otherInducements: Number(loan.otherInducements ?? 0),
      startDate: loan.startDate,
      fiscalYearEnd: fyEndDate,
    });
    if (sl) totalCommitment = sl.totalLeasePayments;
    const deferredRentAtYearEnd = sl?.deferredRentAtYearEnd ?? 0;
    const totalInducements = sl?.totalInducements ?? 0;
    const monthlyStraightLineExpense = sl?.monthlyStraightLineExpense ?? monthlyPayment;
    const yearly = sl ? buildYearlyStraightLine(sl.schedule) : [];
    const inducementLiabilityCurrent = sl?.inducementLiabilityCurrent ?? 0;
    const inducementLiabilityNonCurrent = sl?.inducementLiabilityNonCurrent ?? 0;

    const opCp = loan.counterparty?.trim() || null;
    const opNarrative = opCp
      ? `Operating lease with ${opCp}.`
      : "Operating lease.";

    return {
      id: loan.id,
      name: loan.name,
      counterparty: opCp,
      description: opNarrative,
      monthlyPayment,
      termMonths,
      startDate: loan.startDate,
      yearlyPayments,
      totalCommitment,
      deferredRentAtYearEnd,
      totalInducements,
      monthlyStraightLineExpense,
      yearlyStraightLine: yearly.map((y) => ({ fiscalYear: y.fiscalYear, amount: y.straightLine })),
      inducementLiabilityCurrent,
      inducementLiabilityNonCurrent,
    } as OperatingLeaseSummary;
  }

  // Regular loan or capital lease. When fair value is adopted, the booked
  // schedule keeps the contractual payments fixed (effective-interest method).
  // startDate is guaranteed non-null by the guard at the top of this function.
  const result = calculateBookedSchedule({ ...loan, startDate: loan.startDate! });

  const currentPeriodEnd = new Date(reportYearEnd);
  currentPeriodEnd.setFullYear(currentPeriodEnd.getFullYear() + 1);

  const balanceAtYearEnd =
    result.schedule
      .filter((row) => !isAfter(row.date, reportYearEnd))
      .slice(-1)[0]?.balance ?? principal;

  // When the term is shorter than the amortization period, the schedule ends at
  // term end with a residual balance still owed (an implicit balloon due at
  // maturity). This residual is never captured as a principal payment row, so it
  // must be recognized as principal due in the maturity fiscal year for the
  // repayment-terms disclosure to reconcile to the carrying amount.
  const lastRow = result.schedule[result.schedule.length - 1];
  const residualBalloon =
    lastRow && isAfter(lastRow.date, reportYearEnd) ? lastRow.balance : 0;

  let currentPortion = result.schedule
    .filter((row) => isAfter(row.date, reportYearEnd) && !isAfter(row.date, currentPeriodEnd))
    .reduce((sum, row) => sum + row.principal, 0);
  // If the loan matures within the next fiscal year, the residual balloon is due
  // within one year and belongs in the current portion.
  if (residualBalloon > 0.01 && lastRow && !isAfter(lastRow.date, currentPeriodEnd)) {
    currentPortion += residualBalloon;
  }

  let longTermPortion = Math.max(0, balanceAtYearEnd - currentPortion);

  // Financial covenant violation: the counterparty has the right to demand
  // repayment, so the entire obligation is classified as current (ASPE 1510).
  // We still track the scheduled split for disclosure.
  const covenantViolation = !!loan.covenantViolation;
  const scheduledWithinOneYear = currentPortion;
  const scheduledBeyondOneYear = covenantViolation ? longTermPortion : 0;
  if (covenantViolation) {
    currentPortion = balanceAtYearEnd;
    longTermPortion = 0;
  }

  // Build narrative description
  const freqLabel = loan.paymentFrequency ?? "monthly";
  const freqWord =
    freqLabel === "semi-monthly"
      ? "semi-monthly blended"
      : freqLabel === "bi-weekly"
      ? "bi-weekly blended"
      : freqLabel === "weekly"
      ? "weekly blended"
      : "monthly blended";

  const maturityDate = computeMaturityDate(loan.startDate, loan.termYears, loan.termMonths);
  const regularPayment = getFirstRegularPayment(result.schedule);

  const rateText =
    interestRate === 0
      ? "no interest"
      : `interest at ${interestRate.toFixed(2)}% per annum`;

  const cp = loan.counterparty?.trim() || null;
  const paymentText = `${regularPayment.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const collateralNbv = computeCollateralNbv(loan, reportYearEnd, fyEndMonth, fyEndDay);
  const securityText = buildSecurityText(
    loan.securityClauses ?? [],
    loan.collateralType,
    loan.collateralDescription,
    collateralNbv,
    isCapital
  );
  const leadIn = isCapital
    ? `Capital lease ${cp ? `with ${cp} ` : ""}bearing ${rateText}, repayable in ${freqWord} payments of $${paymentText}`
    : `Loan ${cp ? `from ${cp} ` : ""}bearing ${rateText}, repayable in ${freqWord} payments of $${paymentText}`;
  const narrative = `${leadIn}. The ${isCapital ? "lease" : "loan"} matures on ${formatDate(maturityDate)}${securityText}`;

  // Year-by-year principal repayments (future years only, for the repayment-terms disclosure)
  // and principal repaid during the current reporting fiscal year (for the cash flow statement).
  const reportFY = getFiscalYear(reportYearEnd, fyEndMonth, fyEndDay);
  const principalYearlyMap = new Map<number, number>();
  let principalRepaidCurrentFY = 0;
  for (const row of result.schedule) {
    const rowFY = getFiscalYear(row.date, fyEndMonth, fyEndDay);
    if (isAfter(row.date, reportYearEnd)) {
      principalYearlyMap.set(rowFY, (principalYearlyMap.get(rowFY) ?? 0) + row.principal);
    } else if (rowFY === reportFY) {
      principalRepaidCurrentFY += row.principal;
    }
  }
  // Recognize the residual balloon as principal due in the maturity fiscal year.
  if (residualBalloon > 0.01 && lastRow) {
    const maturityFY = getFiscalYear(lastRow.date, fyEndMonth, fyEndDay);
    principalYearlyMap.set(maturityFY, (principalYearlyMap.get(maturityFY) ?? 0) + residualBalloon);
  }
  const principalEntries = Array.from(principalYearlyMap.entries()).sort((a, b) => a[0] - b[0]);
  const yearlyPrincipal: YearlyBreakdown[] = [];
  let pThereAfter = 0;
  for (let i = 0; i < principalEntries.length; i++) {
    if (i < 5) {
      yearlyPrincipal.push({
        fiscalYear: principalEntries[i][0],
        label: `${principalEntries[i][0]}`,
        amount: principalEntries[i][1],
      });
    } else {
      pThereAfter += principalEntries[i][1];
    }
  }
  if (pThereAfter > 0) {
    yearlyPrincipal.push({
      fiscalYear: principalEntries[principalEntries.length - 1]?.[0] ?? 0,
      label: "Thereafter",
      amount: pThereAfter,
    });
  }

  // Year-by-year interest (for P&L)
  const interestYearlyMap = new Map<number, number>();
  for (const row of result.schedule) {
    const fy = getFiscalYear(row.date, fyEndMonth, fyEndDay);
    interestYearlyMap.set(fy, (interestYearlyMap.get(fy) ?? 0) + row.interest);
  }
  const yearlyInterest = Array.from(interestYearlyMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([fiscalYear, amount]) => ({ fiscalYear, amount }));

  if (isCapital) {
    // Year-by-year blended (future minimum lease payments)
    const blendedYearlyMap = new Map<number, number>();
    for (const row of result.schedule) {
      if (isAfter(row.date, reportYearEnd)) {
        const fy = getFiscalYear(row.date, fyEndMonth, fyEndDay);
        blendedYearlyMap.set(fy, (blendedYearlyMap.get(fy) ?? 0) + row.payment);
      }
    }
    // Include the residual balloon due at maturity (when the term is shorter than
    // the amortization period) as a minimum lease payment, so total minimum
    // payments and the implied interest reconcile to the recorded obligation.
    if (residualBalloon > 0.01 && lastRow) {
      const maturityFY = getFiscalYear(lastRow.date, fyEndMonth, fyEndDay);
      blendedYearlyMap.set(maturityFY, (blendedYearlyMap.get(maturityFY) ?? 0) + residualBalloon);
    }
    const blendedEntries = Array.from(blendedYearlyMap.entries()).sort((a, b) => a[0] - b[0]);
    const yearlyBlended: YearlyBreakdown[] = [];
    let bThereAfter = 0;
    for (let i = 0; i < blendedEntries.length; i++) {
      if (i < 5) {
        yearlyBlended.push({
          fiscalYear: blendedEntries[i][0],
          label: `${blendedEntries[i][0]}`,
          amount: blendedEntries[i][1],
        });
      } else {
        bThereAfter += blendedEntries[i][1];
      }
    }
    if (bThereAfter > 0) {
      yearlyBlended.push({
        fiscalYear: blendedEntries[blendedEntries.length - 1]?.[0] ?? 0,
        label: "Thereafter",
        amount: bThereAfter,
      });
    }

    const totalMinimumPayments = yearlyBlended.reduce((s, y) => s + y.amount, 0);
    const obligations = balanceAtYearEnd; // Present value = balance at year end
    const impliedInterest = totalMinimumPayments - obligations;

    return {
      id: loan.id,
      name: loan.name,
      counterparty: cp,
      description: narrative,
      interestRate,
      maturityDate: formatDate(maturityDate),
      regularPayment,
      paymentFrequency: freqLabel,
      balanceAtYearEnd,
      currentPortion,
      longTermPortion,
      covenantViolation,
      scheduledWithinOneYear,
      scheduledBeyondOneYear,
      yearlyPrincipal,
      yearlyInterest,
      yearlyBlended,
      totalMinimumPayments,
      impliedInterest: Math.max(0, impliedInterest),
      obligations,
      principalRepaidCurrentFY,
      isCapitalLease: true,
      isOperatingLease: false,
      collateralNbv,
    } as CapitalLeaseSummary;
  }

  return {
    id: loan.id,
    name: loan.name,
    counterparty: cp,
    description: narrative,
    interestRate,
    maturityDate: formatDate(maturityDate),
    regularPayment,
    paymentFrequency: freqLabel,
    balanceAtYearEnd,
    currentPortion,
    longTermPortion,
    covenantViolation,
    scheduledWithinOneYear,
    scheduledBeyondOneYear,
    yearlyPrincipal,
    yearlyInterest,
    principalRepaidCurrentFY,
    isCapitalLease: false,
    isOperatingLease: false,
    collateralNbv,
  } as LoanSummary;
}

function formatDate(date: Date): string {
  const options: Intl.DateTimeFormatOptions = { year: "numeric", month: "long", day: "numeric" };
  return date.toLocaleDateString("en-US", options);
}

export interface FileSummary {
  loans: LoanSummary[];
  capitalLeases: CapitalLeaseSummary[];
  operatingLeases: OperatingLeaseSummary[];
  loanTotal: number;
  leaseTotal: number;
  loanCurrent: number;
  loanLongTerm: number;
  leaseCurrent: number;
  leaseLongTerm: number;
  totalDebt: number;
  totalCurrent: number;
  totalLongTerm: number;
  operatingLeaseCount: number;
  operatingLeaseTotalCommitment: number;
  operatingLeaseMonthlyTotal: number;
  // Balance Sheet — current / non-current classification
  deferredRentAsset: number;
  deferredRentLiability: number;
  leaseIncentiveLiability: number;
  leaseIncentiveCurrent: number;
  leaseIncentiveNonCurrent: number;
  // Statement of Operations — P&L impact
  totalInterestExpense: number;
  totalStraightLineRentExpense: number;
  totalLeaseInducementAmortization: number;
  // Cash Flows — cash impact
  totalLoanProceeds: number;
  totalPrincipalRepaid: number;
  totalLoanPrincipalRepaid: number;
  totalCapitalLeasePrincipalRepaid: number;
  totalInterestPaid: number;
  totalOperatingLeaseCash: number;
  // Lease inducements received during the year, split by cash vs non-cash
  cashInducementsReceived: number;
  nonCashInducementsReceived: number;
}

export function buildFileSummary(
  loans: Array<{
    id: string;
    name: string;
    counterparty?: string | null;
    principal: number | string;
    downPayment?: number | string | null;
    interestRate: number | string;
    amortizationYears: number;
    termYears: number;
    startDate: string;
    ioMonths?: number | null;
    specificIoMonths?: string | null;
    balloonPayment?: number | string | null;
    paymentFrequency?: string | null;
    isCapitalLease?: boolean | null;
    monthlyPayment?: number | string | null;
    paymentOverride?: number | string | null;
    termMonths?: number | null;
    freeRentMonths?: number | null;
    rentEscalationRate?: number | string | null;
    rentSteps?: Array<{ fromYear: number; toYear: number; monthlyRent: number }> | null;
    tenantImprovementAllowance?: number | string | null;
    otherInducements?: number | string | null;
    inducementReceivedInCash?: boolean | null;
    fvDecision?: string | null;
    fvRate?: number | string | null;
    covenantViolation?: boolean | null;
  }>,
  fyEndDate: string
): FileSummary {
  if (!fyEndDate) {
    return {
      loans: [],
      capitalLeases: [],
      operatingLeases: [],
      loanTotal: 0,
      leaseTotal: 0,
      loanCurrent: 0,
      loanLongTerm: 0,
      leaseCurrent: 0,
      leaseLongTerm: 0,
      totalDebt: 0,
      totalCurrent: 0,
      totalLongTerm: 0,
      operatingLeaseCount: 0,
      operatingLeaseTotalCommitment: 0,
      operatingLeaseMonthlyTotal: 0,
      deferredRentAsset: 0,
      deferredRentLiability: 0,
      leaseIncentiveLiability: 0,
      leaseIncentiveCurrent: 0,
      leaseIncentiveNonCurrent: 0,
      totalInterestExpense: 0,
      totalStraightLineRentExpense: 0,
      totalLeaseInducementAmortization: 0,
      totalLoanProceeds: 0,
      totalPrincipalRepaid: 0,
      totalLoanPrincipalRepaid: 0,
      totalCapitalLeasePrincipalRepaid: 0,
      totalInterestPaid: 0,
      totalOperatingLeaseCash: 0,
      cashInducementsReceived: 0,
      nonCashInducementsReceived: 0,
    };
  }
  const reportYearEnd = parseISO(fyEndDate);

  const loanSummaries: LoanSummary[] = [];
  const capitalLeaseSummaries: CapitalLeaseSummary[] = [];
  const operatingLeaseSummaries: OperatingLeaseSummary[] = [];

  let loanTotal = 0;
  let leaseTotal = 0;
  let loanCurrent = 0;
  let loanLongTerm = 0;
  let leaseCurrent = 0;
  let leaseLongTerm = 0;
  let operatingLeaseCount = 0;
  let operatingLeaseTotalCommitment = 0;
  let operatingLeaseMonthlyTotal = 0;

  // Financial statement aggregates
  let deferredRentAsset = 0;
  let deferredRentLiability = 0;
  let leaseIncentiveLiability = 0;
  let leaseIncentiveCurrent = 0;
  let leaseIncentiveNonCurrent = 0;
  let totalInterestExpense = 0;
  let totalStraightLineRentExpense = 0;
  let totalLeaseInducementAmortization = 0;
  let totalLoanProceeds = 0;
  let totalPrincipalRepaid = 0;
  let totalLoanPrincipalRepaid = 0;
  let totalCapitalLeasePrincipalRepaid = 0;
  let totalInterestPaid = 0;
  let totalOperatingLeaseCash = 0;
  let cashInducementsReceived = 0;
  let nonCashInducementsReceived = 0;

  const fy = reportYearEnd.getFullYear();
  // Reporting fiscal year window: the 12 months ending on the FY-end date.
  const fyWindowStart = new Date(fy - 1, reportYearEnd.getMonth(), reportYearEnd.getDate());

  for (const loan of loans) {
    const summary = buildLoanSummary(loan, reportYearEnd, fyEndDate);
    if (!summary) continue;

    if ("monthlyPayment" in summary && "termMonths" in summary) {
      // Operating lease
      const op = summary as OperatingLeaseSummary;
      operatingLeaseSummaries.push(op);
      operatingLeaseCount++;
      operatingLeaseTotalCommitment += op.totalCommitment;
      operatingLeaseMonthlyTotal += op.monthlyPayment;
      leaseIncentiveLiability += op.inducementLiabilityCurrent + op.inducementLiabilityNonCurrent;
      leaseIncentiveCurrent += op.inducementLiabilityCurrent;
      leaseIncentiveNonCurrent += op.inducementLiabilityNonCurrent;
      // Straight-line rent expense for current fiscal year
      const slAmount = op.yearlyStraightLine.find((y) => y.fiscalYear === fy)?.amount ?? 0;
      totalStraightLineRentExpense += slAmount;
      // Cash payments for current fiscal year (actual cash, not straight-line expense)
      const cashAmount = op.yearlyPayments.find((y) => y.fiscalYear === fy)?.amount ?? 0;
      totalOperatingLeaseCash += cashAmount;
      // Deferred rent classification
      if (op.deferredRentAtYearEnd < 0) deferredRentAsset += Math.abs(op.deferredRentAtYearEnd);
      else deferredRentLiability += op.deferredRentAtYearEnd;
      // Inducements received during the reporting fiscal year (lease originated this FY),
      // split into cash (financing inflow) vs non-cash (supplementary disclosure).
      const leaseStart = parseISO(loan.startDate);
      if (isAfter(leaseStart, fyWindowStart) && !isAfter(leaseStart, reportYearEnd)) {
        const grossInducement =
          Number(loan.tenantImprovementAllowance ?? 0) + Number(loan.otherInducements ?? 0);
        if (grossInducement > 0) {
          if (loan.inducementReceivedInCash) cashInducementsReceived += grossInducement;
          else nonCashInducementsReceived += grossInducement;
        }
      }
    } else if ("obligations" in summary) {
      // Capital lease
      const cl = summary as CapitalLeaseSummary;
      capitalLeaseSummaries.push(cl);
      leaseTotal += cl.balanceAtYearEnd;
      leaseCurrent += cl.currentPortion;
      leaseLongTerm += cl.longTermPortion;
      // Interest expense for current fiscal year
      const interestAmount = cl.yearlyInterest.find((y) => y.fiscalYear === fy)?.amount ?? 0;
      totalInterestExpense += interestAmount;
      // Principal + interest cash for current year
      totalPrincipalRepaid += cl.principalRepaidCurrentFY;
      totalCapitalLeasePrincipalRepaid += cl.principalRepaidCurrentFY;
      totalInterestPaid += interestAmount;
    } else {
      // Regular loan
      const l = summary as LoanSummary;
      loanSummaries.push(l);
      loanTotal += l.balanceAtYearEnd;
      loanCurrent += l.currentPortion;
      loanLongTerm += l.longTermPortion;
      // Interest expense for current fiscal year
      const interestAmount = l.yearlyInterest.find((y) => y.fiscalYear === fy)?.amount ?? 0;
      totalInterestExpense += interestAmount;
      // Principal + interest cash for current year
      totalPrincipalRepaid += l.principalRepaidCurrentFY;
      totalLoanPrincipalRepaid += l.principalRepaidCurrentFY;
      totalInterestPaid += interestAmount;
      // Loan proceeds: principal received if the loan originated during the reporting fiscal year
      const loanStart = parseISO(loan.startDate);
      if (isAfter(loanStart, fyWindowStart) && !isAfter(loanStart, reportYearEnd)) {
        // Cash actually received from the lender is net of any down payment.
        totalLoanProceeds += Number(loan.principal) - Number(loan.downPayment ?? 0);
      }
    }
  }

  return {
    loans: loanSummaries,
    capitalLeases: capitalLeaseSummaries,
    operatingLeases: operatingLeaseSummaries,
    loanTotal,
    leaseTotal,
    loanCurrent,
    loanLongTerm,
    leaseCurrent,
    leaseLongTerm,
    totalDebt: loanTotal + leaseTotal,
    totalCurrent: loanCurrent + leaseCurrent,
    totalLongTerm: loanLongTerm + leaseLongTerm,
    operatingLeaseCount,
    operatingLeaseTotalCommitment,
    operatingLeaseMonthlyTotal,
    deferredRentAsset,
    deferredRentLiability,
    leaseIncentiveLiability,
    leaseIncentiveCurrent,
    leaseIncentiveNonCurrent,
    totalInterestExpense,
    totalStraightLineRentExpense,
    totalLeaseInducementAmortization,
    totalLoanProceeds,
    totalPrincipalRepaid,
    totalLoanPrincipalRepaid,
    totalCapitalLeasePrincipalRepaid,
    totalInterestPaid,
    totalOperatingLeaseCash,
    cashInducementsReceived,
    nonCashInducementsReceived,
  };
}
