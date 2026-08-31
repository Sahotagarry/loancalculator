import { logger } from "./logger";

/** Current Bank of Canada chartered-bank prime series. No retired-series fallback. */
export const BOC_PRIME_SERIES: "V80691311" = "V80691311";
export const BOC_PRIME_SOURCE_URL =
  "https://www.bankofcanada.ca/valet/observations/V80691311/json";

export type PrimeObservation = {
  observationDate: string;
  publishedDate: string | null;
  fetchedAt: Date;
  rate: number;
  sourceUrl: string;
  sourceSeries: typeof BOC_PRIME_SERIES;
};

export class PrimeObservationError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
  }
}

const cache = new Map<string, { expiresAt: number; value: PrimeObservation }>();
const TTL_MS = 24 * 60 * 60 * 1000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const isTransientNetworkError = (error: unknown) =>
  error instanceof TypeError ||
  (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError"));

function dateOnly(value: string): string {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value
  ) {
    throw new PrimeObservationError("Observation date must be a valid YYYY-MM-DD date", false);
  }
  return value;
}

export async function fetchPrimeObservation(
  requestedDate: string,
  options: { attempts?: number; fetcher?: typeof fetch; now?: () => Date } = {},
): Promise<PrimeObservation> {
  const now = options.now?.() ?? new Date();
  const today = now.toISOString().slice(0, 10);
  const end = dateOnly(requestedDate);
  if (end > today) throw new PrimeObservationError("Future prime observations are unavailable", false);
  const cached = cache.get(end);
  if (cached && cached.expiresAt > now.getTime()) return cached.value;

  const startDate = new Date(`${end}T00:00:00Z`);
  startDate.setUTCDate(startDate.getUTCDate() - 31);
  const url = `${BOC_PRIME_SOURCE_URL}?start_date=${startDate.toISOString().slice(0, 10)}&end_date=${end}`;
  const attempts = Math.max(1, options.attempts ?? 3);
  const fetcher = options.fetcher ?? fetch;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetcher(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) {
        throw new PrimeObservationError(
          `Bank of Canada returned HTTP ${response.status}`,
          response.status === 408 || response.status === 429 || response.status >= 500,
        );
      }
      const payload = (await response.json()) as {
        observations?: Array<{ d?: unknown; V80691311?: { v?: unknown } }>;
      };
      if (!Array.isArray(payload.observations)) {
        throw new PrimeObservationError("Bank of Canada payload has no observations array", false);
      }
      const valid = payload.observations
        .filter(
          (item): item is { d: string; V80691311: { v: string } } =>
            typeof item?.d === "string" &&
            typeof item?.V80691311?.v === "string" &&
            /^\d{4}-\d{2}-\d{2}$/.test(item.d),
        )
        .map((item) => ({ date: item.d, rate: Number(item.V80691311.v) }))
        .filter((item) => item.date <= end && Number.isFinite(item.rate) && item.rate >= 0 && item.rate <= 100)
        .sort((a, b) => a.date.localeCompare(b.date));
      const latest = valid.at(-1);
      if (!latest) throw new PrimeObservationError(`No prime observation available on or before ${end}`, false);
      const value: PrimeObservation = {
        observationDate: latest.date,
        // Valet does not expose publication timestamps for this series.
        publishedDate: null,
        fetchedAt: now,
        rate: latest.rate,
        sourceUrl: url,
        sourceSeries: BOC_PRIME_SERIES,
      };
      cache.set(end, { expiresAt: now.getTime() + TTL_MS, value });
      return value;
    } catch (error) {
      lastError = error;
      const retryable =
        error instanceof PrimeObservationError ? error.retryable : isTransientNetworkError(error);
      if (!retryable || attempt === attempts) break;
      logger.warn({ attempt, requestedDate, err: error }, "Prime retrieval failed; retrying");
      await sleep(250 * 2 ** (attempt - 1));
    }
  }
  if (lastError instanceof PrimeObservationError) throw lastError;
  throw new PrimeObservationError(
    `Bank of Canada retrieval failed: ${lastError instanceof Error ? lastError.message : "unknown error"}`,
    true,
  );
}

/** Retrieves a bounded Valet range once; callers derive contractual candidates
 * locally rather than issuing one request per calendar day. */
export async function fetchPrimeObservationRange(
  startDate: string,
  endDate: string,
  options: { attempts?: number; fetcher?: typeof fetch; now?: () => Date } = {},
): Promise<PrimeObservation[]> {
  dateOnly(startDate); dateOnly(endDate);
  if (startDate > endDate) return [];
  const fetchedAt = options.now?.() ?? new Date();
  const fetcher = options.fetcher ?? fetch;
  const url = `${BOC_PRIME_SOURCE_URL}?start_date=${startDate}&end_date=${endDate}`;
  const attempts = Math.max(1, options.attempts ?? 3);
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetcher(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8_000) });
      if (!response.ok) throw new PrimeObservationError(
        `Bank of Canada returned HTTP ${response.status}`,
        response.status === 408 || response.status === 429 || response.status >= 500,
      );
      const payload = await response.json() as { observations?: Array<{ d?: unknown; V80691311?: { v?: unknown } }> };
      if (!Array.isArray(payload.observations)) throw new PrimeObservationError("Bank of Canada payload has no observations array", false);
      return payload.observations
        .filter((x): x is { d: string; V80691311: { v: string } } =>
          typeof x.d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x.d) && typeof x.V80691311?.v === "string")
        .map((x) => ({ observationDate: x.d, publishedDate: null, fetchedAt, rate: Number(x.V80691311.v), sourceUrl: url, sourceSeries: BOC_PRIME_SERIES }))
        .filter((x) => x.observationDate >= startDate && x.observationDate <= endDate && Number.isFinite(x.rate) && x.rate >= 0 && x.rate <= 100)
        .sort((a, b) => a.observationDate.localeCompare(b.observationDate));
    } catch (error) {
      lastError = error;
      const retryable = error instanceof PrimeObservationError ? error.retryable : isTransientNetworkError(error);
      if (!retryable || attempt === attempts) break;
      logger.warn({ attempt, startDate, endDate, err: error }, "Prime range retrieval failed; retrying");
      await sleep(250 * 2 ** (attempt - 1));
    }
  }
  if (lastError instanceof PrimeObservationError) throw lastError;
  throw new PrimeObservationError(`Bank of Canada range retrieval failed: ${lastError instanceof Error ? lastError.message : "unknown error"}`, true);
}
