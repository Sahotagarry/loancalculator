import { db, appSettingsTable } from "@workspace/db";
import { inArray, eq } from "drizzle-orm";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { logger } from "./logger";

// ---------------------------------------------------------------------------
// At-rest encryption for settings values (AES-256-GCM keyed from SESSION_SECRET)
//
// Stored format: "enc:v1:<iv b64>:<auth tag b64>:<ciphertext b64>"
// Plain-text rows written by older versions are still readable and are
// transparently re-encrypted the next time they are loaded.
// If SESSION_SECRET is not set, values are stored/read as plain text (legacy
// behavior) and a warning is logged once.
// ---------------------------------------------------------------------------

const ENC_PREFIX = "enc:v1:";
let warnedNoSecret = false;

function getEncryptionKey(): Buffer | null {
  const secret = process.env.SESSION_SECRET?.trim();
  if (!secret) {
    if (!warnedNoSecret) {
      warnedNoSecret = true;
      logger.warn(
        "SESSION_SECRET is not set; Azure settings will be stored without encryption. Set SESSION_SECRET to enable at-rest encryption.",
      );
    }
    return null;
  }
  // Static salt is acceptable here: the secret is high-entropy and the goal is
  // key derivation, not password storage.
  return scryptSync(secret, "clearline-app-settings-v1", 32);
}

function encryptValue(plain: string): string {
  const key = getEncryptionKey();
  if (!key) return plain;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENC_PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${ciphertext.toString("base64")}`;
}

/**
 * Decrypt a stored value. Returns the plain text, or null when the value is
 * encrypted but cannot be decrypted (missing or changed SESSION_SECRET).
 */
function decryptValue(stored: string): string | null {
  if (!stored.startsWith(ENC_PREFIX)) return stored; // legacy plain text
  const key = getEncryptionKey();
  if (!key) {
    logger.error(
      "Found an encrypted setting but SESSION_SECRET is not set; the value cannot be read. Restore the original SESSION_SECRET or re-enter the setting on the Settings page.",
    );
    return null;
  }
  try {
    const [ivB64, tagB64, dataB64] = stored.slice(ENC_PREFIX.length).split(":");
    if (!ivB64 || !tagB64 || !dataB64) return null;
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
  } catch {
    logger.error(
      "Failed to decrypt a stored setting; SESSION_SECRET has likely changed. Re-enter the setting on the Settings page.",
    );
    return null;
  }
}

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

  // Transparently migrate legacy plain-text rows to encrypted storage.
  const canEncrypt = getEncryptionKey() !== null;
  for (const row of rows) {
    if (canEncrypt && !row.value.startsWith(ENC_PREFIX) && row.value.trim() !== "") {
      // Optimistic concurrency: only migrate if the row still holds the exact
      // value we read, so we never clobber a concurrent save with stale data.
      const { and } = await import("drizzle-orm");
      await db
        .update(appSettingsTable)
        .set({ value: encryptValue(row.value) })
        .where(and(eq(appSettingsTable.key, row.key), eq(appSettingsTable.value, row.value)));
    }
  }

  const result = {} as AzureSettings;
  for (const [name, { dbKey, envKey }] of Object.entries(AZURE_SETTING_KEYS)) {
    const stored = byKey.get(dbKey);
    const fromDb = stored !== undefined ? (decryptValue(stored) ?? "").trim() : undefined;
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
    if (trimmed !== "" && getEncryptionKey() === null) {
      // Fail closed: never store secrets unencrypted.
      throw new UserFacingError(
        "Settings cannot be saved because the SESSION_SECRET environment variable is not set on the server. Ask your administrator to configure it, then try again.",
        503,
      );
    }
    if (trimmed === "") {
      // Clearing a value removes the row so the env fallback applies again.
      await db.delete(appSettingsTable).where(eq(appSettingsTable.key, meta.dbKey));
    } else {
      const encrypted = encryptValue(trimmed);
      await db
        .insert(appSettingsTable)
        .values({ key: meta.dbKey, value: encrypted })
        .onConflictDoUpdate({ target: appSettingsTable.key, set: { value: encrypted, updatedAt: new Date() } });
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
