import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Engine } from "../src/sim/engine";
import { Intelligence } from "../src/sim/intelligence";
import { selectAiPopulation } from "../src/sim/aiPopulation";
import { DEFAULT_AI_CONFIG } from "../src/shared/aiConfig";

const engine = new Engine(JSON.parse(readFileSync("public/city.json", "utf8")), { residents: 2550, tourists: 0, commuters: 0, seed: 2026, startDate: new Date("2026-10-29") });
const selected = selectAiPopulation(engine.agents, 50);
assert.equal(selected.length, 50);
assert.equal(new Set(selected.map((a) => a.id)).size, 50);
assert.deepEqual(selectAiPopulation(engine.agents, 50).map((a) => a.id), selected.map((a) => a.id));
assert.equal(selectAiPopulation(engine.agents, 0).length, 0);
assert.equal(selectAiPopulation(engine.agents.slice(0, 3), 50).length, 3);
const expected = new Set(selected.map((a) => a.id));
const called = new Set<number>();
let calls = 0, now = 0;
globalThis.fetch = async (_url, options) => {
  calls++;
  const { contexts } = JSON.parse(String(options?.body));
  assert.equal(contexts.length, 5);
  for (const entry of contexts) { assert.ok(expected.has(entry.agentId)); called.add(entry.agentId); }
  return Response.json({ decisions: contexts.map(({ agentId }: { agentId: number }) => ({ agentId, action: "continue", thought: "Je poursuis mon activité." })) });
};
const ai = new Intelligence(engine, undefined, () => now);
assert.equal(ai.population().total, 2550);
assert.equal(ai.population().tracked.length, 50);
for (let n = 0; n < 10; n++) {
  ai.tick();
  await new Promise((resolve) => setTimeout(resolve, 5));
  now += 6000;
}
assert.equal(calls, 10);
assert.equal(called.size, 50, "Seules les 50 personnes sélectionnées doivent appeler le modèle");
const automatic = engine.agents.find((a) => !expected.has(a.id))!;
assert.equal(ai.inspect(automatic.id).mode, "automatic");
assert.equal(automatic.thoughtLog.length, 0, "Les appels IA ne doivent pas modifier les figurants");
assert.equal(ai.inspect(selected[0].id).mode, "llm");
ai.configure({ ...DEFAULT_AI_CONFIG, agentLimit: 0 });
now += 60000;
ai.tick();
await Promise.resolve();
assert.equal(calls, 10);
assert.equal(ai.population().tracked.length, 0);
const report = engine.endDay();
assert.equal(report.population, 2550);
assert.ok(report.trips.walk + report.trips.bike + report.trips.car > 0, "La foule doit poursuivre ses déplacements automatiques");
console.log("Population mixte : 50 IA + 2 500 automatiques, sélection stable, 10 appels pour 50 décisions et foule active : OK");
