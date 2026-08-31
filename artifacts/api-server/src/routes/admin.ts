import { Router, type IRouter } from "express";
import { and, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { appUsersTable, clientMembershipsTable, clientsTable, db } from "@workspace/db";
import { removesLastActiveAdmin } from "../lib/admin-guard";

const router: IRouter = Router();
const id = z.object({ id: z.string().uuid() });
const userInput = z.object({ objectId: z.string().uuid(), displayName: z.string().nullable().optional(), email: z.string().email().nullable().optional(), role: z.enum(["admin", "manager", "accountant", "read_only"]), isActive: z.boolean().optional() });

router.get("/auth/me", (req, res): void => {
  const { tenantId, objectId, displayName, email, firmId, role } = req.auth!;
  res.json({ tenantId, objectId, displayName, email, firmId, role });
});

router.get("/admin/users", async (req, res): Promise<void> => {
  res.json(await db.select().from(appUsersTable).where(eq(appUsersTable.firmId, req.auth!.firmId)));
});
router.post("/admin/users", async (req, res): Promise<void> => {
  const body = userInput.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const auth = req.auth!;
  const result = await db.transaction(async (tx) => {
    // Create-only: never let an upsert bypass the PATCH last-admin guard.
    const [existing] = await tx.select({ objectId: appUsersTable.objectId }).from(appUsersTable).where(and(
      eq(appUsersTable.tenantId, auth.tenantId), eq(appUsersTable.objectId, body.data.objectId),
    )).limit(1);
    if (existing) return null;
    const [user] = await tx.insert(appUsersTable).values({
      ...body.data, tenantId: auth.tenantId, firmId: auth.firmId, isActive: body.data.isActive ?? true,
    }).returning();
    return user;
  });
  if (!result) {
    // Same response for an existing user in this or any other firm. Do not
    // disclose cross-firm tenancy; changes must go through guarded PATCH.
    res.status(409).json({ error: "User already exists; edit users through PATCH" });
    return;
  }
  const user = result;
  res.status(201).json(user);
});
router.patch("/admin/users/:id", async (req, res): Promise<void> => {
  const params = z.object({ id: z.string().min(1) }).safeParse(req.params);
  const body = userInput.partial().omit({ objectId: true }).safeParse(req.body);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const auth = req.auth!;
  const result = await db.transaction(async (tx) => {
    // One lock per firm prevents two admins concurrently removing each other.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${auth.firmId}))`);
    const [target] = await tx.select().from(appUsersTable).where(and(
      eq(appUsersTable.tenantId, auth.tenantId), eq(appUsersTable.objectId, params.data.id), eq(appUsersTable.firmId, auth.firmId),
    ));
    if (!target) return { kind: "missing" as const };
    if (target.role === "admin" && target.isActive) {
      const admins = await tx.select({ objectId: appUsersTable.objectId }).from(appUsersTable).where(and(
        eq(appUsersTable.tenantId, auth.tenantId), eq(appUsersTable.firmId, auth.firmId),
        eq(appUsersTable.role, "admin"), eq(appUsersTable.isActive, true),
      ));
      if (removesLastActiveAdmin(target, body.data, admins.length)) return { kind: "lastAdmin" as const };
    }
    const [user] = await tx.update(appUsersTable).set(body.data).where(and(
      eq(appUsersTable.tenantId, auth.tenantId), eq(appUsersTable.objectId, params.data.id), eq(appUsersTable.firmId, auth.firmId),
    )).returning();
    return { kind: "ok" as const, user };
  });
  if (result.kind === "lastAdmin") { res.status(409).json({ error: "Cannot deactivate or demote the last active admin" }); return; }
  const user = result.kind === "ok" ? result.user : undefined;
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  res.json(user);
});

router.get("/admin/legacy-clients", async (req, res): Promise<void> => {
  // Unowned/quarantined rows deliberately remain invisible to business routes.
  res.json(await db.select().from(clientsTable).where(and(
    or(isNull(clientsTable.firmId), eq(clientsTable.firmId, req.auth!.firmId)),
    or(isNull(clientsTable.firmId), isNull(clientsTable.adoptedAt), isNotNull(clientsTable.quarantinedAt)),
  )));
});
router.post("/admin/legacy-clients/:id/adopt", async (req, res): Promise<void> => {
  const params = id.safeParse(req.params);
  const body = z.object({ memberObjectIds: z.array(z.string().min(1)).max(500) }).safeParse(req.body);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const auth = req.auth!;
  const memberObjectIds = [...new Set([...body.data.memberObjectIds, auth.objectId])];
  const client = await db.transaction(async (tx) => {
    const users = await tx.select({ objectId: appUsersTable.objectId }).from(appUsersTable).where(and(
      eq(appUsersTable.tenantId, auth.tenantId), eq(appUsersTable.firmId, auth.firmId), eq(appUsersTable.isActive, true),
    ));
    if (memberObjectIds.some((value) => !users.some((user) => user.objectId === value))) return null;
    const [adopted] = await tx.update(clientsTable).set({ firmId: auth.firmId, adoptedAt: new Date(), quarantinedAt: null, quarantineReason: null })
      .where(and(eq(clientsTable.id, params.data.id), or(isNull(clientsTable.firmId), eq(clientsTable.firmId, auth.firmId)))).returning();
    if (!adopted) return null;
    await tx.delete(clientMembershipsTable).where(eq(clientMembershipsTable.clientId, adopted.id));
    await tx.insert(clientMembershipsTable).values(memberObjectIds.map((objectId) => ({ clientId: adopted.id, tenantId: auth.tenantId, objectId })));
    return adopted;
  });
  if (!client) { res.status(404).json({ error: "Legacy client not found" }); return; }
  res.json(client);
});
router.get("/admin/clients/:id/members", async (req, res): Promise<void> => {
  const params = id.safeParse(req.params); if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [client] = await db.select({ id: clientsTable.id }).from(clientsTable).where(and(
    eq(clientsTable.id, params.data.id), eq(clientsTable.firmId, req.auth!.firmId),
    isNotNull(clientsTable.adoptedAt), isNull(clientsTable.quarantinedAt),
  ));
  if (!client) { res.status(404).json({ error: "Client not found" }); return; }
  const rows = await db.select({ objectId: appUsersTable.objectId, displayName: appUsersTable.displayName, email: appUsersTable.email, role: appUsersTable.role, isActive: appUsersTable.isActive })
    .from(clientMembershipsTable).innerJoin(appUsersTable, and(eq(clientMembershipsTable.tenantId, appUsersTable.tenantId), eq(clientMembershipsTable.objectId, appUsersTable.objectId)))
    .innerJoin(clientsTable, eq(clientMembershipsTable.clientId, clientsTable.id))
    .where(and(eq(clientsTable.id, params.data.id), eq(clientsTable.firmId, req.auth!.firmId)));
  res.json(rows);
});
router.put("/admin/clients/:id/members", async (req, res): Promise<void> => {
  const params = id.safeParse(req.params); const body = z.object({ memberObjectIds: z.array(z.string().min(1)).max(500) }).safeParse(req.body);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const auth = req.auth!; const ids = [...new Set([...body.data.memberObjectIds, auth.objectId])];
  const result = await db.transaction(async (tx) => {
    const [client] = await tx.select({ id: clientsTable.id }).from(clientsTable).where(and(eq(clientsTable.id, params.data.id), eq(clientsTable.firmId, auth.firmId), isNotNull(clientsTable.adoptedAt), isNull(clientsTable.quarantinedAt)));
    const active = await tx.select({ objectId: appUsersTable.objectId }).from(appUsersTable).where(and(eq(appUsersTable.tenantId, auth.tenantId), eq(appUsersTable.firmId, auth.firmId), eq(appUsersTable.isActive, true)));
    if (!client || ids.some((x) => !active.some((u) => u.objectId === x))) return false;
    await tx.delete(clientMembershipsTable).where(eq(clientMembershipsTable.clientId, client.id));
    await tx.insert(clientMembershipsTable).values(ids.map((objectId) => ({ clientId: client.id, tenantId: auth.tenantId, objectId })));
    return true;
  });
  if (!result) { res.status(404).json({ error: "Client not found" }); return; }
  res.sendStatus(204);
});
export default router;