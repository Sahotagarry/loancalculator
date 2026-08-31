import { Router, type IRouter } from "express";
import { UpdateAzureSettingsBody } from "@workspace/api-zod";
import { loadAzureSettings, saveAzureSettings } from "../lib/azure-settings";
import { requireRole } from "../middlewares/auth";

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

router.get("/settings/azure", requireRole("admin"), async (_req, res): Promise<void> => {
  res.json(await buildStatus());
});

router.put("/settings/azure", requireRole("admin"), async (req, res): Promise<void> => {
  const parsed = UpdateAzureSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  await saveAzureSettings(parsed.data);
  res.json(await buildStatus());
});

export default router;
