import { parseISO } from "date-fns";
import { getFiscalYear } from "./fiscal";

export interface StraightLinePeriod {
  monthIndex: number;
  fiscalYear: number;
  actualPayment: number;
  straightLineExpense: number;
  difference: number;
  cumulativeDeferredRent: number;
}

export interface StraightLineResult {
  totalLeasePayments: number;
  totalInducements: number;
  totalConsideration: number;
  monthlyStraightLineExpense: number;
  schedule: StraightLinePeriod[];
  deferredRentAtYearEnd: number;
  // Inducement liability split current / non-current
  remainingInducementLiability: number;
  inducementLiabilityCurrent: number;
  inducementLiabilityNonCurrent: number;
}

export interface RentStep {
  /** First lease year (1-based, inclusive) this rent applies to. */
  fromYear: number;
  /** Last lease year (1-based, inclusive) this rent applies to. */
  toYear: number;
  monthlyRent: number;
}

export function calculateStraightLineLease({
  baseMonthlyRent,
  termMonths,
  freeRentMonths = 0,
  escalationRate = 0,
  rentSteps,
  tenantImprovementAllowance = 0,
  otherInducements = 0,
  startDate,
  fiscalYearEnd,
}: {
  baseMonthlyRent: number;
  termMonths: number;
  freeRentMonths?: number;
  escalationRate?: number;
  /** Stepped $ rent schedule. When provided (non-empty), overrides escalationRate. */
  rentSteps?: RentStep[] | null;
  tenantImprovementAllowance?: number;
  otherInducements?: number;
  startDate: string;
  fiscalYearEnd: string;
}): StraightLineResult | null {
  const steps = (rentSteps ?? [])
    .filter((s) => s.monthlyRent > 0 && s.fromYear >= 1 && s.toYear >= s.fromYear)
    .sort((a, b) => a.fromYear - b.fromYear);
  const hasSteps = steps.length > 0;
  if (termMonths <= 0 || (baseMonthlyRent <= 0 && !hasSteps)) return null;

  const start = parseISO(startDate);
  const fyEnd = parseISO(fiscalYearEnd);
  const fyEndMonth = fyEnd.getMonth();
  const fyEndDay = fyEnd.getDate();

  // Build actual payment schedule month by month
  const actualPayments: number[] = [];
  let totalLeasePayments = 0;

  for (let m = 0; m < termMonths; m++) {
    const yearOffset = Math.floor(m / 12);
    let rent: number;
    if (hasSteps) {
      const leaseYear = yearOffset + 1;
      const step = steps.find((s) => leaseYear >= s.fromYear && leaseYear <= s.toYear);
      // Months past the last defined step keep the last step's rent.
      rent = step ? step.monthlyRent : steps[steps.length - 1].monthlyRent;
    } else {
      rent = baseMonthlyRent * Math.pow(1 + escalationRate / 100, yearOffset);
    }
    const payment = m < freeRentMonths ? 0 : rent;
    actualPayments.push(payment);
    totalLeasePayments += payment;
  }

  const totalInducements = tenantImprovementAllowance + otherInducements;
  const totalConsideration = totalLeasePayments - totalInducements;
  const monthlyStraightLineExpense = totalConsideration / termMonths;

  // Build schedule
  const schedule: StraightLinePeriod[] = [];
  let cumulativeDeferredRent = 0;

  for (let m = 0; m < termMonths; m++) {
    const currentDate = new Date(start.getFullYear(), start.getMonth() + m, start.getDate());
    const fiscalYear = getFiscalYear(currentDate, fyEndMonth, fyEndDay);

    const actualPayment = actualPayments[m];
    const difference = actualPayment - monthlyStraightLineExpense;
    cumulativeDeferredRent += difference;

    schedule.push({
      monthIndex: m,
      fiscalYear,
      actualPayment,
      straightLineExpense: monthlyStraightLineExpense,
      difference,
      cumulativeDeferredRent,
    });
  }

  // Deferred rent at fiscal year-end: find the last period in the fiscal year that ends on or before fyEnd
  const fyEndDate = parseISO(fiscalYearEnd);
  let deferredRentAtYearEnd = 0;
  for (const period of schedule) {
    const periodDate = new Date(start.getFullYear(), start.getMonth() + period.monthIndex, start.getDate());
    if (periodDate <= fyEndDate) {
      deferredRentAtYearEnd = period.cumulativeDeferredRent;
    }
  }

  // Inducement liability split current / non-current
  const monthlyAmortization = totalInducements / termMonths;
  let elapsedMonths = 0;
  let monthsInNextFY = 0;
  const nextFyEnd = new Date(fyEndDate);
  nextFyEnd.setFullYear(nextFyEnd.getFullYear() + 1);

  for (const period of schedule) {
    const periodDate = new Date(start.getFullYear(), start.getMonth() + period.monthIndex, start.getDate());
    if (periodDate <= fyEndDate) {
      elapsedMonths++;
    }
    if (periodDate > fyEndDate && periodDate <= nextFyEnd) {
      monthsInNextFY++;
    }
  }

  const remainingInducementLiability = Math.max(0, totalInducements - elapsedMonths * monthlyAmortization);
  const inducementLiabilityCurrent = totalInducements > 0
    ? Math.min(remainingInducementLiability, monthsInNextFY * monthlyAmortization)
    : 0;
  const inducementLiabilityNonCurrent = Math.max(0, remainingInducementLiability - inducementLiabilityCurrent);

  return {
    totalLeasePayments,
    totalInducements,
    totalConsideration,
    monthlyStraightLineExpense,
    schedule,
    deferredRentAtYearEnd,
    remainingInducementLiability,
    inducementLiabilityCurrent,
    inducementLiabilityNonCurrent,
  };
}

export function buildYearlyStraightLine(
  schedule: StraightLinePeriod[]
): { fiscalYear: number; actual: number; straightLine: number; difference: number; deferredRent: number }[] {
  const map = new Map<
    number,
    { actual: number; straightLine: number; difference: number; deferredRent: number }
  >();

  for (const p of schedule) {
    const entry = map.get(p.fiscalYear) ?? { actual: 0, straightLine: 0, difference: 0, deferredRent: 0 };
    entry.actual += p.actualPayment;
    entry.straightLine += p.straightLineExpense;
    entry.difference += p.difference;
    entry.deferredRent = p.cumulativeDeferredRent; // last period in the year wins
    map.set(p.fiscalYear, entry);
  }

  return Array.from(map.entries()).map(([fiscalYear, vals]) => ({
    fiscalYear,
    ...vals,
  }));
}
