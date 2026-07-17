import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, date, numeric, boolean, integer, doublePrecision, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { filesTable } from "./files";

export const loansTable = pgTable("loans", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  fileId: varchar("file_id").notNull().references(() => filesTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  // Counterparty (lender / lessor / landlord)
  counterparty: text("counterparty"),
  // Loan type
  isCapitalLease: boolean("is_capital_lease").notNull().default(false),
  // Loan parameters
  principal: numeric("principal", { precision: 15, scale: 2 }).notNull(),
  // Lump-sum paid upfront; the amortized (financed) balance is principal - downPayment
  downPayment: numeric("down_payment", { precision: 15, scale: 2 }).notNull().default("0"),
  interestRate: numeric("interest_rate", { precision: 5, scale: 2 }).notNull(),
  amortizationYears: doublePrecision("amortization_years").notNull(),
  termYears: doublePrecision("term_years").notNull(),
  startDate: date("start_date", { mode: "string" }).notNull(),
  fiscalYearEnd: date("fiscal_year_end", { mode: "string" }).notNull(),
  paymentFrequency: text("payment_frequency").notNull().default("monthly"),
  // IO options
  ioMonths: integer("io_months").notNull().default(0),
  specificIoMonths: text("specific_io_months").notNull().default(""), // comma-separated 0-11
  // Balloon
  balloonPayment: numeric("balloon_payment", { precision: 15, scale: 2 }).notNull().default("0"),
  // Capital lease criteria
  transferOfOwnership: boolean("transfer_of_ownership").notNull().default(false),
  bargainPurchaseOption: boolean("bargain_purchase_option").notNull().default(false),
  leaseTermPct: numeric("lease_term_pct", { precision: 5, scale: 2 }).notNull().default("0"),
  pvPctFairValue: numeric("pv_pct_fair_value", { precision: 5, scale: 2 }).notNull().default("0"),
  fairValue: numeric("fair_value", { precision: 15, scale: 2 }),
  specializedAsset: boolean("specialized_asset").notNull().default(false),
  capitalLeaseRationale: text("capital_lease_rationale"),
  // Lease payment (stored for both capital and operating leases)
  monthlyPayment: numeric("monthly_payment", { precision: 15, scale: 2 }),
  paymentOverride: numeric("payment_override", { precision: 15, scale: 2 }),
  termMonths: integer("term_months"),
  // Asset tracking
  assetDescription: text("asset_description"),
  assetCost: numeric("asset_cost", { precision: 15, scale: 2 }),
  assetUsefulLife: integer("asset_useful_life"),
  // Security & collateral
  // Selected security clauses (curated toggles + custom entries)
  securityClauses: jsonb("security_clauses").$type<string[]>(),
  // One collateral asset per loan. "land_and_building" tracks both a
  // non-amortized land component and an amortized building component, disclosed
  // as a combined net book value.
  collateralType: text("collateral_type"), // equipment | building | land | land_and_building
  collateralDescription: text("collateral_description"),
  // Amortized component cost (equipment / building / building portion)
  collateralDepreciableCost: numeric("collateral_depreciable_cost", { precision: 15, scale: 2 }),
  // Non-amortized component cost (land / land portion)
  collateralLandCost: numeric("collateral_land_cost", { precision: 15, scale: 2 }),
  collateralInServiceDate: date("collateral_in_service_date", { mode: "string" }),
  collateralMethod: text("collateral_method"), // straight_line | declining_balance
  collateralUsefulLifeYears: integer("collateral_useful_life_years"),
  collateralDecliningRate: numeric("collateral_declining_rate", { precision: 5, scale: 2 }),
  collateralSalvageValue: numeric("collateral_salvage_value", { precision: 15, scale: 2 }),
  // Straight-line lease adjustments (operating leases only)
  isOfficeProperty: boolean("is_office_property").notNull().default(false),
  freeRentMonths: integer("free_rent_months").notNull().default(0),
  rentEscalationRate: numeric("rent_escalation_rate", { precision: 5, scale: 2 }).notNull().default("0"),
  // Stepped $ rent schedule (office leases): [{ fromYear, toYear, monthlyRent }]
  // Lease years are 1-based and inclusive. When present, overrides rentEscalationRate.
  rentSteps: jsonb("rent_steps").$type<Array<{ fromYear: number; toYear: number; monthlyRent: number }> | null>(),
  tenantImprovementAllowance: numeric("tenant_improvement_allowance", { precision: 15, scale: 2 }).notNull().default("0"),
  // Estimated monthly CAM / operating costs (office & industrial property leases).
  // Executory costs — excluded from minimum lease payments, disclosed separately.
  camMonthly: numeric("cam_monthly", { precision: 15, scale: 2 }),
  otherInducements: numeric("other_inducements", { precision: 15, scale: 2 }).notNull().default("0"),
  // Whether lease inducements were received in cash (financing inflow) vs non-cash (e.g. landlord-provided TIs)
  inducementReceivedInCash: boolean("inducement_received_in_cash").notNull().default(false),
  // Financial covenant violation — when true the lender can demand repayment,
  // so the entire obligation is classified as current (ASPE 1510).
  covenantViolation: boolean("covenant_violation").notNull().default(false),
  // Roll-forward tracking
  rolledFromId: varchar("rolled_from_id"),
  // ASPE 3856 fair value rate adjustment
  fvRate: numeric("fv_rate", { precision: 5, scale: 2 }),
  // Three-way decision: use_fv | trivial | immaterial
  fvDecision: text("fv_decision"),
  fvDecisionNote: text("fv_decision_note"),
  // Source document (PDF import) — Azure Blob Storage blob name + original filename
  sourceDocumentBlob: text("source_document_blob"),
  sourceDocumentName: text("source_document_name"),
  // Review diagnostics dismissed by the user as not applicable (finding ids)
  dismissedFindings: jsonb("dismissed_findings").$type<string[]>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  // Soft delete: when set, the loan/lease is in the trash (hidden but recoverable)
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const insertLoanSchema = createInsertSchema(loansTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
});

export type InsertLoan = z.infer<typeof insertLoanSchema>;
export type Loan = typeof loansTable.$inferSelect;
