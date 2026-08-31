import { describe, it, expect } from "vitest";
import { calculateAmortization, calculateFairValueSchedule } from "./index";

// User scenario: 60-month amortization, payments start after a 12-month
// grace period, so the term is 72 months (6 years).
const P = 100000;

describe("payment grace period", () => {
  it("capitalized: no payments for 12 months, interest grows the balance", () => {
    const r = calculateAmortization(P, 6, 5, 6, new Date(2025, 0, 1), 0, [], 0, "monthly", null, 12, "capitalized");
    expect(r.schedule).toHaveLength(72);

    const grace = r.schedule.slice(0, 12);
    for (const row of grace) {
      expect(row.isGrace).toBe(true);
      expect(row.payment).toBe(0);
      expect(row.interest).toBeGreaterThan(0);
    }
    // Balance grows to P*(1+0.005)^12
    const expectedAfterGrace = P * Math.pow(1.005, 12);
    expect(grace[11].balance).toBeCloseTo(expectedAfterGrace, 2);

    // Repayment: 60 level payments computed on the grown balance
    const first = r.schedule[12];
    expect(first.isGrace).toBe(false);
    const pow = Math.pow(1.005, 60);
    const expectedPmt = expectedAfterGrace * pow * (0.005 / (pow - 1));
    expect(first.payment).toBeCloseTo(expectedPmt, 2);

    // Fully repaid at the end of the term
    expect(r.schedule[71].balance).toBeCloseTo(0, 1);
  });

  it("none (interest-free): balance unchanged during grace, standard payment after", () => {
    const r = calculateAmortization(P, 6, 5, 6, new Date(2025, 0, 1), 0, [], 0, "monthly", null, 12, "none");
    const grace = r.schedule.slice(0, 12);
    for (const row of grace) {
      expect(row.payment).toBe(0);
      expect(row.interest).toBe(0);
    }
    expect(grace[11].balance).toBeCloseTo(P, 2);

    const pow = Math.pow(1.005, 60);
    const expectedPmt = P * pow * (0.005 / (pow - 1));
    expect(r.schedule[12].payment).toBeCloseTo(expectedPmt, 2);
    expect(r.schedule[71].balance).toBeCloseTo(0, 1);
  });

  it("0% loan with an interest-free grace period amortizes straight-line after the grace", () => {
    const r = calculateAmortization(P, 0, 5, 6, new Date(2025, 0, 1), 0, [], 0, "monthly", null, 12, "none");
    expect(r.schedule[11].balance).toBeCloseTo(P, 2);
    expect(r.schedule[12].payment).toBeCloseTo(P / 60, 2);
    expect(r.schedule[71].balance).toBeCloseTo(0, 1);
  });

  it("grace period combines with a following interest-only period", () => {
    const r = calculateAmortization(P, 6, 5, 6.5, new Date(2025, 0, 1), 6, [], 0, "monthly", null, 12, "capitalized");
    // 12 grace, then 6 IO, then repayment
    expect(r.schedule[11].isGrace).toBe(true);
    expect(r.schedule[12].isGrace).toBe(false);
    expect(r.schedule[12].isInterestOnly).toBe(true);
    expect(r.schedule[17].isInterestOnly).toBe(true);
    expect(r.schedule[18].isInterestOnly).toBe(false);
    expect(r.schedule[18].payment).toBeGreaterThan(0);
  });

  it("grace rows never report principal movement (accretion is not repayment)", () => {
    const r = calculateAmortization(P, 6, 5, 6, new Date(2025, 0, 1), 0, [], 0, "monthly", null, 12, "capitalized");
    for (const row of r.schedule.slice(0, 12)) expect(row.principal).toBe(0);
    // Cash principal repaid equals the grown balance at the end of grace
    const repaid = r.schedule.reduce((s, row) => s + row.principal, 0);
    expect(repaid).toBeCloseTo(P * Math.pow(1.005, 12), 1);
  });

  it("bi-weekly: a 3-month grace defers payments until 3 calendar months after start", () => {
    const r = calculateAmortization(P, 6, 2, 2.25, new Date(2025, 0, 1), 0, [], 0, "bi-weekly", null, 3, "capitalized");
    const graceRows = r.schedule.filter((row) => row.isGrace);
    // 3 calendar months ≈ 6-7 bi-weekly periods (Jan 1 → Apr 1 boundary)
    for (const row of graceRows) {
      expect(row.payment).toBe(0);
      expect(row.date < new Date(2025, 3, 1)).toBe(true);
    }
    const firstPay = r.schedule.find((row) => !row.isGrace)!;
    expect(firstPay.date >= new Date(2025, 3, 1)).toBe(true);
    expect(firstPay.payment).toBeGreaterThan(0);
  });

  it("weekly: a 1-month grace suppresses only payments before the boundary", () => {
    const r = calculateAmortization(P, 6, 1, 1.1, new Date(2025, 0, 1), 0, [], 0, "weekly", null, 1, "capitalized");
    const graceRows = r.schedule.filter((row) => row.isGrace);
    expect(graceRows.length).toBeGreaterThanOrEqual(4);
    expect(graceRows.length).toBeLessThanOrEqual(5);
    const firstPay = r.schedule.find((row) => !row.isGrace)!;
    expect(firstPay.date >= new Date(2025, 1, 1)).toBe(true);
  });

  it("no grace args behaves exactly as before", () => {
    const a = calculateAmortization(P, 6, 5, 5, new Date(2025, 0, 1));
    const b = calculateAmortization(P, 6, 5, 5, new Date(2025, 0, 1), 0, [], 0, "monthly", null, 0, "capitalized");
    expect(a.monthlyPayment).toBeCloseTo(b.monthlyPayment, 10);
    expect(a.totalInterest).toBeCloseTo(b.totalInterest, 6);
  });

  it("fair value schedule handles zero-payment grace rows (balance accretes)", () => {
    const contractual = calculateAmortization(P, 0, 5, 6, new Date(2025, 0, 1), 0, [], 0, "monthly", null, 12, "none");
    const fv = calculateFairValueSchedule(contractual.schedule, 7.2, "monthly");
    expect(fv.fairValue).toBeLessThan(P);
    // During grace no cash: carrying amount accretes at the FV rate
    expect(fv.schedule[0].payment).toBe(0);
    expect(fv.schedule[0].balance).toBeGreaterThan(fv.fairValue);
    // Accretes back to ~0 at maturity
    expect(fv.schedule[71].balance).toBeCloseTo(0, 0);
    // monthlyPayment reflects the regular repayment installment, not a grace row
    expect(fv.monthlyPayment).toBeCloseTo(P / 60, 2);
  });

  it("included mode keeps a 60-month total term and leaves 47 payments after 13 months", () => {
    const r = calculateAmortization(
      P, 6, 5, 5, new Date(2025, 0, 1), 0, [], 0, "monthly", null, 13,
      "capitalized", { graceTermMode: "included" },
    );
    expect(r.schedule).toHaveLength(60);
    expect(r.schedule.filter((row) => row.isGrace)).toHaveLength(13);
    expect(r.schedule.filter((row) => !row.isGrace)).toHaveLength(47);
    expect(r.schedule[59].balance).toBeGreaterThan(0);
  });

  it("added mode makes 60 repayment months plus 13 grace months equal 73", () => {
    const r = calculateAmortization(
      P, 6, 5, 5, new Date(2025, 0, 1), 0, [], 0, "monthly", null, 13,
      "capitalized", { graceTermMode: "added" },
    );
    expect(r.schedule).toHaveLength(73);
    expect(r.schedule.filter((row) => row.isGrace)).toHaveLength(13);
    expect(r.schedule.filter((row) => !row.isGrace)).toHaveLength(60);
    expect(r.schedule[72].balance).toBeCloseTo(0, 1);
  });

  it("added grace is not capped by a shorter base contractual term", () => {
    const r = calculateAmortization(
      P, 0, 1, 0.25, new Date(2025, 0, 1), 0, [], 0, "monthly", null, 6,
      "none", { graceTermMode: "added" },
    );
    // Three base-term months plus six deferred monthly payment dates.
    expect(r.schedule).toHaveLength(9);
    expect(r.schedule.filter((row) => row.isGrace)).toHaveLength(6);
    expect(r.schedule.filter((row) => !row.isGrace)).toHaveLength(3);
    expect(r.schedule[6].date).toEqual(new Date(2025, 6, 1));
    expect(r.schedule[6].payment).toBeGreaterThan(0);
  });

  it("uses first-payment dates consistently on either side of the grace boundary", () => {
    const beforeBoundary = calculateAmortization(
      P, 0, 1, 1, new Date(2025, 0, 1), 0, [], 0, "monthly", null, 2, "none",
      { graceTermMode: "added", firstPaymentDate: new Date(2025, 0, 15) },
    );
    // Jan 15 and Feb 15 are deferred; Mar 15 is the first due payment.
    expect(beforeBoundary.schedule).toHaveLength(14);
    expect(beforeBoundary.schedule.filter((row) => row.isGrace)).toHaveLength(2);
    expect(beforeBoundary.schedule[2].date).toEqual(new Date(2025, 2, 15));
    expect(beforeBoundary.schedule[2].payment).toBeGreaterThan(0);

    const onBoundary = calculateAmortization(
      P, 0, 1, 1, new Date(2025, 0, 1), 0, [], 0, "monthly", null, 2, "none",
      { graceTermMode: "added", firstPaymentDate: new Date(2025, 2, 1) },
    );
    // The boundary payment is due, but the two economic grace periods are
    // retained as no-payment rows before the explicit first due date.
    expect(onBoundary.schedule).toHaveLength(14);
    expect(onBoundary.schedule.slice(0, 2).every((row) => row.isGrace)).toBe(true);
    expect(onBoundary.schedule[2].date).toEqual(new Date(2025, 2, 1));
    expect(onBoundary.schedule[2].payment).toBeGreaterThan(0);
  });

  it("capitalizes economic grace before an explicit boundary payment", () => {
    for (const paymentTiming of ["end", "beginning"] as const) {
      const r = calculateAmortization(
        P, 6, 1, 1, new Date(2025, 0, 1), 0, [], 0, "monthly", null, 2,
        "capitalized", {
          graceTermMode: "added",
          firstPaymentDate: new Date(2025, 2, 1),
          paymentTiming,
        },
      );
      const grown = P * Math.pow(1.005, 2);
      expect(r.schedule.slice(0, 2).map((row) => row.payment)).toEqual([0, 0]);
      expect(r.schedule[1].balance).toBeCloseTo(grown, 6);
      expect(r.schedule[2].date).toEqual(new Date(2025, 2, 1));
      expect(r.schedule[2].interest).toBeCloseTo(
        paymentTiming === "beginning"
          ? (grown - r.schedule[2].payment) * 0.005
          : grown * 0.005,
        6,
      );
      expect(r.totalInterest).toBeGreaterThan(r.schedule.slice(2).reduce((n, row) => n + row.interest, 0));
    }
  });

  it("waives economic grace before an explicit payment at or after the boundary", () => {
    for (const firstPaymentDate of [new Date(2025, 2, 1), new Date(2025, 3, 1)]) {
      const r = calculateAmortization(
        P, 6, 1, 1, new Date(2025, 0, 1), 0, [], 0, "monthly", null, 2,
        "none", { graceTermMode: "added", firstPaymentDate },
      );
      expect(r.schedule.slice(0, 2).every((row) => row.isGrace)).toBe(true);
      expect(r.schedule.slice(0, 2).every((row) => row.interest === 0)).toBe(true);
      expect(r.schedule[1].balance).toBeCloseTo(P, 8);
      expect(r.schedule[2].date).toEqual(firstPaymentDate);
      expect(r.schedule[2].payment).toBeCloseTo(
        P * Math.pow(1.005, 12) * (0.005 / (Math.pow(1.005, 12) - 1)),
        6,
      );
    }
  });

  it("keeps legacy grace accrual unchanged without an explicit first payment date", () => {
    const legacy = calculateAmortization(
      P, 6, 1, 1, new Date(2025, 0, 1), 0, [], 0, "monthly", null, 2,
      "capitalized",
    );
    const explicitLegacy = calculateAmortization(
      P, 6, 1, 1, new Date(2025, 0, 1), 0, [], 0, "monthly", null, 2,
      "capitalized", { paymentTiming: "end", graceTermMode: "included" },
    );
    expect(explicitLegacy.schedule).toEqual(legacy.schedule);
    expect(legacy.schedule[1].balance).toBeCloseTo(P * Math.pow(1.005, 2), 6);
  });

  it("treats a payment exactly on the grace boundary as due", () => {
    const r = calculateAmortization(
      P, 0, 1, 1, new Date(2025, 0, 15), 0, [], 0, "semi-monthly", null, 1,
      "none", {
        firstPaymentDate: new Date(2025, 0, 15),
        semiMonthlyDueDays: [1, 15],
      },
    );
    const grace = r.schedule.filter((row) => row.isGrace);
    expect(grace.map((row) => [row.date.getMonth(), row.date.getDate()]))
      .toEqual([[0, 15], [1, 1]]);
    expect(r.schedule[2].date).toEqual(new Date(2025, 1, 15));
    expect(r.schedule[2].isGrace).toBe(false);
    expect(r.schedule[2].payment).toBeGreaterThan(0);
  });
});
