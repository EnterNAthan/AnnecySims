// Appel à Claude via Claude Code en mode non interactif (`claude -p`), avec sortie structurée.
// Utilise la session Claude Code de la machine : pas de clé API à gérer.
import { spawn } from "node:child_process";
import { z } from "zod";

const MAX_CONCURRENT = 3;
const TIMEOUT_MS = 120_000;

let running = 0;
const queue: (() => void)[] = [];

async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= MAX_CONCURRENT) await new Promise<void>((resolve) => queue.push(resolve));
  running++;
  try {
    return await fn();
  } finally {
    running--;
    queue.shift()?.();
  }
}

export class ClaudeCodeError extends Error {}

/** Schéma JSON sans la référence `$schema`, que Claude Code ne sait pas résoudre. */
function jsonSchema(schema: z.ZodType) {
  const { $schema: _, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  return JSON.stringify(rest);
}

/**
 * Envoie `prompt` à Claude avec `system`, et renvoie la sortie validée par `schema`.
 * Aucun outil, aucun MCP, aucun réglage utilisateur : Claude ne fait que répondre.
 */
export function askClaude<S extends z.ZodType>(system: string, prompt: string, schema: S): Promise<z.infer<S>> {
  return slot(
    () =>
      new Promise((resolve, reject) => {
        const args = [
          "-p", "--output-format", "json", "--no-session-persistence",
          "--tools", "", "--strict-mcp-config", "--setting-sources", "",
          "--system-prompt", system,
          "--json-schema", jsonSchema(schema),
        ];
        const child = spawn("claude", args, { stdio: ["pipe", "pipe", "pipe"] });
        let out = "", err = "";
        const timer = setTimeout(() => {
          child.kill("SIGTERM");
          reject(new ClaudeCodeError("Claude Code n'a pas répondu à temps"));
        }, TIMEOUT_MS);
        child.stdout.on("data", (d) => (out += d));
        child.stderr.on("data", (d) => (err += d));
        child.on("error", (e) => {
          clearTimeout(timer);
          reject(new ClaudeCodeError(`Impossible de lancer « claude » : ${e.message}`));
        });
        child.on("close", (code) => {
          clearTimeout(timer);
          try {
            const res = JSON.parse(out);
            if (res.is_error || code !== 0) throw new ClaudeCodeError(res.result || err || `code ${code}`);
            resolve(schema.parse(res.structured_output));
          } catch (e) {
            reject(e instanceof ClaudeCodeError ? e : new ClaudeCodeError(`Réponse illisible : ${(e as Error).message} ${err.slice(0, 200)}`));
          }
        });
        child.stdin.end(prompt);
      }),
  );
}
