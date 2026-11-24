import type { AssessmentAnswers } from "@/components/capital-lease-assessment";

export const ASSET_TYPE_LIVES: Record<string, number> = {
  vehicle_light: 8, vehicle_heavy: 12, equipment_manufacturing: 15, equipment_office: 10,
  it_hardware: 5, it_software: 3, furniture: 15, building_leasehold: 20, building_industrial: 40,
  office_commercial: 40, land_lease: 99, aircraft: 25, rail_equipment: 30, medical: 12, other: 0,
};

export const ASSET_TYPE_OPTIONS: Array<[string, string]> = [
  ["vehicle", "Vehicle (confirm useful life)"],
  ["vehicle_light", "Light Vehicle / Car (~8 years)"],
  ["vehicle_heavy", "Heavy Truck / Fleet (~12 years)"],
  ["equipment", "Equipment (confirm useful life)"],
  ["equipment_manufacturing", "Manufacturing Equipment (~15 years)"],
  ["equipment_office", "Office Equipment (~10 years)"],
  ["it_hardware", "IT / Computer Hardware (~5 years)"],
  ["it_software", "Software / SaaS License (~3 years)"],
  ["furniture", "Office Furniture / Fixtures (~15 years)"],
  ["building_leasehold", "Leasehold Improvements (~20 years)"],
  ["building_industrial", "Industrial Building (~40 years)"],
  ["office_commercial", "Office / Commercial Property (~40 years)"],
  ["land_lease", "Land Lease / Ground Lease (~99 years)"],
  ["aircraft", "Aircraft (~25 years)"],
  ["rail_equipment", "Rail / Rolling Stock (~30 years)"],
  ["medical", "Medical Equipment (~12 years)"],
  ["other", "Other / Custom (enter manually)"],
];

export type UsefulLifeSource = "existing" | "asset_specific" | "category" | "manual";
const positive = (value: number | null | undefined): value is number =>
  value != null && Number.isFinite(value) && value > 0;

/** Never replace a documented, saved or entered life with a suggestion. */
export function chooseUsefulLife(existing: number, suggested: number | null | undefined, category: string): {
  years: number; source: UsefulLifeSource;
} {
  if (positive(existing)) return { years: existing, source: "existing" };
  if (positive(suggested)) return { years: suggested, source: "asset_specific" };
  if (positive(ASSET_TYPE_LIVES[category])) return { years: ASSET_TYPE_LIVES[category], source: "category" };
  return { years: 0, source: "manual" };
}

export function withUsefulLife(a: AssessmentAnswers, years: number, assetType = a.assetType): AssessmentAnswers {
  const changed = a.economicLife !== years || a.assetType !== assetType;
  return { ...a, assetType, economicLife: years,
    leaseTermPct: positive(years) && a.termMonths > 0 ? Math.round(a.termMonths / (years * 12) * 1000) / 10 : 0,
    ...(changed && a.leaseEndingTerms ? { leaseEndingTerms: { ...a.leaseEndingTerms, status: "draft" as const } } : {}),
  };
}

/** Only an explicit choice in the fallback picker replaces the current useful life. */
export function applyUsefulLifeCategory(a: AssessmentAnswers, category: string): AssessmentAnswers {
  return withUsefulLife(a, positive(ASSET_TYPE_LIVES[category]) ? ASSET_TYPE_LIVES[category] : a.economicLife, category);
}
