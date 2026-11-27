import { expect, it, vi } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { jsPDF } from "jspdf";
import {
  buildFileSummary,
  buildFairValueAccountingEntries,
} from "./aspe-utils";
import {
  buildFileWorkpapers,
  exportFileLeadSheetPdf,
  exportFileWorkpapersPdf,
  exportLoanWorkpaperPdf,
} from "./workpaper-export";
import {
  exportAnnualPdf,
  exportSchedulePdf,
  type YearlyTotal,
} from "./loan-export";
import { buildDisclosureModel } from "./disclosure-model";
import {
  buildPresentationDisclosureDocxPlan,
  downloadPresentationDisclosurePdf,
  renderPresentationDisclosureDocx,
} from "./disclosure-export";
import { renderSchedulePdf, renderAnnualPdf } from "./loan-print";
import { format } from "date-fns";
import { formatCurrency } from "./format";

// Entirely invented records; no database, API or user files. Set PDF_SAMPLE_DIR to retain the PDFs.
const meta = {
  clientName:
    "Illustrative Manufacturing and Distribution Cooperative — Training Example",
  fiscalYearEnd: "2026-12-31",
};
const clauses = Array.from(
  { length: 30 },
  (_, i) =>
    `Illustrative clause ${i + 1}: designated equipment remains subject to the lender's security interest until written release. This example qualification applies only to the equipment listed in the agreement.`,
);
const debt = {
  id: "demo-loan",
  name: "Equipment renewal and distribution centre improvements — five-year illustrative financing agreement",
  principal: 85000,
  interestRate: 3,
  amortizationYears: 5,
  termYears: 5,
  startDate: "2025-01-01",
  paymentFrequency: "monthly",
  isCapitalLease: false,
  counterparty: "Example Equipment Lender",
  currentRevisionHash: "demo-contract-fingerprint",
  currentRevisionId: "demo-revision",
  calculationVersion: "demo-calculation",
  fvDecisionHistory: {
    status: "current",
    reviewRequired: false,
    missingRequirements: [],
    staleReasons: [],
    history: [
      {
        version: 1,
        id: "illustrative-confirmation",
        treatment: "use_fv",
        marketEffectiveRate: 6,
        confirmedAt: "2026-12-31",
        confirmedBy: "Illustrative reviewer",
        rationaleNote:
          "Illustrative market borrowing rate for similar equipment financing.",
        contractFingerprint: "demo-contract-fingerprint",
        canonicalFingerprint: "demo-confirmation",
        reportingContextFingerprint: "demo-reporting",
        evidenceVersion: "demo-evidence",
        calculationVersion: "demo-calculation",
        evidence: { basis: "Training example" },
      },
    ],
  },
  fvDecision: "use_fv",
  fvRate: 6,
  covenantViolation: true,
  securityClauses: clauses,
};
const lease = {
  ...debt,
  id: "demo-lease",
  startDate: "2025-06-01",
  fvDecisionHistory: undefined,
  name: "Illustrative forklift fleet",
  isCapitalLease: true,
  termMonths: 24,
  termYears: 2,
  amortizationYears: 2,
  principal: 30000,
  monthlyPayment: 1300,
  fvDecision: null,
  covenantViolation: false,
  securityClauses: [],
};
const rent = {
  ...lease,
  id: "demo-rent",
  name: "Illustrative warehouse occupancy",
  counterparty: "Example Properties",
  isCapitalLease: false,
  interestRate: 0,
  termMonths: 36,
  principal: 72000,
  monthlyPayment: 2000,
  freeRentMonths: 2,
};
const input = { ...meta, loans: [debt, lease, rent] };

it("prints the fictional mixed-instrument file using the booked calculation and disclosure figures", async () => {
  const [wp] = buildFileWorkpapers(input);
  const schedule = wp.schedule!;
  expect(schedule).toHaveLength(60);
  const years: YearlyTotal[] = [];
  for (const row of schedule) {
    const label = String(row.date.getFullYear());
    if (years.at(-1)?.label !== label)
      years.push({
        label,
        principal: 0,
        interest: 0,
        opening: row.balance + row.principal,
      });
    const y = years.at(-1)!;
    y.principal += row.principal;
    y.interest += row.interest;
    y.closing = row.balance;
  }
  const summary = buildFileSummary(input.loans, meta.fiscalYearEnd);
  const model = buildDisclosureModel({
    ...meta,
    agreements: input.loans,
    summary,
    reportingTransitionsReady: true,
    rolledFromFileId: "demo-prior",
    comparative: {
      sourceFileId: "demo-prior",
      fiscalYearEnd: "2025-12-31",
      rolledFromLoanIds: [],
      summary: buildFileSummary(input.loans, "2025-12-31"),
    },
  });
  const evidence = {
    ...meta,
    ...debt,
    fairValueAccountingEntries: buildFairValueAccountingEntries({
      loan: debt,
      reportingFiscalYearEnd: meta.fiscalYearEnd,
    }),
  };
  const output = process.env.PDF_SAMPLE_DIR;
  if (output) {
    mkdirSync(output, { recursive: true });
    const word = await renderPresentationDisclosureDocx(model);
    writeFileSync(
      `${output}/word-reference.docx`,
      Buffer.from(await word.arrayBuffer()),
    );
  }
  const documents: Record<string, jsPDF> = {};
  let id = "schedule";
  // jsPDF copies API extensions onto instances. Capture real serialized downloads without a browser.
  const save = Object.getOwnPropertyDescriptor(jsPDF.API, "save");
  Object.defineProperty(jsPDF.API, "save", {
    configurable: true,
    enumerable: true,
    value: function (this: jsPDF) {
      documents[id] = this;
      if (output)
        writeFileSync(
          `${output}/${id}.pdf`,
          Buffer.from(this.output("arraybuffer")),
        );
    },
  });
  try {
    exportSchedulePdf(evidence, schedule);
    id = "annual";
    exportAnnualPdf(debt.name, years, evidence);
    id = "agreement";
    exportLoanWorkpaperPdf(wp);
    id = "lead-sheet";
    exportFileLeadSheetPdf(input);
    id = "consolidated";
    exportFileWorkpapersPdf(input);
    id = "disclosure";
    downloadPresentationDisclosurePdf(model);
  } finally {
    if (save) Object.defineProperty(jsPDF.API, "save", save);
    else Reflect.deleteProperty(jsPDF.API, "save");
  }
  expect(Object.keys(documents)).toHaveLength(6);
  for (const doc of Object.values(documents)) {
    const count = doc.getNumberOfPages();
    for (let page = 1; page <= count; page++) {
      doc.setPage(page);
      const [w, h] = [
        doc.internal.pageSize.width,
        doc.internal.pageSize.height,
      ].sort((a, b) => a - b);
      expect(w).toBeCloseTo(215.9);
      expect(h).toBeCloseTo(279.4);
      const content = doc.internal.pages[page].join("\n");
      expect(content).toContain(`(Page ${page} of ${count})`);
      expect(content).toContain("2026");
      if (doc === documents.consolidated || doc === documents["lead-sheet"] || doc === documents.agreement) {
        expect(content).toContain("Client name:");
        expect(content).toContain("Year-end:");
      }
    }
  }
  const textOf = (doc: jsPDF) => doc.internal.pages.slice(1).flat().join("\n");
  const workpaper = textOf(documents.agreement);
  expect(workpaper.indexOf("(Continuity")).toBeLessThan(
    workpaper.indexOf("(Terms)"),
  );
  const packageText = textOf(documents.consolidated);
  expect(packageText).toContain("Loan Repayment Summary Workpaper");
  expect(packageText).toContain("Capital Lease Summary Workpaper");
  expect(packageText).toContain("Less: amount representing interest");
  expect(packageText).toContain("Capital lease liability at year end");
  expect(workpaper).not.toContain("Loan Repayment Summary Workpaper");
  const operating = packageText.slice(
    packageText.indexOf("Operating Lease Workpaper"),
  );
  expect(operating).toContain("(Rent Expense");
  expect(operating).not.toContain("Full Amortization Schedule");
  for (const row of schedule)
    expect(textOf(documents.schedule)).toContain(
      `(${formatCurrency(row.balance)})`,
    );
  for (const value of [
    model.balanceSheet.totalDebt.total.current,
    model.balanceSheet.totalDebt.total.comparative!,
  ]) {
    expect(textOf(documents.disclosure)).toContain(
      `(${formatCurrency(value)})`,
    );
  }
  const expected = {
    payments: schedule.map((row) => [
      row.month,
      format(row.date, "MMM d, yyyy"),
      formatCurrency(row.payment),
      formatCurrency(row.principal),
      formatCurrency(row.interest),
      formatCurrency(row.balance),
    ]),
    annual: years,
    currentDebt: formatCurrency(summary.totalDebt),
    fileInterest: formatCurrency(summary.totalInterestExpense),
    disclosure: buildPresentationDisclosureDocxPlan(model),
    sections: wp.sections.map((s) => s.title),
  };
  if (output)
    writeFileSync(`${output}/expected.json`, JSON.stringify(expected, null, 2));
});

it("prints a single quick-calculator total after the last row, even across pages", () => {
  const rows = buildFileWorkpapers(input)[0].schedule!;
  const quick = {
    name: "Quick loan calculator",
    principal: 85000,
    interestRate: 3,
    termYears: 5,
    fiscalYearEnd: meta.fiscalYearEnd,
  };
  const schedule = renderSchedulePdf(quick, rows, true);
  const years = Array.from({ length: 80 }, (_, i) => ({
    label: `Year ending Dec 31, ${2030 + i}`,
    principal: 10,
    interest: -0.25,
  }));
  const annual = renderAnnualPdf(quick.name, years, quick, true);
  for (const [doc, token] of [
    [schedule, "(Period)"],
    [annual, "(Fiscal year)"],
  ] as const) {
    expect(doc.getNumberOfPages()).toBeGreaterThan(1);
    for (let i = 1; i <= doc.getNumberOfPages(); i++) {
      const page = doc.internal.pages[i].join("\n");
      expect(page).toContain(token);
      // The annual table also has a column named Total in every repeated header.
      expect(page.split("(Total)").length - 1).toBe(
        (doc === annual ? 1 : 0) + Number(i === doc.getNumberOfPages()),
      );
    }
  }
});

it("retains event order, revised and active rate evidence, and section notes longer than a page", () => {
  const r = {
    id: "rate-active",
    setId: "demo-set",
    effectiveDate: "2026-03-01",
    benchmarkRate: 4,
    spread: 1,
    resultingRate: 5,
    reason: "Verified contractual reset",
    source: "Lender notice",
  };
  const event = {
    id: "example-prepayment",
    effectiveDate: "2026-04-15",
    amount: 500,
    ordering: "after_scheduled_payment" as const,
    sequence: 1,
    classification: "ordinary" as const,
    source: "Example notice",
    reason: "Voluntary principal payment",
    treatment: "keep_maturity" as const,
  };
  const floating = {
    ...debt,
    fvDecision: null,
    fvDecisionHistory: undefined,
    securityClauses: [],
    rateType: "prime_linked",
    activeRateEvents: [r],
    rateTimelineEvents: [{ ...r, id: "rate-replaced" }],
    activeEvents: [event],
  };
  const wp = buildFileWorkpapers({ ...meta, loans: [floating] })[0];
  const notes = Array.from(
    { length: 140 },
    (_, i) =>
      `Evidence paragraph ${i + 1}: ${"This detail must remain within the printable area. ".repeat(2)}`,
  ).join("\n");
  wp.sections[0].notes = [notes];
  const doc = renderSchedulePdf({ ...floating, ...meta }, wp.schedule!);
  const content = doc.internal.pages.flat().join("\n");
  for (const value of [
    r.id,
    "rate-replaced",
    event.reason,
    "Voluntary",
    "Segment interest",
    "$500.00",
  ])
    expect(content).toContain(value);
  const save = vi.fn(function (this: jsPDF) {
    const serialized = this.internal.pages.flat().join("\n");
    for (const value of [
      "Evidence paragraph 1:",
      "Evidence paragraph 140:",
      "rate-replaced",
      r.id,
      "Contractual Rate Timeline Evidence",
    ])
      expect(serialized).toContain(value);
  });
  jsPDF.API.save = save;
  try {
    exportLoanWorkpaperPdf(wp);
    expect(save).toHaveBeenCalledOnce();
  } finally {
    delete jsPDF.API.save;
  }
});
