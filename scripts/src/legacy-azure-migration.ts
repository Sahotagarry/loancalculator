import { createHash } from "node:crypto";

export type LegacyReference = {
  kind: "loan" | "master";
  recordId: string;
  fileId: string;
  value: string;
};

export type LegacySnapshot = {
  clients: Array<{ id: string; firmId: string | null; adoptedAt: string | null }>;
  files: Array<{ id: string; clientId: string }>;
  documents: Array<{
    id: string;
    content: Buffer | null;
    storageRef: string | null;
    tenantId: string | null;
    firmId: string | null;
    clientId: string | null;
    fileId: string | null;
  }>;
  references: LegacyReference[];
  counts: Record<string, number>;
};

export type Ownership = { tenantId: string; firmId: string; clientId: string; fileId: string };
export type ProposedDocument = {
  id: string;
  backend: "database" | "azure";
  storageRef: string | null;
  create: boolean;
  ownership: Ownership;
  references: LegacyReference[];
};
export type Finding = {
  code: "missing_file" | "missing_client" | "missing_document" | "ambiguous_document" |
    "conflicting_ownership" | "invalid_reference" | "unreadable_document" | "client_not_selected" |
    "unreferenced_document";
  message: string;
  record?: string;
};
export type MigrationPlan = {
  safe: boolean;
  counts: Record<string, number>;
  documents: ProposedDocument[];
  clients: string[];
  clientStatuses: Array<{
    id: string;
    firmId: string | null;
    firmAssigned: boolean;
    adopted: boolean;
    selected: boolean;
    mapped: boolean;
  }>;
  documentStatuses: Array<{
    id: string;
    exists: boolean;
    backend: "database" | "azure" | "invalid";
    ownershipComplete: boolean;
    referenced: boolean;
    referenceCount: number;
    disposition: "planned_migration" | "already_migrated" | "skipped" | "unsafe";
    reason: string;
  }>;
  referenceMappings: Array<{
    kind: LegacyReference["kind"];
    recordId: string;
    fileId: string;
    clientId: string | null;
    sourceRef: string;
    documentId: string | null;
    targetRef: string | null;
    targetTenantId: string | null;
    targetFirmId: string | null;
    status: "mapped" | "unsafe";
  }>;
  findings: Finding[];
};
export type Identity = { objectId: string; role: "admin" | "manager" | "accountant" | "read_only"; displayName?: string; email?: string };
export type MigrationInput = {
  firm: { id: string; tenantId: string; name: string };
  bootstrapAdmin: Identity;
  adoptClientIds: string[];
  users?: Identity[];
  memberships?: Array<{ clientId: string; objectId: string }>;
};
export type Reconciliation = {
  status: "dry-run" | "migrated";
  before: Record<string, number>;
  after: Record<string, number>;
  plan: MigrationPlan;
};

export interface MigrationTransaction {
  ensureFirmAndUsers(input: MigrationInput): Promise<void>;
  adoptClients(clientIds: string[], firmId: string): Promise<void>;
  addMemberships(tenantId: string, memberships: NonNullable<MigrationInput["memberships"]>): Promise<void>;
  createDocument(document: ProposedDocument): Promise<void>;
  ownDocument(documentId: string, ownership: Ownership): Promise<void>;
  rewriteReference(ref: LegacyReference, opaqueRef: string): Promise<void>;
  snapshot(): Promise<LegacySnapshot>;
}

export interface MigrationStore {
  snapshot(): Promise<LegacySnapshot>;
  transaction<T>(work: (tx: MigrationTransaction) => Promise<T>): Promise<T>;
}

export type ByteReader = (storageRef: string) => Promise<Buffer | null>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function documentCandidates(value: string, documents: LegacySnapshot["documents"]) {
  if (value.startsWith("db:") || value.startsWith("doc:")) {
    const id = value.startsWith("db:") ? value.slice(3) : value.slice(4);
    if (!UUID.test(id)) return [];
    return documents.filter((document) => document.id === id);
  }
  return documents.filter((document) => document.storageRef === value);
}

function deterministicDocumentId(storageRef: string): string {
  const bytes = createHash("sha256").update("clearline-legacy-azure\0").update(storageRef).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function buildPlan(snapshot: LegacySnapshot, tenantId: string, firmId: string, selectedClients?: Set<string>): MigrationPlan {
  const findings: Finding[] = [];
  const files = new Map(snapshot.files.map((file) => [file.id, file]));
  const clients = new Map(snapshot.clients.map((client) => [client.id, client]));
  const proposed = new Map<string, ProposedDocument>();

  for (const ref of snapshot.references) {
    const file = files.get(ref.fileId);
    if (!file) {
      findings.push({ code: "missing_file", record: `${ref.kind}:${ref.recordId}`, message: `Reference belongs to missing file ${ref.fileId}` });
      continue;
    }
    if (!clients.has(file.clientId)) {
      findings.push({ code: "missing_client", record: `${ref.kind}:${ref.recordId}`, message: `File ${file.id} belongs to missing client ${file.clientId}` });
      continue;
    }
    const opaqueId = ref.value.startsWith("db:") ? ref.value.slice(3) : ref.value.startsWith("doc:") ? ref.value.slice(4) : null;
    if (opaqueId !== null && !UUID.test(opaqueId)) {
      findings.push({ code: "invalid_reference", record: `${ref.kind}:${ref.recordId}`, message: `Malformed document reference ${ref.value}` });
      continue;
    }
    const candidates = documentCandidates(ref.value, snapshot.documents);
    if (!candidates.length) {
      if (opaqueId !== null) {
        findings.push({ code: "missing_document", record: `${ref.kind}:${ref.recordId}`, message: `No stored document matches ${ref.value}` });
        continue;
      }
      const id = deterministicDocumentId(ref.value);
      const colliding = snapshot.documents.find((document) => document.id === id);
      if (colliding) {
        findings.push({ code: "conflicting_ownership", record: id, message: `Deterministic Azure handle collides with another document` });
        continue;
      }
      candidates.push({
        id, content: null, storageRef: ref.value, tenantId: null, firmId: null,
        clientId: null, fileId: null,
      });
    }
    if (candidates.length > 1) {
      findings.push({ code: "ambiguous_document", record: `${ref.kind}:${ref.recordId}`, message: `${ref.value} matches ${candidates.length} documents` });
      continue;
    }
    const document = candidates[0];
    const ownership = { tenantId, firmId, clientId: file.clientId, fileId: file.id };
    const existing = proposed.get(document.id);
    if (existing && (existing.ownership.clientId !== ownership.clientId || existing.ownership.fileId !== ownership.fileId)) {
      findings.push({ code: "conflicting_ownership", record: document.id, message: `Document is referenced by multiple client/file relationships` });
      continue;
    }
    const persisted = [document.tenantId, document.firmId, document.clientId, document.fileId];
    const expected = [tenantId, firmId, file.clientId, file.id];
    if (tenantId !== "<tenant>" && persisted.some((value, index) => value !== null && value !== expected[index])) {
      findings.push({ code: "conflicting_ownership", record: document.id, message: `Existing document ownership conflicts with ${file.clientId}/${file.id}` });
      continue;
    }
    const backend = document.content !== null ? "database" : document.storageRef ? "azure" : null;
    if (!backend || (document.content !== null && document.storageRef !== null)) {
      findings.push({ code: "unreadable_document", record: document.id, message: `Document does not have exactly one storage backend` });
      continue;
    }
    if (!existing) proposed.set(document.id, {
      id: document.id,
      backend,
      storageRef: document.storageRef,
      create: !snapshot.documents.some((item) => item.id === document.id),
      ownership,
      references: [],
    });
    proposed.get(document.id)!.references.push(ref);
  }

  const usedClients = [...new Set([...proposed.values()].map((item) => item.ownership.clientId))].sort();
  const proposedIds = new Set(proposed.keys());
  const skipped = snapshot.documents.filter((document) => !proposedIds.has(document.id));
  for (const document of skipped) {
    if (!document.tenantId || !document.firmId || !document.clientId || !document.fileId) {
      findings.push({ code: "unreferenced_document", record: document.id, message: "Unowned stored document has no loan/master reference proving ownership" });
    }
  }
  if (selectedClients) {
    for (const clientId of usedClients) {
      if (!selectedClients.has(clientId)) findings.push({ code: "client_not_selected", record: clientId, message: `Client must be explicitly selected for adoption` });
    }
    for (const clientId of selectedClients) {
      const client = clients.get(clientId);
      if (!client) {
        findings.push({ code: "missing_client", record: clientId, message: "Explicitly selected client does not exist" });
      } else if (client.firmId && client.firmId !== firmId) {
        findings.push({ code: "conflicting_ownership", record: clientId, message: "Explicitly selected client already belongs to another firm" });
      }
    }
  }
  const clientStatuses = snapshot.clients.map((client) => ({
    id: client.id,
    firmId: client.firmId,
    firmAssigned: client.firmId !== null,
    adopted: client.adoptedAt !== null,
    selected: selectedClients?.has(client.id) ?? false,
    mapped: usedClients.includes(client.id),
  })).sort((a, b) => a.id.localeCompare(b.id));
  const proposedByReference = new Map<string, ProposedDocument>();
  for (const document of proposed.values()) {
    for (const ref of document.references) proposedByReference.set(`${ref.kind}:${ref.recordId}`, document);
  }
  const referenceMappings = snapshot.references.map((ref) => {
    const document = proposedByReference.get(`${ref.kind}:${ref.recordId}`);
    return {
      kind: ref.kind,
      recordId: ref.recordId,
      fileId: ref.fileId,
      clientId: files.get(ref.fileId)?.clientId ?? null,
      sourceRef: ref.value,
      documentId: document?.id ?? null,
      targetRef: document ? `doc:${document.id}` : null,
      targetTenantId: document?.ownership.tenantId ?? null,
      targetFirmId: document?.ownership.firmId ?? null,
      status: document ? "mapped" as const : "unsafe" as const,
    };
  });
  const allStatusDocuments = [
    ...snapshot.documents.map((document) => ({ document, exists: true })),
    ...[...proposed.values()]
      .filter((document) => document.create)
      .map((document) => ({
        exists: false,
        document: {
          id: document.id, content: null, storageRef: document.storageRef,
          ...document.ownership,
        },
      })),
  ];
  const documentStatuses = allStatusDocuments.map(({ document, exists }) => {
    const references = snapshot.references.filter((ref) => {
      if (ref.value === document.storageRef && !ref.value.startsWith("db:") && !ref.value.startsWith("doc:")) return true;
      const id = ref.value.startsWith("db:") ? ref.value.slice(3) : ref.value.startsWith("doc:") ? ref.value.slice(4) : null;
      return id === document.id;
    });
    const ownershipComplete = Boolean(document.tenantId && document.firmId && document.clientId && document.fileId);
    const relevantFindings = findings.filter((finding) =>
      finding.record === document.id || references.some((ref) => finding.record === `${ref.kind}:${ref.recordId}`));
    const proposedDocument = proposed.get(document.id);
    const allOpaque = references.every((ref) => ref.value === `doc:${document.id}`);
    const disposition = relevantFindings.length ? "unsafe" as const :
      !references.length ? (ownershipComplete ? "skipped" as const : "unsafe" as const) :
      ownershipComplete && allOpaque ? "already_migrated" as const : "planned_migration" as const;
    const reason = relevantFindings.length ? relevantFindings.map((finding) => finding.code).join(", ") :
      disposition === "already_migrated" ? "Opaque references and complete ownership already match" :
      disposition === "skipped" ? "Fully-owned document has no loan/master reference" :
      disposition === "planned_migration" ? (proposedDocument?.create ? "Create document row for verified legacy Azure locator" : "Backfill ownership and rewrite references") :
      "Unowned document has no reference proving ownership";
    return {
      id: document.id,
      exists,
      backend: document.content !== null && document.storageRef === null ? "database" as const :
        document.content === null && document.storageRef !== null ? "azure" as const : "invalid" as const,
      ownershipComplete,
      referenced: references.length > 0,
      referenceCount: references.length,
      disposition,
      reason,
    };
  }).sort((a, b) => a.id.localeCompare(b.id));
  return {
    safe: findings.length === 0,
    counts: { ...snapshot.counts, references: snapshot.references.length, mappedDocuments: proposed.size, skippedDocuments: skipped.length, findings: findings.length },
    documents: [...proposed.values()].sort((a, b) => a.id.localeCompare(b.id)),
    clients: usedClients,
    clientStatuses,
    documentStatuses,
    referenceMappings,
    findings,
  };
}

export async function verifyPlan(plan: MigrationPlan, snapshot: LegacySnapshot, readAzure: ByteReader): Promise<void> {
  const byId = new Map(snapshot.documents.map((document) => [document.id, document]));
  for (const proposed of plan.documents) {
    const document = byId.get(proposed.id);
    try {
      const bytes = proposed.backend === "database" ? document?.content : await readAzure(proposed.storageRef!);
      if (!bytes) throw new Error("no bytes returned");
    } catch (error) {
      plan.findings.push({ code: "unreadable_document", record: proposed.id, message: `Unable to read ${proposed.backend} bytes: ${error instanceof Error ? error.message : String(error)}` });
    }
  }
  plan.counts.findings = plan.findings.length;
  plan.safe = plan.findings.length === 0;
}

export async function inventory(store: MigrationStore): Promise<MigrationPlan> {
  const snapshot = await store.snapshot();
  return buildPlan(snapshot, "<tenant>", "<firm>");
}

export async function dryRun(store: MigrationStore, input: MigrationInput, readAzure: ByteReader): Promise<Reconciliation> {
  validateInput(input);
  const beforeSnapshot = await store.snapshot();
  const plan = buildPlan(beforeSnapshot, input.firm.tenantId, input.firm.id, new Set(input.adoptClientIds));
  await verifyPlan(plan, beforeSnapshot, readAzure);
  return { status: "dry-run", before: beforeSnapshot.counts, after: beforeSnapshot.counts, plan };
}

export async function migrate(
  store: MigrationStore,
  input: MigrationInput,
  readAzure: ByteReader,
  beforeCommit?: (report: Reconciliation) => Promise<void>,
): Promise<Reconciliation> {
  validateInput(input);
  const report = await dryRun(store, input, readAzure);
  if (!report.plan.safe) throw new MigrationUnsafeError(report);
  return store.transaction(async (tx) => {
    // Verify again inside the transaction so no writes follow stale byte checks.
    const locked = await tx.snapshot();
    const plan = buildPlan(locked, input.firm.tenantId, input.firm.id, new Set(input.adoptClientIds));
    await verifyPlan(plan, locked, readAzure);
    if (!plan.safe) throw new MigrationUnsafeError({ ...report, plan });
    await tx.ensureFirmAndUsers(input);
    await tx.adoptClients(input.adoptClientIds, input.firm.id);
    await tx.addMemberships(input.firm.tenantId, input.memberships ?? []);
    for (const document of plan.documents) {
      if (document.create) await tx.createDocument(document);
      await tx.ownDocument(document.id, document.ownership);
      for (const ref of document.references) await tx.rewriteReference(ref, `doc:${document.id}`);
    }
    const afterSnapshot = await tx.snapshot();
    const afterPlan = buildPlan(afterSnapshot, input.firm.tenantId, input.firm.id, new Set(input.adoptClientIds));
    await verifyPlan(afterPlan, afterSnapshot, readAzure);
    if (!afterPlan.safe || afterSnapshot.references.length !== locked.references.length ||
      afterSnapshot.counts.clients !== locked.counts.clients || afterSnapshot.counts.files !== locked.counts.files ||
      afterSnapshot.counts.loans !== locked.counts.loans || afterSnapshot.counts.masterAgreements !== locked.counts.masterAgreements ||
      afterSnapshot.counts.documents !== locked.counts.documents + plan.documents.filter((document) => document.create).length) {
      throw new MigrationUnsafeError({ status: "migrated", before: locked.counts, after: afterSnapshot.counts, plan: afterPlan });
    }
    const reconciled = { status: "migrated" as const, before: locked.counts, after: afterSnapshot.counts, plan: afterPlan };
    // This callback intentionally executes before transaction() commits. If
    // durable report persistence fails, all data changes are rolled back.
    await beforeCommit?.(reconciled);
    return reconciled;
  });
}

function validateInput(input: MigrationInput): void {
  if (!input.firm?.id || !input.firm.tenantId || !input.firm.name) throw new Error("Explicit firm id, tenantId, and name are required");
  if (!input.bootstrapAdmin?.objectId || input.bootstrapAdmin.role !== "admin") throw new Error("An explicit bootstrap admin identity with the admin role is required");
  if (!Array.isArray(input.adoptClientIds)) throw new Error("adoptClientIds must be an explicit array");
  if (!UUID.test(input.firm.id) || !UUID.test(input.firm.tenantId)) throw new Error("Firm id and tenantId must be UUIDs");
  const identities = [input.bootstrapAdmin, ...(input.users ?? [])];
  const roles = new Set(["admin", "manager", "accountant", "read_only"]);
  for (const identity of identities) {
    if (!UUID.test(identity.objectId) || !roles.has(identity.role)) throw new Error(`Invalid explicitly supplied identity ${identity.objectId}`);
  }
  for (const clientId of input.adoptClientIds) {
    if (!UUID.test(clientId)) throw new Error(`Invalid explicitly supplied client ${clientId}`);
  }
  const knownUsers = new Set(identities.map((identity) => identity.objectId));
  const clients = new Set(input.adoptClientIds);
  for (const membership of input.memberships ?? []) {
    if (!clients.has(membership.clientId)) throw new Error(`Membership client ${membership.clientId} is not explicitly selected for adoption`);
    if (!knownUsers.has(membership.objectId)) throw new Error(`Membership user ${membership.objectId} is not an explicitly supplied identity`);
  }
}

export class MigrationUnsafeError extends Error {
  constructor(public readonly report: Reconciliation) {
    super(`Migration is unsafe: ${report.plan.findings.length} finding(s)`);
  }
}

export function humanReport(report: Reconciliation | MigrationPlan): string {
  const plan = "plan" in report ? report.plan : report;
  const lines = [
    `Legacy document migration: ${plan.safe ? "SAFE" : "UNSAFE"}`,
    ...Object.entries(plan.counts).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `  ${key}: ${value}`),
    `  clients to adopt: ${plan.clients.join(", ") || "(none)"}`,
    "Clients:",
    ...plan.clientStatuses.map((client) =>
      `  ${client.id}: firm=${client.firmId ?? "(unassigned)"} adopted=${client.adopted} selected=${client.selected} mapped=${client.mapped}`),
    "Documents:",
    ...plan.documentStatuses.map((document) =>
      `  ${document.id}: backend=${document.backend} exists=${document.exists} ownershipComplete=${document.ownershipComplete} referenced=${document.referenced} referenceCount=${document.referenceCount} disposition=${document.disposition} reason=${document.reason}`),
    "Proposed reference rewrites:",
    ...plan.referenceMappings.map((mapping) =>
      `  ${mapping.kind}:${mapping.recordId} file=${mapping.fileId} client=${mapping.clientId ?? "(missing)"} tenant=${mapping.targetTenantId ?? "(unresolved)"} firm=${mapping.targetFirmId ?? "(unresolved)"} document=${mapping.documentId ?? "(unresolved)"} ${mapping.sourceRef} -> ${mapping.targetRef ?? "(unresolved)"} [${mapping.status}]`),
  ];
  for (const finding of plan.findings) lines.push(`  ERROR ${finding.code}${finding.record ? ` [${finding.record}]` : ""}: ${finding.message}`);
  if ("status" in report) {
    lines.unshift(`Mode: ${report.status}`);
    lines.push(`Reconciliation: before=${JSON.stringify(report.before)} after=${JSON.stringify(report.after)}`);
  }
  return lines.join("\n");
}