/**
 * End-to-end example: PDF invoice → text → structured fields.
 *
 * Run with the AZURE_* environment variables set (see README.md):
 *   npx tsx example.ts path/to/invoice.pdf
 */
import fs from "fs";
import { loadAzureSettings, requireSettings } from "./azure-core";
import { readPdfText } from "./azure-doc-intel";
import { extractInvoice, checkInvoiceMath } from "./invoice-extract";

async function main() {
  const pdfPath = process.argv[2];
  if (!pdfPath) {
    console.error("Usage: npx tsx example.ts <invoice.pdf>");
    process.exit(1);
  }

  const settings = loadAzureSettings();
  requireSettings(
    settings,
    ["docIntelEndpoint", "docIntelKey", "openaiEndpoint", "openaiKey", "openaiDeployment"],
    "Invoice analysis",
  );

  const pdf = fs.readFileSync(pdfPath);

  console.log("1/2 Reading PDF with Document Intelligence (OCR)...");
  const text = await readPdfText(settings, pdf);
  console.log(`    Extracted ${text.length} characters of text.`);

  console.log("2/2 Analyzing with Azure OpenAI...");
  const result = await extractInvoice(settings, text);

  console.log(`\nClassification: ${result.classification} (confidence ${result.confidence})`);
  console.log(`Reasoning: ${result.reasoning}`);

  if (result.invoice) {
    const { warnings } = checkInvoiceMath(result.invoice);
    console.log("\nExtracted fields:");
    console.log(JSON.stringify(result.invoice, null, 2));
    if (warnings.length) {
      console.log("\nMath warnings (flag for the auditor):");
      for (const w of warnings) console.log(`  - ${w}`);
    }
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
