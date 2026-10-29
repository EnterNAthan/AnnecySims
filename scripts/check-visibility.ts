import { readFileSync } from "node:fs";
import { Engine } from "../src/sim/engine";
import { selectAiPopulation } from "../src/sim/aiPopulation";
import { FRAME_CAPACITY_FACTOR, FRAME_STRIDE } from "../src/sim/protocol";
const engine = new Engine(JSON.parse(readFileSync("public/city.json", "utf8")), { residents: 2550, tourists: 0, commuters: 0, seed: 2026, startDate: new Date("2026-10-29"), transit: JSON.parse(readFileSync("public/transit.json", "utf8")) });
const selected = new Set(selectAiPopulation(engine.agents, 50).map((a) => a.id));
const buffer = new Float32Array((engine.everyone.length + 100) * FRAME_CAPACITY_FACTOR * FRAME_STRIDE);
const rows = [];
for (const hour of [6, 7.5, 8, 8.25, 8.5, 10, 12, 12.25, 13, 18]) {
  engine.advanceTo(hour * 60);
  const count = engine.snapshot(buffer);
  const visible = new Set<number>();
  for (let i = 0; i < count; i++) {
    const id = buffer[i * FRAME_STRIDE + 5];
    if (id >= 0 && id < engine.agents.length) visible.add(id);
  }
  const ai = [...visible].filter((id) => selected.has(id)).length;
  rows.push({ hour, population: engine.agents.length, visibleResidents: visible.size, visibleAutomatic: visible.size - ai, visibleAi: ai });
}
console.table(rows);
