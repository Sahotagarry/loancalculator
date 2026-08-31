/* ── Loan payload validation shared by create + update routes ────
   Kept free of db/express imports so it can be unit tested. */

/**
 * Validates an fvRate supplied by the client. The fair-value rate is a
 * market discount rate: it must be a finite number strictly greater than
 * zero (a 0% or negative market rate would silently corrupt the FV
 * schedule — the PV loop divides by (1 + rate) powers).
 *
 * Returns an error message when invalid, or null when acceptable.
 * `null`/`undefined` are acceptable here: on create it means "no rate",
 * on update it means "leave unchanged / clear".
 */
export function validateFvRate(fvRate: number | null | undefined): string | null {
  if (fvRate == null) return null;
  if (typeof fvRate !== "number" || !Number.isFinite(fvRate) || fvRate <= 0) {
    return "fvRate must be a finite number greater than 0";
  }
  return null;
}

export interface PaymentCalendarInput {
  paymentFrequency: string;
  semiMonthlyFirstDueDay: number | null;
  semiMonthlySecondDueDay: number | null;
  startDate: string;
  firstPaymentDate: string | null;
  termYears: number;
  termMonths: number | null;
  graceMonths: number;
  graceTermMode: string;
  paymentTiming?: "beginning" | "end";
  allowMissingSemiMonthlyDays?: boolean;
}

function addUtcMonths(date: Date, months: number): Date {
  const sourceDay = date.getUTCDate();
  const result = new Date(date);
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(sourceDay, lastDay));
  return result;
}

function nextSemiMonthlyDueDate(
  after: Date,
  firstDay: number,
  secondDay: number,
): Date {
  const days = [firstDay, secondDay].sort((a, b) => a - b);
  for (let monthOffset = 0; ; monthOffset++) {
    const month = addUtcMonths(
      new Date(Date.UTC(after.getUTCFullYear(), after.getUTCMonth(), 1)),
      monthOffset,
    );
    const lastDay = new Date(
      Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0),
    ).getUTCDate();
    for (const day of days) {
      const candidate = new Date(
        Date.UTC(
          month.getUTCFullYear(),
          month.getUTCMonth(),
          Math.min(day, lastDay),
        ),
      );
      if (candidate > after) return candidate;
    }
  }
}

/** Validates calendar terms after create/PATCH values have been merged. */
export function validatePaymentCalendar(input: PaymentCalendarInput): string | null {
  const firstDay = input.semiMonthlyFirstDueDay;
  const secondDay = input.semiMonthlySecondDueDay;
  if (input.paymentFrequency === "semi-monthly") {
    if (
      (firstDay == null || secondDay == null) &&
      !(input.allowMissingSemiMonthlyDays && firstDay == null && secondDay == null)
    ) {
      return "semi-monthly paymentFrequency requires two due days";
    }
    if (firstDay != null && secondDay != null && (
      !Number.isInteger(firstDay) ||
      !Number.isInteger(secondDay) ||
      firstDay < 1 ||
      firstDay > 31 ||
      secondDay < 1 ||
      secondDay > 31 ||
      firstDay === secondDay
    )) {
      return "semi-monthly due days must be two distinct whole days from 1 through 31";
    }
  } else if (firstDay != null || secondDay != null) {
    return "semi-monthly due days are only allowed with semi-monthly paymentFrequency";
  }

  if (input.firstPaymentDate == null) return null;
  const start = new Date(`${input.startDate}T00:00:00Z`);
  const firstPayment = new Date(`${input.firstPaymentDate}T00:00:00Z`);
  if (firstPayment < start) return "firstPaymentDate must not be before startDate";
  const graceEnd = addUtcMonths(start, Math.max(0, input.graceMonths));
  if (firstPayment < graceEnd) {
    return "firstPaymentDate must not be before the end of the grace period";
  }

  const baseTermMonths = input.termMonths ?? Math.round(input.termYears * 12);
  const maturity = addUtcMonths(
    start,
    baseTermMonths + (input.graceTermMode === "added" ? input.graceMonths : 0),
  );
  if (firstPayment > maturity) {
    return "firstPaymentDate must not be after the contractual maturity date";
  }

  const repaymentMonths =
    input.graceTermMode === "included"
      ? Math.max(0, baseTermMonths - input.graceMonths)
      : baseTermMonths;
  const periodsPerYear =
    input.paymentFrequency === "weekly"
      ? 52
      : input.paymentFrequency === "bi-weekly"
        ? 26
        : input.paymentFrequency === "semi-monthly"
          ? 24
          : 12;
  const paymentRows = Math.round((repaymentMonths * periodsPerYear) / 12);
  if (paymentRows === 0) return null;

  let finalDue = new Date(firstPayment);
  if (input.paymentFrequency === "monthly") {
    finalDue = addUtcMonths(firstPayment, paymentRows - 1);
  } else if (input.paymentFrequency === "weekly") {
    finalDue.setUTCDate(finalDue.getUTCDate() + (paymentRows - 1) * 7);
  } else if (input.paymentFrequency === "bi-weekly") {
    finalDue.setUTCDate(finalDue.getUTCDate() + (paymentRows - 1) * 14);
  } else if (firstDay != null && secondDay != null) {
    for (let row = 1; row < paymentRows; row++) {
      finalDue = nextSemiMonthlyDueDate(finalDue, firstDay, secondDay);
    }
  }
  if (finalDue > maturity) {
    return "payment dates extend beyond the contractual maturity date";
  }
  return null;
}
