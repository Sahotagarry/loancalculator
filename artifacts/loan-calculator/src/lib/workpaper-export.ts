import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { format, parseISO, subYears, isAfter } from "date-fns";
import { formatCurrency } from "@/lib/format";
import { calculateAmortization, type AmortizationRow, type Frequency } from "@workspace/amortization";
import {
  buildLoanSummary,
  calculateBookedSchedule,
  type LoanSummary,
  type CapitalLeaseSummary,
  type OperatingLeaseSummary,
} from "./aspe-utils";
import { getFiscalYear, getFyEndParts } from "./fiscal";

/* ────────────────────────────────────────────────────────────────
   Workpaper exports for audit / review engagement files.

   A workpaper is assembled as a list of generic sections so the same
   data renders to both PDF (jspdf-autotable) and Excel (one sheet per
   section). All figures reuse the exact same computation paths as the
   app (calculateBookedSchedule / buildLoanSummary), so the workpaper
   always ties to what is displayed on screen.
   ──────────────────────────────────────────────────────────────── */

export type WorkpaperLoanInput = Parameters<typeof buildLoanSummary>[0] & {
  description?: string | null;
};

export interface WorkpaperMeta {
  clientName: string;
  fiscalYearEnd: string; // ISO date string
}

interface WpSection {
  title: string;
  head: string[];
  rows: (string | number)[][];
  notes?: string[];
}

export interface Workpaper {
  loanName: string;
  typeLabel: string;
  clientName: string;
  fyeLabel: string;
  sections: WpSection[];
  /** Full booked amortization schedule appendix (loans & capital leases). */
  schedule: AmortizationRow[] | null;
}

const money = (n: number) => formatCurrency(n);
const pct = (n: number) => `${n.toFixed(2)}%`;

function fvDecisionLabel(d: string | null | undefined): string {
  switch (d) {
    case "use_fv":
      return "Fair value adopted — booked using the effective-interest method at the market rate";
    case "trivial":
      return "Difference from market rate assessed as trivial — booked at contractual terms";
    case "immaterial":
      return "Fair value difference assessed as immaterial — booked at contractual terms";
    default:
      return "Not assessed — booked at contractual terms";
  }
}

/* ── Per-loan workpaper assembly ─────────────────────────────── */

export function buildLoanWorkpaper(
  loan: WorkpaperLoanInput,
  meta: WorkpaperMeta,
): Workpaper | null {
  if (!loan.startDate || !meta.fiscalYearEnd) return null;
  const reportYearEnd = parseISO(meta.fiscalYearEnd);
  const summary = buildLoanSummary(loan, reportYearEnd, meta.fiscalYearEnd);
  if (!summary) return null;

  const fyeLabel = format(reportYearEnd, "MMMM d, yyyy");

  if ("monthlyStraightLineExpense" in summary) {
    return buildOperatingLeaseWorkpaper(loan, summary, meta, fyeLabel, reportYearEnd);
  }
  return buildDebtWorkpaper(
    loan,
    summary as LoanSummary | CapitalLeaseSummary,
    meta,
    fyeLabel,
    reportYearEnd,
  );
}

function buildDebtWorkpaper(
  loan: WorkpaperLoanInput,
  summary: LoanSummary | CapitalLeaseSummary,
  meta: WorkpaperMeta,
  fyeLabel: string,
  reportYearEnd: Date,
): Workpaper {
  const isCapital = summary.isCapitalLease;
  const typeLabel = isCapital ? "Capital Lease" : "Loan";
  const booked = calculateBookedSchedule({ ...loan, startDate: loan.startDate! });
  const principal = Number(loan.principal);
  const downPayment = Number(loan.downPayment ?? 0);
  // Financed amount actually amortized (face principal net of down payment).
  const financed = principal - downPayment;
  const statedRate = Number(loan.interestRate);
  const { month: fyEndMonth, day: fyEndDay } = getFyEndParts(meta.fiscalYearEnd);
  const reportFY = getFiscalYear(reportYearEnd, fyEndMonth, fyEndDay);
  const startDate = parseISO(loan.startDate!);
  const priorYearEnd = subYears(reportYearEnd, 1);
  const startedThisFY = isAfter(startDate, priorYearEnd);

  const sections: WpSection[] = [];

  /* 1 — Terms */
  const termsRows: (string | number)[][] = [
    ["Counterparty", loan.counterparty?.trim() || "—"],
    [isCapital ? "Capitalized amount" : "Principal", money(principal)],
    ["Stated rate", pct(statedRate)],
    ["Start date", format(startDate, "MMMM d, yyyy")],
    ["Maturity date", summary.maturityDate],
    [
      "Term / amortization",
      loan.termMonths != null && loan.termMonths > 0
        ? `${loan.termMonths} months / ${loan.amortizationYears} yr amortization`
        : `${loan.termYears} yr term / ${loan.amortizationYears} yr amortization`,
    ],
    ["Payment", `${money(summary.regularPayment)} ${summary.paymentFrequency}`],
  ];
  if (downPayment > 0) {
    termsRows.splice(2, 0,
      [isCapital ? "Down payment / first payment" : "Down payment", `(${money(downPayment)})`],
      [isCapital ? "Obligation financed" : "Amount financed", money(financed)],
    );
  }
  if (Number(loan.balloonPayment ?? 0) > 0) {
    termsRows.push(["Balloon payment", money(Number(loan.balloonPayment))]);
  }
  if ((loan.ioMonths ?? 0) > 0) {
    termsRows.push(["Interest-only period", `${loan.ioMonths} months`]);
  }
  sections.push({ title: "Terms", head: ["Item", "Detail"], rows: termsRows });

  /* 2 — Fair value assessment (ASPE 3856) — loans only */
  if (!isCapital) {
    const fvRows: (string | number)[][] = [
      ["Assessment", fvDecisionLabel(loan.fvDecision)],
    ];
    if (loan.fvDecision === "use_fv" && loan.fvRate != null) {
      fvRows.push(["Market (effective) rate", pct(Number(loan.fvRate))]);
      if (booked.fairValue != null) {
        fvRows.push(["Fair value at inception", money(booked.fairValue)]);
        fvRows.push(["Day-one discount", money(financed - booked.fairValue)]);
      }
    }
    sections.push({
      title: "Fair Value Assessment (ASPE 3856)",
      head: ["Item", "Detail"],
      rows: fvRows,
    });
  } else {
    sections.push({
      title: "Lease Classification (ASPE 3065)",
      head: ["Item", "Detail"],
      rows: [
        ["Classification", "Capital lease"],
        ["Discount rate used", pct(summary.interestRate)],
        [
          "Total minimum lease payments",
          money((summary as CapitalLeaseSummary).totalMinimumPayments),
        ],
        ["Implied interest", money((summary as CapitalLeaseSummary).impliedInterest)],
        ["Obligation at year end (PV)", money((summary as CapitalLeaseSummary).obligations)],
      ],
      notes: [
        "Classification support: document which ASPE 3065.06 criteria were met (transfer of ownership / bargain purchase option, lease term vs. economic life, PV of minimum payments vs. fair value of the asset).",
      ],
    });
  }

  /* 3 — Continuity for the fiscal year */
  const openingBalance = startedThisFY
    ? 0
    : booked.schedule.filter((r) => !isAfter(r.date, priorYearEnd)).slice(-1)[0]?.balance ??
      (booked.usedFairValue && booked.fairValue != null ? booked.fairValue : financed);
  const advances = startedThisFY
    ? booked.usedFairValue && booked.fairValue != null
      ? booked.fairValue
      : financed
    : 0;
  const interestExpenseFY =
    summary.yearlyInterest.find((y) => y.fiscalYear === reportFY)?.amount ?? 0;
  const principalRepaidFY = summary.principalRepaidCurrentFY;
  const closing = summary.balanceAtYearEnd;
  const continuityCheck = openingBalance + advances - principalRepaidFY;
  sections.push({
    title: `Continuity — Year Ended ${fyeLabel}`,
    head: ["Item", "Amount"],
    rows: [
      ["Opening balance", money(openingBalance)],
      ["Advances / additions during the year", money(advances)],
      ["Principal repayments", `(${money(principalRepaidFY)})`],
      ["Closing balance per schedule", money(closing)],
      ["Interest expense for the year", money(interestExpenseFY)],
    ],
    notes:
      Math.abs(continuityCheck - closing) > 0.02
        ? [
            `Note: opening + advances − repayments = ${money(continuityCheck)} differs from the closing balance by ${money(Math.abs(continuityCheck - closing))} (rounding and/or effective-interest accretion).`,
          ]
        : undefined,
  });

  /* 4 — Balance sheet presentation & 5-year maturity */
  sections.push({
    title: "Balance Sheet Presentation",
    head: ["Item", "Amount"],
    rows: summary.covenantViolation
      ? [
          ["Balance at year end", money(summary.balanceAtYearEnd)],
          ["Current portion (entire balance — covenant violation)", money(summary.currentPortion)],
          ["  Scheduled repayments due within one year", money(summary.scheduledWithinOneYear)],
          ["  Scheduled repayments due beyond one year, callable", money(summary.scheduledBeyondOneYear)],
          ["Long-term portion", money(summary.longTermPortion)],
        ]
      : [
          ["Balance at year end", money(summary.balanceAtYearEnd)],
          ["Current portion (due within 12 months)", money(summary.currentPortion)],
          ["Long-term portion", money(summary.longTermPortion)],
        ],
    notes: summary.covenantViolation
      ? [
          "Note: a financial covenant was violated as at year end, so the entire obligation is classified as current (ASPE 1510).",
        ]
      : undefined,
  });
  sections.push({
    title: "Principal Repayments — Next Five Years (Disclosure)",
    head: ["Fiscal year", "Principal"],
    rows: [
      ...summary.yearlyPrincipal.map((y) => [y.label, money(y.amount)]),
      ["Total", money(summary.yearlyPrincipal.reduce((s, y) => s + y.amount, 0))],
    ],
  });
  if (isCapital) {
    const cl = summary as CapitalLeaseSummary;
    sections.push({
      title: "Future Minimum Lease Payments (Disclosure)",
      head: ["Fiscal year", "Payment"],
      rows: [
        ...cl.yearlyBlended.map((y) => [y.label, money(y.amount)]),
        ["Total minimum lease payments", money(cl.totalMinimumPayments)],
        ["Less: amount representing interest", `(${money(cl.impliedInterest)})`],
        ["Obligation under capital lease", money(cl.obligations)],
      ],
    });
  }

  /* 5 — Fair value adjusting entry (when FV adopted) */
  if (!isCapital && loan.fvDecision === "use_fv" && booked.usedFairValue && booked.fairValue != null) {
    const frequency = (loan.paymentFrequency ?? "monthly") as Frequency;
    const contractual = calculateAmortization(
      financed,
      statedRate,
      loan.amortizationYears,
      loan.termYears,
      startDate,
      loan.ioMonths ?? 0,
      loan.specificIoMonths
        ? loan.specificIoMonths.split(",").map(Number).filter((n) => !isNaN(n))
        : [],
      Number(loan.balloonPayment ?? 0),
      frequency,
      loan.paymentOverride != null ? Number(loan.paymentOverride) : null,
    );
    const interestByFY = (rows: AmortizationRow[]) => {
      const m = new Map<number, number>();
      for (const r of rows) {
        const fy = getFiscalYear(r.date, fyEndMonth, fyEndDay);
        m.set(fy, (m.get(fy) ?? 0) + r.interest);
      }
      return m;
    };
    const fvInt = interestByFY(booked.schedule);
    const ctInt = interestByFY(contractual.schedule);
    const day1 = financed - booked.fairValue;
    let priorExtra = 0;
    for (const [fy, amt] of fvInt) {
      if (fy < reportFY) priorExtra += amt - (ctInt.get(fy) ?? 0);
    }
    const currentExtra = (fvInt.get(reportFY) ?? 0) - (ctInt.get(reportFY) ?? 0);
    const cumulative = priorExtra + currentExtra;
    sections.push({
      title: `Fair Value Adjustment — As At ${fyeLabel}`,
      head: ["Item", "Amount"],
      rows: [
        ["Day-one discount (principal less fair value)", money(day1)],
        ["Discount accreted in prior years (opening retained earnings)", money(priorExtra)],
        ["Discount accreted this year (additional interest expense)", money(currentExtra)],
        ["Cumulative discount accreted", money(cumulative)],
        ["Unamortized discount at year end", money(day1 - cumulative)],
      ],
      notes: [
        "If the client records the loan at contractual amounts, the adjusting entry reduces the loan by the unamortized discount, credits opening retained earnings for the net prior-year effect, and adjusts current-year interest expense as shown.",
      ],
    });
  }

  /* 6 — Security / collateral */
  const collateralRows: (string | number)[][] = [];
  if (loan.collateralType) {
    collateralRows.push(["Collateral", loan.collateralDescription || loan.collateralType]);
    if (summary.collateralNbv != null) {
      collateralRows.push(["Net book value at year end", money(summary.collateralNbv)]);
    }
  }
  if (loan.securityClauses && loan.securityClauses.length > 0) {
    collateralRows.push(["Security clauses", loan.securityClauses.join("; ")]);
  }
  if (collateralRows.length > 0) {
    sections.push({
      title: "Security & Related Assets",
      head: ["Item", "Detail"],
      rows: collateralRows,
      notes: ["Cross-reference the related asset workpaper for cost and accumulated amortization support."],
    });
  }

  /* 7 — Disclosure narrative */
  sections.push({
    title: "Draft Note Disclosure",
    head: ["Narrative"],
    rows: [[summary.description]],
  });

  return {
    loanName: summary.name,
    typeLabel,
    clientName: meta.clientName,
    fyeLabel,
    sections,
    schedule: booked.schedule,
  };
}

function buildOperatingLeaseWorkpaper(
  loan: WorkpaperLoanInput,
  summary: OperatingLeaseSummary,
  meta: WorkpaperMeta,
  fyeLabel: string,
  reportYearEnd: Date,
): Workpaper {
  const { month: fyEndMonth, day: fyEndDay } = getFyEndParts(meta.fiscalYearEnd);
  const reportFY = getFiscalYear(reportYearEnd, fyEndMonth, fyEndDay);
  const sections: WpSection[] = [];

  const termsRows: (string | number)[][] = [
    ["Lessor", summary.counterparty ?? "—"],
    ["Monthly payment", money(summary.monthlyPayment)],
    ["Start date", format(parseISO(summary.startDate), "MMMM d, yyyy")],
    ["Term", `${summary.termMonths} months`],
    ["Total lease commitment", money(summary.totalCommitment)],
  ];
  if ((loan.freeRentMonths ?? 0) > 0) termsRows.push(["Free rent period", `${loan.freeRentMonths} months`]);
  if (Number(loan.tenantImprovementAllowance ?? 0) > 0)
    termsRows.push(["Tenant improvement allowance", money(Number(loan.tenantImprovementAllowance))]);
  if (Number(loan.otherInducements ?? 0) > 0)
    termsRows.push(["Other inducements", money(Number(loan.otherInducements))]);
  sections.push({ title: "Terms", head: ["Item", "Detail"], rows: termsRows });

  sections.push({
    title: "Lease Classification (ASPE 3065)",
    head: ["Item", "Detail"],
    rows: [
      [
        "Classification",
        "Operating lease — benefits and risks of ownership remain substantially with the lessor; none of the capital lease criteria in ASPE 3065.06 are met.",
      ],
    ],
  });

  const slExpenseFY =
    summary.yearlyStraightLine.find((y) => y.fiscalYear === reportFY)?.amount ?? 0;
  sections.push({
    title: `Rent Expense — Year Ended ${fyeLabel}`,
    head: ["Item", "Amount"],
    rows: [
      ["Straight-line monthly expense", money(summary.monthlyStraightLineExpense)],
      ["Straight-line rent expense for the year", money(slExpenseFY)],
      ["Deferred rent (liability) at year end", money(summary.deferredRentAtYearEnd)],
      ["Total inducements", money(summary.totalInducements)],
      ["Inducement liability — current", money(summary.inducementLiabilityCurrent)],
      ["Inducement liability — non-current", money(summary.inducementLiabilityNonCurrent)],
    ],
    notes: [
      "Rent is recognized on a straight-line basis over the lease term; inducements are amortized as a reduction of rent expense (ASPE 3065.27).",
    ],
  });

  sections.push({
    title: "Future Minimum Lease Payments (Disclosure)",
    head: ["Fiscal year", "Payment"],
    rows: [
      ...summary.yearlyPayments.map((y) => [y.label, money(y.amount)]),
      ["Total", money(summary.yearlyPayments.reduce((s, y) => s + y.amount, 0))],
    ],
  });

  sections.push({
    title: "Draft Note Disclosure",
    head: ["Narrative"],
    rows: [[summary.description]],
  });

  return {
    loanName: summary.name,
    typeLabel: "Operating Lease",
    clientName: meta.clientName,
    fyeLabel,
    sections,
    schedule: null,
  };
}

/* ── PDF rendering ───────────────────────────────────────────── */

const HEAD_COLOR: [number, number, number] = [24, 95, 45];

function renderWorkpaperPdf(doc: jsPDF, wp: Workpaper, startNewPage: boolean): void {
  if (startNewPage) doc.addPage();
  doc.setFontSize(16);
  doc.setTextColor(0);
  doc.text(`${wp.loanName} — ${wp.typeLabel} Workpaper`, 14, 18);
  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text(`${wp.clientName} · Year ended ${wp.fyeLabel}`, 14, 25);

  let y = 32;
  for (const section of wp.sections) {
    const est = 10 + section.rows.length * 7 + (section.notes?.length ?? 0) * 8;
    if (y + est > 275 && y > 40) {
      doc.addPage();
      y = 18;
    }
    doc.setFontSize(11);
    doc.setTextColor(0);
    doc.text(section.title, 14, y);
    autoTable(doc, {
      startY: y + 2,
      head: [section.head],
      body: section.rows.map((r) => r.map(String)),
      theme: "grid",
      headStyles: { fillColor: HEAD_COLOR, fontSize: 8 },
      bodyStyles: { fontSize: 8 },
      margin: { left: 14, right: 14 },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4;
    if (section.notes) {
      doc.setFontSize(7.5);
      doc.setTextColor(100);
      for (const note of section.notes) {
        const lines = doc.splitTextToSize(note, 180) as string[];
        const blockHeight = lines.length * 3.5 + 2;
        if (y + blockHeight > 285) {
          doc.addPage();
          y = 18;
          doc.setFontSize(7.5);
          doc.setTextColor(100);
        }
        doc.text(lines, 14, y);
        y += blockHeight;
      }
    }
    y += 4;
  }

  if (wp.schedule && wp.schedule.length > 0) {
    doc.addPage();
    doc.setFontSize(11);
    doc.setTextColor(0);
    doc.text(`Appendix — Full Amortization Schedule (${wp.loanName})`, 14, 18);
    autoTable(doc, {
      startY: 22,
      head: [["Period", "Date", "Payment", "Principal", "Interest", "Balance"]],
      body: wp.schedule.map((r) => [
        r.month,
        format(r.date, "MMMM d, yyyy"),
        money(r.payment),
        money(r.principal),
        money(r.interest),
        money(r.balance),
      ]),
      theme: "striped",
      headStyles: { fillColor: HEAD_COLOR, fontSize: 8 },
      bodyStyles: { fontSize: 7 },
      margin: { left: 14, right: 14 },
    });
  }
}

export function exportLoanWorkpaperPdf(wp: Workpaper): void {
  const doc = new jsPDF();
  renderWorkpaperPdf(doc, wp, false);
  doc.save(`${wp.loanName}_Workpaper.pdf`);
}

/* ── Excel rendering ─────────────────────────────────────────── */

function usedSheetNameSafe(base: string, used: Set<string>): string {
  const safeBase = base.replace(/[\\/?*[\]:]/g, "").trim() || "Sheet";
  let name = safeBase.slice(0, 31);
  let i = 2;
  while (used.has(name)) {
    const suffix = ` (${i})`;
    name = safeBase.slice(0, 31 - suffix.length) + suffix;
    i++;
  }
  used.add(name);
  return name;
}

function sectionsToAoa(wp: Workpaper): (string | number)[][] {
  const aoa: (string | number)[][] = [
    [`${wp.loanName} — ${wp.typeLabel} Workpaper`],
    [`${wp.clientName} · Year ended ${wp.fyeLabel}`],
    [],
  ];
  for (const section of wp.sections) {
    aoa.push([section.title]);
    aoa.push(section.head);
    for (const row of section.rows) aoa.push(row);
    if (section.notes) for (const note of section.notes) aoa.push([note]);
    aoa.push([]);
  }
  return aoa;
}

function scheduleSheet(schedule: AmortizationRow[]): XLSX.WorkSheet {
  return XLSX.utils.json_to_sheet(
    schedule.map((r) => ({
      Period: r.month,
      Date: format(r.date, "MMMM d, yyyy"),
      Payment: r.payment.toFixed(2),
      Principal: r.principal.toFixed(2),
      Interest: r.interest.toFixed(2),
      Balance: r.balance.toFixed(2),
    })),
  );
}

export function exportLoanWorkpaperXlsx(wp: Workpaper): void {
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();
  for (const section of wp.sections) {
    const ws = XLSX.utils.aoa_to_sheet([
      [`${wp.loanName} — ${section.title}`],
      [],
      section.head,
      ...section.rows,
      ...(section.notes ? [[], ...section.notes.map((n) => [n])] : []),
    ]);
    ws["!cols"] = [{ wch: 50 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(wb, ws, usedSheetNameSafe(section.title, used));
  }
  if (wp.schedule && wp.schedule.length > 0) {
    XLSX.utils.book_append_sheet(wb, scheduleSheet(wp.schedule), usedSheetNameSafe("Schedule", used));
  }
  XLSX.writeFile(wb, `${wp.loanName}_Workpaper.xlsx`);
}

/* ── Combined file (lead sheet) exports ──────────────────────── */

export interface FileWorkpaperInput {
  clientName: string;
  fiscalYearEnd: string;
  loans: WorkpaperLoanInput[];
}

interface LeadSheetData {
  debtRows: (string | number)[][];
  debtTotals: (string | number)[];
  debtBreakdownRows: (string | number)[][];
  debtNotes: string[];
  operatingRows: (string | number)[][];
  operatingTotals: (string | number)[] | null;
  fyeLabel: string;
}

function buildLeadSheet(input: FileWorkpaperInput, workpapers: Workpaper[]): LeadSheetData {
  const reportYearEnd = parseISO(input.fiscalYearEnd);
  const { month: fyEndMonth, day: fyEndDay } = getFyEndParts(input.fiscalYearEnd);
  const reportFY = getFiscalYear(reportYearEnd, fyEndMonth, fyEndDay);

  const debtRows: (string | number)[][] = [];
  const operatingRows: (string | number)[][] = [];
  let tBal = 0, tCur = 0, tLt = 0, tInt = 0;
  let tRent = 0, tCommit = 0;
  let tWithin = 0, tBeyond = 0;
  const violatedNames: string[] = [];

  for (const loan of input.loans) {
    const summary = buildLoanSummary(loan, reportYearEnd, input.fiscalYearEnd);
    if (!summary) continue;
    if ("monthlyStraightLineExpense" in summary) {
      const sl = summary.yearlyStraightLine.find((y) => y.fiscalYear === reportFY)?.amount ?? 0;
      operatingRows.push([
        summary.name,
        summary.counterparty ?? "—",
        money(summary.monthlyPayment),
        money(sl),
        money(summary.deferredRentAtYearEnd),
        money(summary.totalCommitment),
      ]);
      tRent += sl;
      tCommit += summary.totalCommitment;
    } else {
      const s = summary as LoanSummary | CapitalLeaseSummary;
      const interestFY = s.yearlyInterest.find((y) => y.fiscalYear === reportFY)?.amount ?? 0;
      const baseType = s.isCapitalLease ? "Capital lease" : "Loan";
      debtRows.push([
        s.name,
        s.covenantViolation ? `${baseType} — covenant violation` : baseType,
        pct(s.interestRate),
        s.maturityDate,
        money(s.balanceAtYearEnd),
        money(s.currentPortion),
        money(s.longTermPortion),
        money(interestFY),
      ]);
      tBal += s.balanceAtYearEnd;
      tCur += s.currentPortion;
      tLt += s.longTermPortion;
      tInt += interestFY;
      tWithin += s.scheduledWithinOneYear;
      tBeyond += s.scheduledBeyondOneYear;
      if (s.covenantViolation) violatedNames.push(s.name);
    }
  }

  const debtBreakdownRows: (string | number)[][] =
    tBeyond > 0
      ? [
          ["  Scheduled repayments due within one year", "", "", "", "", money(tWithin), "", ""],
          [
            "  Scheduled repayments due beyond one year, callable on covenant violation",
            "",
            "",
            "",
            "",
            money(tBeyond),
            "",
            "",
          ],
        ]
      : [];
  const debtNotes: string[] =
    violatedNames.length > 0
      ? [
          `Covenant violation: ${violatedNames.join(", ")} — a financial covenant was violated as at year end, so the entire obligation is classified as current (ASPE 1510). Amount otherwise due beyond one year but callable: ${money(tBeyond)}.`,
        ]
      : [];

  return {
    debtRows,
    debtTotals: ["Total", "", "", "", money(tBal), money(tCur), money(tLt), money(tInt)],
    debtBreakdownRows,
    debtNotes,
    operatingRows,
    operatingTotals:
      operatingRows.length > 0
        ? ["Total", "", "", money(tRent), "", money(tCommit)]
        : null,
    fyeLabel: workpapers[0]?.fyeLabel ?? format(reportYearEnd, "MMMM d, yyyy"),
  };
}

const DEBT_LEAD_HEAD = ["Name", "Type", "Rate", "Maturity", "Balance", "Current", "Long-term", "Interest exp."];
const OP_LEAD_HEAD = ["Name", "Lessor", "Monthly", "SL rent exp.", "Deferred rent", "Commitment"];

export function buildFileWorkpapers(input: FileWorkpaperInput): Workpaper[] {
  const meta: WorkpaperMeta = { clientName: input.clientName, fiscalYearEnd: input.fiscalYearEnd };
  return input.loans
    .map((loan) => buildLoanWorkpaper(loan, meta))
    .filter((wp): wp is Workpaper => wp != null);
}

function renderLeadSheetPdf(doc: jsPDF, input: FileWorkpaperInput, lead: ReturnType<typeof buildLeadSheet>): void {
  doc.setFontSize(16);
  doc.text(`${input.clientName} — Debt & Lease Lead Sheet`, 14, 18);
  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text(`Year ended ${lead.fyeLabel}`, 14, 25);
  let y = 30;
  if (lead.debtRows.length > 0) {
    autoTable(doc, {
      startY: y,
      head: [DEBT_LEAD_HEAD],
      body: lead.debtRows.map((r) => r.map(String)),
      foot: [
        lead.debtTotals.map(String),
        ...lead.debtBreakdownRows.map((r) => r.map(String)),
      ],
      theme: "grid",
      headStyles: { fillColor: HEAD_COLOR, fontSize: 8 },
      bodyStyles: { fontSize: 8 },
      footStyles: { fontSize: 8 },
      margin: { left: 14, right: 14 },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
    for (const note of lead.debtNotes) {
      doc.setFontSize(8);
      doc.setTextColor(150, 30, 30);
      const wrapped = doc.splitTextToSize(note, 268);
      doc.text(wrapped, 14, y);
      y += wrapped.length * 4 + 4;
      doc.setTextColor(0);
    }
  }
  if (lead.operatingRows.length > 0) {
    doc.setFontSize(11);
    doc.setTextColor(0);
    doc.text("Operating Leases", 14, y);
    autoTable(doc, {
      startY: y + 2,
      head: [OP_LEAD_HEAD],
      body: lead.operatingRows.map((r) => r.map(String)),
      foot: lead.operatingTotals ? [lead.operatingTotals.map(String)] : undefined,
      theme: "grid",
      headStyles: { fillColor: HEAD_COLOR, fontSize: 8 },
      bodyStyles: { fontSize: 8 },
      margin: { left: 14, right: 14 },
    });
  }
}

export function exportFileWorkpapersPdf(input: FileWorkpaperInput): void {
  const workpapers = buildFileWorkpapers(input);
  if (workpapers.length === 0) return;
  const lead = buildLeadSheet(input, workpapers);
  const doc = new jsPDF({ orientation: "landscape" });
  renderLeadSheetPdf(doc, input, lead);

  // Individual workpapers follow in portrait-equivalent layout on new pages.
  for (const wp of workpapers) {
    renderWorkpaperPdf(doc, wp, true);
  }

  doc.save(`${input.clientName}_Debt_Lease_Workpapers.pdf`);
}

export function exportFileLeadSheetPdf(input: FileWorkpaperInput): void {
  const workpapers = buildFileWorkpapers(input);
  if (workpapers.length === 0) return;
  const lead = buildLeadSheet(input, workpapers);
  const doc = new jsPDF({ orientation: "landscape" });
  renderLeadSheetPdf(doc, input, lead);
  doc.save(`${input.clientName}_Debt_Lease_Summary.pdf`);
}

function buildLeadSheetWs(input: FileWorkpaperInput, lead: ReturnType<typeof buildLeadSheet>): XLSX.WorkSheet {
  const leadAoa: (string | number)[][] = [
    [`${input.clientName} — Debt & Lease Lead Sheet`],
    [`Year ended ${lead.fyeLabel}`],
    [],
  ];
  if (lead.debtRows.length > 0) {
    leadAoa.push(
      ["Loans & Capital Leases"],
      DEBT_LEAD_HEAD,
      ...lead.debtRows,
      lead.debtTotals,
      ...lead.debtBreakdownRows,
      ...lead.debtNotes.map((n) => [n]),
      [],
    );
  }
  if (lead.operatingRows.length > 0) {
    leadAoa.push(["Operating Leases"], OP_LEAD_HEAD, ...lead.operatingRows);
    if (lead.operatingTotals) leadAoa.push(lead.operatingTotals);
  }
  const leadWs = XLSX.utils.aoa_to_sheet(leadAoa);
  leadWs["!cols"] = [{ wch: 28 }, { wch: 16 }, { wch: 10 }, { wch: 20 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
  return leadWs;
}

export function exportFileWorkpapersXlsx(input: FileWorkpaperInput): void {
  const workpapers = buildFileWorkpapers(input);
  if (workpapers.length === 0) return;
  const lead = buildLeadSheet(input, workpapers);
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();
  XLSX.utils.book_append_sheet(wb, buildLeadSheetWs(input, lead), usedSheetNameSafe("Lead Sheet", used));

  for (const wp of workpapers) {
    const ws = XLSX.utils.aoa_to_sheet(sectionsToAoa(wp));
    ws["!cols"] = [{ wch: 50 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(wb, ws, usedSheetNameSafe(wp.loanName, used));
    if (wp.schedule && wp.schedule.length > 0) {
      XLSX.utils.book_append_sheet(
        wb,
        scheduleSheet(wp.schedule),
        usedSheetNameSafe(`${wp.loanName} Sched`, used),
      );
    }
  }

  XLSX.writeFile(wb, `${input.clientName}_Debt_Lease_Workpapers.xlsx`);
}

export function exportFileLeadSheetXlsx(input: FileWorkpaperInput): void {
  const workpapers = buildFileWorkpapers(input);
  if (workpapers.length === 0) return;
  const lead = buildLeadSheet(input, workpapers);
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();
  XLSX.utils.book_append_sheet(wb, buildLeadSheetWs(input, lead), usedSheetNameSafe("Lead Sheet", used));
  XLSX.writeFile(wb, `${input.clientName}_Debt_Lease_Summary.xlsx`);
}
