import { z } from "zod";
import { UserFacingError, type AzureSettings } from "./azure-core";
import { extractJson } from "./azure-openai";

/**
 * Invoice extraction for an audit sampling / vouching workflow.
 *
 * This follows the same pattern proven in the loan/lease app:
 * - Every field is nullable with `.catch(null)` so one malformed field never
 *   sinks the whole extraction — a null means "not found", and the UI can
 *   flag it for manual follow-up.
 * - The prompt forbids guessing and requires per-field source citations
 *   (`fieldNotes`) so the auditor can verify where each number came from.
 * - The model output is validated with Zod before anything touches it.
 *
 * Adjust the schema + prompt to the assertions you're vouching for.
 */

const lineItemSchema = z.object({
  description: z.string().nullable().catch(null),
  quantity: z.number().nullable().catch(null),
  unitPrice: z.number().nullable().catch(null),
  amount: z.number().nullable().catch(null),
});

const invoiceFieldsSchema = z.object({
  vendorName: z.string().nullable().catch(null),
  vendorAddress: z.string().nullable().catch(null),
  billToName: z.string().nullable().catch(null),
  invoiceNumber: z.string().nullable().catch(null),
  purchaseOrderNumber: z.string().nullable().catch(null),
  invoiceDate: z.string().nullable().catch(null), // YYYY-MM-DD
  dueDate: z.string().nullable().catch(null), // YYYY-MM-DD
  currency: z.string().nullable().catch(null), // e.g. "CAD", "USD"
  subtotal: z.number().nullable().catch(null),
  gstHstAmount: z.number().nullable().catch(null),
  pstQstAmount: z.number().nullable().catch(null),
  totalAmount: z.number().nullable().catch(null),
  amountDue: z.number().nullable().catch(null),
  paymentTerms: z.string().nullable().catch(null),
  gstHstRegistrationNumber: z.string().nullable().catch(null),
  lineItems: z.array(lineItemSchema).nullable().catch(null),
  fieldNotes: z.record(z.string(), z.string()).nullable().catch(null),
});

export const invoiceExtractionSchema = z.object({
  classification: z.enum(["invoice", "credit_note", "statement", "receipt", "other"]),
  confidence: z.number().min(0).max(1).catch(0.5),
  reasoning: z.string().catch(""),
  invoice: invoiceFieldsSchema.nullable().catch(null),
});

export type InvoiceExtractionResult = z.infer<typeof invoiceExtractionSchema>;
export type InvoiceFields = z.infer<typeof invoiceFieldsSchema>;

const roundCents = (n: number): number => Math.round(n * 100) / 100;

/**
 * Recompute arithmetic server-side — LLMs occasionally make small math
 * mistakes, so totals are re-derived from line items when both are present,
 * and a mismatch is surfaced instead of silently trusted.
 */
export function checkInvoiceMath(invoice: InvoiceFields): {
  invoice: InvoiceFields;
  warnings: string[];
} {
  const warnings: string[] = [];

  if (invoice.lineItems?.length && invoice.subtotal != null) {
    const lineSum = roundCents(
      invoice.lineItems.reduce((sum, li) => sum + (li.amount ?? 0), 0),
    );
    if (Math.abs(lineSum - invoice.subtotal) > 0.02) {
      warnings.push(
        `Line items sum to ${lineSum.toFixed(2)} but the stated subtotal is ${invoice.subtotal.toFixed(2)}.`,
      );
    }
  }

  if (invoice.subtotal != null && invoice.totalAmount != null) {
    const expected = roundCents(
      invoice.subtotal + (invoice.gstHstAmount ?? 0) + (invoice.pstQstAmount ?? 0),
    );
    if (Math.abs(expected - invoice.totalAmount) > 0.02) {
      warnings.push(
        `Subtotal + taxes = ${expected.toFixed(2)} but the stated total is ${invoice.totalAmount.toFixed(2)}.`,
      );
    }
  }

  return { invoice, warnings };
}

const SYSTEM_PROMPT = `You are an assistant for a Canadian audit vouching tool. You will receive the text of a document that an auditor selected while vouching a sample. Classify it and extract structured data.

Classification rules:
- "invoice": a supplier/vendor invoice billing for goods or services.
- "credit_note": a credit memo reducing an amount owed.
- "statement": a vendor statement of account listing multiple invoices.
- "receipt": proof of payment (till receipt, payment confirmation).
- "other": anything else.

Extraction rules — CRITICAL:
- NEVER guess or invent values. If a value is not clearly stated in the document, use null.
- Read the ENTIRE document before answering — totals and terms are often at the bottom or on a later page.
- Dates must be in YYYY-MM-DD format. If only month/year is given, use the first of the month. If not stated, null.
- All money amounts are plain numbers without currency symbols or thousands separators.
- currency: the ISO code if determinable (e.g. "CAD", "USD"); infer from symbols/wording only if unambiguous, otherwise null.
- gstHstAmount: GST or HST charged. pstQstAmount: PST or QST charged. If tax is one combined line you cannot split, put it in gstHstAmount and note this in reasoning.
- gstHstRegistrationNumber: the supplier's GST/HST registration number if shown (format like 123456789RT0001).
- lineItems: extract each billed line with description, quantity, unitPrice, amount. If the invoice has more than 30 lines, extract the 30 largest by amount and say so in reasoning.
- amountDue may differ from totalAmount (partial payments, deposits) — extract both as stated.
- In "reasoning", briefly explain the classification and note anything an auditor should verify (2-4 sentences, plain language).
- Fill "fieldNotes": an object mapping each NON-NULL extracted field name to a short note (max ~15 words) citing where you found it (e.g. "totalAmount": "Bottom of page 1, 'Total Due'"). Only include fields you actually extracted.

Respond with JSON only, matching exactly this shape:
{
  "classification": "invoice" | "credit_note" | "statement" | "receipt" | "other",
  "confidence": number between 0 and 1,
  "reasoning": string,
  "invoice": { vendorName, vendorAddress, billToName, invoiceNumber, purchaseOrderNumber, invoiceDate, dueDate, currency, subtotal, gstHstAmount, pstQstAmount, totalAmount, amountDue, paymentTerms, gstHstRegistrationNumber, lineItems ([{description, quantity, unitPrice, amount}] or null), fieldNotes ({fieldName: note} or null) } or null if classification is "other".
}`;

/** Ask Azure OpenAI to classify + extract fields from invoice text. */
export async function extractInvoice(
  settings: AzureSettings,
  documentText: string,
): Promise<InvoiceExtractionResult> {
  const parsed = await extractJson(settings, SYSTEM_PROMPT, documentText);

  const validated = invoiceExtractionSchema.safeParse(parsed);
  if (!validated.success) {
    throw new UserFacingError("The AI response was missing required information. Try again.", 502);
  }
  return validated.data;
}
