import { addMonths, format, startOfMonth, getMonth, getYear, addDays } from "date-fns";

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
  frequency: Frequency = "monthly"
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