import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { applyExcelNumberTypes } from "./excel-numbers";

describe("Excel numeric amounts", () => {
  it("survives an XLSX write/read with numeric amounts and display formats", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ["$12,345.67", "-$120.50", "$0.00", "1980.00", "6.2500%"],
      ["00123", "2026-01-01", "December 1, 2026", "5 years", "$500.00 / 5.00%"],
    ]), "Amounts");
    applyExcelNumberTypes(wb);
    const result = XLSX.read(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }), { cellNF: true });
    const ws = result.Sheets.Amounts;
    for (const key of ["A1", "B1", "C1", "D1", "E1"]) expect(ws[key].t).toBe("n");
    expect(ws.A1.v + ws.B1.v).toBeCloseTo(12225.17);
    expect(ws.C1.v).toBe(0);
    expect(ws.D1.v).toBe(1980);
    expect(ws.E1.v).toBe(0.0625);
    expect(ws.E1.z).toBe("0.0000%");
    for (const key of ["A2", "B2", "C2", "D2", "E2"]) expect(ws[key].t).toBe("s");
  });
});
