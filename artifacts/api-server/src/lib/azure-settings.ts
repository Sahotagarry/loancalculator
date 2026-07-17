import { db, appSettingsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";

export interface AzureSettings {
  docIntelEndpoint: string;
  docIntelKey: string;
  openaiEndpoint: string;
  openaiKey: string;
  openaiDeployment: string;
  storageConnectionString: string;
}

export const AZURE_SETTING_KEYS: Record<keyof AzureSettings, { dbKey: string; envKey: string }> = {
  docIntelEndpoint: { dbKey: "azure.docIntelEndpoint", envKey: "AZURE_DOC_INTEL_ENDPOINT" },
  docIntelKey: { dbKey: "azure.docIntelKey", envKey: "AZURE_DOC_INTEL_KEY" },
  openaiEndpoint: { dbKey: "azure.openaiEndpoint", envKey: "AZURE_OPENAI_ENDPOINT" },
  openaiKey: { dbKey: "azure.openaiKey", envKey: "AZURE_OPENAI_KEY" },
  openaiDeployment: { dbKey: "azure.openaiDeployment", envKey: "AZURE_OPENAI_DEPLOYMENT" },
  storageConnectionString: { dbKey: "azure.storageConnectionString", envKey: "AZURE_STORAGE_CONNECTION_STRING" },
};

/**
 * Load Azure settings. Values saved through the in-app Settings page (stored
 * in the app_settings table) take precedence; environment variables act as a
 * fallback so the app also works when configured via App Service settings.
 */
export async function loadAzureSettings(): Promise<AzureSettings> {
  const dbKeys = Object.values(AZURE_SETTING_KEYS).map((k) => k.dbKey);
  const rows = await db
    .select()
    .from(appSettingsTable)
    .where(inArray(appSettingsTable.key, dbKeys));
  const byKey = new Map(rows.map((r) => [r.key, r.value]));

  const result = {} as AzureSettings;
  for (const [name, { dbKey, envKey }] of Object.entries(AZURE_SETTING_KEYS)) {
    const fromDb = byKey.get(dbKey)?.trim();
    const fromEnv = process.env[envKey]?.trim();
    result[name as keyof AzureSettings] = fromDb || fromEnv || "";
  }
  return result;
}

export async function saveAzureSettings(values: Partial<Record<keyof AzureSettings, string | null>>): Promise<void> {
  for (const [name, value] of Object.entries(values)) {
    const meta = AZURE_SETTING_KEYS[name as keyof AzureSettings];
    if (!meta || value === undefined) continue;
    const trimmed = (value ?? "").trim();
    if (trimmed === "") {
      // Clearing a value removes the row so the env fallback applies again.
      const { eq } = await import("drizzle-orm");
      await db.delete(appSettingsTable).where(eq(appSettingsTable.key, meta.dbKey));
    } else {
      await db
        .insert(appSettingsTable)
        .values({ key: meta.dbKey, value: trimmed })
        .onConflictDoUpdate({ target: appSettingsTable.key, set: { value: trimmed, updatedAt: new Date() } });
    }
  }
}

/** Public class of error whose message is safe to show to the user. */
export class UserFacingError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export function requireSettings(s: AzureSettings, keys: (keyof AzureSettings)[], featureLabel: string): void {
  const labels: Record<keyof AzureSettings, string> = {
    docIntelEndpoint: "Document Intelligence endpoint",
    docIntelKey: "Document Intelligence key",
    openaiEndpoint: "Azure OpenAI endpoint",
    openaiKey: "Azure OpenAI key",
    openaiDeployment: "Azure OpenAI deployment name",
    storageConnectionString: "Storage connection string",
  };
  const missing = keys.filter((k) => !s[k]);
  if (missing.length > 0) {
    throw new UserFacingError(
      `${featureLabel} needs the following Azure settings: ${missing.map((k) => labels[k]).join(", ")}. Enter them on the Settings page.`,
      400,
    );
  }
}
