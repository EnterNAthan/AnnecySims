// Fait tourner la simulation sans rendu, pour mesurer les performances et vérifier les bilans.
// Usage : npx tsx scripts/sim-headless.ts [habitants] [jours]
import { readFileSync } from "node:fs";
import type { City } from "../src/shared/city";
import { Engine } from "../src/sim/engine";

const residents = Number(process.argv[2] ?? 5000);
const days = Number(process.argv[3] ?? 2);
const city: City = JSON.parse(readFileSync("public/city.json", "utf8"));

let t = performance.now();
const engine = new Engine(city, {
  residents, tourists: Math.round(residents * 0.04), commuters: Math.round(residents * 0.12), seed: 2026, startDate: new Date("2026-10-29"),
});
console.log(`init ${(performance.now() - t).toFixed(0)} ms, ${engine.agents.length} agents`);
console.log(Object.fromEntries([...engine.places.byKind].map(([k, v]) => [k, v.length])));

for (let d = 0; d < days; d++) {
  t = performance.now();
  let peak = { minute: 0, n: 0 };
  for (let m = 0; m <= 1440; m += 10) {
    engine.advanceTo(m);
    const c = engine.liveCounts();
    const moving = c.walk + c.bike + c.car;
    if (moving > peak.n) peak = { minute: m, n: moving };
  }
  const r = engine.endDay();
  console.log(`\njour ${r.day} (${r.date}) simulé en ${(performance.now() - t).toFixed(0)} ms — pic ${peak.n} en déplacement à ${(peak.minute / 60).toFixed(1)} h`);
  const { hourly, ...rest } = r;
  console.log(JSON.stringify(rest, null, 1));
}
