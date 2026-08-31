import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { saveAs } from "file-saver";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { DisclosureAmount, DisclosureModel } from "./disclosure-model";

export interface DisclosureRenderSection {
  title: string;
  columns: string[];
  rows: string[][];
  notes?: string[];
}

export interface DisclosureRenderPlan {
  title: string;
  subtitle: string;
  evidenceLine: string;
  sections: DisclosureRenderSection[];
}

const money = (value: number) =>
  new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", minimumFractionDigits: 2 }).format(value);

const amountRow = (label: string, value: DisclosureAmount, comparative: boolean): string[] =>
  comparative ? [label, money(value.current), value.comparative == null ? "—" : money(value.comparative)] : [label, money(value.current)];

/** Shared deterministic renderer intermediate; DOCX and PDF use these exact rows. */
export function buildDisclosureRenderPlan(model: DisclosureModel): DisclosureRenderPlan {
  const comparative = model.comparativeFiscalYearEnd != null;
  const amountColumns = comparative
    ? ["Item", model.reportingFiscalYearEnd, model.comparativeFiscalYearEnd!]
    : ["Item", model.reportingFiscalYearEnd];
  const evidenceParts = [
    `Model ${model.modelVersion}`,
    `Fingerprint ${model.modelFingerprint}`,
    `Calculation ${model.evidence.calculationVersions.join(", ") || "not supplied"}`,
    `Revisions ${model.evidence.revisionFingerprints.join(", ") || "not supplied"}`,
    `Event sets ${model.evidence.eventSetFingerprints.join(", ") || "none"}`,
    `Rate sets ${model.evidence.rateSetIds.join(", ") || "none"}`,
    `Inputs ${model.evidence.inputFingerprints.join(", ") || "none"}`,
  ];
  const sections: DisclosureRenderSection[] = [
    {
      title: "Balance Sheet Presentation",
      columns: amountColumns,
      rows: [
        amountRow("Loans — current", model.balanceSheet.loans.current, comparative),
        amountRow("Loans — non-current", model.balanceSheet.loans.nonCurrent, comparative),
        amountRow("Loans — total", model.balanceSheet.loans.total, comparative),
        amountRow("Capital leases — current", model.balanceSheet.capitalLeases.current, comparative),
        amountRow("Capital leases — non-current", model.balanceSheet.capitalLeases.nonCurrent, comparative),
        amountRow("Capital leases — total", model.balanceSheet.capitalLeases.total, comparative),
        amountRow("Total debt — current", model.balanceSheet.totalDebt.current, comparative),
        amountRow("Total debt — non-current", model.balanceSheet.totalDebt.nonCurrent, comparative),
        amountRow("Total debt", model.balanceSheet.totalDebt.total, comparative),
        amountRow("Operating lease commitments", model.balanceSheet.operatingLeases.commitments, comparative),
        amountRow("Deferred rent asset", model.balanceSheet.operatingLeases.deferredRentAsset, comparative),
        amountRow("Deferred rent liability", model.balanceSheet.operatingLeases.deferredRentLiability, comparative),
        amountRow("Lease incentive liability — current", model.balanceSheet.operatingLeases.incentiveCurrent, comparative),
        amountRow("Lease incentive liability — non-current", model.balanceSheet.operatingLeases.incentiveNonCurrent, comparative),
      ],
    },
    {
      title: "Statement of Operations",
      columns: amountColumns,
      rows: [
        amountRow("Interest expense", model.operations.interestExpense, comparative),
        amountRow("Straight-line rent expense", model.operations.straightLineRentExpense, comparative),
        amountRow("Lease inducement amortization", model.operations.leaseInducementAmortization, comparative),
      ],
    },
    {
      title: "Cash Flows — Relevant Items",
      columns: amountColumns,
      rows: [
        amountRow("Proceeds from long-term debt", model.cashFlows.loanProceeds, comparative),
        amountRow("Repayment of long-term debt", model.cashFlows.loanPrincipalRepayments, comparative),
        amountRow("Capital lease principal repayments", model.cashFlows.capitalLeasePrincipalRepayments, comparative),
        amountRow("Operating lease payments", model.cashFlows.operatingLeasePayments, comparative),
        amountRow("Lease inducements received in cash", model.cashFlows.cashLeaseInducements, comparative),
      ],
      notes: ["Interest paid is not presented in this cash-flow disclosure."],
    },
    {
      title: "Non-cash Transactions",
      columns: amountColumns,
      rows: [amountRow("Non-cash lease inducements", model.nonCashItems.leaseInducements, comparative)],
    },
    {
      title: "Contractual Maturities",
      columns: ["Fiscal year", "Loans", "Capital leases", "Operating leases", "Total"],
      rows: model.maturities.map((row) => [
        row.label, money(row.loans), money(row.capitalLeases), money(row.operatingLeases), money(row.total),
      ]),
      notes: ["Loan and capital-lease maturities include explicit balloons and contractual residual balances due at maturity."],
    },
    {
      title: "Security & Covenants",
      columns: ["Agreement", "Counterparty", "Security", "Covenants / status"],
      rows: model.securityAndCovenants.map((item) => [
        item.agreementName,
        item.counterparty ?? "—",
        item.security.join("; ") || "—",
        [item.covenant, item.covenantViolation ? "Covenant violation at reporting date" : null].filter(Boolean).join("; ") || "—",
      ]),
    },
    {
      title: "Agreement Transitions",
      columns: ["Successor", "Predecessor", "Effective date", "Treatment", "Presentation"],
      rows: model.transitions.map((item) => [
        item.successorAgreementId, item.predecessorAgreementId, item.effectiveDate, item.treatment,
        "Single accounting timeline; predecessor and successor are not double counted",
      ]),
    },
  ];
  return {
    title: `${model.clientName} — Presentation & Disclosure`,
    subtitle: `${model.scopeStatement} Reporting FYE: ${model.reportingFiscalYearEnd}`,
    evidenceLine: evidenceParts.join(" · "),
    sections,
  };
}

export function serializeDisclosureRenderPlan(model: DisclosureModel): string {
  return JSON.stringify(buildDisclosureRenderPlan(model));
}

/** Named parity hooks let tests/UI integrations compare formats without parsing binaries. */
export const buildPresentationDisclosureDocxPlan = (model: DisclosureModel): DisclosureRenderPlan =>
  buildDisclosureRenderPlan(model);
export const buildPresentationDisclosurePdfPlan = (model: DisclosureModel): DisclosureRenderPlan =>
  buildDisclosureRenderPlan(model);

const docxTable = (section: DisclosureRenderSection) => new Table({
  width: { size: 100, type: WidthType.PERCENTAGE },
  rows: [
    new TableRow({ children: section.columns.map((cell) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: cell, bold: true })] })] })) }),
    ...section.rows.map((row) => new TableRow({ children: row.map((cell) => new TableCell({ children: [new Paragraph(cell)] })) })),
  ],
});

export async function renderPresentationDisclosureDocx(model: DisclosureModel): Promise<Blob> {
  const plan = buildPresentationDisclosureDocxPlan(model);
  const children = [
    new Paragraph({ text: plan.title, heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER }),
    new Paragraph(plan.subtitle),
    new Paragraph({ children: [new TextRun({ text: plan.evidenceLine, italics: true })] }),
    ...plan.sections.flatMap((section) => [
      new Paragraph({ text: section.title, heading: HeadingLevel.HEADING_1 }),
      docxTable(section),
      ...(section.notes ?? []).map((note) => new Paragraph({ children: [new TextRun({ text: note, italics: true })] })),
    ]),
  ];
  return Packer.toBlob(new Document({ sections: [{ children }] }));
}

export async function downloadPresentationDisclosureDocx(model: DisclosureModel): Promise<void> {
  saveAs(await renderPresentationDisclosureDocx(model), `${model.clientName}_Presentation_Disclosure_${model.reportingFiscalYearEnd}.docx`);
}

export function renderPresentationDisclosurePdf(model: DisclosureModel): jsPDF {
  const plan = buildPresentationDisclosurePdfPlan(model);
  const doc = new jsPDF();
  doc.setFontSize(16);
  doc.text(plan.title, 14, 18);
  doc.setFontSize(9);
  doc.text(doc.splitTextToSize(plan.subtitle, 180), 14, 25);
  doc.setFontSize(7);
  doc.text(doc.splitTextToSize(plan.evidenceLine, 180), 14, 34);
  let startY = 44;
  for (const section of plan.sections) {
    autoTable(doc, {
      startY,
      head: [[section.title], section.columns],
      body: section.rows,
      theme: "grid",
      headStyles: { fillColor: [24, 95, 45] },
      didDrawPage: () => undefined,
    });
    const finalY = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? startY;
    if (section.notes?.length) {
      doc.setFontSize(7);
      doc.text(doc.splitTextToSize(section.notes.join(" "), 180), 14, finalY + 4);
      startY = finalY + 10;
    } else {
      startY = finalY + 6;
    }
  }
  return doc;
}

export function downloadPresentationDisclosurePdf(model: DisclosureModel): void {
  renderPresentationDisclosurePdf(model).save(`${model.clientName}_Presentation_Disclosure_${model.reportingFiscalYearEnd}.pdf`);
}
