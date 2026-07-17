import { addMonths, getMonth, addDays } from "date-fns";

export interface AmortizationRow {
  month: number;
  date: Date;
  payment: number;
  principal: number;
  interest: number;
  totalInterest: number;
  balance: number;
  isInterestOnly: boolean;
}

export type Frequency = "monthly" | "semi-monthly" | "bi-weekly" | "weekly";

export function calculateAmortization(
  principal: number,
  annualInterestRate: number,
  amortizationYears: number,
  termYears: number,
  startDate: Date = new Date(),
  interestOnlyMonths: number = 0,
  interestOnlySpecificMonths: number[] = [], // 0-11 for Jan-Dec
  balloonPayment: number = 0,
  frequency: Frequency = "monthly",
  paymentOverride: number | null = null
): {
  monthlyPayment: number;
  totalInterest: number;
  totalPayment: number;
  schedule: AmortizationRow[];
} {
  let periodsPerYear = 12;
  if (frequency === "semi-monthly") periodsPerYear = 24;
  else if (frequency === "bi-weekly") periodsPerYear = 26;
  else if (frequency === "weekly") periodsPerYear = 52;

  const totalAmortizationPeriods = Math.round(amortizationYears * periodsPerYear);
  const totalTermPeriods = Math.round(termYears * periodsPerYear);
  const periodicRate = annualInterestRate / 100 / periodsPerYear;

  let balance = principal;
  let totalInterest = 0;
  const schedule: AmortizationRow[] = [];

  // Adjust IO periods for frequency
  const ioRatio = periodsPerYear / 12;
  const adjInterestOnlyPeriods = Math.round(interestOnlyMonths * ioRatio);

  const remainingAmortizationPeriods = totalAmortizationPeriods - adjInterestOnlyPeriods;
  let standardPeriodicPayment = 0;

  if (periodicRate === 0) {
    standardPeriodicPayment = (principal - balloonPayment) / (remainingAmortizationPeriods > 0 ? remainingAmortizationPeriods : totalAmortizationPeriods);
  } else if (remainingAmortizationPeriods > 0) {
    const pow = Math.pow(1 + periodicRate, remainingAmortizationPeriods);
    standardPeriodicPayment = (principal * pow - balloonPayment) * (periodicRate / (pow - 1));
  }

  // When the contractual payment differs from the computed one, the override
  // replaces the standard periodic payment; the schedule then derives the
  // principal/interest split (and residual balance) from the actual payment.
  if (paymentOverride != null && paymentOverride > 0) {
    standardPeriodicPayment = paymentOverride;
  }

  const baseDate = startDate;

  for (let i = 1; i <= totalTermPeriods; i++) {
    let currentDate: Date;
    if (frequency === "monthly") {
      currentDate = addMonths(baseDate, i - 1);
    } else if (frequency === "semi-monthly") {
      // Approximation: alternating 14/15 days or half-month
      currentDate = addDays(baseDate, Math.round((i - 1) * 365.25 / 24));
    } else if (frequency === "bi-weekly") {
      currentDate = addDays(baseDate, (i - 1) * 14);
    } else {
      currentDate = addDays(baseDate, (i - 1) * 7);
    }

    const monthOfYear = getMonth(currentDate);
    const isInitialIO = i <= adjInterestOnlyPeriods;
    const isSpecificIO = interestOnlySpecificMonths.includes(monthOfYear);
    const isInterestOnly = isInitialIO || isSpecificIO;

    const interestForPeriod = balance * periodicRate;
    let principalForPeriod = 0;
    let payment = 0;

    if (isInterestOnly) {
      payment = interestForPeriod;
      principalForPeriod = 0;
    } else {
      payment = standardPeriodicPayment;
      principalForPeriod = payment - interestForPeriod;
    }

    totalInterest += interestForPeriod;
    balance -= principalForPeriod;

    if (i === totalTermPeriods) {
      // For the term end, we don't force balance to balloonPayment unless it's also the end of amortization
      if (i === totalAmortizationPeriods && Math.abs(balance - balloonPayment) > 0.01) {
        const diff = balance - balloonPayment;
        payment += diff;
        principalForPeriod += diff;
        balance = balloonPayment;
      }
    }

    schedule.push({
      month: i, // Period index
      date: currentDate,
      payment,
      principal: principalForPeriod,
      interest: interestForPeriod,
      totalInterest,
      balance: Math.max(0, balance),
      isInterestOnly,
    });
  }

  return {
    monthlyPayment: standardPeriodicPayment,
    totalInterest,
    totalPayment: principal + totalInterest,
    schedule,
  };
}

/**
 * Builds the fair-value schedule for a below-market-rate loan/lease using the
 * effective-interest method. The contractual cash payments are FIXED — they do
 * not change with the fair-value rate. Only the split between principal and
 * interest changes, because interest is accrued at the market (fair-value) rate
 * on the discounted carrying amount.
 *
 * The opening carrying amount is the fair value: the present value of the
 * unchanged contractual cash flows (each payment plus any residual balloon owed
 * at the end of the term) discounted at the fair-value rate. By construction the
 * schedule accretes/amortizes back to the same residual balance the contractual
 * schedule ends on, so for every period principal + interest equals the
 * contractual payment.
 */
export function calculateFairValueSchedule(
  contractualSchedule: AmortizationRow[],
  annualFvRate: number,
  frequency: Frequency = "monthly",
): {
  fairValue: number;
  monthlyPayment: number;
  totalInterest: number;
  totalPayment: number;
  schedule: AmortizationRow[];
} {
  let periodsPerYear = 12;
  if (frequency === "semi-monthly") periodsPerYear = 24;
  else if (frequency === "bi-weekly") periodsPerYear = 26;
  else if (frequency === "weekly") periodsPerYear = 52;

  const periodicRate = annualFvRate / 100 / periodsPerYear;
  const n = contractualSchedule.length;

  // Residual balance still owed at the end of the contractual term (an implicit
  // balloon when the term is shorter than the amortization period).
  const finalBalance = n > 0 ? contractualSchedule[n - 1].balance : 0;

  // Fair value = present value of the unchanged contractual cash flows.
  let fairValue = 0;
  for (let i = 0; i < n; i++) {
    fairValue += contractualSchedule[i].payment / Math.pow(1 + periodicRate, i + 1);
  }
  fairValue += finalBalance / Math.pow(1 + periodicRate, n);

  let balance = fairValue;
  let totalInterest = 0;
  let totalPayment = 0;
  const schedule: AmortizationRow[] = [];

  for (let i = 0; i < n; i++) {
    const src = contractualSchedule[i];
    const payment = src.payment;
    const interestForPeriod = balance * periodicRate;
    const principalForPeriod = payment - interestForPeriod;
    totalInterest += interestForPeriod;
    totalPayment += payment;
    balance -= principalForPeriod;
    schedule.push({
      month: src.month,
      date: src.date,
      payment,
      principal: principalForPeriod,
      interest: interestForPeriod,
      totalInterest,
      balance: Math.max(0, balance),
      isInterestOnly: src.isInterestOnly,
    });
  }

  // The regular (fixed) contractual payment: the first non-interest-only
  // payment, falling back to the first payment if every period is IO.
  const regularRow = contractualSchedule.find((r) => !r.isInterestOnly);
  const monthlyPayment = regularRow?.payment ?? contractualSchedule[0]?.payment ?? 0;

  return {
    fairValue: Number(fairValue.toFixed(2)),
    monthlyPayment,
    totalInterest,
    totalPayment,
    schedule,
  };
}

/**
 * Computes the fair-value adjustment recognized at inception for a
 * below-market-rate loan/lease: the day-one discount, i.e. the face principal
 * less the fair value (present value of the contractual cash flows discounted at
 * the market rate). Positive means the instrument is carried below its face
 * amount. The contractual payments are never changed to derive this figure.
 */
export function computeFvAdjustment(params: {
  principal: number;
  contractualRate: number;
  fvRate: number;
  amortizationYears: number;
  termYears: number;
  startDate: Date;
  ioMonths?: number;
  specificIoMonths?: number[];
  balloonPayment?: number;
  frequency?: Frequency;
  paymentOverride?: number | null;
}): number {
  const {
    principal,
    contractualRate,
    fvRate,
    amortizationYears,
    termYears,
    startDate,
    ioMonths = 0,
    specificIoMonths = [],
    balloonPayment = 0,
    frequency = "monthly",
    paymentOverride = null,
  } = params;

  const contractual = calculateAmortization(
    principal,
    contractualRate,
    amortizationYears,
    termYears,
    startDate,
    ioMonths,
    specificIoMonths,
    balloonPayment,
    frequency,
    paymentOverride,
  );
  const fv = calculateFairValueSchedule(contractual.schedule, fvRate, frequency);

  return Number((principal - fv.fairValue).toFixed(2));
}

/**
 * Suggests an FV decision ('use_fv' | 'trivial' | 'immaterial') by comparing
 * the absolute FV adjustment against the file's trivialThreshold and materiality.
 * Returns null when there isn't enough information to make a determination
 * (e.g. no thresholds configured).
 */
export function suggestFvDecision(
  fvAdjustment: number | null | undefined,
  trivialThreshold: number | null | undefined,
  materiality: number | null | undefined
): "use_fv" | "trivial" | "immaterial" | null {
  if (fvAdjustment == null) return null;
  const absAdjustment = Math.abs(fvAdjustment);

  if (trivialThreshold != null && absAdjustment < trivialThreshold) {
    return "trivial";
  }
  if (materiality != null && absAdjustment >= materiality) {
    return "use_fv";
  }
  if (trivialThreshold != null || materiality != null) {
    return "immaterial";
  }
  return null;
}
