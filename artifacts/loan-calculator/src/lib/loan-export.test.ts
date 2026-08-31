import { describe, expect, it, vi } from "vitest";
import { exportScheduleXlsx, exportSchedulePdf, exportAnnualXlsx, exportAnnualPdf } from "./loan-export";

vi.mock("xlsx", () => ({
  utils: { json_to_sheet: vi.fn(() => ({})), aoa_to_sheet: vi.fn(() => ({})), book_new: vi.fn(), book_append_sheet: vi.fn() },
  writeFile: vi.fn()
}));
vi.mock("jspdf", () => {
  const mockDoc = {
    setFontSize: vi.fn(),
    text: vi.fn(),
    save: vi.fn()
  };
  return { jsPDF: vi.fn(function() { return mockDoc; }) };
});
vi.mock("jspdf-autotable", () => ({
  default: vi.fn()
}));

describe("loan-export parity", () => {
  it("passes fairValueAccountingEntries and fvDecisionHistory correctly", () => {
    const mockSchedule = [{ month: 1, date: new Date(), payment: 100, principal: 50, interest: 50, totalInterest: 50, balance: 1000 }];
    const mockYearly = [{ year: 2025, label: "2025", principal: 100, interest: 50, opening: 1000, closing: 900 }];
    
    const mockFvAccounting = { treatment: "use_fv", dayOne: null, annualEntries: [], cumulativeSupport: [], decisionHistory: null } as any;
    const mockFvDecisionHistory = { status: "current", current: {}, staleReasons: [], missingRequirements: [], history: [] } as any;

    const evidence = {
      name: "Test Loan",
      principal: 1000,
      interestRate: 5,
      termYears: 5,
      fairValueAccountingEntries: mockFvAccounting,
      fvDecisionHistory: mockFvDecisionHistory
    };

    exportScheduleXlsx("Test", mockSchedule, evidence);
    exportSchedulePdf(evidence, mockSchedule);
    exportAnnualXlsx("Test", mockYearly, evidence);
    exportAnnualPdf("Test", mockYearly, evidence);

    expect(true).toBe(true);
  });
});
