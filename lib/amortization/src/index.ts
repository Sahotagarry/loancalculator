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
  /** True while the loan is in a payment grace period (no payment due). */
  isGrace?: boolean;
}

export type Frequency = "monthly" | "semi-monthly" | "bi-weekly" | "weekly";

/**
 * How interest behaves during a payment grace period (months with no payments
 * before repayment starts):
 * - "capitalized": interest accrues and is added to the balance; repayment
 *   installments are computed on the grown balance.
 * - "none": no interest accrues during the grace period (interest-free start).
 * A grace period where interest IS paid monthly is not a grace period at all —
 * that is the existing interest-only option (ioMonths).
 */
export type GraceInterestTreatment = "capitalized" | "none";

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
  paymentOverride: number | null = null,
  graceMonths: number = 0,
  graceInterestTreatment: GraceInterestTreatment = "capitalized"
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

  // Period dates are generated the same way inside the schedule loop below.
  const dateForPeriod = (i: number): Date => {
    if (frequency === "monthly") return addMonths(startDate, i - 1);
    if (frequency === "semi-monthly") return addDays(startDate, Math.round(((i - 1) * 365.25) / 24));
    if (frequency === "bi-weekly") return addDays(startDate, (i - 1) * 14);
    return addDays(startDate, (i - 1) * 7);
  };

  // Payment grace period: no payments at all until `graceMonths` calendar
  // months after the start date. The term includes the grace period, but the
  // amortization period does not — e.g. a 72-month term with a 12-month grace
  // period repays over a 60-month amortization. Grace periods are counted by
  // comparing each period's actual date against the calendar boundary so
  // weekly/bi-weekly/semi-monthly schedules defer the right number of periods.
  const graceEndDate = graceMonths > 0 ? addMonths(startDate, Math.max(0, graceMonths)) : null;
  let adjGracePeriods = 0;
  if (graceEndDate) {
    while (
      adjGracePeriods < totalTermPeriods &&
      dateForPeriod(adjGracePeriods + 1) < graceEndDate
    ) {
      adjGracePeriods++;
    }
  }

  // Installments are computed on the balance at the END of the grace period
  // (grown by capitalized interest, or unchanged when interest is waived).
  const balanceAfterGrace =
    graceInterestTreatment === "capitalized"
      ? principal * Math.pow(1 + periodicRate, adjGracePeriods)
      : principal;

  const remainingAmortizationPeriods = totalAmortizationPeriods - adjInterestOnlyPeriods;
  let standardPeriodicPayment = 0;

  if (periodicRate === 0) {
    standardPeriodicPayment = (balanceAfterGrace - balloonPayment) / (remainingAmortizationPeriods > 0 ? remainingAmortizationPeriods : totalAmortizationPeriods);
  } else if (remainingAmortizationPeriods > 0) {
    const pow = Math.pow(1 + periodicRate, remainingAmortizationPeriods);
    standardPeriodicPayment = (balanceAfterGrace * pow - balloonPayment) * (periodicRate / (pow - 1));
  }

  // When the contractual payment differs from the computed one, the override
  // replaces the standard periodic payment; the schedule then derives the
  // principal/interest split (and residual balance) from the actual payment.
  if (paymentOverride != null && paymentOverride > 0) {
    standardPeriodicPayment = paymentOverride;
  }

  for (let i = 1; i <= totalTermPeriods; i++) {
    const currentDate = dateForPeriod(i);

    const monthOfYear = getMonth(currentDate);
    const isGrace = i <= adjGracePeriods;
    const isInitialIO = !isGrace && i <= adjGracePeriods + adjInterestOnlyPeriods;
    const isSpecificIO = !isGrace && interestOnlySpecificMonths.includes(monthOfYear);
    const isInterestOnly = isInitialIO || isSpecificIO;

    let interestForPeriod = balance * periodicRate;
    let principalForPeriod = 0;
    let payment = 0;

    if (isGrace) {
      // No payment due. Interest either capitalizes onto the balance or is
      // waived entirely, depending on the grace treatment. Accretion is NOT
      // recorded as (negative) principal — repayment metrics that sum
      // row.principal must only see actual principal repayments — the balance
      // is grown directly instead.
      payment = 0;
      principalForPeriod = 0;
      if (graceInterestTreatment === "capitalized") {
        balance += interestForPeriod;
      } else {
        interestForPeriod = 0;
      }
    } else if (isInterestOnly) {
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
      if (i === adjGracePeriods + totalAmortizationPeriods && Math.abs(balance - balloonPayment) > 0.01) {
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
      isGrace,
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
/**
 * Whether a fair-value rate can safely drive the effective-interest math:
 * a finite number strictly greater than zero. Zero, negative, NaN, and
 * Infinity all silently corrupt the PV discounting, so every consumer must
 * fall back to the contractual schedule when this returns false.
 */
export function isValidFvRate(rate: number | null | undefined): rate is number {
  return rate != null && typeof rate === "number" && Number.isFinite(rate) && rate > 0;
}

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
  if (!isValidFvRate(annualFvRate)) {
    throw new Error(
      `calculateFairValueSchedule requires a finite fair-value rate > 0, got ${annualFvRate}`,
    );
  }
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
      isGrace: src.isGrace,
    });
  }

  // The regular (fixed) contractual payment: the first non-interest-only
  // payment, falling back to the first payment if every period is IO.
  const regularRow = contractualSchedule.find((r) => !r.isInterestOnly && !r.isGrace);
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
  graceMonths?: number;
  graceInterestTreatment?: GraceInterestTreatment;
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
    graceMonths = 0,
    graceInterestTreatment = "capitalized",
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
    graceMonths,
    graceInterestTreatment,
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
