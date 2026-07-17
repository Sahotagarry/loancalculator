import { PDFDocument } from "pdf-lib";
import { UserFacingError, type AzureSettings } from "./azure-settings";

const API_VERSION = "2024-11-30";

// The free (F0) Document Intelligence tier only analyzes the first 2 pages of
// a document. When we detect that fewer pages came back than the PDF has, we
// split the PDF into chunks of this size and analyze each chunk separately.
const FREE_TIER_PAGE_LIMIT = 2;
const MAX_PAGES = 60; // safety cap: 30 extra requests max

/**
 * Send a PDF to Azure Document Intelligence (prebuilt-read model) and return
 * the extracted text. Handles scanned/image PDFs via built-in OCR, and works
 * around the free-tier 2-page limit by splitting larger PDFs into chunks.
 */
export async function readPdfText(settings: AzureSettings, pdf: Buffer): Promise<string> {
  const first = await analyzePdf(settings, pdf);

  let totalPages: number | null = null;
  let doc: PDFDocument | null = null;
  try {
    doc = await PDFDocument.load(pdf, { ignoreEncryption: true });
    totalPages = doc.getPageCount();
  } catch {
    // Can't parse locally — return whatever Azure gave us.
    return first.content;
  }

  // Full document was read (paid tier, or short document) — done. A zero
  // pagesRead means the page metadata was missing; don't risk duplicating.
  if (
    totalPages == null ||
    first.pagesRead === 0 ||
    first.pagesRead >= totalPages ||
    first.pagesRead > FREE_TIER_PAGE_LIMIT
  ) {
    return first.content;
  }

  // Free tier truncated the document: analyze the remaining pages in chunks.
  const pagesToRead = Math.min(totalPages, MAX_PAGES);
  const parts: string[] = [first.content];
  for (let start = first.pagesRead; start < pagesToRead; start += FREE_TIER_PAGE_LIMIT) {
    const end = Math.min(start + FREE_TIER_PAGE_LIMIT, pagesToRead);
    const chunkDoc = await PDFDocument.create();
    const indices = Array.from({ length: end - start }, (_, i) => start + i);
    const pages = await chunkDoc.copyPages(doc, indices);
    for (const p of pages) chunkDoc.addPage(p);
    const chunkBytes = Buffer.from(await chunkDoc.save());
    const chunk = await analyzePdf(settings, chunkBytes);
    parts.push(chunk.content);
  }
  return parts.filter(Boolean).join("\n");
}

async function analyzePdf(
  settings: AzureSettings,
  pdf: Buffer,
): Promise<{ content: string; pagesRead: number }> {
  const endpoint = settings.docIntelEndpoint.replace(/\/+$/, "");
  const analyzeUrl = `${endpoint}/documentintelligence/documentModels/prebuilt-read:analyze?api-version=${API_VERSION}`;

  let submitRes: Response;
  try {
    submitRes = await fetch(analyzeUrl, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": settings.docIntelKey,
        "Content-Type": "application/pdf",
      },
      body: new Uint8Array(pdf),
    });
  } catch {
    throw new UserFacingError(
      "Couldn't reach Azure Document Intelligence. Check the endpoint URL on the Settings page.",
      502,
    );
  }

  if (submitRes.status === 401 || submitRes.status === 403) {
    throw new UserFacingError(
      "Azure Document Intelligence rejected the credentials. Check the key and endpoint on the Settings page.",
      502,
    );
  }
  if (submitRes.status === 429) {
    throw new UserFacingError(
      "Azure Document Intelligence is rate-limited right now. Wait a moment and try again.",
      502,
    );
  }
  if (!submitRes.ok) {
    const detail = await safeErrorDetail(submitRes);
    throw new UserFacingError(
      `Azure Document Intelligence couldn't read the document${detail ? `: ${detail}` : "."}`,
      502,
    );
  }

  const operationLocation = submitRes.headers.get("operation-location");
  if (!operationLocation) {
    throw new UserFacingError("Azure Document Intelligence returned an unexpected response.", 502);
  }

  // Poll until the analysis completes (typically a few seconds).
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500));
    const pollRes = await fetch(operationLocation, {
      headers: { "Ocp-Apim-Subscription-Key": settings.docIntelKey },
    });
    if (!pollRes.ok) {
      throw new UserFacingError("Azure Document Intelligence failed while reading the document.", 502);
    }
    const body = (await pollRes.json()) as {
      status?: string;
      analyzeResult?: { content?: string; pages?: unknown[] };
      error?: { message?: string };
    };
    if (body.status === "succeeded") {
      const content = body.analyzeResult?.content?.trim() ?? "";
      if (!content) {
        throw new UserFacingError(
          "No readable text was found in this PDF. It may be blank or too low quality to read.",
          422,
        );
      }
      return { content, pagesRead: body.analyzeResult?.pages?.length ?? 0 };
    }
    if (body.status === "failed") {
      throw new UserFacingError(
        `Azure Document Intelligence couldn't read this document${body.error?.message ? `: ${body.error.message}` : "."}`,
        422,
      );
    }
  }
  throw new UserFacingError("Reading the document timed out. Try again with a smaller PDF.", 504);
}

async function safeErrorDetail(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    return body.error?.message ?? null;
  } catch {
    return null;
  }
}
