import { Pool, type PoolClient, type QueryResultRow } from "pg";
import type {
  LegacyReference,
  LegacySnapshot,
  MigrationInput,
  MigrationStore,
  MigrationTransaction,
  Ownership,
  ProposedDocument,
} from "./legacy-azure-migration.js";

type Queryable = Pick<PoolClient, "query">;

async function rows<T extends QueryResultRow>(db: Queryable, sql: string, values: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, values)).rows;
}

async function loadSnapshot(db: Queryable, lock = false): Promise<LegacySnapshot> {
  const suffix = lock ? " FOR SHARE" : "";
  const [clients, files, documents, loans, masters, countRows] = await Promise.all([
    rows<{ id: string; firm_id: string | null; adopted_at: Date | null }>(db, `SELECT id, firm_id, adopted_at FROM clients ORDER BY id${suffix}`),
    rows<{ id: string; client_id: string }>(db, `SELECT id, client_id FROM files ORDER BY id${suffix}`),
    rows<{ id: string; content: Buffer | null; storage_ref: string | null; tenant_id: string | null; firm_id: string | null; client_id: string | null; file_id: string | null }>(
      db, `SELECT id, content, storage_ref, tenant_id, firm_id, client_id, file_id FROM stored_documents ORDER BY id${suffix}`,
    ),
    rows<{ id: string; file_id: string; source_document_blob: string }>(
      db, `SELECT id, file_id, source_document_blob FROM loans WHERE source_document_blob IS NOT NULL ORDER BY id${suffix}`,
    ),
    rows<{ id: string; file_id: string; source_document_blob: string }>(
      db, `SELECT id, file_id, source_document_blob FROM master_agreements WHERE source_document_blob IS NOT NULL ORDER BY id${suffix}`,
    ),
    rows<Record<string, string>>(db, `SELECT
      (SELECT count(*) FROM clients)::text AS clients,
      (SELECT count(*) FROM clients WHERE adopted_at IS NOT NULL)::text AS adopted_clients,
      (SELECT count(*) FROM clients WHERE quarantined_at IS NOT NULL)::text AS quarantined_clients,
      (SELECT count(*) FROM files)::text AS files,
      (SELECT count(*) FROM loans)::text AS loans,
      (SELECT count(*) FROM master_agreements)::text AS master_agreements,
      (SELECT count(*) FROM stored_documents)::text AS documents,
      (SELECT count(*) FROM stored_documents WHERE content IS NOT NULL)::text AS database_documents,
      (SELECT count(*) FROM stored_documents WHERE storage_ref IS NOT NULL)::text AS azure_documents,
      (SELECT count(*) FROM stored_documents WHERE tenant_id IS NULL OR firm_id IS NULL OR client_id IS NULL OR file_id IS NULL)::text AS unowned_documents`),
  ]);
  const references: LegacyReference[] = [
    ...loans.map((row) => ({ kind: "loan" as const, recordId: row.id, fileId: row.file_id, value: row.source_document_blob })),
    ...masters.map((row) => ({ kind: "master" as const, recordId: row.id, fileId: row.file_id, value: row.source_document_blob })),
  ].sort((a, b) => `${a.kind}:${a.recordId}`.localeCompare(`${b.kind}:${b.recordId}`));
  return {
    clients: clients.map((row) => ({ id: row.id, firmId: row.firm_id, adoptedAt: row.adopted_at?.toISOString() ?? null })),
    files: files.map((row) => ({ id: row.id, clientId: row.client_id })),
    documents: documents.map((row) => ({
      id: row.id, content: row.content, storageRef: row.storage_ref, tenantId: row.tenant_id,
      firmId: row.firm_id, clientId: row.client_id, fileId: row.file_id,
    })),
    references,
    counts: Object.fromEntries(Object.entries(countRows[0]).map(([key, value]) => [
      key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()), Number(value),
    ])),
  };
}

/** Allows ordinary SELECTs but conflicts with row-writing and schema locks.
 * Acquiring these before the first snapshot prevents phantom inserts and
 * relationship rewrites between byte verification and COMMIT. */
export async function lockMigrationTables(db: Queryable): Promise<void> {
  await db.query(`LOCK TABLE clients, files, loans, master_agreements,
    stored_documents, firms, app_users, client_memberships
    IN SHARE ROW EXCLUSIVE MODE`);
}

class PgTransaction implements MigrationTransaction {
  constructor(private readonly db: PoolClient) {}
  snapshot() { return loadSnapshot(this.db, true); }

  async ensureFirmAndUsers(input: MigrationInput): Promise<void> {
    const existing = await rows<{ id: string; tenant_id: string; name: string }>(
      this.db, `SELECT id, tenant_id, name FROM firms ORDER BY id FOR UPDATE`,
    );
    if (existing.length && (existing.length !== 1 || existing[0].id !== input.firm.id ||
      existing[0].tenant_id !== input.firm.tenantId || existing[0].name !== input.firm.name)) {
      throw new Error("Database does not contain exactly the explicitly supplied single firm");
    }
    if (!existing.length) {
      await this.db.query(`INSERT INTO firms (id, tenant_id, name) VALUES ($1, $2, $3)`,
        [input.firm.id, input.firm.tenantId, input.firm.name]);
    }
    const identities = [input.bootstrapAdmin, ...(input.users ?? [])];
    const seen = new Set<string>();
    for (const identity of identities) {
      if (seen.has(identity.objectId)) throw new Error(`Identity ${identity.objectId} was supplied more than once`);
      seen.add(identity.objectId);
      await this.db.query(`INSERT INTO app_users
        (tenant_id, object_id, firm_id, role, display_name, email)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (tenant_id, object_id) DO UPDATE SET
          firm_id = EXCLUDED.firm_id, role = EXCLUDED.role,
          display_name = EXCLUDED.display_name, email = EXCLUDED.email,
          is_active = true, updated_at = now()`,
      [input.firm.tenantId, identity.objectId, input.firm.id, identity.role, identity.displayName ?? null, identity.email ?? null]);
    }
  }

  async adoptClients(clientIds: string[], firmId: string): Promise<void> {
    for (const clientId of [...new Set(clientIds)].sort()) {
      const result = await this.db.query(`UPDATE clients SET
        firm_id = $2, adopted_at = COALESCE(adopted_at, now()),
        quarantined_at = NULL, quarantine_reason = NULL, updated_at = now()
        WHERE id = $1 AND (firm_id IS NULL OR firm_id = $2)`, [clientId, firmId]);
      if (result.rowCount !== 1) throw new Error(`Client ${clientId} is missing or belongs to another firm`);
    }
  }

  async addMemberships(tenantId: string, memberships: NonNullable<MigrationInput["memberships"]>): Promise<void> {
    for (const membership of memberships) {
      await this.db.query(`INSERT INTO client_memberships (client_id, tenant_id, object_id)
        VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [membership.clientId, tenantId, membership.objectId]);
    }
  }

  async createDocument(document: ProposedDocument): Promise<void> {
    if (!document.create || document.backend !== "azure" || !document.storageRef) {
      throw new Error(`Invalid request to create legacy document ${document.id}`);
    }
    await this.db.query(`INSERT INTO stored_documents
      (id, name, content, storage_ref, tenant_id, firm_id, client_id, file_id)
      VALUES ($1, $2, NULL, $3, $4, $5, $6, $7)`,
    [
      document.id,
      document.storageRef.split("/").pop() || "legacy-document",
      document.storageRef,
      document.ownership.tenantId,
      document.ownership.firmId,
      document.ownership.clientId,
      document.ownership.fileId,
    ]);
  }

  async ownDocument(documentId: string, ownership: Ownership): Promise<void> {
    const result = await this.db.query(`UPDATE stored_documents SET
      tenant_id=$2, firm_id=$3, client_id=$4, file_id=$5
      WHERE id=$1 AND
        (tenant_id IS NULL OR tenant_id=$2) AND (firm_id IS NULL OR firm_id=$3) AND
        (client_id IS NULL OR client_id=$4) AND (file_id IS NULL OR file_id=$5)`,
    [documentId, ownership.tenantId, ownership.firmId, ownership.clientId, ownership.fileId]);
    if (result.rowCount !== 1) throw new Error(`Document ${documentId} changed or has conflicting ownership`);
  }

  async rewriteReference(ref: LegacyReference, opaqueRef: string): Promise<void> {
    const table = ref.kind === "loan" ? "loans" : "master_agreements";
    const result = await this.db.query(`UPDATE ${table} SET source_document_blob=$1, updated_at=now()
      WHERE id=$2 AND file_id=$3 AND source_document_blob=$4`, [opaqueRef, ref.recordId, ref.fileId, ref.value]);
    // A rerun has an opaque value in ref.value and still updates one row.
    if (result.rowCount !== 1) throw new Error(`${ref.kind} ${ref.recordId} changed during migration`);
  }
}

export class PgLegacyMigrationStore implements MigrationStore {
  readonly pool: Pool;
  constructor(connectionString: string, pool?: Pool) {
    // Optional injection keeps lock/rollback ordering testable without a DB.
    this.pool = pool ?? new Pool({ connectionString, max: 2 });
  }
  snapshot() { return loadSnapshot(this.pool); }
  async transaction<T>(work: (tx: MigrationTransaction) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
      await lockMigrationTables(client);
      const result = await work(new PgTransaction(client));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  close() { return this.pool.end(); }
}