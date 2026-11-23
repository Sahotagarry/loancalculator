import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

const store = vi.hoisted(() => ({
  loans: [] as Record<string, any>[],
  revisions: [] as Record<string, any>[],
  writes: vi.fn(),
}));

// Exercise the real HTTP router, schemas, accounting validation, serializer and
// immutable revision writer. Only database I/O is replaced with a stateful store;
// GET must reload the saved row rather than echo the original request.
vi.mock("@workspace/db", async () => {
  const schema = await import("@workspace/db/schema");
  const copy = <T,>(value: T): T => structuredClone(value);
  const rows = (table: unknown) => table === schema.loansTable ? store.loans
    : table === schema.loanContractRevisionsTable ? store.revisions : [];
  const db = {
    select: () => {
      let table: unknown;
      let count = Infinity;
      const chain = {
        from: (value: unknown) => { table = value; return chain; },
        where: () => chain,
        orderBy: () => chain,
        limit: (value: number) => { count = value; return chain; },
        then: (resolve: (value: Record<string, any>[]) => unknown) =>
          Promise.resolve(copy([...rows(table)].reverse().slice(0, count))).then(resolve),
      };
      return chain;
    },
    insert: (table: unknown) => ({
      values: (value: Record<string, unknown>) => ({
        returning: async () => {
          store.writes("insert", table);
          const row = { id: `saved-${rows(table).length + 1}`, ...copy(value) };
          rows(table).push(row);
          return [copy(row)];
        },
      }),
    }),
    update: (table: unknown) => ({
      set: (value: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => {
            store.writes("update", table);
            Object.assign(rows(table)[0], copy(value));
            return [copy(rows(table)[0])];
          },
        }),
      }),
    }),
    execute: async () => [],
    query: { loansTable: { findFirst: async () => copy(store.loans[0]) } },
    transaction: async <T,>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      const previous = copy({ loans: store.loans, revisions: store.revisions });
      try { return await fn(db); }
      catch (error) {
        store.loans = previous.loans;
        store.revisions = previous.revisions;
        throw error;
      }
    },
  };
  return { ...schema, db };
});

import router from "./loans";
import { agreementKind } from "../lib/modification-assessment";

const ending = {
  version: 1, kind: "none", amount: 0, basis: "stated",
  source: "Reviewed agreement: return at expiry; no required ending payment.",
  settlementMonth: 12, status: "reviewed", issues: [],
};
const operating = {
  name: "Operating lease", principal: 11800, interestRate: 0, leaseAssessmentRate: 6,
  amortizationYears: 1, termYears: 1, termMonths: 12,
  startDate: "2026-01-01", fiscalYearEnd: "2026-12-31",
  monthlyPayment: 900, paymentOverride: 900, firstPaymentAmount: 1900,
  fairValue: 200000, assetUsefulLife: 10, paymentFrequency: "monthly",
  isCapitalLease: false, transferOfOwnership: false, bargainPurchaseOption: false,
  leaseEndingTerms: ending,
};

let server: Server;
let base: string;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(router);
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", error => error ? reject(error) : resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test server port");
  base = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});
beforeEach(() => {
  store.loans = [];
  store.revisions = [];
  store.writes.mockClear();
});

async function request(method: string, path: string, body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method, headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() as any };
}
const create = (body: unknown) => request("POST", "/files/file-1/loans", body);
const patch = (body: unknown) => request("PATCH", `/loans/${store.loans[0].id}`, body);
const reopen = () => request("GET", `/loans/${store.loans[0].id}`);

describe("loan API classification persistence", () => {
  it.each(["reviewed", "draft"])("rejects the nonzero operating-rate reproduction with %s evidence before persistence", async status => {
    const response = await create({
      ...operating, interestRate: 6, leaseAssessmentRate: null,
      leaseEndingTerms: { ...ending, status },
    });
    expect(response.status).toBe(400);
    expect(response.body.error).toContain("leaseAssessmentRate");
    expect(store.loans).toEqual([]);
    expect(store.revisions).toEqual([]);
    expect(store.writes).not.toHaveBeenCalled();
  });

  it.each(["termMonths", "monthlyPayment"])("rejects an explicit operating draft missing %s before persistence", async field => {
    const input: Record<string, unknown> = {
      ...operating, leaseEndingTerms: { ...ending, status: "draft" },
    };
    delete input[field];
    const response = await create(input);
    expect(response.status).toBe(400);
    expect(response.body.error).toContain("Operating leases require monthlyPayment and termMonths");
    expect(store.writes).not.toHaveBeenCalled();
  });

  it.each([
    { leaseAssessmentRate: 6 },
    { leaseAssessmentRate: null, leaseEndingTerms: { ...ending, discountRate: 6 } },
    { leaseAssessmentRate: null, leaseEndingTerms: { ...ending, implicitRate: 6 } },
  ])("saves and reopens operating evidence with a separate supported rate %j", async rateEvidence => {
    const created = await create({ ...operating, ...rateEvidence });
    expect(created.status).toBe(201);
    const saved = await reopen();
    expect(saved.status).toBe(200);
    expect(agreementKind(saved.body)).toBe("lease");
    expect(saved.body).toMatchObject({
      isCapitalLease: false, interestRate: "0", termMonths: 12,
      monthlyPayment: "900", paymentOverride: "900", firstPaymentAmount: "1900",
      interestMethod: null, leaseEndingTerms: { status: "reviewed", source: ending.source },
    });
    expect(saved.body.leaseAssessmentRate ?? null).toBe(rateEvidence.leaseAssessmentRate?.toString() ?? null);
    const originalEvidence = structuredClone(store.revisions);
    expect((await patch({ name: "Reviewed operating lease", leaseEndingTerms: saved.body.leaseEndingTerms })).status).toBe(200);
    expect((await reopen()).body.interestRate).toBe("0");
    expect(store.revisions.slice(0, originalEvidence.length)).toEqual(originalEvidence);
  });

  it.each([
    { interestRate: 6, leaseEndingTerms: ending },
    { interestRate: 6 },
    { interestRate: 6, leaseEndingTerms: { ...ending, status: "draft" } },
    { termMonths: null },
    { monthlyPayment: null },
  ])("rejects inconsistent operating updates without changing records or evidence %j", async update => {
    expect((await create(operating)).status).toBe(201);
    const before = structuredClone({ loans: store.loans, revisions: store.revisions });
    store.writes.mockClear();
    const response = await patch(update);
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/Operating leases require|Expected number/);
    expect({ loans: store.loans, revisions: store.revisions }).toEqual(before);
    expect(store.writes).not.toHaveBeenCalled();
    expect((await reopen()).body.interestRate).toBe("0");
  });

  it("retains the assessment rate when reconfirming a legacy operating lease without rewriting old evidence", async () => {
    expect((await create(operating)).status).toBe(201);
    store.loans[0].leaseEndingTerms = null;
    const original = structuredClone(store.revisions);
    expect((await patch({ leaseEndingTerms: ending, leaseAssessmentRate: 6 })).status).toBe(200);
    const saved = await reopen();
    expect(saved.body.interestRate).toBe("0");
    expect(saved.body.leaseAssessmentRate).toBe("6");
    expect(agreementKind(saved.body)).toBe("lease");
    expect(store.revisions.slice(0, original.length)).toEqual(original);
  });

  it.each([0, 6])("preserves ordinary %s percent loans on create and update without lease evidence", async interestRate => {
    const { leaseEndingTerms: _ending, leaseAssessmentRate: _rate, termMonths: _months, ...loan } = operating;
    expect((await create({ ...loan, interestRate })).status).toBe(201);
    expect(agreementKind((await reopen()).body)).toBe("loan");
    expect((await patch({ interestRate: interestRate + 1 })).status).toBe(200);
    expect((await reopen()).body.interestRate).toBe(String(interestRate + 1));
  });

  it("keeps capital-lease rates and measurements on their existing save path", async () => {
    const response = await create({ ...operating, isCapitalLease: true,
      interestRate: 6, fairValue: 11000, assetUsefulLife: 1 });
    expect(response.status).toBe(201);
    expect(response.body.isCapitalLease).toBe(true);
    expect(response.body.interestRate).toBe("6");
    expect(Number(response.body.principal)).toBeGreaterThan(0);
    expect((await patch({ leaseEndingTerms: response.body.leaseEndingTerms })).status).toBe(200);
    expect((await reopen()).body.interestRate).toBe("6");
  });

  it("does not reinterpret or convert an existing inconsistent record when reading it", async () => {
    expect((await create(operating)).status).toBe(201);
    store.loans[0].interestRate = "6";
    const original = structuredClone({ loans: store.loans, revisions: store.revisions });
    const saved = await reopen();
    expect(saved.status).toBe(200);
    expect(saved.body.interestRate).toBe("6");
    expect(agreementKind(saved.body)).toBe("loan");
    expect({ loans: store.loans, revisions: store.revisions }).toEqual(original);
  });
});
