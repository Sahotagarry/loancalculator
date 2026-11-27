import { expect, it } from "vitest";
import * as XLSX from "xlsx";
import { buildFileWorkbook } from "./file-report-workbook";
import { file } from "./excel-example-data";
import { buildAgreementWorkbook } from "./agreement-workbook";
import { buildFileWorkpapers } from "./workpaper-export";
import { amount, column, newBook, reportTable } from "./excel-report-style";
import type { Workbook } from "exceljs";

// These semantic checks complement parsing: tolerant readers and the Open XML
// schema validator accept ExcelJS empty tables that desktop Excel may reject.
async function checkWorkbook(wb: Workbook) {
  const book = XLSX.read(await wb.xlsx.writeBuffer(), { type: "buffer", bookFiles: true }) as XLSX.WorkBook & {
    files: Record<string, { content: Uint8Array }>;
  };
  const names: string[] = [];
  for (const [path, entry] of Object.entries(book.files)) {
    if (!/^xl\/tables\/table\d+\.xml$/.test(path)) continue;
    const xml = new TextDecoder().decode(entry.content);
    const name = /<table\b[^>]*\bdisplayName="([^"]+)"/.exec(xml)![1];
    names.push(name.toLowerCase());
    const columns = [...xml.matchAll(/<tableColumn\b[^>]*\bname="([^"]*)"/g)].map(m => m[1].toLowerCase());
    expect(new Set(columns).size, `${path}: ${xml}`).toBe(columns.length);
    expect(xml, path).not.toMatch(/(?:NaN|Infinity)/);
    const ref = /<table\b[^>]*\bref="([^"]+)"/.exec(xml)![1];
    const range = XLSX.utils.decode_range(ref);
    expect(range.e.c - range.s.c + 1, path).toBe(columns.length);
    const totals = Number(/totalsRowCount="(\d+)"/.exec(xml)?.[1] ?? 0);
    expect(range.e.r - range.s.r - totals, `Empty structured table: ${path}`).toBeGreaterThan(0);
  }
  expect(new Set(names).size).toBe(names.length);
  const workbookXml = new TextDecoder().decode(book.files["xl/workbook.xml"].content);
  for (const match of workbookXml.matchAll(/<definedName\b[^>]*>(.*?)<\/definedName>/g)) {
    expect(match[1].replace(/&apos;/g, "'")).toMatch(/^'[^']+'!\$1:\$3$/);
  }
  return book;
}

it.each([
  ["mixed agreements", file],
  ["capital leases only", { ...file, loans: [file.loans[1], { ...file.loans[1], id: "second-lease" }] }],
  ["operating leases only", { ...file, loans: [file.loans[2]] }],
  ["fully repaid agreements", { ...file, fiscalYearEnd: "2040-12-31" }],
  ["agreements starting after year-end", { ...file, fiscalYearEnd: "2025-12-31" }],
  ["zero-interest capital lease", { ...file, loans: [{ ...file.loans[1], interestRate: 0 }] }],
  ["many leases with difficult names", { ...file, loans: Array.from({ length: 40 }, (_, i) => ({
    ...file.loans[1], id: `stress-${i}`, name: "Lessor's / unusual [lease]: & <equipment> 🚚 ".repeat(3),
  })) }],
] as const)("writes valid table definitions for %s", async (_, input) => {
  await checkWorkbook(buildFileWorkbook(input, true)!);
});

it("writes empty repayment totals as zero cells, with no dangling table formula", async () => {
  const wb = newBook();
  const ws = wb.addWorksheet("Empty maturities");
  expect(reportTable(ws, "EmptyMaturities", 1, [column("Fiscal year", 20), amount("Principal", true)], [])).toBe(2);
  const book = await checkWorkbook(wb);
  expect(book.Sheets["Empty maturities"].A2.v).toBe("Total");
  expect(book.Sheets["Empty maturities"].B2).toMatchObject({ t: "n", v: 0 });
  expect(book.Sheets["Empty maturities"].B2.f).toBeUndefined();
});

it("also avoids empty tables in an individual repaid agreement's workpaper", async () => {
  const [wp] = buildFileWorkpapers({ ...file, fiscalYearEnd: "2040-12-31", loans: [file.loans[1]] });
  const book = await checkWorkbook(buildAgreementWorkbook(wp));
  const ws = book.Sheets.Schedule;
  const cells = Object.values(ws).filter(value => value && typeof value === "object" && "v" in value) as XLSX.CellObject[];
  expect(cells.some(c => c.v === "Total")).toBe(true);
  expect(cells.some(c => c.f?.includes("PrincipalMaturities["))).toBe(false);
});
