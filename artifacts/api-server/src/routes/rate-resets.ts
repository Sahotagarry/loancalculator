import { timingSafeEqual } from "node:crypto";
import { Router, type IRouter, type RequestHandler } from "express";
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod/v4";
import {
  db,
  loanEventsTable,
  loanEventSetsTable,
  loansTable,
  rateRefreshRunsTable,
  rateResetFindingsTable,
} from "@workspace/db";
import { overrideRate, refreshDueRateResets, restoreSourcedRate } from "../lib/rate-resets";

const router: IRouter = Router();
const idSchema = z.object({ id: z.string().min(1) });
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const requireSchedulerSecret: RequestHandler = (req, res, next) => {
  const configured = process.env["RATE_REFRESH_SECRET"];
  const supplied = req.header("x-rate-refresh-secret");
  if (!configured || !supplied) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const a = Buffer.from(configured);
  const b = Buffer.from(supplied);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
};

router.get("/loans/:id/rate-timeline", async (req, res): Promise<void> => {
  const parsed = idSchema.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [loan] = await db.select().from(loansTable).where(eq(loansTable.id, parsed.data.id));
  if (!loan) { res.status(404).json({ error: "Loan not found" }); return; }
  const sets = await db
    .select()
    .from(loanEventSetsTable)
    .where(eq(loanEventSetsTable.loanId, loan.id))
    .orderBy(desc(loanEventSetsTable.version));
  const events = await db
    .select()
    .from(loanEventsTable)
    .where(and(eq(loanEventsTable.loanId, loan.id), eq(loanEventsTable.kind, "rate_reset")))
    .orderBy(asc(loanEventsTable.effectiveDate), asc(loanEventsTable.sequence));
  const findings = await db
    .select()
    .from(rateResetFindingsTable)
    .where(eq(rateResetFindingsTable.loanId, loan.id))
    .orderBy(desc(rateResetFindingsTable.createdAt));
  res.json({
    terms: {
      rateType: loan.rateType,
      benchmark: loan.rateBenchmark,
      contractualPrimeName: loan.contractualPrimeName,
      spread: loan.rateSpread == null ? null : Number(loan.rateSpread),
      resetFrequency: loan.rateResetFrequency,
      effectiveConvention: loan.rateEffectiveConvention,
      paymentTreatment: loan.ratePaymentTreatment,
      initialFvRateAssumption: loan.initialFvRateAssumption,
    },
    activeSetId: loan.activeEventSetId,
    sets,
    events: events.map((event) => ({
      ...event,
      benchmarkRate: Number(event.benchmarkRate),
      spread: Number(event.spread),
      resultingRate: Number(event.resultingRate),
    })),
    findings,
  });
});

router.post("/loans/:id/rate-overrides", async (req, res): Promise<void> => {
  const params = idSchema.safeParse(req.params);
  const body = z
    .object({
      effectiveDate: dateSchema,
      benchmarkRate: z.number().min(0).max(100),
      reason: z.string().min(1),
      author: z.string().min(1),
      sourceUrl: z.string().min(1),
    })
    .safeParse(req.body);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const result = await overrideRate(params.data.id, body.data);
  res.status(result.applied ? 201 : 200).json(result);
});

router.post("/loans/:id/rate-restores", async (req, res): Promise<void> => {
  const params = idSchema.safeParse(req.params);
  const body = z.object({ effectiveDate: dateSchema, author: z.string().min(1) }).safeParse(req.body);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const result = await restoreSourcedRate(params.data.id, body.data.effectiveDate, body.data.author);
  res.status(result.applied ? 201 : 200).json(result);
});

router.post("/rate-resets/refresh", requireSchedulerSecret, async (req, res): Promise<void> => {
  const parsed = z.object({ date: dateSchema.optional() }).safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const run = await refreshDueRateResets(parsed.data.date);
  res.status(run.status === "failed" ? 503 : 200).json(run);
});

router.get("/rate-resets/status", async (_req, res) => {
  const runs = await db
    .select()
    .from(rateRefreshRunsTable)
    .orderBy(desc(rateRefreshRunsTable.startedAt))
    .limit(25);
  const unresolved = await db
    .select()
    .from(rateResetFindingsTable)
    .where(eq(rateResetFindingsTable.status, "unresolved"))
    .orderBy(desc(rateResetFindingsTable.createdAt));
  res.json({ runs, unresolved });
});

export default router;
