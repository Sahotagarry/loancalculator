import { Router, type IRouter } from "express";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, clientsTable, filesTable, loansTable } from "@workspace/db";
import {
  CreateClientBody,
  GetClientParams,
  GetClientResponse,
  DeleteClientParams,
  ListClientsResponse,
  UpdateClientBody,
  UpdateClientParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/clients", async (_req, res): Promise<void> => {
  const clients = await db
    .select({
      id: clientsTable.id,
      name: clientsTable.name,
      code: clientsTable.code,
      createdAt: clientsTable.createdAt,
      updatedAt: clientsTable.updatedAt,
      fileCount: sql<number>`count(distinct ${filesTable.id})::int`,
      loanCount: sql<number>`count(${loansTable.id})::int`,
      latestFiscalYearEnd: sql<string | null>`max(${filesTable.fiscalYearEnd})`,
    })
    .from(clientsTable)
    .leftJoin(filesTable, and(eq(filesTable.clientId, clientsTable.id), isNull(filesTable.deletedAt)))
    .leftJoin(loansTable, and(eq(loansTable.fileId, filesTable.id), isNull(loansTable.deletedAt)))
    .where(isNull(clientsTable.deletedAt))
    .groupBy(clientsTable.id)
    .orderBy(clientsTable.name);
  res.json(ListClientsResponse.parse(clients));
});

router.post("/clients", async (req, res): Promise<void> => {
  const parsed = CreateClientBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [client] = await db.insert(clientsTable).values(parsed.data).returning();
  res.status(201).json(GetClientResponse.parse(client));
});

router.get("/clients/:id", async (req, res): Promise<void> => {
  const params = GetClientParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [client] = await db
    .select()
    .from(clientsTable)
    .where(and(eq(clientsTable.id, params.data.id), isNull(clientsTable.deletedAt)));

  if (!client) {
    res.status(404).json({ error: "Client not found" });
    return;
  }

  res.json(GetClientResponse.parse(client));
});

router.patch("/clients/:id", async (req, res): Promise<void> => {
  const params = UpdateClientParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateClientBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [client] = await db
    .update(clientsTable)
    .set(parsed.data)
    .where(and(eq(clientsTable.id, params.data.id), isNull(clientsTable.deletedAt)))
    .returning();

  if (!client) {
    res.status(404).json({ error: "Client not found" });
    return;
  }

  res.json(GetClientResponse.parse(client));
});

router.delete("/clients/:id", async (req, res): Promise<void> => {
  const params = DeleteClientParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  // Soft delete: move to trash (recoverable). Permanent deletion happens via
  // the trash endpoints.
  const [client] = await db
    .update(clientsTable)
    .set({ deletedAt: new Date() })
    .where(and(eq(clientsTable.id, params.data.id), isNull(clientsTable.deletedAt)))
    .returning();

  if (!client) {
    res.status(404).json({ error: "Client not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
