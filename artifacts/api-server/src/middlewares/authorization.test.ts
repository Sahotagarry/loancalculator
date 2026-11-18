import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const results: unknown[][] = [];
  class Builder {
    from() { return this; }
    innerJoin() { return this; }
    where() { return this; }
    orderBy() { return this; }
    limit() { return Promise.resolve(results.shift() ?? []); }
    then(resolve: (value: unknown[]) => unknown) { return Promise.resolve(results.shift() ?? []).then(resolve); }
  }
  const table = new Proxy({}, { get: (_target, property) => ({ name: String(property) }) });
  return { results, Builder, table };
});

vi.mock("drizzle-orm", () => ({
  and: () => ({}), eq: () => ({}), isNull: () => ({}),
}));
vi.mock("@workspace/db", () => ({
  db: { select: () => new mocks.Builder() },
  clientMembershipsTable: mocks.table, clientsTable: mocks.table, filesTable: mocks.table,
  loansTable: mocks.table, masterAgreementsTable: mocks.table,
}));

import { authorizeRequest } from "./authorization";

const auth = {
  tenantId: "tenant", objectId: "user", firmId: "firm-a",
  displayName: null, email: null, role: "manager",
};
const adopted = (id = "client-a", firmId = "firm-a") => ({
  id, firmId, adoptedAt: new Date(), quarantinedAt: null,
});

async function invoke(path: string, method = "GET", body?: unknown) {
  let next = false; let status: number | undefined;
  const req = { path, method, body, auth } as never;
  const response = { status(code: number) { status = code; return response; }, json() {} };
  await authorizeRequest(req, response as never, () => { next = true; });
  return { next, status };
}

describe("direct resource authorization", () => {
  beforeEach(() => { mocks.results.length = 0; auth.role = "manager"; });

  for (const role of ["manager", "accountant", "read_only"]) {
    it(`allows ${role} members to manage only their client's access`, async () => {
      auth.role = role;
      mocks.results.push([adopted()], [{ clientId: "client-a" }]);
      expect(await invoke("/admin/clients/client-a/members", "PUT")).toEqual({ next: true, status: undefined });
      mocks.results.push([adopted()], []);
      expect(await invoke("/admin/clients/client-a/members", "PUT")).toEqual({ next: false, status: 404 });
      expect(await invoke("/admin/users", "POST")).toEqual({ next: false, status: 403 });
      expect(await invoke("/admin/clients")).toEqual({ next: false, status: 403 });
    });
  }
  it("allows an administrator without membership but never across firms", async () => {
    auth.role = "admin";
    mocks.results.push([adopted()]);
    expect(await invoke("/admin/clients/client-a/members", "PUT")).toEqual({ next: true, status: undefined });
    mocks.results.push([adopted("client-b", "other-firm")]);
    expect(await invoke("/admin/clients/client-b/members", "PUT")).toEqual({ next: false, status: 404 });
  });
  it("keeps other read-only writes forbidden", async () => {
    auth.role = "read_only";
    expect(await invoke("/loans/loan-a", "PATCH")).toEqual({ next: false, status: 403 });
  });

  const directPaths = [
    "/clients/client-x", "/files/file-x", "/loans/loan-x",
    "/loans/loan-x/rate-timeline", "/loans/loan-x/rate-overrides",
    "/loans/loan-x/rate-restores", "/master-agreements/master-x",
    "/trash/client/client-x/restore", "/trash/file/file-x/restore",
    "/trash/loan/loan-x/restore",
  ];

  for (const path of directPaths) {
    it(`conceals unauthorized ${path}`, async () => {
      mocks.results.push([adopted("client-x", "different-firm")]);
      await expect(invoke(path)).resolves.toEqual({ next: false, status: 404 });
    });
  }

  for (const path of ["/clients/client-a", "/files/file-a", "/loans/loan-a", "/master-agreements/master-a", "/trash/loan/loan-a/restore"]) {
    it(`allows assigned adopted resource ${path}`, async () => {
      mocks.results.push([adopted()], [{ clientId: "client-a" }]);
      await expect(invoke(path)).resolves.toEqual({ next: true, status: undefined });
    });
  }

  it("conceals an adopted same-firm client without membership", async () => {
    mocks.results.push([adopted()], []);
    await expect(invoke("/loans/loan-x")).resolves.toEqual({ next: false, status: 404 });
  });

  it("requires rollforward target to be the same authorized client", async () => {
    mocks.results.push(
      [adopted("source-client")], [{ clientId: "source-client" }],
      [adopted("other-client")],
    );
    await expect(invoke("/loans/loan-a/rollforward", "POST", { fileId: "target-file" }))
      .resolves.toEqual({ next: false, status: 404 });
  });

  it("allows rollforward when source and target resolve to the same assigned client", async () => {
    mocks.results.push(
      [adopted("client-a")], [{ clientId: "client-a" }],
      [adopted("client-a")], [{ clientId: "client-a" }],
    );
    await expect(invoke("/loans/loan-a/rollforward", "POST", { fileId: "target-file" }))
      .resolves.toEqual({ next: true, status: undefined });
  });
});