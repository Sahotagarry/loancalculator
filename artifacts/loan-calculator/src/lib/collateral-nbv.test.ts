import { describe, it, expect } from "vitest";
import { computeCollateralNbv, buildAssetDepreciationSchedule, type CollateralFields } from "./aspe-utils";

// December 31 fiscal year end used across the cases.
const FYE_MONTH = 11;
const FYE_DAY = 31;
const reportYearEnd = (year: number) => new Date(year, FYE_MONTH, FYE_DAY);

describe("computeCollateralNbv", () => {
  it("returns null when no collateral type is set", () => {
    expect(
      computeCollateralNbv({} as CollateralFields, reportYearEnd(2024), FYE_MONTH, FYE_DAY),
    ).toBeNull();
  });

  it("carries land at cost without depreciating it", () => {
    const c: CollateralFields = { collateralType: "land", collateralLandCost: 500000 };
    expect(computeCollateralNbv(c, reportYearEnd(2024), FYE_MONTH, FYE_DAY)).toBeCloseTo(
      500000,
      2,
    );
  });

  it("depreciates equipment straight-line over its useful life", () => {
    const c: CollateralFields = {
      collateralType: "equipment",
      collateralDepreciableCost: 100000,
      collateralInServiceDate: "2020-01-01",
      collateralMethod: "straight_line",
      collateralUsefulLifeYears: 10,
      collateralSalvageValue: 0,
    };
    // 5 full fiscal years at 10,000/yr => NBV 50,000.
    expect(computeCollateralNbv(c, reportYearEnd(2024), FYE_MONTH, FYE_DAY)).toBeCloseTo(
      50000,
      2,
    );
  });

  it("prorates the acquisition fiscal year by months held", () => {
    const c: CollateralFields = {
      collateralType: "equipment",
      collateralDepreciableCost: 100000,
      collateralInServiceDate: "2020-10-01",
      collateralMethod: "straight_line",
      collateralUsefulLifeYears: 10,
      collateralSalvageValue: 0,
    };
    // Acq year: Oct-Dec = 3 months = 0.25yr; 2021-2024 full => 4.25yr * 10,000 = 42,500.
    expect(computeCollateralNbv(c, reportYearEnd(2024), FYE_MONTH, FYE_DAY)).toBeCloseTo(
      57500,
      2,
    );
  });

  it("depreciates with the declining-balance method", () => {
    const c: CollateralFields = {
      collateralType: "equipment",
      collateralDepreciableCost: 100000,
      collateralInServiceDate: "2020-01-01",
      collateralMethod: "declining_balance",
      collateralDecliningRate: 20,
      collateralSalvageValue: 0,
    };
    // 100000 -> 80000 -> 64000 -> 51200 over FY2020..FY2022.
    expect(computeCollateralNbv(c, reportYearEnd(2022), FYE_MONTH, FYE_DAY)).toBeCloseTo(
      51200,
      2,
    );
  });

  it("never depreciates below the salvage value", () => {
    const c: CollateralFields = {
      collateralType: "equipment",
      collateralDepreciableCost: 100000,
      collateralInServiceDate: "2010-01-01",
      collateralMethod: "straight_line",
      collateralUsefulLifeYears: 10,
      collateralSalvageValue: 30000,
    };
    // Fully depreciated after 10 years but floored at the 30,000 salvage value.
    expect(computeCollateralNbv(c, reportYearEnd(2024), FYE_MONTH, FYE_DAY)).toBeCloseTo(
      30000,
      2,
    );
  });

  it("adds non-depreciating land to the depreciated building for land_and_building", () => {
    const c: CollateralFields = {
      collateralType: "land_and_building",
      collateralLandCost: 200000,
      collateralDepreciableCost: 100000,
      collateralInServiceDate: "2020-01-01",
      collateralMethod: "straight_line",
      collateralUsefulLifeYears: 10,
      collateralSalvageValue: 0,
    };
    // Building NBV 50,000 + land 200,000 = 250,000.
    expect(computeCollateralNbv(c, reportYearEnd(2024), FYE_MONTH, FYE_DAY)).toBeCloseTo(
      250000,
      2,
    );
  });

  it("does not depreciate assets placed in service after the reporting year end", () => {
    const c: CollateralFields = {
      collateralType: "equipment",
      collateralDepreciableCost: 100000,
      collateralInServiceDate: "2025-01-01",
      collateralMethod: "straight_line",
      collateralUsefulLifeYears: 10,
      collateralSalvageValue: 0,
    };
    expect(computeCollateralNbv(c, reportYearEnd(2024), FYE_MONTH, FYE_DAY)).toBeCloseTo(
      100000,
      2,
    );
  });
});

describe("buildAssetDepreciationSchedule", () => {
  it("ties each closing NBV to computeCollateralNbv at that year end", () => {
    const c: CollateralFields = {
      collateralType: "equipment",
      collateralDepreciableCost: 100000,
      collateralInServiceDate: "2020-04-15",
      collateralMethod: "declining_balance",
      collateralDecliningRate: 20,
      collateralSalvageValue: 5000,
    };
    const rows = buildAssetDepreciationSchedule(
      100000, "2020-04-15", "declining_balance", null, 20, 5000, FYE_MONTH, FYE_DAY,
    );
    expect(rows.length).toBeGreaterThan(3);
    for (const row of rows.slice(0, 5)) {
      expect(row.closingNbv).toBeCloseTo(
        computeCollateralNbv(c, reportYearEnd(row.fiscalYear), FYE_MONTH, FYE_DAY)!,
        6,
      );
    }
  });

  it("fully amortizes straight-line down to salvage with acquisition-year proration", () => {
    const rows = buildAssetDepreciationSchedule(
      100000, "2020-10-01", "straight_line", 10, 0, 10000, FYE_MONTH, FYE_DAY,
    );
    // 3 months held in 2020 => 2,250 (9,000/yr base of 90,000/10)
    expect(rows[0].fiscalYear).toBe(2020);
    expect(rows[0].depreciation).toBeCloseTo(2250, 2);
    const last = rows[rows.length - 1];
    expect(last.closingNbv).toBeCloseTo(10000, 2);
    expect(last.accumulated).toBeCloseTo(90000, 2);
    // opening/closing chain is consistent
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].openingNbv).toBeCloseTo(rows[i - 1].closingNbv, 6);
    }
  });

  it("returns an empty schedule when inputs cannot depreciate", () => {
    expect(
      buildAssetDepreciationSchedule(0, "2020-01-01", "straight_line", 10, 0, 0, FYE_MONTH, FYE_DAY),
    ).toEqual([]);
    expect(
      buildAssetDepreciationSchedule(100000, null, "straight_line", 10, 0, 0, FYE_MONTH, FYE_DAY),
    ).toEqual([]);
    expect(
      buildAssetDepreciationSchedule(100000, "2020-01-01", "straight_line", 0, 0, 0, FYE_MONTH, FYE_DAY),
    ).toEqual([]);
  });
});
