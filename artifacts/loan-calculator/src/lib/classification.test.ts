import { describe, it, expect } from "vitest";
import { isOperatingLeaseLoan } from "./aspe-utils";
import { getLoanKind, type LoanDiagnosticInput } from "./diagnostics";

const base = {
  isCapitalLease: false,
  interestRate: 0,
  monthlyPayment: 2000,
  termMonths: 60,
};

describe("isOperatingLeaseLoan", () => {
  it("classifies a genuine operating lease (0%, monthly payment, term in months)", () => {
    expect(isOperatingLeaseLoan(base)).toBe(true);
  });

  it("does NOT classify a 0% loan without termMonths as an operating lease", () => {
    expect(isOperatingLeaseLoan({ ...base, termMonths: null })).toBe(false);
    expect(isOperatingLeaseLoan({ ...base, termMonths: undefined })).toBe(false);
  });

  it("does NOT classify a 0% loan without a monthly payment as an operating lease", () => {
    expect(isOperatingLeaseLoan({ ...base, monthlyPayment: null })).toBe(false);
  });

  it("keeps capital leases as capital leases even at 0%", () => {
    expect(isOperatingLeaseLoan({ ...base, isCapitalLease: true })).toBe(false);
  });

  it("does NOT classify a loan with a positive rate as an operating lease", () => {
    expect(isOperatingLeaseLoan({ ...base, interestRate: 5 })).toBe(false);
  });

  it("handles string rates from the API (numeric columns serialize as strings)", () => {
    expect(isOperatingLeaseLoan({ ...base, interestRate: "0.00" })).toBe(true);
    expect(isOperatingLeaseLoan({ ...base, interestRate: "4.50" })).toBe(false);
  });
});

describe("getLoanKind (diagnostics)", () => {
  const diagBase: LoanDiagnosticInput = {
    id: "x",
    name: "Test",
    isCapitalLease: false,
    principal: 100000,
    interestRate: 0,
    amortizationYears: 5,
    termYears: 5,
    startDate: "2025-01-01",
    monthlyPayment: 2000,
    termMonths: 60,
  } as LoanDiagnosticInput;

  it("agrees with isOperatingLeaseLoan for operating leases", () => {
    expect(getLoanKind(diagBase)).toBe("operating_lease");
  });

  it("treats a 0% loan without termMonths as a loan", () => {
    expect(getLoanKind({ ...diagBase, termMonths: null })).toBe("loan");
  });

  it("treats capital leases as capital leases", () => {
    expect(getLoanKind({ ...diagBase, isCapitalLease: true })).toBe("capital_lease");
  });
});
