import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Engine } from "../src/sim/engine";
import { Intelligence } from "../src/sim/intelligence";
import { AiConfigSchema, DEFAULT_AI_CONFIG } from "../src/shared/aiConfig";

const engine = new Engine(JSON.parse(readFileSync("public/city.json", "utf8")), {
  residents: 100, tourists: 0, commuters: 0, seed: 2026, startDate: new Date("2026-10-29"),
});
assert.equal(engine.agents.length, 100);
let now = 0;
const ai = new Intelligence(engine, undefined, () => now);
let calls = 0;
let continuedPlan = false;
globalThis.fetch = async (_url, options) => {
  calls++;
  const context = JSON.parse(JSON.parse(String(options?.body)).context);
  if (context.goal === "Retrouver mes proches" && context.memories.length && context.remainingPlan.length) continuedPlan = true;
  const target = context.nearby[0];
  return Response.json({ thought: "Je prends des nouvelles.", goal: "Retrouver mes proches", plan: ["Discuter", "Proposer une rencontre"], action: target ? "talk" : "continue", targetId: target?.id, message: "Bonjour !" });
};
ai.tick();
assert.equal(calls, 1, "Un seul appel doit démarrer à la fois pour lisser le débit");
ai.tick();
assert.equal(calls, 1, "Aucun pic de requêtes sur le même tick");
await new Promise((resolve) => setTimeout(resolve, 20));
for (let i = 0; i < 99; i++) {
  now += 1000;
  ai.tick();
  await new Promise((resolve) => setTimeout(resolve, 5));
}
assert.ok(engine.agents.some((a) => ai.inspect(a.id).memories.some((m) => m.includes("te dit"))), "Une parole doit être mémorisée par son destinataire");
assert.ok(engine.thoughts.length > 0);
assert.equal(calls, 100, "Les appels doivent être répartis à un maximum d'un par seconde");
now += 1000;
ai.tick();
await new Promise((resolve) => setTimeout(resolve, 20));
assert.ok(continuedPlan, "La décision suivante doit recevoir l'objectif, le plan et les résultats précédents");
const beforePause = calls;
ai.configure({ ...DEFAULT_AI_CONFIG, enabled: false });
now += 60000;
ai.tick();
assert.equal(calls, beforePause, "La suspension doit arrêter les nouveaux appels");
ai.configure({ ...DEFAULT_AI_CONFIG, enabled: true, memoryLimit: 4 });
ai.tick();
await new Promise((resolve) => setTimeout(resolve, 20));
assert.ok(calls > beforePause, "La reprise doit relancer les décisions");
assert.ok(!AiConfigSchema.safeParse({ ...DEFAULT_AI_CONFIG, concurrency: 0 }).success);
assert.equal(engine.endDay().population, 100, "Un agent représente exactement une personne");
console.log("100 personnes, concurrence, conversations et statistiques : OK");
