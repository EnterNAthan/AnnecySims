import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Engine } from "../src/sim/engine";
import { Intelligence } from "../src/sim/intelligence";
import { DEFAULT_AI_CONFIG } from "../src/shared/aiConfig";
const engine = new Engine(JSON.parse(readFileSync("public/city.json", "utf8")), { residents: 100, tourists: 0, commuters: 0, seed: 2026, startDate: new Date("2026-10-29") });
let now = 0, calls = 0;
const held: (() => void)[] = [];
globalThis.fetch = async (_url, options) => {
  calls++;
  const { contexts } = JSON.parse(String(options?.body));
  return new Promise<Response>((resolve) => held.push(() => resolve(Response.json({ decisions: contexts.map((entry: { agentId: number }) => ({ agentId: entry.agentId, thought: "Je continue.", action: "continue" })) }))));
};
const ai = new Intelligence(engine, undefined, () => now);
ai.configure({ ...DEFAULT_AI_CONFIG, concurrency: 2 });
ai.tick();
await Promise.resolve();
now += 6000;
ai.tick();
await Promise.resolve();
assert.equal(calls, 2);
now += 6000;
ai.tick();
await Promise.resolve();
assert.equal(calls, 2, "La limite doit compter les requêtes réelles, pas les personnes");
held.forEach((finish) => finish());
await new Promise((resolve) => setTimeout(resolve, 10));

let failures = 0;
globalThis.fetch = async () => { failures++; return Response.json({ error: "Provider indisponible" }, { status: 502 }); };
const failing = new Intelligence(engine, undefined, () => now);
failing.configure({ ...DEFAULT_AI_CONFIG, concurrency: 1 });
for (let i = 0; i < 3; i++) {
  now += 6000;
  failing.tick();
  await new Promise((resolve) => setTimeout(resolve, 10));
}
assert.equal(failures, 3);
now += 10000;
failing.tick();
await Promise.resolve();
assert.equal(failures, 3, "Trois échecs doivent suspendre globalement les appels");
engine.advanceTo(60);
assert.equal(engine.minute, 60, "Le moteur doit continuer sans attendre le provider");
now += 30000;
failing.tick();
await new Promise((resolve) => setTimeout(resolve, 10));
assert.equal(failures, 4, "Une tentative doit redevenir possible après la pause");
console.log("Concurrence réelle, isolation du moteur, pause après erreurs et reprise : OK");
