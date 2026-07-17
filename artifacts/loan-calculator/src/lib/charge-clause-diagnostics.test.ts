import { describe, it, expect } from "vitest";
import { runLoanDiagnostics, type LoanDiagnosticInput } from "./diagnostics";

const file = { fiscalYearEnd: "2025-12-31" };

const baseLoan: LoanDiagnosticInput = {
  id: "l1",
  name: "Term loan",
  counterparty: "Bank",
  description: "Equipment loan",
  isCapitalLease: false,
  principal: 100000,
  interestRate: 6,
  amortizationYears: 5,
  termYears: 5,
  startDate: "2024-01-15",
  paymentFrequency: "monthly",
  fvDecision: "trivial",
  fvDecisionNote: "Rate approximates market.",
};

const EQUIP_CLAUSE = "Specific charge on equipment";
const REALPROP_CLAUSE = "Specific charge / mortgage on real property (land & building)";

function findingIds(loan: LoanDiagnosticInput): string[] {
  return runLoanDiagnostics(loan, file).findings.map((f) => f.id);
}

describe("specific charge without matching collateral asset", () => {
  it("flags equipment charge with no collateral asset", () => {
    const ids = findingIds({ ...baseLoan, securityClauses: [EQUIP_CLAUSE] });
    expect(ids).toContain("charge-equip-no-nbv");
  });

  it("flags real property charge with mismatched collateral (equipment)", () => {
    const ids = findingIds({
      ...baseLoan,
      securityClauses: [REALPROP_CLAUSE],
      collateralType: "equipment",
    });
    expect(ids).toContain("charge-realprop-no-nbv");
    expect(ids).not.toContain("charge-equip-no-nbv");
  });

  it("does not flag when equipment collateral matches the equipment charge", () => {
    const ids = findingIds({
      ...baseLoan,
      securityClauses: [EQUIP_CLAUSE],
      collateralType: "equipment",
    });
    expect(ids).not.toContain("charge-equip-no-nbv");
  });

  it("accepts any real property collateral type for the real property charge", () => {
    for (const collateralType of ["building", "land", "land_and_building"]) {
      const ids = findingIds({
        ...baseLoan,
        securityClauses: [REALPROP_CLAUSE],
        collateralType,
      });
      expect(ids).not.toContain("charge-realprop-no-nbv");
    }
  });

  it("does not flag loans without specific charge clauses", () => {
    const ids = findingIds({
      ...baseLoan,
      securityClauses: ["General security agreement (GSA)"],
    });
    expect(ids).not.toContain("charge-equip-no-nbv");
    expect(ids).not.toContain("charge-realprop-no-nbv");
  });

  it("respects dismissal of the new findings", () => {
    const result = runLoanDiagnostics(
      {
        ...baseLoan,
        securityClauses: [EQUIP_CLAUSE],
        dismissedFindings: ["charge-equip-no-nbv"],
      },
      file,
    );
    expect(result.findings.map((f) => f.id)).not.toContain("charge-equip-no-nbv");
    expect(result.dismissed.map((f) => f.id)).toContain("charge-equip-no-nbv");
  });
});
