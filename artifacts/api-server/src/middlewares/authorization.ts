import type { RequestHandler } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { clientMembershipsTable, clientsTable, db, filesTable, loansTable, masterAgreementsTable } from "@workspace/db";

type ClientRow = { id: string; firmId: string | null; adoptedAt: Date | null; quarantinedAt: Date | null };

export const routeParts = (path: string): string[] =>
  path.split("/").filter(Boolean).map((part) => decodeURIComponent(part));

async function clientForRequest(req: Parameters<RequestHandler>[0]): Promise<ClientRow | undefined> {
  const path = req.path;
  // This middleware runs before Express matches a concrete route, so req.params
  // is still empty. Resolve identifiers from the normalized path instead.
  const parts = routeParts(path);
  const id = parts[1];
  if (!id) return undefined;
  if (path.startsWith("/trash/")) {
    const type = parts[1] ?? "";
    const trashId = parts[2];
    if (!trashId) return undefined;
    if (type === "client") return (await db.select({ id: clientsTable.id, firmId: clientsTable.firmId, adoptedAt: clientsTable.adoptedAt, quarantinedAt: clientsTable.quarantinedAt }).from(clientsTable).where(eq(clientsTable.id, trashId)))[0];
    if (type === "file") return (await db.select({ id: clientsTable.id, firmId: clientsTable.firmId, adoptedAt: clientsTable.adoptedAt, quarantinedAt: clientsTable.quarantinedAt }).from(filesTable).innerJoin(clientsTable, eq(filesTable.clientId, clientsTable.id)).where(eq(filesTable.id, trashId)))[0];
    if (type === "loan") return (await db.select({ id: clientsTable.id, firmId: clientsTable.firmId, adoptedAt: clientsTable.adoptedAt, quarantinedAt: clientsTable.quarantinedAt }).from(loansTable).innerJoin(filesTable, eq(loansTable.fileId, filesTable.id)).innerJoin(clientsTable, eq(filesTable.clientId, clientsTable.id)).where(eq(loansTable.id, trashId)))[0];
  }
  if (path.startsWith("/clients/")) {
    return (await db.select({ id: clientsTable.id, firmId: clientsTable.firmId, adoptedAt: clientsTable.adoptedAt, quarantinedAt: clientsTable.quarantinedAt })
      .from(clientsTable).where(eq(clientsTable.id, id)))[0];
  }
  if (path.startsWith("/files/")) {
    return (await db.select({ id: clientsTable.id, firmId: clientsTable.firmId, adoptedAt: clientsTable.adoptedAt, quarantinedAt: clientsTable.quarantinedAt })
      .from(filesTable).innerJoin(clientsTable, eq(filesTable.clientId, clientsTable.id)).where(eq(filesTable.id, id)))[0];
  }
  if (path.startsWith("/loans/")) {
    return (await db.select({ id: clientsTable.id, firmId: clientsTable.firmId, adoptedAt: clientsTable.adoptedAt, quarantinedAt: clientsTable.quarantinedAt })
      .from(loansTable).innerJoin(filesTable, eq(loansTable.fileId, filesTable.id)).innerJoin(clientsTable, eq(filesTable.clientId, clientsTable.id)).where(eq(loansTable.id, id)))[0];
  }
  if (path.startsWith("/master-agreements/")) {
    return (await db.select({ id: clientsTable.id, firmId: clientsTable.firmId, adoptedAt: clientsTable.adoptedAt, quarantinedAt: clientsTable.quarantinedAt })
      .from(masterAgreementsTable).innerJoin(filesTable, eq(masterAgreementsTable.fileId, filesTable.id)).innerJoin(clientsTable, eq(filesTable.clientId, clientsTable.id)).where(eq(masterAgreementsTable.id, id)))[0];
  }
  return undefined;
}

async function canAccessClient(req: Parameters<RequestHandler>[0], client: ClientRow): Promise<boolean> {
  const auth = req.auth!;
  if (client.firmId !== auth.firmId || !client.adoptedAt || client.quarantinedAt) return false;
  const membership = await db.select({ clientId: clientMembershipsTable.clientId }).from(clientMembershipsTable)
    .where(and(eq(clientMembershipsTable.clientId, client.id), eq(clientMembershipsTable.tenantId, auth.tenantId), eq(clientMembershipsTable.objectId, auth.objectId))).limit(1);
  return membership.length > 0;
}

/** Enforces role policy and hides cross-client IDs before individual routes execute. */
export const authorizeRequest: RequestHandler = async (req, res, next) => {
  // The scheduler endpoint performs its own constant-time secret check.
  if (req.path === "/rate-resets/refresh") {
    next();
    return;
  }
  const auth = req.auth!;
  const mutation = !["GET", "HEAD", "OPTIONS"].includes(req.method);
  if (req.path.startsWith("/admin/") || req.path === "/rate-resets/status" || req.path.startsWith("/settings/")) {
    if (auth.role !== "admin") { res.status(403).json({ error: "Insufficient role" }); return; }
    next(); return;
  }
  if (mutation && auth.role === "read_only") { res.status(403).json({ error: "Read-only access" }); return; }
  if ((req.method === "DELETE" || req.path.includes("/restore")) && !["admin", "manager"].includes(auth.role)) {
    res.status(403).json({ error: "Insufficient role" }); return;
  }
  if (req.path.startsWith("/trash/") && req.method === "DELETE" && auth.role !== "admin") {
    res.status(403).json({ error: "Insufficient role" }); return;
  }
  const client = await clientForRequest(req);
  if (client && !(await canAccessClient(req, client))) { res.status(404).json({ error: "Not found" }); return; }
  // A loan rollforward must authorize both the source and body-selected target file.
  if (req.path.startsWith("/loans/") && req.path.endsWith("/rollforward") && typeof req.body?.fileId === "string") {
    const [target] = await db.select({ id: clientsTable.id, firmId: clientsTable.firmId, adoptedAt: clientsTable.adoptedAt, quarantinedAt: clientsTable.quarantinedAt })
      .from(filesTable).innerJoin(clientsTable, eq(filesTable.clientId, clientsTable.id)).where(and(eq(filesTable.id, req.body.fileId), isNull(filesTable.deletedAt)));
    if (!target || !client || target.id !== client.id || !(await canAccessClient(req, target))) {
      res.status(404).json({ error: "Not found" }); return;
    }
  }
  next();
};