// Vérifie le réalisme du trafic sur une journée de semaine : parts modales, voitures en circulation
// heure par heure, véhicules par jour sur les grands axes (à comparer aux comptages d'Annecy).
// Usage : npx tsx scripts/check-traffic.mts
import { readFileSync } from "node:fs";
import type { City } from "../src/shared/city";
import { AGENT_SCALE, Engine } from "../src/sim/engine";
const city: City = JSON.parse(readFileSync("public/city.json", "utf8"));
const engine = new Engine(city, { residents: 10000, tourists: 400, commuters: 3500, seed: 2026, startDate: new Date("2026-10-27"), transit: JSON.parse(readFileSync("public/transit.json", "utf8")) });
const g = engine.graph;
const perRoad = new Map<string, number>();
const last = new Map<number, number>();
const byHour: number[] = Array(24).fill(0);
for (let m = 0; m < 1440; m++) {
  engine.advanceTo(m + 1);
  let cars = 0;
  for (const a of engine.everyone) {
    const t = a.trip;
    if (!t || t.mode !== 3) continue;
    cars++;
    const r = g.edgeRoad[t.path.edges[t.seg]];
    if (last.get(a.id) !== r) {
      last.set(a.id, r);
      const n = city.roads[r].name;
      if (n) perRoad.set(n, (perRoad.get(n) ?? 0) + AGENT_SCALE);
    }
  }
  byHour[Math.floor(m / 60)] = Math.max(byHour[Math.floor(m / 60)], cars * AGENT_SCALE);
}
const r = engine.endDay();
const tot = r.trips.walk + r.trips.bike + r.trips.car + r.trips.bus;
console.log("stationnement :", JSON.stringify(r.parking), "— congestion", r.congestion, "— bouchons", r.jams.map((j) => j.name + " " + j.slowdown).join(", "));
console.log("parts modales : marche", Math.round(100 * r.trips.walk / tot), "% vélo", Math.round(100 * r.trips.bike / tot), "% voiture", Math.round(100 * r.trips.car / tot), "% bus", Math.round(100 * r.trips.bus / tot), "% — trajets/jour", tot, "— pop", r.population);
console.log("voitures en circulation (max) par heure :", byHour.join(" "));
console.log("véhicules/jour :", [...perRoad].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([n, v]) => `${n} ${v}`).join(" | "));
