import { describe, expect, it, vi } from "vitest";
import { fetchPrimeObservation, fetchPrimeObservationRange, PrimeObservationError } from "./prime-rates";
import {
  findingIsSatisfiedByAppliedReset,
  generateDueDates,
  restorePrimeObservationError,
  restoreSourcedRate,
} from "./rate-resets";

const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("fetchPrimeObservation", () => {
  it("uses the latest validated observation on or before the requested date", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      response({
        observations: [
          { d: "2024-01-05", V80691311: { v: "7.20" } },
          { d: "2024-01-08", V80691311: { v: "7.10" } },
        ],
      }),
    );
    const result = await fetchPrimeObservation("2024-01-07", {
      fetcher,
      now: () => new Date("2024-01-10T12:00:00Z"),
    });
    expect(result.observationDate).toBe("2024-01-05");
    expect(result.rate).toBe(7.2);
    expect(result.publishedDate).toBeNull();
  });

  it("reports missing observations instead of inserting a contractual fallback", async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ observations: [] }));
    await expect(
      fetchPrimeObservation("2023-01-02", {
        fetcher,
        now: () => new Date("2023-01-03T00:00:00Z"),
      }),
    ).rejects.toMatchObject({
      message: "No prime observation available on or before 2023-01-02",
      retryable: false,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not silently parse the retired V122495 payload key", async () => {
    await expect(
      fetchPrimeObservation("2024-01-05", {
        fetcher: vi.fn().mockResolvedValue(response({
          observations: [{ d: "2024-01-05", V122495: { v: "7.20" } }],
        })),
        now: () => new Date("2024-01-06T00:00:00Z"),
      }),
    ).rejects.toThrow("No prime observation");
  });

  it("retries transient failures with backoff and records the successful fetch", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response({}, 503))
      .mockResolvedValueOnce(
        response({ observations: [{ d: "2022-02-01", V80691311: { v: "2.45" } }] }),
      );
    const result = await fetchPrimeObservation("2022-02-01", {
      attempts: 2,
      fetcher,
      now: () => new Date("2022-02-02T00:00:00Z"),
    });
    expect(result.rate).toBe(2.45);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("rejects future dates instead of clamping contractual evidence", async () => {
    await expect(
      fetchPrimeObservation("2030-01-01", {
        now: () => new Date("2029-12-31T00:00:00Z"),
      }),
    ).rejects.toThrow("Future prime observations are unavailable");
  });
});

describe("contractual reset calendar", () => {
  it("backfills each periodic reset and clamps month-end dates", () => {
    expect(generateDueDates("2024-01-31", "2024-04-30", "monthly")).toEqual([
      "2024-01-31", "2024-02-29", "2024-03-31", "2024-04-30",
    ]);
    expect(generateDueDates("2024-01-31", "2024-12-31", "quarterly")).toEqual([
      "2024-01-31", "2024-04-30", "2024-07-31", "2024-10-31",
    ]);
  });

  it("resolves every due request converging on one next-payment effective date", () => {
    const findings = [
      { loanId: "loan-1", observationDate: "2026-07-30", contractualEffectiveDate: "2026-08-01", status: "unresolved" },
      { loanId: "loan-1", observationDate: "2026-07-31", contractualEffectiveDate: "2026-08-01", status: "unresolved" },
      { loanId: "loan-1", observationDate: "2026-08-02", contractualEffectiveDate: "2026-09-01", status: "unresolved" },
    ];
    const satisfied = findings.filter((finding) => findingIsSatisfiedByAppliedReset(finding, {
      loanId: "loan-1",
      requestedDate: "2026-07-31",
      effectiveDate: "2026-08-01",
    }));
    expect(satisfied.map((finding) => finding.observationDate)).toEqual([
      "2026-07-30",
      "2026-07-31",
    ]);
  });
});

describe("sourced restoration boundaries", () => {
  it("rejects future restores before any source retrieval", async () => {
    await expect(restoreSourcedRate("loan-1", "2026-08-02", "reviewer", new Date("2026-08-01T00:00:00Z")))
      .rejects.toThrow("Sourced restoration is unavailable until an observation exists");
    try {
      await restoreSourcedRate("loan-1", "2026-08-02", "reviewer", new Date("2026-08-01T00:00:00Z"));
    } catch (error) {
      expect(error).toMatchObject({ status: 422 });
    }
  });

  it("maps a missing source observation to actionable 422 evidence", () => {
    const error = restorePrimeObservationError(new PrimeObservationError("No prime observation", false));
    expect(error).toMatchObject({ status: 422 });
    expect(error.message).toContain("do not forecast or hold a current rate");
  });

  it("maps transient source outages to retryable HTTP 503", () => {
    const error = restorePrimeObservationError(new PrimeObservationError("Bank of Canada returned HTTP 503", true));
    expect(error).toMatchObject({ status: 503 });
    expect(error.message).toContain("temporarily unavailable");
  });
});

describe("range retrieval", () => {
  it.each([429, 503])("retries HTTP %s then succeeds", async (status) => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({}, status))
      .mockResolvedValueOnce(response({ observations: [{ d: "2024-01-05", V80691311: { v: "7.20" } }] }));
    const result = await fetchPrimeObservationRange("2024-01-01", "2024-01-07", {
      attempts: 2, fetcher, now: () => new Date("2024-01-08T00:00:00Z"),
    });
    expect(result).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("fails after bounded exhausted retries", async () => {
    const fetcher = vi.fn().mockResolvedValue(response({}, 503));
    await expect(fetchPrimeObservationRange("2024-01-01", "2024-01-07", {
      attempts: 2, fetcher,
    })).rejects.toMatchObject({ retryable: true });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("returns empty coverage without fabricating a prior observation", async () => {
    const result = await fetchPrimeObservationRange("2024-01-01", "2024-01-07", {
      fetcher: vi.fn().mockResolvedValue(response({ observations: [] })),
    });
    expect(result).toEqual([]);
  });
});
