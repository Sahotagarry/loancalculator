/**
 * Shared types and helpers for the Azure AI document pipeline.
 *
 * This standalone version reads configuration from environment variables.
 * (The original app also allowed overriding these from a database-backed
 * settings page; that part was app-specific and is omitted here.)
 */

export interface AzureSettings {
  docIntelEndpoint: string;
  docIntelKey: string;
  openaiEndpoint: string;
  openaiKey: string;
  openaiDeployment: string;
}

/** Error whose message is safe to show to the end user. */
export class UserFacingError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/** Load Azure settings from environment variables. */
export function loadAzureSettings(): AzureSettings {
  return {
    docIntelEndpoint: process.env["AZURE_DOC_INTEL_ENDPOINT"]?.trim() ?? "",
    docIntelKey: process.env["AZURE_DOC_INTEL_KEY"]?.trim() ?? "",
    openaiEndpoint: process.env["AZURE_OPENAI_ENDPOINT"]?.trim() ?? "",
    openaiKey: process.env["AZURE_OPENAI_KEY"]?.trim() ?? "",
    openaiDeployment: process.env["AZURE_OPENAI_DEPLOYMENT"]?.trim() ?? "",
  };
}

/** Throw a clear error listing any missing settings before calling Azure. */
export function requireSettings(
  s: AzureSettings,
  keys: (keyof AzureSettings)[],
  featureLabel: string,
): void {
  const labels: Record<keyof AzureSettings, string> = {
    docIntelEndpoint: "Document Intelligence endpoint",
    docIntelKey: "Document Intelligence key",
    openaiEndpoint: "Azure OpenAI endpoint",
    openaiKey: "Azure OpenAI key",
    openaiDeployment: "Azure OpenAI deployment name",
  };
  const missing = keys.filter((k) => !s[k]);
  if (missing.length > 0) {
    throw new UserFacingError(
      `${featureLabel} needs the following Azure settings: ${missing.map((k) => labels[k]).join(", ")}.`,
      400,
    );
  }
}
