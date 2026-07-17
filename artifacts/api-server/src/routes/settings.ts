import { Router, type IRouter } from "express";
import { UpdateAzureSettingsBody, UnlockSettingsBody } from "@workspace/api-zod";
import { loadAzureSettings, saveAzureSettings } from "../lib/azure-settings";
import { unlock, requireAdmin } from "../lib/admin-auth";

const router: IRouter = Router();

async function buildStatus() {
  const s = await loadAzureSettings();
  return {
    docIntelEndpoint: s.docIntelEndpoint,
    openaiEndpoint: s.openaiEndpoint,
    openaiDeployment: s.openaiDeployment,
    docIntelKeySet: s.docIntelKey.length > 0,
    openaiKeySet: s.openaiKey.length > 0,
    storageConnectionSet: s.storageConnectionString.length > 0,
  };
}

router.post("/settings/unlock", (req, res): void => {
  const parsed = UnlockSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const result = unlock(parsed.data.password);
  if (!result.ok) {
    req.log?.warn({ status: result.status }, "Settings unlock failed");
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.json({ token: result.token, expiresAt: result.expiresAt });
});

router.get("/settings/azure", requireAdmin, async (_req, res): Promise<void> => {
  res.json(await buildStatus());
});

router.put("/settings/azure", requireAdmin, async (req, res): Promise<void> => {
  const parsed = UpdateAzureSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  await saveAzureSettings(parsed.data);
  res.json(await buildStatus());
});

export default router;
