import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { format } from "date-fns";
import { formatCurrency } from "@/lib/format";

export interface ScheduleRow {
  month: number;
  date: Date;
  payment: number;
  principal: number;
  interest: number;
  totalInterest: number;
  balance: number;
  isInterestOnly: boolean;
}

export interface YearlyTotal {
  label: string;
  principal: number;
  interest: number;
  opening?: number;
  closing?: number;
}

export interface LoanExportMeta {
  name: string;
  principal: number;
  interestRate: number;
  termYears: number;
}

export function exportScheduleXlsx(loanName: string, schedule: ScheduleRow[]): void {
  const ws = XLSX.utils.json_to_sheet(
    schedule.map((row) => ({
      Period: row.month,
      Date: format(row.date, "MMMM d, yyyy"),
      Payment: row.payment.toFixed(2),
      Principal: row.principal.toFixed(2),
      Interest: row.interest.toFixed(2),
      "Total Interest": row.totalInterest.toFixed(2),
      Balance: row.balance.toFixed(2),
      Type: row.isInterestOnly ? "Interest Only" : "Standard",
    }))
  );
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Schedule");
  XLSX.writeFile(wb, `${loanName}_Schedule.xlsx`);
}

export function exportSchedulePdf(loan: LoanExportMeta, schedule: ScheduleRow[]): void {
  const doc = new jsPDF();
  doc.setFontSize(18);
  doc.text(loan.name, 14, 22);
  doc.setFontSize(11);
  doc.text(
    `Principal: ${formatCurrency(loan.principal)} | Rate: ${loan.interestRate}% | Term: ${loan.termYears} yrs`,
    14,
    30,
  );
  autoTable(doc, {
    startY: 40,
    head: [["Period", "Date", "Payment", "Principal", "Interest", "Balance"]],
    body: schedule.map((row) => [
      row.month,
      format(row.date, "MMMM d, yyyy"),
      formatCurrency(row.payment),
      formatCurrency(row.principal),
      formatCurrency(row.interest),
      formatCurrency(row.balance),
    ]),
    theme: "striped",
    headStyles: { fillColor: [24, 95, 45] },
  });
  doc.save(`${loan.name}_Schedule.pdf`);
}

export function exportAnnualXlsx(loanName: string, yearlyTotals: YearlyTotal[]): void {
  const ws = XLSX.utils.json_to_sheet(
    yearlyTotals.map((row) => ({
      "Fiscal Year": row.label,
      "Opening Balance": row.opening != null ? row.opening.toFixed(2) : "",
      Principal: row.principal.toFixed(2),
      Interest: row.interest.toFixed(2),
      Total: (row.principal + row.interest).toFixed(2),
      "Closing Balance": row.closing != null ? row.closing.toFixed(2) : "",
    }))
  );
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Annual");
  XLSX.writeFile(wb, `${loanName}_Annual.xlsx`);
}

export function exportAnnualPdf(loanName: string, yearlyTotals: YearlyTotal[]): void {
  const doc = new jsPDF();
  doc.setFontSize(18);
  doc.text(`${loanName} - Annual Breakdown`, 14, 22);
  autoTable(doc, {
    startY: 40,
    head: [["Fiscal Year", "Opening Balance", "Principal", "Interest", "Total", "Closing Balance"]],
    body: yearlyTotals.map((row) => [
      row.label,
      row.opening != null ? formatCurrency(row.opening) : "-",
      formatCurrency(row.principal),
      formatCurrency(row.interest),
      formatCurrency(row.principal + row.interest),
      row.closing != null ? formatCurrency(row.closing) : "-",
    ]),
    foot: [
      [
        "Total",
        yearlyTotals.length > 0 && yearlyTotals[0].opening != null
          ? formatCurrency(yearlyTotals[0].opening)
          : "-",
        formatCurrency(yearlyTotals.reduce((s, r) => s + r.principal, 0)),
        formatCurrency(yearlyTotals.reduce((s, r) => s + r.interest, 0)),
        formatCurrency(yearlyTotals.reduce((s, r) => s + r.principal + r.interest, 0)),
        yearlyTotals.length > 0 && yearlyTotals[yearlyTotals.length - 1].closing != null
          ? formatCurrency(yearlyTotals[yearlyTotals.length - 1].closing!)
          : "-",
      ],
    ],
    theme: "grid",
    headStyles: { fillColor: [24, 95, 45] },
  });
  doc.save(`${loanName}_Annual.pdf`);
}
