import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { createIntelligenceApi } from "../server/intelligenceApi";

const handle = createIntelligenceApi({ ARKANE_API_KEY: "test-only", ARKANE_MODEL: "env-model" });
const server = createServer((req, res) => { if (!handle(req, res)) { res.statusCode = 404; res.end(); } });
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = (server.address() as { port: number }).port;
function call(path: string, body?: unknown) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port, path, method: body === undefined ? "GET" : "POST", headers: { "Content-Type": "application/json" } }, (res) => {
      let text = "";
      res.on("data", (chunk) => { text += chunk; });
      res.on("end", () => resolve({ status: res.statusCode!, body: text ? JSON.parse(text) : null }));
    });
    req.on("error", reject); req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}
try {
  const config = await call("/api/ai-config");
  assert.equal(config.body.agentLimit, 50);
  assert.equal(config.body.model, "qwen38-27b-turbo-v2");
  assert.equal((await call("/api/ai-config", {})).status, 405);
  globalThis.fetch = async (_url, options) => {
    const input = JSON.parse(String(options?.body));
    const conversation = input.messages[0].content.includes("habitant fictif");
    return Response.json({ choices: [{ message: { content: JSON.stringify(conversation
      ? { biography: "Je vis près du lac.", reply: "Bonjour visiteur !" }
      : { action: "continue", thought: "Je poursuis ma journée." }) } }] });
  };
  const context = JSON.stringify({ person: { id: 0, name: "Camille" } });
  assert.equal((await call("/api/agents/decide", { context })).body.action, "continue");
  assert.equal((await call("/api/agents/chat", { context, biography: "", messages: [{ role: "user", content: "Bonjour" }] })).body.reply, "Bonjour visiteur !");
  assert.equal((await call("/api/agents/chat")).status, 405);
  console.log("API commune dev/production : config figée, décisions et chat : OK");
} finally { server.close(); }
