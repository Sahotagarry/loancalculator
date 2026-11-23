import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "../components/ui/tooltip";

const fixture = vi.hoisted(() => ({ loan: {} as Record<string, any> }));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ canWrite: true, user: { displayName: "Test accountant", role: "admin" } }),
  EASY_AUTH_LOGOUT_URL: "/logout",
}));
vi.mock("wouter", async () => {
  const { createElement } = await import("react");
  return {
    useRoute: () => [true, { id: "client", fileId: "file", loanId: "operating" }],
    useLocation: () => ["/client/client/file/file/loan/operating", vi.fn()],
    Link: ({ children, href, ...props }: any) => createElement("a", { href, ...props }, children),
  };
});
vi.mock("@workspace/api-client-react", async (original) => {
  const actual = await original<Record<string, unknown>>();
  const mutation = () => ({ mutate: vi.fn(), isPending: false });
  return {
    ...actual,
    useGetLoan: (id: string) => ({ data: id === "operating" ? fixture.loan : undefined }),
    useGetFile: () => ({ data: { id: "file", fiscalYearEnd: "2026-12-31" } }),
    useGetClient: () => ({ data: { id: "client", name: "Synthetic client" } }),
    useListLoans: () => ({ data: [fixture.loan] }),
    useListMasterAgreements: () => ({ data: [] }),
    useGetFvDecisionHistory: () => ({ data: undefined }),
    useGetLoanRateTimeline: () => ({ data: undefined }),
    useGetPrimeRate: () => ({ data: { rate: 5 } }),
    useConfirmFvDecision: mutation,
    useOverrideLoanRate: mutation,
    useRestoreLoanSourcedRate: mutation,
    useUpdateLoan: mutation,
    useCreateLoanEventSet: mutation,
    usePreviewLoanEventSet: mutation,
  };
});

import LoanDetail from "../pages/loan-detail";

beforeEach(() => {
  vi.stubGlobal("__APP_VERSION__", "test");
  vi.stubGlobal("__APP_BUILD_TIME__", "2026-11-23T00:00:00.000Z");
  fixture.loan = {
    id: "operating", fileId: "file", name: "Synthetic property lease",
    description: "Documentary inputs stay available", isCapitalLease: false,
    isOfficeProperty: true, interestRate: 0, rateType: "fixed", principal: 23000,
    downPayment: 0, monthlyPayment: 1000, firstPaymentAmount: null,
    termMonths: 24, termYears: 2, amortizationYears: 2,
    startDate: "2026-01-01", fiscalYearEnd: "2026-12-31",
    paymentFrequency: "monthly", paymentTiming: "beginning",
    graceMonths: 0, ioMonths: 0, balloonPayment: 0,
    freeRentMonths: 1, rentEscalationRate: 0,
    tenantImprovementAllowance: 1000, otherInducements: 0, rentSteps: [],
    assetCost: 0, assetUsefulLife: 40, assetDescription: "",
    fairValue: 1000000, leaseTermPct: 5, transferOfOwnership: false,
    bargainPurchaseOption: false, specializedAsset: false, activeEvents: [],
    leaseAssessmentRate: 6, leaseEndingTerms: {
      version: 1, kind: "none", amount: 0, basis: "stated",
      source: "Synthetic return clause — no payment or guarantee.",
      settlementMonth: 24, issues: [], status: "reviewed", discountRate: 6,
    },
  };
});

afterEach(() => vi.unstubAllGlobals());

const renderPage = () => renderToStaticMarkup(createElement(TooltipProvider, null, createElement(LoanDetail)));
const accountingSections = [
  "Minimum Lease Payments Schedule", "Straight-Line Lease Expense",
  "Recurring Monthly Journal Entry", "Cr. Lease Incentive Liability",
];

describe("operating lease detail review availability", () => {
  it("withholds draft accounting after a financial edit and restores it after explicit review", () => {
    const reviewed = renderPage();
    for (const section of accountingSections) expect(reviewed).toContain(section);

    // The saved state produced by editing a financial input in LoanFormFields.
    fixture.loan = { ...fixture.loan, monthlyPayment: 1100,
      leaseEndingTerms: { ...fixture.loan.leaseEndingTerms, status: "draft" } };
    const draft = renderPage();
    expect(draft).toContain("Calculation unavailable — review required");
    expect(draft).toContain("Stored lease inputs — not reviewed");
    expect(draft).toContain("Stored monthly rent");
    expect(draft).toContain("$1,100.00");
    expect(draft).toContain("Documentary inputs stay available");
    for (const section of accountingSections) expect(draft).not.toContain(section);
    expect(draft).not.toContain("Dr. Rent Expense");
    expect(draft).not.toContain("Cr. Deferred Rent");

    fixture.loan = { ...fixture.loan,
      leaseEndingTerms: { ...fixture.loan.leaseEndingTerms, status: "reviewed" } };
    const restored = renderPage();
    for (const section of accountingSections) expect(restored).toContain(section);
    expect(restored).not.toContain("Calculation unavailable — review required");
  });
});
