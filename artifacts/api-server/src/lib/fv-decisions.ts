import { and, eq, isNull } from "drizzle-orm";
import { db, loansTable } from "@workspace/db";
import { computeFvAdjustment, suggestFvDecision } from "@workspace/amortization";
import { logger } from "./logger";

/* ------------------------------------------------------------------ */
/*  Prime-rate helper (Bank of Canada Valet API)                     */
/* ------------------------------------------------------------------ */

const PRIME_CACHE = new Map<string, { primeRate: number; source: string }>();
const PRIME_CACHE_TTL_MS = 1000 * 60 * 60 * 24; // 24 hours

export async function fetchPrimeRate(dateStr: string): Promise<{ primeRate: number; source: string }> {
  // The series has no future observations; clamp to today.
  const today = new Date().toISOString().slice(0, 10);
  if (dateStr > today) dateStr = today;

  const cacheKey = dateStr;
  const cached = PRIME_CACHE.get(cacheKey);
  if (cached) return cached;

  try {
    // BoC Valet series V122495 = Chartered bank administered interest rates – prime rate.
    // Observations are not published for every calendar day, so query a
    // two-week window ending at the date and use the latest observation.
    const start = new Date(dateStr);
    start.setDate(start.getDate() - 14);
    const startStr = start.toISOString().slice(0, 10);
    const url = `https://www.bankofcanada.ca/valet/observations/V122495/json?start_date=${startStr}&end_date=${dateStr}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) throw new Error(`BoC API ${resp.status}`);
    const json = await resp.json() as Record<string, unknown>;
    const observations = (json.observations as Array<{ d: string; V122495?: { v: string } }>) ?? [];
    const obs = observations[observations.length - 1];
    if (!obs) throw new Error("No observation in window");
    const rate = parseFloat(obs.V122495?.v ?? "");
    if (Number.isNaN(rate)) throw new Error("Invalid rate value");
    const result = { primeRate: rate, source: "Bank of Canada" };
    PRIME_CACHE.set(cacheKey, result);
    return result;
  } catch (err) {
    logger.warn({ err, date: dateStr }, "Failed to fetch BoC prime rate; falling back to 7.20%");
    // Conservative fallback (historical range ~3-8%)
    return { primeRate: 7.2, source: "Fallback default" };
  }
}

/* ------------------------------------------------------------------ */
/*  FV decision auto-suggestion                                       */
/* ------------------------------------------------------------------ */

export interface FvEvalLoanInput {
  interestRate: string;
  principal: string;
  downPayment?: string | null;
  amortizationYears: number;
  termYears: number;
  startDate: string;
  ioMonths: number;
  specificIoMonths: string;
  balloonPayment: string;
  paymentFrequency: string;
  fvRate?: string | null;
  paymentOverride?: string | null;
}

export interface FvEvalFileInput {
  trivialThreshold?: string | null;
  materiality?: string | null;
}

/**
 * Compares the computed FV adjustment against the file's trivialThreshold and
 * materiality to auto-suggest a treatment decision. Returns null when the
 * loan isn't below-market-rate or when the file has no thresholds configured.
 */
export async function computeFvSuggestion(
  loan: FvEvalLoanInput,
  file: FvEvalFileInput
): Promise<{ fvDecision: "use_fv" | "trivial" | "immaterial"; fvRate: number } | null> {
  const rate = Number(loan.interestRate);
  const isBelowMarketRate = rate > 0 && rate < 3;
  if (!isBelowMarketRate) return null;

  const startDateObj = new Date(loan.startDate);
  let fvRate = loan.fvRate != null ? Number(loan.fvRate) : undefined;
  if (fvRate == null || fvRate <= 0) {
    const dateStr = startDateObj.toISOString().split("T")[0];
    const { primeRate } = await fetchPrimeRate(dateStr);
    fvRate = Number((primeRate + 2).toFixed(2));
  }

  const fvAdjustment = computeFvAdjustment({
    principal: Number(loan.principal) - Number(loan.downPayment ?? 0),
    contractualRate: rate,
    fvRate,
    amortizationYears: loan.amortizationYears,
    termYears: loan.termYears,
    startDate: startDateObj,
    ioMonths: loan.ioMonths,
    specificIoMonths: loan.specificIoMonths
      ? loan.specificIoMonths.split(",").map(Number).filter((n) => !isNaN(n))
      : [],
    balloonPayment: Number(loan.balloonPayment),
    frequency: loan.paymentFrequency as "monthly" | "semi-monthly" | "bi-weekly" | "weekly",
    paymentOverride: loan.paymentOverride != null ? Number(loan.paymentOverride) : null,
  });

  const trivialThreshold = file.trivialThreshold != null ? Number(file.trivialThreshold) : null;
  const materiality = file.materiality != null ? Number(file.materiality) : null;

  const decision = suggestFvDecision(fvAdjustment, trivialThreshold, materiality);
  if (!decision) return null;

  return { fvDecision: decision, fvRate };
}

/**
 * Re-evaluates the auto-suggested FV decision for every below-market-rate
 * loan in a file after its trivialThreshold or materiality changes. Only
 * touches loans whose decision was previously auto-suggested (or unset) —
 * loans the user selected the same value for get refreshed too, since the
 * decision is re-derived from the same rule every time; there is currently
 * no separate "manually overridden" flag distinguishing user choice from an
 * old auto-suggestion, so every below-market-rate loan is re-evaluated.
 */
export async function evaluateFvDecisionsForFile(
  fileId: string,
  file: FvEvalFileInput
): Promise<void> {
  const loans = await db
    .select()
    .from(loansTable)
    .where(and(eq(loansTable.fileId, fileId), isNull(loansTable.deletedAt)));

  for (const loan of loans) {
    const suggestion = await computeFvSuggestion(
      {
        interestRate: loan.interestRate,
        principal: loan.principal,
        downPayment: loan.downPayment,
        amortizationYears: loan.amortizationYears,
        termYears: loan.termYears,
        startDate: loan.startDate,
        ioMonths: loan.ioMonths,
        specificIoMonths: loan.specificIoMonths,
        balloonPayment: loan.balloonPayment,
        paymentFrequency: loan.paymentFrequency,
        fvRate: loan.fvRate,
        paymentOverride: loan.paymentOverride,
      },
      file
    );

    if (!suggestion) continue;

    await db
      .update(loansTable)
      .set({
        fvDecision: suggestion.fvDecision,
        fvRate: suggestion.fvRate.toString(),
      })
      .where(eq(loansTable.id, loan.id));
  }
}
