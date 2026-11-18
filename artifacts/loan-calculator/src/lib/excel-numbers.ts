import type { WorkBook } from "xlsx";

/**
 * PDF and Excel share presentation rows. Restore strictly formatted amounts
 * at the Excel boundary, without coercing dates, identifiers, or prose.
 */
export function applyExcelNumberTypes(workbook: WorkBook): void {
  for (const sheet of Object.values(workbook.Sheets)) {
    for (const [address, cell] of Object.entries(sheet)) {
      if (address.startsWith("!") || cell.t !== "s" || typeof cell.v !== "string") continue;
      const text = cell.v;
      const currency = /^-?\$(?:\d+|\d{1,3}(?:,\d{3})+)\.\d{2}$/.test(text);
      const percent = /^-?\d+\.\d+%$/.test(text);
      const decimal = /^-?(?:0|[1-9]\d*)\.\d{2}$/.test(text);
      if (!currency && !percent && !decimal) continue;
      const value = Number(text.replace(/[$,%]/g, "")) / (percent ? 100 : 1);
      if (!Number.isFinite(value)) continue;
      cell.t = "n";
      cell.v = value;
      cell.z = currency ? '"$"#,##0.00;-"$"#,##0.00'
        : percent ? `0.${"0".repeat(text.split(".")[1].length - 1)}%`
        : "#,##0.00";
      delete cell.w;
    }
  }
}
