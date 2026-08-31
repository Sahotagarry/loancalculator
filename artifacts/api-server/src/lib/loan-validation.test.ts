import { describe, it, expect } from "vitest";
import { validateFvRate, validatePaymentCalendar } from "./loan-validation";

describe("validateFvRate (API save boundary)", () => {
  it("accepts positive finite rates", () => {
    expect(validateFvRate(9.2)).toBeNull();
    expect(validateFvRate(0.01)).toBeNull();
    expect(validateFvRate(25)).toBeNull();
  });

  it("accepts absent rates (no change / no rate)", () => {
    expect(validateFvRate(null)).toBeNull();
    expect(validateFvRate(undefined)).toBeNull();
  });

  it("rejects zero", () => {
    expect(validateFvRate(0)).toMatch(/greater than 0/);
  });

  it("rejects negative rates", () => {
    expect(validateFvRate(-3)).toMatch(/greater than 0/);
  });

  it("rejects non-finite values", () => {
    expect(validateFvRate(Infinity)).toMatch(/finite/);
    expect(validateFvRate(-Infinity)).toMatch(/finite/);
    expect(validateFvRate(NaN)).toMatch(/finite/);
  });

  it("rejects non-number payloads that slip past loose parsing", () => {
    expect(validateFvRate("7" as unknown as number)).toMatch(/finite number/);
  });
});

describe("validatePaymentCalendar", () => {
  const validSemiMonthly = {
    paymentFrequency: "semi-monthly",
    semiMonthlyFirstDueDay: 1,
    semiMonthlySecondDueDay: 15,
    startDate: "2025-01-01",
    firstPaymentDate: "2025-01-15",
    termYears: 1,
    termMonths: null,
    graceMonths: 0,
    graceTermMode: "included",
  };

  it("requires two distinct days for new semi-monthly schedules", () => {
    expect(validatePaymentCalendar(validSemiMonthly)).toBeNull();
    expect(
      validatePaymentCalendar({ ...validSemiMonthly, semiMonthlySecondDueDay: 1 }),
    ).toMatch(/distinct/);
    expect(
      validatePaymentCalendar({ ...validSemiMonthly, semiMonthlySecondDueDay: null }),
    ).toMatch(/requires two due days/);
  });

  it("allows legacy semi-monthly schedules without explicit days", () => {
    expect(
      validatePaymentCalendar({
        ...validSemiMonthly,
        semiMonthlyFirstDueDay: null,
        semiMonthlySecondDueDay: null,
        allowMissingSemiMonthlyDays: true,
      }),
    ).toBeNull();
  });

  it("rejects stale days and first payments outside contractual dates", () => {
    expect(
      validatePaymentCalendar({ ...validSemiMonthly, paymentFrequency: "monthly" }),
    ).toMatch(/only allowed/);
    expect(
      validatePaymentCalendar({ ...validSemiMonthly, firstPaymentDate: "2024-12-31" }),
    ).toMatch(/before startDate/);
    expect(
      validatePaymentCalendar({
        ...validSemiMonthly,
        firstPaymentDate: "2025-01-15",
        graceMonths: 2,
      }),
    ).toMatch(/before the end of the grace period/);
    expect(
      validatePaymentCalendar({
        ...validSemiMonthly,
        firstPaymentDate: "2026-02-01",
      }),
    ).toMatch(/after the contractual maturity/);
  });

  it("accepts explicit null due-day clears for a monthly PATCH", () => {
    expect(
      validatePaymentCalendar({
        ...validSemiMonthly,
        paymentFrequency: "monthly",
        semiMonthlyFirstDueDay: null,
        semiMonthlySecondDueDay: null,
      }),
    ).toBeNull();
  });

  it("extends first-payment validation for added grace", () => {
    expect(
      validatePaymentCalendar({
        ...validSemiMonthly,
        firstPaymentDate: "2025-03-01",
        graceMonths: 2,
        graceTermMode: "added",
      }),
    ).toBeNull();
  });

  it("uses the first payment as the actual due date after grace", () => {
    const sixtyMonthLoan = {
      paymentFrequency: "monthly",
      semiMonthlyFirstDueDay: null,
      semiMonthlySecondDueDay: null,
      startDate: "2025-01-01",
      firstPaymentDate: "2026-02-01",
      termYears: 5,
      termMonths: 60,
      graceMonths: 13,
      graceTermMode: "included",
      paymentTiming: "end" as const,
    };
    // Included grace leaves 47 repayment rows, ending before month 60.
    expect(validatePaymentCalendar(sixtyMonthLoan)).toBeNull();
    expect(
      validatePaymentCalendar({
        ...sixtyMonthLoan,
        firstPaymentDate: "2026-04-01",
      }),
    ).toMatch(/extend beyond/);

    // Added grace keeps all 60 repayment rows within the 73-month maturity.
    expect(
      validatePaymentCalendar({
        ...sixtyMonthLoan,
        graceTermMode: "added",
        paymentTiming: "beginning",
      }),
    ).toBeNull();
  });

  it("checks final weekly, bi-weekly, and EOM semi-monthly due dates", () => {
    const base = {
      semiMonthlyFirstDueDay: null,
      semiMonthlySecondDueDay: null,
      startDate: "2025-01-31",
      firstPaymentDate: "2025-01-31",
      termYears: 1,
      termMonths: 12,
      graceMonths: 0,
      graceTermMode: "included",
    };
    expect(validatePaymentCalendar({ ...base, paymentFrequency: "weekly" })).toBeNull();
    expect(validatePaymentCalendar({ ...base, paymentFrequency: "bi-weekly" })).toBeNull();
    expect(
      validatePaymentCalendar({
        ...base,
        paymentFrequency: "semi-monthly",
        semiMonthlyFirstDueDay: 15,
        semiMonthlySecondDueDay: 31,
      }),
    ).toBeNull();
  });
});
