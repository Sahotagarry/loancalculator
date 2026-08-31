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
  /** Scheduled rows remain the default; event rows are principal-only cash flows. */
  rowType?: "scheduled_payment" | "principal_event" | "accrued_interest_settlement";
  eventId?: string;
  eventOrdering?: PrincipalEventOrdering;
  eventSequence?: number;
  eventTreatment?: PrincipalEventTreatment;
  openingBalance?: number;
  /** Interest earned but not paid at the time represented by this row. */
  accruedInterest?: number;
  /** Dated contractual-rate portions making up this row's interest. */
  rateSegments?: readonly RateAccrualSegment[];
  /** Contractual annual rate in force immediately after this row. */
  contractualAnnualRate?: number;
}

export type Frequency = "monthly" | "semi-monthly" | "bi-weekly" | "weekly";
export type PaymentTiming = "beginning" | "end";
export type GraceTermMode = "included" | "added";
export type DatedLoanEventOrdering =
  | "before_scheduled_payment"
  | "after_scheduled_payment";
export type PrincipalEventOrdering = DatedLoanEventOrdering;
export type RateResetOrdering = DatedLoanEventOrdering;
export type ProspectiveEventTreatment = "keep_payment" | "keep_maturity";
export type PrincipalEventTreatment = ProspectiveEventTreatment;
export type RateResetTreatment = ProspectiveEventTreatment;

export interface PrincipalPaymentEvent {
  readonly id: string;
  readonly effectiveDate: Date;
  readonly ordering: PrincipalEventOrdering;
  /** Immutable tie-breaker within a date and ordering phase. */
  readonly sequence: number;
  readonly amount: number;
  readonly treatment: PrincipalEventTreatment;
}

/** Evidence for the benchmark observation used by a contractual reset. */
export interface RateResetSourceEvidence {
  readonly source: string;
  readonly observationDate?: Date;
  readonly publishedDate?: Date;
  readonly fetchedAt?: Date;
  readonly reference?: string;
}

export interface RateResetOverrideEvidence {
  readonly reason: string;
  readonly authoredAt: Date;
  readonly author?: string;
  readonly reference?: string;
}

export interface RateResetEvent {
  readonly id: string;
  readonly effectiveDate: Date;
  readonly ordering: RateResetOrdering;
  /** Immutable tie-breaker shared with every other event on the date/phase. */
  readonly sequence: number;
  /** Rates and spreads are annual percentage values (for example, 6.45). */
  readonly benchmarkRate: number;
  readonly spread: number;
  readonly resultingContractualRate: number;
  readonly sourceEvidence: RateResetSourceEvidence;
  readonly overrideEvidence?: RateResetOverrideEvidence;
  readonly treatment: RateResetTreatment;
}

export interface RateAccrualSegment {
  readonly from: Date;
  readonly to: Date;
  readonly annualContractualRate: number;
  readonly interest: number;
  /** Absent for the opening rate supplied directly to the calculation. */
  readonly rateResetEventId?: string;
}

export interface AmortizationEvidenceMetadata {
  [key: string]: unknown;
}

/**
 * Optional contractual conventions. Omitting this object preserves the legacy
 * schedule: end-of-period payments, grace included in the entered term, the
 * start date used as the first period date, and approximate semi-monthly dates.
 */
export interface AmortizationOptions {
  paymentTiming?: PaymentTiming;
  graceTermMode?: GraceTermMode;
  firstPaymentDate?: Date;
  /** Contractual semi-monthly due days, for example [1, 15] or [15, 31]. */
  semiMonthlyDueDays?: readonly [number, number];
  principalEvents?: readonly PrincipalPaymentEvent[];
  /** Realized contractual resets, applied prospectively to the stated schedule. */
  rateResetEvents?: readonly RateResetEvent[];
  /**
   * Frozen day-one expected reset assumptions. Used only by
   * computeFvAdjustment, separately from realized contractual resets.
   */
  fvExpectedRateResetEvents?: readonly RateResetEvent[];
  evidenceMetadata?: AmortizationEvidenceMetadata;
  /**
   * Contract commencement used to place irregular cash flows before the first
   * scheduled due date on the FV timeline.
   */
  commencementDate?: Date;
}

export interface AmortizationResult {
  monthlyPayment: number;
  totalInterest: number;
  totalPayment: number;
  schedule: AmortizationRow[];
  evidenceMetadata?: AmortizationEvidenceMetadata;
}

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

function calculateAmortizationLegacy(
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
  graceInterestTreatment: GraceInterestTreatment = "capitalized",
  options: AmortizationOptions = {},
): AmortizationResult {
  let periodsPerYear = 12;
  if (frequency === "semi-monthly") periodsPerYear = 24;
  else if (frequency === "bi-weekly") periodsPerYear = 26;
  else if (frequency === "weekly") periodsPerYear = 52;

  const totalAmortizationPeriods = Math.round(amortizationYears * periodsPerYear);
  const baseTermPeriods = Math.round(termYears * periodsPerYear);
  const periodicRate = annualInterestRate / 100 / periodsPerYear;
  const paymentTiming = options.paymentTiming ?? "end";
  const graceTermMode = options.graceTermMode ?? "included";

  let balance = principal;
  let totalInterest = 0;
  const schedule: AmortizationRow[] = [];

  // Adjust IO periods for frequency
  const ioRatio = periodsPerYear / 12;
  const adjInterestOnlyPeriods = Math.round(interestOnlyMonths * ioRatio);

  const paymentDateAnchor = options.firstPaymentDate ?? startDate;
  const explicitSemiMonthlyDays = options.semiMonthlyDueDays;
  if (
    explicitSemiMonthlyDays &&
    (explicitSemiMonthlyDays[0] < 1 ||
      explicitSemiMonthlyDays[0] > 31 ||
      explicitSemiMonthlyDays[1] < 1 ||
      explicitSemiMonthlyDays[1] > 31 ||
      explicitSemiMonthlyDays[0] === explicitSemiMonthlyDays[1])
  ) {
    throw new Error("semiMonthlyDueDays must contain two distinct days from 1 through 31");
  }

  const semiMonthlyDates: Date[] = [];
  const semiMonthlyCandidate = (year: number, month: number, day: number): Date => {
    const lastDay = new Date(year, month + 1, 0).getDate();
    const result = new Date(paymentDateAnchor);
    result.setFullYear(year, month, Math.min(day, lastDay));
    return result;
  };
  const nextSemiMonthlyDate = (onOrAfter: Date, inclusive: boolean): Date => {
    const days = [...explicitSemiMonthlyDays!].sort((a, b) => a - b);
    for (let monthOffset = 0; ; monthOffset++) {
      const monthBase = addMonths(
        new Date(onOrAfter.getFullYear(), onOrAfter.getMonth(), 1),
        monthOffset,
      );
      for (const day of days) {
        const candidate = semiMonthlyCandidate(
          monthBase.getFullYear(),
          monthBase.getMonth(),
          day,
        );
        if (inclusive ? candidate >= onOrAfter : candidate > onOrAfter) return candidate;
      }
    }
  };

  // Period dates use the first contractual payment as their anchor. Explicit
  // semi-monthly due days opt into calendar due dates; absence retains the
  // historical 365.25/24 approximation for existing loans.
  const dateForPeriod = (i: number): Date => {
    if (frequency === "monthly") return addMonths(paymentDateAnchor, i - 1);
    if (frequency === "semi-monthly") {
      if (!explicitSemiMonthlyDays) {
        return addDays(paymentDateAnchor, Math.round(((i - 1) * 365.25) / 24));
      }
      while (semiMonthlyDates.length < i) {
        if (semiMonthlyDates.length === 0) {
          semiMonthlyDates.push(
            options.firstPaymentDate
              ? new Date(paymentDateAnchor)
              : nextSemiMonthlyDate(paymentDateAnchor, true),
          );
        } else {
          semiMonthlyDates.push(
            nextSemiMonthlyDate(semiMonthlyDates[semiMonthlyDates.length - 1], false),
          );
        }
      }
      return new Date(semiMonthlyDates[i - 1]);
    }
    if (frequency === "bi-weekly") return addDays(paymentDateAnchor, (i - 1) * 14);
    return addDays(paymentDateAnchor, (i - 1) * 7);
  };
  // Grace is an economic interval from commencement, not merely a count of
  // suppressed payment dates. This separate generator deliberately anchors at
  // commencement so a first payment supplied at/after grace end cannot erase
  // accrued (or waived) grace periods.
  const graceDateForPeriod = (i: number): Date => {
    if (frequency === "monthly") return addMonths(startDate, i - 1);
    if (frequency === "semi-monthly" && explicitSemiMonthlyDays) {
      const days = [...explicitSemiMonthlyDays].sort((a, b) => a - b);
      let found = 0;
      for (let monthOffset = 0; ; monthOffset++) {
        const month = addMonths(new Date(startDate.getFullYear(), startDate.getMonth(), 1), monthOffset);
        for (const day of days) {
          const lastDay = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
          const date = new Date(startDate);
          date.setFullYear(month.getFullYear(), month.getMonth(), Math.min(day, lastDay));
          if (date >= startDate && ++found === i) return date;
        }
      }
    }
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
  let paymentDateGracePeriods = 0;
  if (graceEndDate) {
    while (
      dateForPeriod(paymentDateGracePeriods + 1) < graceEndDate
    ) {
      paymentDateGracePeriods++;
    }
  }
  let economicGracePeriods = 0;
  if (graceEndDate) {
    while (graceDateForPeriod(economicGracePeriods + 1) < graceEndDate) {
      economicGracePeriods++;
    }
  }
  // An included-term schedule cannot contain grace rows after its contractual
  // maturity. Added-term schedules retain the whole measured deferral, even
  // when it is longer than the base repayment term.
  const adjGracePeriods =
    graceTermMode === "added"
      ? economicGracePeriods
      : Math.min(economicGracePeriods, baseTermPeriods);
  // When the explicit first payment is later than commencement, materialize
  // enough no-payment rows to represent the economic grace interval. The
  // remaining payment dates still begin at the contractual first-payment date.
  const syntheticGracePeriods = Math.max(
    0,
    Math.min(adjGracePeriods, economicGracePeriods) - paymentDateGracePeriods,
  );
  const totalTermPeriods =
    baseTermPeriods + (graceTermMode === "added" ? adjGracePeriods : 0);

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
    if (paymentTiming === "beginning") standardPeriodicPayment /= 1 + periodicRate;
  }

  // When the contractual payment differs from the computed one, the override
  // replaces the standard periodic payment; the schedule then derives the
  // principal/interest split (and residual balance) from the actual payment.
  if (paymentOverride != null && paymentOverride > 0) {
    standardPeriodicPayment = paymentOverride;
  }

  for (let i = 1; i <= totalTermPeriods; i++) {
    const currentDate =
      i <= syntheticGracePeriods
        ? graceDateForPeriod(i)
        : dateForPeriod(i - syntheticGracePeriods);

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
      payment =
        paymentTiming === "beginning"
          ? (balance * periodicRate) / (1 + periodicRate)
          : interestForPeriod;
      if (paymentTiming === "beginning") {
        interestForPeriod = (balance - payment) * periodicRate;
      }
      principalForPeriod = 0;
    } else {
      payment = standardPeriodicPayment;
      if (paymentTiming === "beginning") {
        interestForPeriod = (balance - payment) * periodicRate;
      }
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

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Applies principal-only events to the contractual schedule. The legacy
 * implementation above is deliberately left untouched and is returned
 * directly when there are no events; this is important because existing
 * schedules are accounting evidence and must not move by rounding noise.
 */
export function calculateAmortization(
  principal: number,
  annualInterestRate: number,
  amortizationYears: number,
  termYears: number,
  startDate: Date = new Date(),
  interestOnlyMonths: number = 0,
  interestOnlySpecificMonths: number[] = [],
  balloonPayment: number = 0,
  frequency: Frequency = "monthly",
  paymentOverride: number | null = null,
  graceMonths: number = 0,
  graceInterestTreatment: GraceInterestTreatment = "capitalized",
  options: AmortizationOptions = {},
): AmortizationResult {
  const principalEvents = options.principalEvents ?? [];
  const rateResetEvents = options.rateResetEvents ?? [];
  const legacy = calculateAmortizationLegacy(
    principal,
    annualInterestRate,
    amortizationYears,
    termYears,
    startDate,
    interestOnlyMonths,
    interestOnlySpecificMonths,
    balloonPayment,
    frequency,
    paymentOverride,
    graceMonths,
    graceInterestTreatment,
    options,
  );
  if (principalEvents.length === 0 && rateResetEvents.length === 0) {
    return options.evidenceMetadata === undefined
      ? legacy
      : { ...legacy, evidenceMetadata: options.evidenceMetadata };
  }
  if (legacy.schedule.length === 0) {
    throw new Error("dated events require at least one contractual payment period");
  }

  type DatedEvent =
    | { readonly kind: "principal"; readonly event: PrincipalPaymentEvent }
    | { readonly kind: "rate_reset"; readonly event: RateResetEvent };
  const isPrincipalEvent = (
    item: DatedEvent,
  ): item is { readonly kind: "principal"; readonly event: PrincipalPaymentEvent } =>
    item.kind === "principal";
  const phase = (ordering: PrincipalEventOrdering): number =>
    ordering === "before_scheduled_payment" ? 0 : 1;
  const ordered: DatedEvent[] = [
    ...principalEvents.map((event) => ({ kind: "principal" as const, event })),
    ...rateResetEvents.map((event) => ({ kind: "rate_reset" as const, event })),
  ].sort(
    (a, b) =>
      a.event.effectiveDate.getTime() - b.event.effectiveDate.getTime() ||
      phase(a.event.ordering) - phase(b.event.ordering) ||
      a.event.sequence - b.event.sequence,
  );
  const maturity = legacy.schedule[legacy.schedule.length - 1].date.getTime();
  const seen = new Set<string>();
  for (const item of ordered) {
    const event = item.event;
    const time = event.effectiveDate.getTime();
    const label = isPrincipalEvent(item) ? "principal event" : "rate reset";
    if (!Number.isFinite(time)) throw new Error(`${label} ${event.id} has an invalid effectiveDate`);
    if (isPrincipalEvent(item) && (!Number.isFinite(item.event.amount) || item.event.amount <= 0)) {
      throw new Error(`principal event ${event.id} amount must be greater than zero`);
    }
    if (!isPrincipalEvent(item)) {
      const reset = item.event;
      if (
        !Number.isFinite(reset.benchmarkRate) ||
        !Number.isFinite(reset.spread) ||
        !Number.isFinite(reset.resultingContractualRate) ||
        reset.resultingContractualRate < 0
      ) {
        throw new Error(`rate reset ${reset.id} contains an invalid rate`);
      }
      if (!reset.sourceEvidence?.source?.trim()) {
        throw new Error(`rate reset ${reset.id} requires source evidence`);
      }
      if (reset.overrideEvidence) {
        if (
          !reset.overrideEvidence.reason.trim() ||
          !Number.isFinite(reset.overrideEvidence.authoredAt.getTime())
        ) {
          throw new Error(`rate reset ${reset.id} contains invalid override evidence`);
        }
      }
    }
    if (!Number.isSafeInteger(event.sequence) || event.sequence < 0) {
      throw new Error(`${label} ${event.id} sequence must be a non-negative integer`);
    }
    if (time < startDate.getTime()) {
      throw new Error(`${label} ${event.id} cannot be before the loan start date`);
    }
    if (time > maturity) {
      throw new Error(`${label} ${event.id} cannot be after contractual maturity`);
    }
    const key = `${time}|${event.ordering}|${event.sequence}`;
    if (seen.has(key)) {
      throw new Error("dated events cannot duplicate date, ordering, and sequence");
    }
    seen.add(key);
  }

  let periodsPerYear = 12;
  if (frequency === "semi-monthly") periodsPerYear = 24;
  else if (frequency === "bi-weekly") periodsPerYear = 26;
  else if (frequency === "weekly") periodsPerYear = 52;
  let currentAnnualRate = annualInterestRate;
  let currentRateResetEventId: string | undefined;
  const periodicRate = (): number => currentAnnualRate / 100 / periodsPerYear;
  const paymentTiming = options.paymentTiming ?? "end";
  const targetResidual = legacy.schedule[legacy.schedule.length - 1].balance;
  let standardPayment = legacy.monthlyPayment;
  let balance = principal;
  let accruedInterest = 0;
  let totalInterest = 0;
  let eventIndex = 0;
  const schedule: AmortizationRow[] = [];
  const epsilon = 1e-8;
  let pendingCurrentDueRecast = false;

  const futureAmortizingCount = (from: number, includeCurrent: boolean): number =>
    legacy.schedule.slice(from + (includeCurrent ? 0 : 1))
      .filter((row) => !row.isGrace && !row.isInterestOnly).length;

  const recast = (rowIndex: number, includeCurrent: boolean): void => {
    const count = futureAmortizingCount(rowIndex, includeCurrent);
    if (count <= 0) {
      if (balance > targetResidual + 0.01) {
        throw new Error("keep_maturity event leaves principal with no future amortizing payments");
      }
      return;
    }
    const current = legacy.schedule[rowIndex];
    const currentIsAmortizing =
      includeCurrent && !current.isGrace && !current.isInterestOnly;
    // IO interest settles at the current due date and is not financed into the
    // later amortizing installments. Grace interest, by contrast, capitalizes.
    const amountToAmortize =
      includeCurrent && current.isInterestOnly
        ? balance
        : balance + accruedInterest;
    const rate = periodicRate();
    if (rate === 0) {
      standardPayment = (amountToAmortize - targetResidual) / count;
    } else if (paymentTiming === "end" && currentIsAmortizing) {
      // Interest already accrued in the current (possibly segmented) interval.
      // It settles in the first of `count` payments, so only the remaining
      // count - 1 whole periods compound at the newly effective rate.
      const futurePow = Math.pow(1 + rate, count - 1);
      const futureAnnuity = (futurePow - 1) / rate;
      standardPayment =
        (amountToAmortize * futurePow - targetResidual) /
        (futurePow + futureAnnuity);
    } else {
      const pow = Math.pow(1 + rate, count);
      standardPayment =
        (amountToAmortize * pow - targetResidual) * (rate / (pow - 1));
      if (paymentTiming === "beginning") standardPayment /= 1 + rate;
    }
    if (!Number.isFinite(standardPayment) || standardPayment < -epsilon) {
      throw new Error("dated event produces an invalid or negative amortizing payment");
    }
    standardPayment = Math.max(0, standardPayment);
  };

  const addEvent = (
    event: PrincipalPaymentEvent,
    rowIndex: number,
    includeCurrentForRecast: boolean,
    deferCurrentDueRecast: boolean,
  ): void => {
    if (event.amount > balance + 0.005) {
      throw new Error(`principal event ${event.id} exceeds the outstanding principal balance`);
    }
    const openingBalance = balance;
    const amount = Math.min(event.amount, balance);
    balance = Math.max(0, balance - amount);
    schedule.push({
      month: rowIndex + 1,
      date: new Date(event.effectiveDate),
      payment: amount,
      principal: amount,
      interest: 0,
      totalInterest,
      balance,
      isInterestOnly: false,
      isGrace: false,
      rowType: "principal_event",
      eventId: event.id,
      eventOrdering: event.ordering,
      eventSequence: event.sequence,
      eventTreatment: event.treatment,
      openingBalance,
      accruedInterest,
      contractualAnnualRate: currentAnnualRate,
    });
    if (event.treatment === "keep_maturity") {
      if (deferCurrentDueRecast) pendingCurrentDueRecast = true;
      else recast(rowIndex, includeCurrentForRecast);
    }
  };

  const applyDatedEvent = (
    item: DatedEvent,
    rowIndex: number,
    includeCurrentForRecast: boolean,
    deferCurrentDueRecast: boolean,
  ): void => {
    if (isPrincipalEvent(item)) {
      addEvent(item.event, rowIndex, includeCurrentForRecast, deferCurrentDueRecast);
      return;
    }
    currentAnnualRate = item.event.resultingContractualRate;
    currentRateResetEventId = item.event.id;
    if (item.event.treatment === "keep_maturity") {
      if (deferCurrentDueRecast) pendingCurrentDueRecast = true;
      else recast(rowIndex, includeCurrentForRecast);
    }
  };

  let periodRateSegments: RateAccrualSegment[] = [];
  const accrue = (from: number, to: number, periodStart: number, periodEnd: number, isGrace: boolean): void => {
    if (to <= from || balance <= epsilon) return;
    if (isGrace && graceInterestTreatment === "none") return;
    const periodLength = Math.max(DAY_MS, periodEnd - periodStart);
    const fraction = (to - from) / periodLength;
    const interest = balance * periodicRate() * fraction;
    accruedInterest += interest;
    periodRateSegments.push({
      from: new Date(from),
      to: new Date(to),
      annualContractualRate: currentAnnualRate,
      interest,
      rateResetEventId: currentRateResetEventId,
    });
  };

  for (let i = 0; i < legacy.schedule.length; i++) {
    periodRateSegments = [];
    const template = legacy.schedule[i];
    const due = template.date.getTime();
    const previousDue =
      i === 0
        ? (paymentTiming === "beginning"
          ? due
          : due > startDate.getTime()
          ? startDate.getTime()
          : due - Math.max(DAY_MS, (legacy.schedule[1]?.date.getTime() ?? due + DAY_MS) - due))
        : legacy.schedule[i - 1].date.getTime();
    // A delayed first due can still contain a dated event after commencement.
    // Beginning-timing payments do not have a prior due date, so use
    // commencement solely as that leading event interval's lower boundary.
    const intervalStart =
      i === 0 && paymentTiming === "beginning" ? startDate.getTime() : previousDue;
    let cursor = intervalStart;

    // Events strictly inside the contractual interval accrue interest up to
    // their actual day, using the interval's actual calendar length.
    while (eventIndex < ordered.length && ordered[eventIndex].event.effectiveDate.getTime() < due) {
      const item = ordered[eventIndex];
      const eventTime = item.event.effectiveDate.getTime();
      if (eventTime >= intervalStart) {
        accrue(cursor, eventTime, intervalStart, due, !!template.isGrace);
        cursor = eventTime;
        applyDatedEvent(
          item,
          i,
          paymentTiming === "end",
          paymentTiming === "end",
        );
      }
      eventIndex++;
    }
    accrue(cursor, due, intervalStart, due, !!template.isGrace);

    const sameDate: DatedEvent[] = [];
    while (eventIndex < ordered.length && ordered[eventIndex].event.effectiveDate.getTime() === due) {
      sameDate.push(ordered[eventIndex++]);
    }
    for (const item of sameDate.filter(
      ({ event }) => event.ordering === "before_scheduled_payment",
    )) {
      applyDatedEvent(item, i, true, true);
    }
    if (pendingCurrentDueRecast) {
      recast(i, true);
      pendingCurrentDueRecast = false;
    }

    const openingBalance = balance;
    let payment = 0;
    let principalForPeriod = 0;
    let interestForPeriod = accruedInterest;
    if (template.isGrace) {
      // An exact principal event can occur during capitalizing grace. Its
      // already-earned interest remains a separate receivable: never add it
      // back to a zero principal balance.
      if (balance <= epsilon && accruedInterest > epsilon) {
        payment = accruedInterest;
      } else if (graceInterestTreatment === "capitalized" && balance > epsilon) {
        balance += accruedInterest;
      }
    } else if (balance <= epsilon) {
      // A principal event never pays interest. Any interest earned before an
      // exact payoff is therefore settled separately on the next due date.
      payment = accruedInterest;
    } else if (template.isInterestOnly) {
      payment = accruedInterest;
    } else {
      payment = standardPayment;
      if (payment + epsilon < accruedInterest) {
        throw new Error("principal event would cause negative amortization");
      }
      payment = Math.min(payment, balance + accruedInterest);
      principalForPeriod = Math.min(balance, Math.max(0, payment - accruedInterest));
      balance -= principalForPeriod;
    }
    // At every due date interest is either paid, waived, or capitalized.
    // Keeping capitalized grace interest in this accumulator would capitalize
    // the same earned amount again in every later grace period.
    accruedInterest = 0;
    totalInterest += interestForPeriod;

    if (payment > epsilon || balance > epsilon || interestForPeriod > epsilon) {
      schedule.push({
        month: template.month,
        date: new Date(template.date),
        payment,
        principal: principalForPeriod,
        interest: interestForPeriod,
        totalInterest,
        balance: Math.max(0, balance),
        isInterestOnly: template.isInterestOnly,
        isGrace: template.isGrace,
        rowType:
          balance <= epsilon && principalForPeriod === 0 && interestForPeriod > 0
            ? "accrued_interest_settlement"
            : "scheduled_payment",
        openingBalance,
        accruedInterest: interestForPeriod,
        rateSegments: periodRateSegments,
        contractualAnnualRate: currentAnnualRate,
      });
    }

    for (const item of sameDate.filter(
      ({ event }) => event.ordering === "after_scheduled_payment",
    )) {
      applyDatedEvent(item, i, false, false);
    }
  }

  return {
    monthlyPayment: standardPayment,
    totalInterest,
    totalPayment: principal + totalInterest,
    schedule,
    evidenceMetadata: options.evidenceMetadata,
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
  options: Pick<
    AmortizationOptions,
    "paymentTiming" | "evidenceMetadata" | "commencementDate"
  > = {},
): {
  fairValue: number;
  monthlyPayment: number;
  totalInterest: number;
  totalPayment: number;
  schedule: AmortizationRow[];
  evidenceMetadata?: AmortizationEvidenceMetadata;
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
  const paymentTiming = options.paymentTiming ?? "end";
  const n = contractualSchedule.length;
  const hasIrregularCashFlows = contractualSchedule.some(
    (row) => row.rowType === "principal_event" || row.rowType === "accrued_interest_settlement",
  );

  // Event rows add cash-flow points without adding contractual periods. Give
  // scheduled due dates integral period positions and interpolate event dates
  // by the actual elapsed fraction of the enclosing due-date interval.
  const contractualTimes: number[] = [];
  if (hasIrregularCashFlows) {
    const scheduledIndexes = contractualSchedule
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => row.rowType !== "principal_event");
    for (let i = 0; i < n; i++) {
      const exact = scheduledIndexes.findIndex(({ index }) => index === i);
      if (exact >= 0) {
        // Irregular schedules use dated contractual time rather than row
        // index. Retaining one full period to the first due date also gives a
        // leading event a place strictly between commencement and that due
        // date for both payment-timing conventions.
        contractualTimes[i] = exact + 1;
        continue;
      }
      const before = [...scheduledIndexes].reverse().find(({ index }) => index < i);
      const after = scheduledIndexes.find(({ index }) => index > i);
      if (before && after) {
        const span = Math.max(DAY_MS, after.row.date.getTime() - before.row.date.getTime());
        contractualTimes[i] =
          scheduledIndexes.findIndex(({ index }) => index === before.index) +
          1 +
          (contractualSchedule[i].date.getTime() - before.row.date.getTime()) / span;
      } else if (before) {
        contractualTimes[i] =
          scheduledIndexes.findIndex(({ index }) => index === before.index) +
          1;
      } else {
        const commencementCandidate =
          options.commencementDate ??
          (options.evidenceMetadata?.commencementDate instanceof Date
            ? options.evidenceMetadata.commencementDate
            : undefined);
        const firstDue = scheduledIndexes[0]?.row.date.getTime();
        const commencement = commencementCandidate?.getTime();
        if (firstDue != null && commencement != null && firstDue > commencement) {
          contractualTimes[i] = Math.max(
            0,
            (contractualSchedule[i].date.getTime() - commencement) / (firstDue - commencement),
          );
        } else {
          // A caller that cannot supply commencement retains the historical
          // conservative placement at the first due date.
          contractualTimes[i] = 1;
        }
      }
    }
  }

  // Residual balance still owed at the end of the contractual term (an implicit
  // balloon when the term is shorter than the amortization period).
  const finalBalance = n > 0 ? contractualSchedule[n - 1].balance : 0;

  // Fair value = present value of the unchanged contractual cash flows.
  let fairValue = 0;
  for (let i = 0; i < n; i++) {
    const discountPeriods = hasIrregularCashFlows
      ? contractualTimes[i]
      : paymentTiming === "beginning" ? i : i + 1;
    fairValue += contractualSchedule[i].payment / Math.pow(1 + periodicRate, discountPeriods);
  }
  const residualTime = hasIrregularCashFlows
    ? (contractualTimes[n - 1] ?? 0)
    : n;
  fairValue += finalBalance / Math.pow(1 + periodicRate, residualTime);

  let balance = fairValue;
  let totalInterest = 0;
  let totalPayment = 0;
  const schedule: AmortizationRow[] = [];

  for (let i = 0; i < n; i++) {
    const src = contractualSchedule[i];
    const payment = src.payment;
    const priorTime = i === 0 ? 0 : contractualTimes[i - 1];
    const elapsed = hasIrregularCashFlows ? Math.max(0, contractualTimes[i] - priorTime) : 1;
    const interestForPeriod = hasIrregularCashFlows
      ? balance * (Math.pow(1 + periodicRate, elapsed) - 1)
      : paymentTiming === "beginning"
        ? (balance - payment) * periodicRate
        : balance * periodicRate;
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
      rowType: src.rowType,
      eventId: src.eventId,
      eventOrdering: src.eventOrdering,
      eventSequence: src.eventSequence,
      eventTreatment: src.eventTreatment,
      openingBalance: balance + principalForPeriod,
      accruedInterest: src.accruedInterest,
      rateSegments: src.rateSegments,
      contractualAnnualRate: src.contractualAnnualRate,
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
    evidenceMetadata: options.evidenceMetadata,
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
  paymentTiming?: PaymentTiming;
  graceTermMode?: GraceTermMode;
  firstPaymentDate?: Date;
  semiMonthlyDueDays?: readonly [number, number];
}, options: AmortizationOptions = {}): number {
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
    paymentTiming,
    graceTermMode,
    firstPaymentDate,
    semiMonthlyDueDays,
  } = params;
  const conventions: AmortizationOptions = {
    paymentTiming,
    graceTermMode,
    firstPaymentDate,
    semiMonthlyDueDays,
    ...options,
  };
  // Initial-recognition FV cash flows use only the approved expectation set.
  // Later realized resets must never rewrite that day-one measurement.
  conventions.rateResetEvents = options.fvExpectedRateResetEvents ?? [];

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
    conventions,
  );
  const fv = calculateFairValueSchedule(contractual.schedule, fvRate, frequency, conventions);

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

/** A payment in a remaining contractual cash-flow stream. Amounts are outflows. */
export interface Aspe3856DatedCashFlow {
  readonly date: Date;
  readonly amount: number;
  readonly description?: string;
  readonly evidenceReference?: string;
}

/**
 * Whether a contractual payment falling exactly on the modification date is
 * still outstanding and therefore belongs in the 10% test.
 */
export type SameDayPaymentTreatment = "include" | "exclude";

/**
 * Treatment of interest earned up to the modification date. This choice is
 * explicit because files differ as to whether accrued interest is already in
 * the supplied carrying amount.
 */
export type AccruedInterestTestTreatment =
  | "included_in_carrying_amount"
  | "include_in_cash_flows"
  /** @deprecated Use included_in_carrying_amount. */
  | "add_to_carrying_amount"
  | "exclude";

export interface Aspe3856ModificationFacts {
  /** The original creditor has been replaced by a different legal creditor. */
  readonly creditorChanged?: boolean;
  /** The debtor has been legally released from the original obligation. */
  readonly legalDischarge?: boolean;
  readonly relatedParty?: boolean;
  readonly relatedPartyRelationship?: string;
  readonly legalEvidenceReference?: string;
  readonly creditorEvidenceReference?: string;
  readonly relatedPartyEvidenceReference?: string;
}

export interface Aspe3856TenPercentTestInput {
  readonly modificationDate: Date;
  /** Carrying amount immediately before the change, before any optional add-on below. */
  readonly carryingAmount: number;
  /** Original effective annual interest rate, expressed as a percentage (e.g. 6.5). */
  readonly originalEffectiveRate: number;
  /** Remaining original contractual payments, before the changed provisions. */
  readonly originalRemainingCashFlows: readonly Aspe3856DatedCashFlow[];
  readonly modifiedCashFlows: readonly Aspe3856DatedCashFlow[];
  readonly sameDayPaymentTreatment: SameDayPaymentTreatment;
  /** Fees paid to the creditor are part of the modified contractual cash flows. */
  readonly creditorFees?: number;
  /**
   * Third-party/legal transaction costs are deliberately excluded from the
   * numerical 10% test and returned separately for subsequent accounting.
   */
  readonly otherTransactionCosts?: number;
  readonly accruedInterest?: number;
  readonly accruedInterestTreatment?: AccruedInterestTestTreatment;
}

export interface Aspe3856TenPercentTestResult {
  /** Evidence for transition entries; it is not the 10% test denominator. */
  readonly carryingAmountTested: number;
  readonly presentValueOfOriginalRemainingCashFlows: number;
  readonly presentValueOfModifiedCashFlows: number;
  readonly difference: number;
  /** Unrounded absolute PV difference divided by original remaining PV. */
  readonly differenceRatio: number;
  /** Unrounded ratio expressed as a percentage. */
  readonly differencePercent: number;
  /** ASPE 3856's boundary is inclusive: exactly 10% is substantial. */
  readonly meetsTenPercentThreshold: boolean;
  readonly originalEffectiveRate: number;
  readonly sameDayPaymentTreatment: SameDayPaymentTreatment;
  readonly includedOriginalCashFlows: readonly Aspe3856DatedCashFlow[];
  readonly excludedSameDayOriginalCashFlows: readonly Aspe3856DatedCashFlow[];
  readonly includedCashFlows: readonly Aspe3856DatedCashFlow[];
  readonly excludedSameDayCashFlows: readonly Aspe3856DatedCashFlow[];
  readonly creditorFeesIncluded: number;
  readonly otherTransactionCostsExcluded: number;
  readonly accruedInterest: number;
  readonly accruedInterestTreatment: AccruedInterestTestTreatment;
}

export type Aspe3856ModificationRecommendation =
  | "derecognize_original"
  | "account_as_modification";

export interface Aspe3856ModificationAssessment {
  readonly tenPercentTest: Aspe3856TenPercentTestResult;
  readonly recommendation: Aspe3856ModificationRecommendation;
  readonly recommendationReasons: readonly string[];
  readonly facts: Aspe3856ModificationFacts;
  /** Related-party status is evidence for disclosure/judgment, not a numeric override. */
  readonly relatedPartyJudgmentRequired: boolean;
}

export type Aspe3856ModificationRecommendationResult = Omit<
  Aspe3856ModificationAssessment,
  "tenPercentTest"
>;

function requireFiniteNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a finite non-negative number`);
  }
}

/**
 * Performs the dated ASPE 3856 10% test without currency rounding. Original
 * remaining and modified cash flows are discounted at the original effective
 * rate using Actual/365 time from the modification date. The denominator is
 * the PV of the original remaining cash flows, not carrying amount.
 */
export function calculateAspe3856TenPercentTest(
  input: Aspe3856TenPercentTestInput,
): Aspe3856TenPercentTestResult {
  const modificationTime = input.modificationDate.getTime();
  if (!Number.isFinite(modificationTime)) throw new Error("modificationDate must be valid");
  if (!Number.isFinite(input.originalEffectiveRate) || input.originalEffectiveRate <= -100) {
    throw new Error("originalEffectiveRate must be finite and greater than -100%");
  }
  if (!Number.isFinite(input.carryingAmount) || input.carryingAmount <= 0) {
    throw new Error("carryingAmount must be a finite number greater than zero");
  }

  const creditorFees = input.creditorFees ?? 0;
  const otherCosts = input.otherTransactionCosts ?? 0;
  const accruedInterest = input.accruedInterest ?? 0;
  requireFiniteNonNegative(creditorFees, "creditorFees");
  requireFiniteNonNegative(otherCosts, "otherTransactionCosts");
  requireFiniteNonNegative(accruedInterest, "accruedInterest");
  const accruedTreatment =
    input.accruedInterestTreatment ?? "included_in_carrying_amount";

  const carryingAmountTested =
    input.carryingAmount +
    (accruedTreatment === "add_to_carrying_amount" ? accruedInterest : 0);
  const annualRate = input.originalEffectiveRate / 100;

  const selectCashFlows = (
    cashFlows: readonly Aspe3856DatedCashFlow[],
  ): { included: Aspe3856DatedCashFlow[]; excludedSameDay: Aspe3856DatedCashFlow[] } => {
    const selected: Aspe3856DatedCashFlow[] = [];
    const excluded: Aspe3856DatedCashFlow[] = [];
    for (const cashFlow of cashFlows) {
      const time = cashFlow.date.getTime();
      if (!Number.isFinite(time)) throw new Error("cash flow dates must be valid");
      requireFiniteNonNegative(cashFlow.amount, "cash flow amount");
      if (time < modificationTime) {
        throw new Error("remaining cash flows cannot precede the modification date");
      }
      if (time === modificationTime && input.sameDayPaymentTreatment === "exclude") {
        excluded.push(cashFlow);
      } else {
        selected.push(cashFlow);
      }
    }
    return { included: selected, excludedSameDay: excluded };
  };
  const original = selectCashFlows(input.originalRemainingCashFlows);
  // Retained names in the result preserve existing consumers of this new API.
  const modified = selectCashFlows(input.modifiedCashFlows);
  const pv = (cashFlows: readonly Aspe3856DatedCashFlow[]): number =>
    cashFlows.reduce((total, cashFlow) => {
      const years = (cashFlow.date.getTime() - modificationTime) / (365 * DAY_MS);
      return total + cashFlow.amount / Math.pow(1 + annualRate, years);
    }, 0);
  // Accrued interest is either already represented by carrying amount, excluded,
  // or explicitly added to both remaining streams at the modification date.
  const accruedCashFlow =
    accruedTreatment === "include_in_cash_flows" ? accruedInterest : 0;
  const presentValueOfOriginalRemainingCashFlows = pv(original.included) + accruedCashFlow;
  if (presentValueOfOriginalRemainingCashFlows <= 0) {
    throw new Error("original remaining cash flows must have a positive present value");
  }
  const presentValueOfModifiedCashFlows = pv(modified.included) + creditorFees + accruedCashFlow;
  const difference = presentValueOfModifiedCashFlows - presentValueOfOriginalRemainingCashFlows;
  const differenceRatio = Math.abs(difference) / presentValueOfOriginalRemainingCashFlows;

  return {
    carryingAmountTested,
    presentValueOfOriginalRemainingCashFlows,
    presentValueOfModifiedCashFlows,
    difference,
    differenceRatio,
    differencePercent: differenceRatio * 100,
    meetsTenPercentThreshold: differenceRatio >= 0.1,
    originalEffectiveRate: input.originalEffectiveRate,
    sameDayPaymentTreatment: input.sameDayPaymentTreatment,
    includedOriginalCashFlows: original.included,
    excludedSameDayOriginalCashFlows: original.excludedSameDay,
    includedCashFlows: modified.included,
    excludedSameDayCashFlows: modified.excludedSameDay,
    creditorFeesIncluded: creditorFees,
    otherTransactionCostsExcluded: otherCosts,
    accruedInterest,
    accruedInterestTreatment: accruedTreatment,
  };
}

/**
 * Combines the mechanical test with legal facts. A legal discharge or change
 * of creditor independently supports derecognition; related-party status is
 * preserved as a judgment flag but does not change the arithmetic.
 */
export function assessAspe3856Modification(
  input: Aspe3856TenPercentTestInput,
  facts: Aspe3856ModificationFacts = {},
): Aspe3856ModificationAssessment {
  const tenPercentTest = calculateAspe3856TenPercentTest(input);
  return {
    tenPercentTest,
    ...recommendAspe3856Modification(tenPercentTest, facts),
  };
}

/** Applies the legal and related-party facts to an already calculated test. */
export function recommendAspe3856Modification(
  tenPercentTest: Aspe3856TenPercentTestResult,
  facts: Aspe3856ModificationFacts = {},
): Aspe3856ModificationRecommendationResult {
  const reasons: string[] = [];
  if (facts.legalDischarge) reasons.push("The original obligation was legally discharged.");
  if (facts.creditorChanged) reasons.push("The legal creditor changed.");
  if (tenPercentTest.meetsTenPercentThreshold) {
    reasons.push("The full-precision cash-flow difference is at least 10%.");
  }
  const recommendation =
    facts.legalDischarge || facts.creditorChanged || tenPercentTest.meetsTenPercentThreshold
      ? "derecognize_original"
      : "account_as_modification";
  if (recommendation === "account_as_modification") {
    reasons.push("No legal extinguishment indicator exists and the cash-flow difference is below 10%.");
  }
  if (facts.relatedParty) {
    reasons.push("Related-party terms require documented professional judgment and disclosure.");
  }
  return {
    recommendation,
    recommendationReasons: reasons,
    facts,
    relatedPartyJudgmentRequired: facts.relatedParty === true,
  };
}

export interface LeaseTransitionEntryEvidence {
  readonly entryDate: Date;
  readonly debitAccount: string;
  readonly creditAccount: string;
  readonly amount: number;
  readonly evidenceReference: string;
}

export interface LeaseChangeFacts {
  readonly originalLeaseLegallyTerminated?: boolean;
  readonly replacementLeaseExecuted?: boolean;
  readonly addsRightOfUse?: boolean;
  readonly addedConsiderationAtStandalonePrice?: boolean;
  readonly relatedParty?: boolean;
  readonly legalEvidenceReference?: string;
  readonly transitionEntryEvidence?: LeaseTransitionEntryEvidence;
}

export type LeaseChangeRecommendation =
  | "new_lease";

export interface LeaseChangeAssessment {
  readonly recommendation: LeaseChangeRecommendation;
  readonly recommendationReasons: readonly string[];
  readonly transitionEntryEvidenceRequired: boolean;
  readonly transitionEntryEvidenceComplete: boolean;
  readonly facts: LeaseChangeFacts;
}

/**
 * Under this application's ASPE 3065 workflow, changed lease provisions are
 * documented and processed as a new lease, rather than applying IFRS-style
 * separate-lease or remeasurement classifications.
 */
export function assessLeaseChange(facts: LeaseChangeFacts): LeaseChangeAssessment {
  const reasons: string[] = [];
  const recommendation: LeaseChangeRecommendation = "new_lease";
  reasons.push("Changed lease provisions are accounted for as a new lease in this ASPE 3065 workflow.");
  if (facts.originalLeaseLegallyTerminated || facts.replacementLeaseExecuted) {
    reasons.push("Legal evidence also indicates replacement of the original lease.");
  }
  if (facts.relatedParty) reasons.push("Related-party terms require documented judgment.");

  const evidence = facts.transitionEntryEvidence;
  const evidenceComplete =
    evidence !== undefined &&
    Number.isFinite(evidence.entryDate.getTime()) &&
    evidence.debitAccount.trim().length > 0 &&
    evidence.creditAccount.trim().length > 0 &&
    Number.isFinite(evidence.amount) &&
    evidence.amount > 0 &&
    evidence.evidenceReference.trim().length > 0;
  return {
    recommendation,
    recommendationReasons: reasons,
    transitionEntryEvidenceRequired: true,
    transitionEntryEvidenceComplete: evidenceComplete,
    facts,
  };
}

/** Verbose alias for callers that expose this operation as a recommendation. */
export const recommendLeaseChangeTreatment = assessLeaseChange;

export interface ProspectiveModificationScheduleInput {
  readonly effectiveDate: Date;
  /** Carrying amount of the continuing instrument immediately before the change. */
  readonly openingCarryingAmount: number;
  /**
   * Unamortized fees/costs retained from the original instrument. They reduce
   * the prospective effective-interest basis.
   */
  readonly retainedFeesAndCosts: number;
  /** Fees and costs incurred for the confirmed non-substantial modification. */
  readonly newFeesAndCosts: number;
  readonly modifiedCashFlows: readonly Aspe3856DatedCashFlow[];
  readonly sameDayPaymentTreatment: SameDayPaymentTreatment;
}

export interface ProspectiveModificationScheduleResult {
  /** Annual effective rate as a percentage (for example, 7.25), unrounded. */
  readonly resultingEffectiveAnnualRate: number;
  readonly effectiveInterestBasis: number;
  readonly includedCashFlows: readonly Aspe3856DatedCashFlow[];
  readonly excludedSameDayCashFlows: readonly Aspe3856DatedCashFlow[];
  readonly schedule: AmortizationRow[];
}

/**
 * Solves the prospective effective-interest rate for a confirmed
 * non-substantial modification and rolls that basis forward using dated
 * Actual/365 intervals. No currency rounding is applied.
 */
export function calculateProspectiveModificationSchedule(
  input: ProspectiveModificationScheduleInput,
): ProspectiveModificationScheduleResult {
  const effectiveTime = input.effectiveDate.getTime();
  if (!Number.isFinite(effectiveTime)) throw new Error("effectiveDate must be valid");
  if (!Number.isFinite(input.openingCarryingAmount) || input.openingCarryingAmount <= 0) {
    throw new Error("openingCarryingAmount must be a finite number greater than zero");
  }
  requireFiniteNonNegative(input.retainedFeesAndCosts, "retainedFeesAndCosts");
  requireFiniteNonNegative(input.newFeesAndCosts, "newFeesAndCosts");
  const effectiveInterestBasis =
    input.openingCarryingAmount - input.retainedFeesAndCosts - input.newFeesAndCosts;
  if (!Number.isFinite(effectiveInterestBasis) || effectiveInterestBasis <= 0) {
    throw new Error("openingCarryingAmount less retained/new fees and costs must be positive");
  }

  const includedCashFlows: Aspe3856DatedCashFlow[] = [];
  const excludedSameDayCashFlows: Aspe3856DatedCashFlow[] = [];
  for (const cashFlow of input.modifiedCashFlows) {
    const time = cashFlow.date.getTime();
    if (!Number.isFinite(time)) throw new Error("cash flow dates must be valid");
    requireFiniteNonNegative(cashFlow.amount, "cash flow amount");
    if (time < effectiveTime) {
      throw new Error("modified cash flows cannot precede the effective date");
    }
    if (time === effectiveTime && input.sameDayPaymentTreatment === "exclude") {
      excludedSameDayCashFlows.push(cashFlow);
    } else {
      includedCashFlows.push(cashFlow);
    }
  }
  includedCashFlows.sort((a, b) => a.date.getTime() - b.date.getTime());
  if (includedCashFlows.length === 0) {
    throw new Error("at least one included modified cash flow is required");
  }

  const presentValue = (annualRate: number): number =>
    includedCashFlows.reduce((total, cashFlow) => {
      const years = (cashFlow.date.getTime() - effectiveTime) / (365 * DAY_MS);
      return total + cashFlow.amount / Math.pow(1 + annualRate, years);
    }, 0);
  // A same-day-only stream has no rate-sensitive cash flow, so an effective
  // rate cannot be solved rather than silently selecting an arbitrary rate.
  if (!includedCashFlows.some((cashFlow) => cashFlow.date.getTime() > effectiveTime)) {
    throw new Error("included modified cash flows must include a date after the effective date");
  }

  let low = -0.999999999;
  let high = 1;
  const lowerPv = presentValue(low);
  if (!Number.isFinite(lowerPv) || lowerPv < effectiveInterestBasis) {
    throw new Error("modified cash flows cannot support the effective-interest basis");
  }
  while (presentValue(high) > effectiveInterestBasis && high < 1e12) high *= 2;
  if (presentValue(high) > effectiveInterestBasis) {
    throw new Error("could not solve a finite effective annual rate");
  }
  for (let iteration = 0; iteration < 200; iteration++) {
    const midpoint = (low + high) / 2;
    if (presentValue(midpoint) > effectiveInterestBasis) low = midpoint;
    else high = midpoint;
  }
  const annualRate = (low + high) / 2;

  let balance = effectiveInterestBasis;
  let totalInterest = 0;
  let previousTime = effectiveTime;
  const schedule: AmortizationRow[] = includedCashFlows.map((cashFlow, index) => {
    const time = cashFlow.date.getTime();
    const openingBalance = balance;
    const years = (time - previousTime) / (365 * DAY_MS);
    const interest = balance * (Math.pow(1 + annualRate, years) - 1);
    const payment = cashFlow.amount;
    const principal = payment - interest;
    balance -= principal;
    totalInterest += interest;
    previousTime = time;
    return {
      month: index + 1,
      date: new Date(cashFlow.date),
      payment,
      principal,
      interest,
      totalInterest,
      balance,
      isInterestOnly: false,
      rowType: "scheduled_payment",
      openingBalance,
      accruedInterest: 0,
      contractualAnnualRate: annualRate * 100,
    };
  });

  return {
    resultingEffectiveAnnualRate: annualRate * 100,
    effectiveInterestBasis,
    includedCashFlows,
    excludedSameDayCashFlows,
    schedule,
  };
}
