import { z } from "zod";
import { UserFacingError, type AzureSettings } from "./azure-settings";

const LEGACY_API_VERSION = "2024-10-21";

// ---------------------------------------------------------------------------
// Result shape returned by the AI extraction. All fields are nullable — a
// null means "not found in the document" and the UI leaves it blank/flagged.
// ---------------------------------------------------------------------------

const loanFieldsSchema = z.object({
  name: z.string().nullable().catch(null),
  lender: z.string().nullable().catch(null),
  principal: z.number().nullable().catch(null),
  downPayment: z.number().nullable().catch(null),
  interestRate: z.number().nullable().catch(null),
  primeSpread: z.number().nullable().catch(null),
  statedPrimeRate: z.number().nullable().catch(null),
  amortizationYears: z.number().nullable().catch(null),
  termYears: z.number().nullable().catch(null),
  startDate: z.string().nullable().catch(null),
  paymentFrequency: z.enum(["monthly", "semi-monthly", "bi-weekly", "weekly"]).nullable().catch(null),
  paymentAmount: z.number().nullable().catch(null),
  interestOnlyMonths: z.number().nullable().catch(null),
  balloonPayment: z.number().nullable().catch(null),
  securityDescription: z.string().nullable().catch(null),
});

const leaseFieldsSchema = z.object({
  name: z.string().nullable().catch(null),
  lessor: z.string().nullable().catch(null),
  assetDescription: z.string().nullable().catch(null),
  assetType: z.enum(["vehicle", "equipment", "office_commercial", "other"]).nullable().catch(null),
  startDate: z.string().nullable().catch(null),
  termMonths: z.number().nullable().catch(null),
  monthlyPayment: z.number().nullable().catch(null),
  downPayment: z.number().nullable().catch(null),
  interestRate: z.number().nullable().catch(null),
  fairValue: z.number().nullable().catch(null),
  economicLifeYears: z.number().nullable().catch(null),
  buyoutAmount: z.number().nullable().catch(null),
  transferOfOwnership: z.boolean().nullable().catch(null),
  bargainPurchaseOption: z.boolean().nullable().catch(null),
  specializedAsset: z.boolean().nullable().catch(null),
  paymentAtBeginning: z.boolean().nullable().catch(null),
  rentableSquareFeet: z.number().nullable().catch(null),
  rentSteps: z
    .array(
      z.object({
        fromYear: z.number(),
        toYear: z.number(),
        monthlyRent: z.number(),
        annualRatePerSquareFoot: z.number().nullable().catch(null).optional(),
      }),
    )
    .nullable()
    .catch(null),
  tenantImprovementAllowance: z.number().nullable().catch(null),
  freeRentMonths: z.number().nullable().catch(null),
  camAnnualPerSquareFoot: z.number().nullable().catch(null),
  camMonthly: z.number().nullable().catch(null),
  percentageRentNote: z.string().nullable().catch(null),
  fieldNotes: z.record(z.string(), z.string()).nullable().catch(null),
  estimates: z
    .object({
      economicLifeYears: z.number().nullable().catch(null),
      fairValue: z.number().nullable().catch(null),
      interestRate: z.number().nullable().catch(null),
      reasoning: z.string().nullable().catch(null),
    })
    .nullable()
    .catch(null),
});

export const extractionSchema = z.object({
  classification: z.enum(["loan", "lease", "other"]),
  confidence: z.number().min(0).max(1).catch(0.5),
  reasoning: z.string().catch(""),
  loan: loanFieldsSchema.nullable().catch(null),
  lease: leaseFieldsSchema.nullable().catch(null),
});

export type ExtractionResult = z.infer<typeof extractionSchema>;
export type LoanFields = z.infer<typeof loanFieldsSchema>;
export type LeaseFields = z.infer<typeof leaseFieldsSchema>;

const roundCents = (n: number): number => Math.round(n * 100) / 100;

/**
 * Recompute per-square-foot money math server-side. LLMs occasionally make
 * small arithmetic mistakes converting annual $/sf rates to monthly dollars,
 * so whenever the rentable area and the stated rates are available we redo
 * the multiplication here and overwrite the model's numbers.
 */
export function reconcileLeaseMath(lease: LeaseFields): LeaseFields {
  const sf = lease.rentableSquareFeet;
  if (sf == null || sf <= 0) return lease;

  let steps = lease.rentSteps;
  if (steps?.length) {
    steps = steps.map((s) =>
      s.annualRatePerSquareFoot != null && s.annualRatePerSquareFoot > 0
        ? { ...s, monthlyRent: roundCents((s.annualRatePerSquareFoot * sf) / 12) }
        : s,
    );
  }

  let monthlyPayment = lease.monthlyPayment;
  const firstStep = steps?.length
    ? [...steps].sort((a, b) => a.fromYear - b.fromYear)[0]
    : null;
  if (firstStep && firstStep.fromYear === 1) {
    monthlyPayment = firstStep.monthlyRent;
  }

  // When a per-square-foot rate is stated, it is the source of truth —
  // overwrite any model-computed monthly amount.
  let camMonthly = lease.camMonthly;
  if (lease.camAnnualPerSquareFoot != null && lease.camAnnualPerSquareFoot > 0) {
    camMonthly = roundCents((lease.camAnnualPerSquareFoot * sf) / 12);
  }

  return { ...lease, rentSteps: steps ?? lease.rentSteps, monthlyPayment, camMonthly };
}

const SYSTEM_PROMPT = `You are an assistant for a Canadian ASPE accounting tool. You will receive the text of a document. Classify it and extract structured data.

Classification rules:
- "loan": a loan agreement, mortgage, promissory note, credit facility, or term debt document.
- "lease": a lease agreement (vehicle, equipment, or real property) from the lessee's perspective.
- "other": anything else (invoices, letters, financial statements, etc.).

Extraction rules — CRITICAL:
- NEVER guess or invent values. If a value is not clearly stated in the document, use null.
- Do not compute values that are not stated, EXCEPT simple unit conversions (e.g. an amortization stated as "84 months" becomes amortizationYears 7), combining a stated prime rate with a stated spread (see interest rate rules), and per-square-foot math for real property leases (see office lease rules).
- Read the ENTIRE document before answering. Key terms are often buried mid-document under headings like "Repayment", "Payments", "Interest", "Security", "Guarantees", or in a schedule/appendix — do not stop after the first page.
- Dates must be in YYYY-MM-DD format. If only month/year is given, use the first of the month. If not stated, null.
- startDate is the date the loan/lease commences or funds are advanced (often the agreement date). A separate "first payment date" is normal — it is usually one payment period AFTER the start date; do not use it as startDate. If both appear, mention the first payment date in reasoning.
- Interest rate rules:
  - interestRate is the annual percentage as a number (e.g. 6.25 for 6.25%).
  - If the rate is variable (e.g. "prime + 1.75%" or "prime plus 1.75%"), set primeSpread to the spread (1.75). If the document also states the prime rate in effect (e.g. "prime, currently 6.45%"), set statedPrimeRate to that number AND set interestRate to their sum (8.20). If the prime rate is not stated, leave interestRate and statedPrimeRate null — the app will look up prime automatically.
  - For a plain fixed rate, leave primeSpread and statedPrimeRate null.
- paymentAmount is the periodic payment. Watch for synonyms: "blended payment", "blended payments of principal and interest", "instalment", "monthly payment of $X". A stated blended/instalment amount IS the paymentAmount.
- All money amounts are plain numbers without currency symbols or thousands separators.
- amortizationYears / termYears may be fractional (e.g. 2.5). If stated in months, divide by 12.
- For a loan, "termYears" is the length of the committed term; "amortizationYears" is the amortization period (often longer — e.g. a 5-year term amortized over 84 months means termYears 5, amortizationYears 7). If only one is stated, set the other to null.
- securityDescription: summarize ALL security and guarantee provisions in 1-3 sentences — general security agreements (GSA), specific charges over assets, mortgages, personal or corporate guarantees, postponements, assignments. If the document mentions any collateral or guarantee at all, this must not be null.
- For a lease, termMonths is the lease term in months.
- Office / commercial property lease rules (assetType "office_commercial"):
  - rentableSquareFeet: the rentable area of the premises in square feet, if stated (e.g. "approximately 3,200 rentable square feet").
  - Base rent is usually quoted as an ANNUAL rate per rentable square foot (e.g. "$28.00 per rentable square foot per annum"). Convert it: monthly rent = rate × rentableSquareFeet ÷ 12. Round to the cent. This conversion is REQUIRED, not guessing.
  - If base rent changes over the term (e.g. "Lease Years 1-2: $28.00/sf; Years 3-4: $30.00/sf; Year 5: $32.00/sf"), fill rentSteps: an array of { fromYear, toYear, monthlyRent, annualRatePerSquareFoot } using 1-based inclusive lease years and the CONVERTED monthly dollar amounts. ALWAYS include annualRatePerSquareFoot (the stated per-square-foot annual rate, e.g. 28.00) whenever rent is quoted per square foot — the app recomputes the exact monthly amount from it, so it must be the rate exactly as stated in the document. A single flat rent for the whole term does not need rentSteps (leave it null).
  - monthlyPayment must be the monthly rent for the FIRST lease year (the first step, converted to monthly dollars). Base rent only — exclude operating costs / additional rent / taxes.
  - camAnnualPerSquareFoot: the annual Common Area Maintenance / operating cost rate per square foot, if stated (e.g. "CAM estimated at $11.25 per square foot"). Include any other per-square-foot additional-rent charges billed with CAM (e.g. a merchants' association fee of $0.35/sf makes 11.60). If CAM is instead stated as a dollar amount per month or year, set camMonthly to the monthly dollar amount and leave camAnnualPerSquareFoot null.
  - percentageRentNote: if the lease requires percentage rent / turnover rent (e.g. "6% of Gross Sales above the Natural Breakpoint"), summarize the formula in one sentence. This is contingent rent — never include it in monthlyPayment or rentSteps. Null if no percentage rent.
  - tenantImprovementAllowance: total dollar amount the landlord contributes to the tenant's leasehold improvements. If quoted per square foot (e.g. "$25.00 per rentable square foot"), multiply by rentableSquareFeet. Look for "Tenant Improvement Allowance", "leasehold improvement allowance", "inducement", "fixturing allowance".
  - freeRentMonths: number of rent-free or "gross rent free" months at the start of the term, if stated.
  - Note the per-square-foot figures and the math you used in "reasoning" so the accountant can verify.
- transferOfOwnership: true only if the lease clearly transfers title to the lessee at end of term.
- bargainPurchaseOption: true only if there is a purchase option clearly below expected fair value (e.g. nominal buyout like $1 or ~10% or less of value). A fair-market-value buyout is false.
- specializedAsset: true only if the asset is clearly custom/specialized such that only the lessee can use it.
- paymentAtBeginning: true if payments are due at the beginning of each period, false if at end, null if not stated.
- In "reasoning", briefly explain the classification and note anything important the user should verify (2-4 sentences, plain language for an accountant).
- For a lease, also fill "fieldNotes": an object mapping each NON-NULL extracted lease field name to a short note (max ~15 words) citing where/how you found it — quote the section or clause wording (e.g. "termMonths": "Section 2.1: term of five (5) years", "monthlyPayment": "$28.00/sf × 3,200 sf ÷ 12 (Section 4.1)"). Only include fields you actually extracted. Booleans you inferred as false because nothing was stated should NOT get a note.
- For a lease, also fill "estimates": ONLY for economicLifeYears, fairValue, and interestRate that are NOT stated in the document, you may provide a reasonable professional ESTIMATE to help the accountant (e.g. typical economic life for the asset class, an approximate market financing rate). These are clearly labelled estimates, NOT extractions — never put them in the main lease fields. Set "reasoning" inside estimates to 1-2 sentences explaining the basis of each estimate. If you cannot estimate responsibly, use null.

Respond with JSON only, matching exactly this shape:
{
  "classification": "loan" | "lease" | "other",
  "confidence": number between 0 and 1,
  "reasoning": string,
  "loan": { name, lender, principal, downPayment, interestRate, primeSpread, statedPrimeRate, amortizationYears, termYears, startDate, paymentFrequency ("monthly"|"semi-monthly"|"bi-weekly"|"weekly"), paymentAmount, interestOnlyMonths, balloonPayment, securityDescription } or null if not a loan,
  "lease": { name, lessor, assetDescription, assetType ("vehicle"|"equipment"|"office_commercial"|"other"), startDate, termMonths, monthlyPayment, downPayment, interestRate, fairValue, economicLifeYears, buyoutAmount, transferOfOwnership, bargainPurchaseOption, specializedAsset, paymentAtBeginning, rentableSquareFeet, rentSteps ([{fromYear, toYear, monthlyRent, annualRatePerSquareFoot}] or null), tenantImprovementAllowance, freeRentMonths, camAnnualPerSquareFoot, camMonthly, percentageRentNote, fieldNotes ({fieldName: note} or null), estimates ({economicLifeYears, fairValue, interestRate, reasoning} or null) } or null if not a lease.
  "name" should be a short human label like "Truck Loan — TD Bank" based on the document.
}`;

async function callChatCompletions(
  settings: AzureSettings,
  messages: Array<{ role: string; content: string }>,
): Promise<Response> {
  const endpoint = settings.openaiEndpoint.replace(/\/+$/, "");
  const deployment = settings.openaiDeployment;

  const basePayload = {
    messages,
    response_format: { type: "json_object" },
  };

  const attempts: Array<{ url: string; body: Record<string, unknown> }> = [
    // Modern version-free v1 endpoint (works with current GPT-5 family models).
    {
      url: `${endpoint}/openai/v1/chat/completions`,
      body: { ...basePayload, model: deployment },
    },
    // Legacy deployment-scoped endpoint for older resources/models.
    {
      url: `${endpoint}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${LEGACY_API_VERSION}`,
      body: { ...basePayload, temperature: 0 },
    },
  ];

  let lastRes: Response | null = null;
  for (const attempt of attempts) {
    let res: Response;
    try {
      res = await fetch(attempt.url, {
        method: "POST",
        headers: {
          "api-key": settings.openaiKey,
          Authorization: `Bearer ${settings.openaiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(attempt.body),
      });
    } catch {
      throw new UserFacingError(
        "Couldn't reach Azure OpenAI. Check the endpoint URL on the Settings page.",
        502,
      );
    }
    if (res.ok) return res;
    lastRes = res;
    // Only fall through to the next attempt on "endpoint/parameter not
    // recognized" style errors; auth and rate-limit errors are terminal.
    if (res.status !== 404 && res.status !== 400 && res.status !== 405) return res;
  }
  return lastRes as Response;
}

/** Ask Azure OpenAI to classify + extract fields from document text. */
export async function extractLoanOrLease(settings: AzureSettings, documentText: string): Promise<ExtractionResult> {
  // Keep the request within a safe token budget.
  const text = documentText.length > 60_000 ? documentText.slice(0, 60_000) : documentText;

  const res = await callChatCompletions(settings, [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: text },
  ]);

  if (res.status === 401 || res.status === 403) {
    throw new UserFacingError(
      "Azure OpenAI rejected the credentials. Check the key and endpoint on the Settings page.",
      502,
    );
  }
  if (res.status === 404) {
    throw new UserFacingError(
      "The Azure OpenAI deployment name wasn't found. Check the deployment name on the Settings page.",
      502,
    );
  }
  if (res.status === 429) {
    throw new UserFacingError("Azure OpenAI is rate-limited right now. Wait a moment and try again.", 502);
  }
  if (!res.ok) {
    throw new UserFacingError("Azure OpenAI couldn't analyze the document. Try again.", 502);
  }

  const body = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = body.choices?.[0]?.message?.content;
  if (!content) {
    throw new UserFacingError("Azure OpenAI returned an empty response. Try again.", 502);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new UserFacingError("The AI response couldn't be understood. Try again.", 502);
  }

  const validated = extractionSchema.safeParse(parsed);
  if (!validated.success) {
    throw new UserFacingError("The AI response was missing required information. Try again.", 502);
  }
  return validated.data;
}
