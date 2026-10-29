// LLM calls through Arkane (OpenAI-compatible /chat/completions), with JSON output validated by Zod.
// Config from the environment: ARKANE_API_KEY (required), ARKANE_BASE_URL, ARKANE_MODEL.
import { z } from "zod";

const TIMEOUT_MS = 120_000;
const MAX_TOKENS = 4000;
const DEFAULT_BASE_URL = "https://console.arkanecloud.com/api/v2";
const DEFAULT_MODEL = "qwen38-27b-turbo-v2";

export class LlmError extends Error {}

/** JSON schema without the `$schema` reference, which only adds noise to the prompt. */
function jsonSchema(schema: z.ZodType) {
  const { $schema: _, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  return JSON.stringify(rest);
}

/** Strips reasoning tags and markdown fences some models wrap around their JSON. */
function extractJson(content: string) {
  return content.replace(/<think>[\s\S]*?<\/think>/g, "").trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
}

/**
 * Sends `prompt` with `system` to the Arkane model and returns the output validated by `schema`.
 * Callers fall back to their local rules on any thrown error.
 */
export async function askLlm<S extends z.ZodType>(system: string, prompt: string, schema: S): Promise<z.infer<S>> {
  const key = process.env.ARKANE_API_KEY;
  if (!key) throw new LlmError("ARKANE_API_KEY manquante");
  const base = (process.env.ARKANE_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
  const model = process.env.ARKANE_MODEL || DEFAULT_MODEL;
  // "/no_think" is a Qwen3 soft switch: skips hidden reasoning, roughly halves latency
  const noThink = /qwen/i.test(model) ? "\n/no_think" : "";

  let response: Response;
  try {
    response = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        model,
        max_tokens: MAX_TOKENS,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: `${system}\n\nRéponds exclusivement par un objet JSON conforme à ce schéma JSON :\n${jsonSchema(schema)}` },
          { role: "user", content: prompt + noThink },
        ],
      }),
    });
  } catch (err) {
    throw new LlmError(`Arkane injoignable (${model}) : ${(err as Error).message}`);
  }
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500).replaceAll(key, "[clé masquée]");
    throw new LlmError(`Arkane HTTP ${response.status} (${model}) : ${detail}`);
  }
  const result = await response.json();
  const choice = result.choices?.[0];
  if (choice?.finish_reason === "length") throw new LlmError(`Réponse de ${model} tronquée`);
  if (typeof choice?.message?.content !== "string") throw new LlmError(`Réponse vide de ${model}`);
  try {
    return schema.parse(JSON.parse(extractJson(choice.message.content)));
  } catch (err) {
    throw new LlmError(`Réponse illisible de ${model} : ${(err as Error).message.slice(0, 200)}`);
  }
}
