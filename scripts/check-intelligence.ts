import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Engine } from "../src/sim/engine";
import { Intelligence } from "../src/sim/intelligence";

const engine = new Engine(JSON.parse(readFileSync("public/city.json", "utf8")), {
  residents: 100, tourists: 0, commuters: 0, seed: 2026, startDate: new Date("2026-10-29"),
});
assert.equal(engine.agents.length, 100);
const ai = new Intelligence(engine);
let calls = 0;
globalThis.fetch = async (_url, options) => {
  calls++;
  const context = JSON.parse(JSON.parse(String(options?.body)).context);
  const target = context.nearby[0];
  return Response.json({ thought: "Je prends des nouvelles.", action: target ? "talk" : "continue", targetId: target?.id, message: "Bonjour !" });
};
ai.tick();
assert.equal(calls, 4, "La concurrence doit être limitée à quatre appels");
await new Promise((resolve) => setTimeout(resolve, 20));
for (let i = 0; i < 24; i++) {
  ai.tick();
  await new Promise((resolve) => setTimeout(resolve, 5));
}
assert.ok(engine.agents.some((a) => ai.inspect(a.id).memories.some((m) => m.includes("te dit"))), "Une parole doit être mémorisée par son destinataire");
assert.ok(engine.thoughts.length > 0);
assert.equal(engine.endDay().population, 100, "Un agent représente exactement une personne");
console.log("100 personnes, concurrence, conversations et statistiques : OK");
