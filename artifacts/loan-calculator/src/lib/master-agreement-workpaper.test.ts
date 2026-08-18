import { describe, it, expect } from "vitest";
import {
  buildLoanWorkpaper,
  buildFileWorkpapers,
  type WorkpaperLoanInput,
  type WorkpaperMasterInput,
} from "./workpaper-export";

const meta = { clientName: "Test Co", fiscalYearEnd: "2026-12-31" };

const master: WorkpaperMasterInput = {
  id: "m1",
  lender: "Royal Bank",
  description: "Master credit agreement",
  facilityLimit: 5000000,
  securityDescription: "GSA over all present and after-acquired property",
  covenantDescription: "DSCR not less than 1.25:1",
};

function makeLoan(overrides: Partial<WorkpaperLoanInput> = {}): WorkpaperLoanInput {
  return {
    name: "Facility A",
    counterparty: "Royal Bank",
    isCapitalLease: false,
    principal: "1000000",
    downPayment: null,
    interestRate: "6.0",
    amortizationYears: 10,
    termYears: 5,
    startDate: "2026-01-01",
    paymentFrequency: "monthly",
    ioMonths: 0,
    balloonPayment: "0",
    ...overrides,
  } as WorkpaperLoanInput;
}

describe("workpaper master agreement fallback", () => {
  it("falls back to master security/covenant wording when the facility has none", () => {
    const wp = buildLoanWorkpaper(makeLoan({ masterAgreementId: "m1" }), meta, master);
    expect(wp).not.toBeNull();
    const section = wp!.sections.find((s) => s.title === "Security & Related Assets");
    expect(section).toBeDefined();
    const flat = section!.rows.map((r) => r.join(": ")).join("\n");
    expect(flat).toContain("Security (per master agreement)");
    expect(flat).toContain("GSA over all present");
    expect(flat).toContain("Covenants (per master agreement)");
    expect(flat).toContain("Royal Bank");
  });

  it("keeps facility-level security when overridden", () => {
    const wp = buildLoanWorkpaper(
      makeLoan({ masterAgreementId: "m1", securityClauses: ["First charge over equipment"] } as any),
      meta,
      master,
    );
    const section = wp!.sections.find((s) => s.title === "Security & Related Assets");
    const flat = section!.rows.map((r) => r.join(": ")).join("\n");
    expect(flat).toContain("First charge over equipment");
    expect(flat).not.toContain("Security (per master agreement)");
    // Covenant wording still comes from the master (no facility-level covenant field).
    expect(flat).toContain("Covenants (per master agreement)");
  });

  it("retains inherited security after the master is deleted and the facility is unlinked", () => {
    // Copy-on-link: linking copies the master's security wording into the
    // facility's own securityClauses, so after delete/unlink (no master passed)
    // the security disclosure survives on the facility itself.
    const wp = buildLoanWorkpaper(
      makeLoan({ securityClauses: [master.securityDescription!] } as Partial<WorkpaperLoanInput>),
      meta,
      null,
    );
    const section = wp!.sections.find((s) => s.title === "Security & Related Assets");
    expect(section).toBeDefined();
    const flat = section!.rows.map((r) => r.join(": ")).join("\n");
    expect(flat).toContain("GSA over all present and after-acquired property");
    expect(flat).not.toContain("master agreement");
  });

  it("does not mention a master for standalone loans", () => {
    const wp = buildLoanWorkpaper(makeLoan(), meta, null);
    const section = wp!.sections.find((s) => s.title === "Security & Related Assets");
    expect(section).toBeUndefined();
  });

  it("orders facilities under their master in file workpapers", () => {
    const wps = buildFileWorkpapers({
      ...meta,
      loans: [
        makeLoan({ name: "Standalone" }),
        makeLoan({ name: "Facility B", masterAgreementId: "m1" }),
        makeLoan({ name: "Facility A", masterAgreementId: "m1" }),
      ],
      masters: [master],
    });
    expect(wps.map((w) => w.loanName)).toEqual(["Facility B", "Facility A", "Standalone"]);
  });
});
