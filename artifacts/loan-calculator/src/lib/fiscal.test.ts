import { describe, it, expect } from "vitest";
import { getFiscalYear, getFyEndParts } from "./fiscal";

// December 31 fiscal year end.
const DEC = { month: 11, day: 31 };
// June 30 fiscal year end (non-calendar).
const JUN = { month: 5, day: 30 };

describe("getFiscalYear", () => {
  it("assigns dates on or before a Dec 31 year end to that calendar year", () => {
    expect(getFiscalYear(new Date(2024, 5, 15), DEC.month, DEC.day)).toBe(2024);
    expect(getFiscalYear(new Date(2024, 11, 31), DEC.month, DEC.day)).toBe(2024);
  });

  it("rolls into the next fiscal year for dates after a Dec 31 year end", () => {
    expect(getFiscalYear(new Date(2025, 0, 1), DEC.month, DEC.day)).toBe(2025);
  });

  it("handles a non-calendar (June 30) year end", () => {
    expect(getFiscalYear(new Date(2024, 4, 15), JUN.month, JUN.day)).toBe(2024);
    expect(getFiscalYear(new Date(2024, 5, 30), JUN.month, JUN.day)).toBe(2024);
    expect(getFiscalYear(new Date(2024, 6, 1), JUN.month, JUN.day)).toBe(2025);
  });
});

describe("getFyEndParts", () => {
  it("extracts the month and day from an ISO date string", () => {
    expect(getFyEndParts("2024-12-31")).toEqual({ month: 11, day: 31 });
    expect(getFyEndParts("2024-06-30")).toEqual({ month: 5, day: 30 });
  });
});
