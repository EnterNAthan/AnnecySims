import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Engine } from "../src/sim/engine";
import { Intelligence } from "../src/sim/intelligence";
import { validateBatch } from "../src/shared/intelligence";
import { DEFAULT_AI_CONFIG } from "../src/shared/aiConfig";

const engine = new Engine(JSON.parse(readFileSync("public/city.json", "utf8")), { residents: 100, tourists: 0, commuters: 0, seed: 2026, startDate: new Date("2026-10-29") });
let requests = 0;
globalThis.fetch = async (_url, options) => {
  requests++;
  const { contexts } = JSON.parse(String(options?.body));
  assert.equal(contexts.length, 5);
  return Response.json({ decisions: [...contexts].reverse().map((entry: { agentId: number }) => ({ agentId: entry.agentId, action: "continue", thought: `Pensée privée ${entry.agentId}` })) });
};
const ai = new Intelligence(engine);
ai.configure({ ...DEFAULT_AI_CONFIG, agentLimit: 100 });
ai.tick();
await new Promise((resolve) => setTimeout(resolve, 20));
assert.equal(requests, 1);
for (let id = 0; id < 5; id++) {
  assert.ok(ai.inspect(id).memories.some((m) => m.includes(`Pensée privée ${id}`)));
  assert.equal(ai.inspect(id).memories.length, 1);
}
assert.equal(ai.inspect(5).memories.length, 0);
assert.throws(() => validateBatch({ decisions: [{ agentId: 0, thought: "a", action: "continue" }, { agentId: 0, thought: "b", action: "continue" }] }, [0, 1]));
assert.throws(() => validateBatch({ decisions: [{ agentId: 99, thought: "a", action: "continue" }] }, [0]));
assert.throws(() => validateBatch({ decisions: [] }, [0]));
console.log("Un appel, cinq décisions, attribution par identifiant et rejet des lots invalides : OK");
