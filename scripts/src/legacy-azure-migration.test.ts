import { describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildPlan,
  dryRun,
  humanReport,
  migrate,
  MigrationUnsafeError,
  type LegacySnapshot,
  type MigrationInput,
  type MigrationStore,
  type MigrationTransaction,
  type Ownership,
} from "./legacy-azure-migration.js";
import { reportContents, reserveReportFiles, writeSyncedReports } from "./legacy-azure-migration-cli.js";
import { lockMigrationTables, PgLegacyMigrationStore } from "./pg-legacy-migration-store.js";

const tenantId = "11111111-1111-4111-8111-111111111111";
const firmId = "22222222-2222-4222-8222-222222222222";
const clientId = "33333333-3333-4333-8333-333333333333";
const fileId = "44444444-4444-4444-8444-444444444444";
const dbId = "55555555-5555-4555-8555-555555555555";
const azureId = "66666666-6666-4666-8666-666666666666";

function fixture(): LegacySnapshot {
  return {
    clients: [{ id: clientId, firmId: null, adoptedAt: null }],
    files: [{ id: fileId, clientId }],
    documents: [
      { id: dbId, content: Buffer.from("db"), storageRef: null, tenantId: null, firmId: null, clientId: null, fileId: null },
      { id: azureId, content: null, storageRef: "legacy/blob.pdf", tenantId: null, firmId: null, clientId: null, fileId: null },
    ],
    references: [
      { kind: "loan", recordId: "loan-1", fileId, value: `db:${dbId}` },
      { kind: "master", recordId: "master-1", fileId, value: "legacy/blob.pdf" },
    ],
    counts: { clients: 1, files: 1, loans: 1, masterAgreements: 1, documents: 2 },
  };
}

const input: MigrationInput = {
  firm: { id: firmId, tenantId, name: "Explicit Firm" },
  bootstrapAdmin: { objectId: "77777777-7777-4777-8777-777777777777", role: "admin" },
  adoptClientIds: [clientId],
  memberships: [],
};

function clone(snapshot: LegacySnapshot): LegacySnapshot {
  const copied = structuredClone(snapshot);
  copied.documents = copied.documents.map((document) => ({
    ...document,
    content: document.content ? Buffer.from(document.content) : null,
  }));
  return copied;
}

class MemoryStore implements MigrationStore {
  committed: LegacySnapshot;
  constructor(snapshot = fixture(), private failOwn = false) { this.committed = clone(snapshot); }
  async snapshot() { return clone(this.committed); }
  async transaction<T>(work: (tx: MigrationTransaction) => Promise<T>): Promise<T> {
    const pending = clone(this.committed);
    const tx: MigrationTransaction = {
      snapshot: async () => clone(pending),
      ensureFirmAndUsers: async () => {},
      adoptClients: async (ids, id) => {
        for (const client of pending.clients) if (ids.includes(client.id)) {
          client.firmId = id; client.adoptedAt = client.adoptedAt ?? new Date(0).toISOString();
        }
      },
      addMemberships: async () => {},
      createDocument: async (document) => {
        pending.documents.push({
          id: document.id, content: null, storageRef: document.storageRef,
          ...document.ownership,
        });
        pending.counts.documents += 1;
      },
      ownDocument: async (id: string, ownership: Ownership) => {
        if (this.failOwn) throw new Error("write failed");
        Object.assign(pending.documents.find((document) => document.id === id)!, ownership);
      },
      rewriteReference: async (ref, opaque) => {
        pending.references.find((item) => item.kind === ref.kind && item.recordId === ref.recordId)!.value = opaque;
      },
    };
    const result = await work(tx);
    this.committed = pending;
    return result;
  }
}

describe("legacy Azure migration", () => {
  it("maps and verifies database and Azure documents", async () => {
    const reader = vi.fn(async () => Buffer.from("azure"));
    const report = await dryRun(new MemoryStore(), input, reader);
    expect(report.plan.safe).toBe(true);
    expect(report.plan.documents.map((document) => document.backend)).toEqual(["database", "azure"]);
    expect(reader).toHaveBeenCalledWith("legacy/blob.pdf");
    expect(report.plan.clientStatuses).toEqual([expect.objectContaining({
      id: clientId, firmAssigned: false, adopted: false, selected: true, mapped: true,
    })]);
    expect(report.plan.documentStatuses).toEqual([
      expect.objectContaining({ id: dbId, backend: "database", ownershipComplete: false, referenced: true, referenceCount: 1, disposition: "planned_migration" }),
      expect.objectContaining({ id: azureId, backend: "azure", ownershipComplete: false, referenced: true, referenceCount: 1, disposition: "planned_migration" }),
    ]);
    expect(report.plan.referenceMappings).toEqual([
      expect.objectContaining({ kind: "loan", recordId: "loan-1", sourceRef: `db:${dbId}`, documentId: dbId, targetRef: `doc:${dbId}`, clientId, status: "mapped" }),
      expect.objectContaining({ kind: "master", recordId: "master-1", sourceRef: "legacy/blob.pdf", documentId: azureId, targetRef: `doc:${azureId}`, clientId, status: "mapped" }),
    ]);
    const human = humanReport(report);
    expect(human).toContain(`Clients:\n  ${clientId}: firm=(unassigned) adopted=false selected=true mapped=true`);
    expect(human).toContain(`${`db:${dbId}`} -> doc:${dbId} [mapped]`);
    expect(human).toContain(`document=${azureId} legacy/blob.pdf -> doc:${azureId} [mapped]`);
  });

  it("adopts a raw Azure reference without a pre-existing document row", async () => {
    const state = fixture();
    state.documents = state.documents.slice(0, 1);
    state.counts.documents = 1;
    const store = new MemoryStore(state);
    const report = await migrate(store, input, async () => Buffer.from("azure"));
    expect(report.after.documents).toBe(2);
    expect(store.committed.documents[1]).toEqual(expect.objectContaining({
      storageRef: "legacy/blob.pdf", content: null, clientId, fileId,
    }));
    expect(store.committed.references[1].value).toMatch(/^doc:[0-9a-f-]{36}$/);
  });

  it("migrates idempotently and preserves both backends", async () => {
    const store = new MemoryStore();
    await migrate(store, input, async () => Buffer.from("azure"));
    const first = clone(store.committed);
    await migrate(store, input, async () => Buffer.from("azure"));
    expect(store.committed).toEqual(first);
    expect(store.committed.references.map((ref) => ref.value)).toEqual([`doc:${dbId}`, `doc:${azureId}`]);
    expect(store.committed.documents[1].storageRef).toBe("legacy/blob.pdf");
  });

  it("fails ambiguous raw blob ownership", () => {
    const state = fixture();
    state.documents.push({ ...state.documents[1], id: "88888888-8888-4888-8888-888888888888" });
    expect(buildPlan(state, tenantId, firmId).findings).toContainEqual(expect.objectContaining({ code: "ambiguous_document" }));
  });

  it.each([
    ["missing file", (state: LegacySnapshot) => { state.files = []; }, "missing_file"],
    ["missing reference row", (state: LegacySnapshot) => { state.documents = state.documents.slice(1); }, "missing_document"],
  ])("reports %s", (_name, mutate, code) => {
    const state = fixture(); mutate(state);
    expect(buildPlan(state, tenantId, firmId).findings).toContainEqual(expect.objectContaining({ code }));
  });

  it("rejects an explicitly selected client that does not exist", async () => {
    const missingClientId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const report = await dryRun(
      new MemoryStore(),
      { ...input, adoptClientIds: [clientId, missingClientId] },
      async () => Buffer.from("azure"),
    );
    expect(report.plan.safe).toBe(false);
    expect(report.plan.findings).toContainEqual(expect.objectContaining({
      code: "missing_client",
      record: missingClientId,
    }));
  });

  it("rejects an explicitly selected client owned by another firm even without document references", async () => {
    const otherClientId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const state = fixture();
    state.clients.push({
      id: otherClientId,
      firmId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      adoptedAt: new Date(0).toISOString(),
    });
    const report = await dryRun(
      new MemoryStore(state),
      { ...input, adoptClientIds: [clientId, otherClientId] },
      async () => Buffer.from("azure"),
    );
    expect(report.plan.safe).toBe(false);
    expect(report.plan.findings).toContainEqual(expect.objectContaining({
      code: "conflicting_ownership",
      record: otherClientId,
    }));
  });

  it("fails unreadable Azure bytes before writing", async () => {
    const store = new MemoryStore();
    await expect(migrate(store, input, async () => null)).rejects.toBeInstanceOf(MigrationUnsafeError);
    expect(store.committed).toEqual(fixture());
  });

  it("rolls the transaction back on any write failure", async () => {
    const store = new MemoryStore(fixture(), true);
    await expect(migrate(store, input, async () => Buffer.from("azure"))).rejects.toThrow("write failed");
    expect(store.committed).toEqual(fixture());
  });

  it("rolls back when pre-commit reconciliation persistence fails", async () => {
    const store = new MemoryStore();
    await expect(migrate(store, input, async () => Buffer.from("azure"), async () => {
      throw new Error("audit disk failure");
    })).rejects.toThrow("audit disk failure");
    expect(store.committed).toEqual(fixture());
  });

  it("reports fully-owned unreferenced documents as skipped with a reason", () => {
    const state = fixture();
    state.references = [];
    state.documents[0] = { ...state.documents[0], tenantId, firmId, clientId, fileId };
    const plan = buildPlan(state, tenantId, firmId, new Set([clientId]));
    expect(plan.documentStatuses.find((document) => document.id === dbId)).toEqual(expect.objectContaining({
      disposition: "skipped", reason: "Fully-owned document has no loan/master reference",
    }));
  });

  it("reserves and synchronously writes report files without bytes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "legacy-report-"));
    try {
      const json = join(directory, "report.json");
      const human = join(directory, "report.txt");
      await reserveReportFiles(json, human);
      const report = await dryRun(new MemoryStore(), input, async () => Buffer.from("azure"));
      await writeSyncedReports(json, human, report);
      expect(await readFile(json, "utf8")).toContain("\"referenceMappings\"");
      expect(await readFile(human, "utf8")).toContain("Proposed reference rewrites:");
      expect(reportContents(report).json).not.toContain("\"content\"");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("acquires the adapter's write-blocking table lock before transaction work", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    await lockMigrationTables({ query } as never);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("LOCK TABLE clients, files, loans, master_agreements"));
    expect(query).toHaveBeenCalledWith(expect.stringContaining("IN SHARE ROW EXCLUSIVE MODE"));
  });

  it("locks before work and rolls back a failed PostgreSQL adapter transaction", async () => {
    const calls: string[] = [];
    const client = {
      query: vi.fn(async (sql: string) => { calls.push(sql); return { rows: [] }; }),
      release: vi.fn(),
    };
    const pool = { connect: vi.fn(async () => client) };
    const store = new PgLegacyMigrationStore("postgres://not-used", pool as never);
    await expect(store.transaction(async () => {
      expect(calls[1]).toContain("LOCK TABLE clients");
      throw new Error("fail after lock");
    })).rejects.toThrow("fail after lock");
    expect(calls[0]).toBe("BEGIN ISOLATION LEVEL REPEATABLE READ");
    expect(calls[1]).toContain("IN SHARE ROW EXCLUSIVE MODE");
    expect(calls.at(-1)).toBe("ROLLBACK");
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("rejects one document referenced through conflicting files", () => {
    const state = fixture();
    const otherFile = "99999999-9999-4999-8999-999999999999";
    state.files.push({ id: otherFile, clientId });
    state.references.push({ kind: "loan", recordId: "loan-2", fileId: otherFile, value: `db:${dbId}` });
    expect(buildPlan(state, tenantId, firmId).findings).toContainEqual(expect.objectContaining({ code: "conflicting_ownership" }));
  });
});