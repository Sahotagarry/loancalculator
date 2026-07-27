import { UserFacingError, type AzureSettings } from "./azure-core";

const LEGACY_API_VERSION = "2024-10-21";

/**
 * Call Azure OpenAI chat completions with a dual-endpoint strategy:
 *
 * 1. The modern version-free `/openai/v1/chat/completions` endpoint
 *    (required for current GPT-5-family models; takes `model` in the body,
 *    does NOT accept `temperature` on reasoning models).
 * 2. Fall back to the legacy deployment-scoped endpoint for older
 *    resources/models.
 *
 * Falls through only on "endpoint/parameter not recognized" errors
 * (400/404/405); auth and rate-limit errors are terminal.
 */
export async function callChatCompletions(
  settings: AzureSettings,
  messages: Array<{ role: string; content: string }>,
): Promise<Response> {
  const endpoint = settings.openaiEndpoint.replace(/\/+$/, "");
  const deployment = settings.openaiDeployment;

  const basePayload = {
    messages,
    response_format: { type: "json_object" },
  };

  const attempts: Array<{ url: string; body: Record<string, unknown> }> = [
    {
      url: `${endpoint}/openai/v1/chat/completions`,
      body: { ...basePayload, model: deployment },
    },
    {
      url: `${endpoint}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${LEGACY_API_VERSION}`,
      body: { ...basePayload, temperature: 0 },
    },
  ];

  let lastRes: Response | null = null;
  for (const attempt of attempts) {
    let res: Response;
    try {
      res = await fetch(attempt.url, {
        method: "POST",
        headers: {
          "api-key": settings.openaiKey,
          Authorization: `Bearer ${settings.openaiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(attempt.body),
      });
    } catch {
      throw new UserFacingError("Couldn't reach Azure OpenAI. Check the endpoint URL.", 502);
    }
    if (res.ok) return res;
    lastRes = res;
    if (res.status !== 404 && res.status !== 400 && res.status !== 405) return res;
  }
  return lastRes as Response;
}

/**
 * Send document text + a system prompt to Azure OpenAI and return the
 * parsed JSON object from the model's response. Handles the common error
 * cases with user-friendly messages.
 */
export async function extractJson(
  settings: AzureSettings,
  systemPrompt: string,
  documentText: string,
): Promise<unknown> {
  // Keep the request within a safe token budget.
  const text = documentText.length > 60_000 ? documentText.slice(0, 60_000) : documentText;

  const res = await callChatCompletions(settings, [
    { role: "system", content: systemPrompt },
    { role: "user", content: text },
  ]);

  if (res.status === 401 || res.status === 403) {
    throw new UserFacingError("Azure OpenAI rejected the credentials. Check the key and endpoint.", 502);
  }
  if (res.status === 404) {
    throw new UserFacingError("The Azure OpenAI deployment name wasn't found. Check the deployment name.", 502);
  }
  if (res.status === 429) {
    throw new UserFacingError("Azure OpenAI is rate-limited right now. Wait a moment and try again.", 502);
  }
  if (!res.ok) {
    throw new UserFacingError("Azure OpenAI couldn't analyze the document. Try again.", 502);
  }

  const body = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = body.choices?.[0]?.message?.content;
  if (!content) {
    throw new UserFacingError("Azure OpenAI returned an empty response. Try again.", 502);
  }

  try {
    return JSON.parse(content);
  } catch {
    throw new UserFacingError("The AI response couldn't be understood. Try again.", 502);
  }
}
