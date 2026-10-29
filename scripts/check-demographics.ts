// Compares the generated population with the INSEE targets of src/sim/demographics.ts.
// Usage : npx tsx scripts/check-demographics.ts [residents]
//         npx tsx scripts/check-demographics.ts --tune   (iterates AGE_RATIO, prints the table to paste)
import { readFileSync } from "node:fs";
import type { City } from "../src/shared/city";
import { Graph } from "../src/sim/graph";
import { Places } from "../src/sim/places";
import { mulberry32 } from "../src/sim/engine";
import { AGE_RATIO, createPopulation, sampleShapes, type Agent } from "../src/sim/population";
import {
  ACTIVITY_15_64, AGE_SEX_PYRAMID, CARS_PER_HOUSEHOLD, CSPS, CSP_ACTIVE, HOUSEHOLD_SHARE, INCOME_MEDIAN, MEAN_HOUSEHOLD_SIZE,
  PART_TIME_RATE, POVERTY_RATE,
} from "../src/sim/demographics";

const pct = (x: number) => (100 * x).toFixed(1).padStart(5);
const rows: string[] = [];
let worst = 0;
function row(label: string, sim: number, target: number, tol = 0.02) {
  const d = sim - target;
  const flag = Math.abs(d) > tol ? "  <-- " : "";
  worst = Math.max(worst, Math.abs(d) > tol ? Math.abs(d) : 0);
  rows.push(`${label.padEnd(30)} ${pct(sim)}  ${pct(target)}  ${(d >= 0 ? "+" : "") + (100 * d).toFixed(1)}${flag}`);
}
const section = (t: string) => rows.push(`\n${t}\n${"".padEnd(30)} ${"sim%".padStart(5)}  ${"INSEE".padStart(5)}  diff`);

if (process.argv[2] === "--tune") {
  const total = AGE_SEX_PYRAMID.reduce((s, b) => s + b.male + b.female, 0);
  const measure = (seed: number) => {
    const cnt = { M: AGE_SEX_PYRAMID.map(() => 0), F: AGE_SEX_PYRAMID.map(() => 0) };
    const shapes = sampleShapes(300000, mulberry32(seed));
    for (const s of shapes) for (const p of s.persons) cnt[p.sex][AGE_SEX_PYRAMID.findIndex((b) => p.age <= b.to)]++;
    return cnt;
  };
  for (let it = 0; it < 25; it++) {
    const cnt = measure(100 + it);
    let err = 0;
    AGE_SEX_PYRAMID.forEach((b, i) => {
      for (const [sx, t] of [["M", b.male], ["F", b.female]] as const) {
        const ratio = (t / total) / (cnt[sx][i] / 300000);
        err = Math.max(err, Math.abs(ratio - 1));
        AGE_RATIO[sx][i] *= Math.pow(ratio, 0.7);
      }
    });
    const mx = Math.max(...AGE_RATIO.M, ...AGE_RATIO.F);
    for (const sx of ["M", "F"] as const) AGE_RATIO[sx] = AGE_RATIO[sx].map((v) => v / mx);
    console.log(`iter ${it} max rel error ${err.toFixed(3)}`);
  }
  const fmt = (a: number[]) => `[${a.map((v) => v.toFixed(3)).join(", ")}]`;
  console.log(`M: ${fmt(AGE_RATIO.M)},\nF: ${fmt(AGE_RATIO.F)},`);
  process.exit(0);
}

const N = Number(process.argv[2] ?? 10000);
const city: City = JSON.parse(readFileSync("public/city.json", "utf8"));
const graph = new Graph(city);
const places = new Places(city, graph);
const t0 = performance.now();
const { agents, households } = createPopulation(places, N, Math.round(N * 0.04), Math.round(N * 0.12), mulberry32(2026));
const ms = performance.now() - t0;

// integrity checks
let bad = 0;
agents.forEach((a, i) => { if (a.id !== i) bad++; });
for (const h of households) {
  const drivers = h.members.filter((m) => m.hasCar).length;
  if (drivers > h.cars) bad++;
  for (const m of h.members) if (m.household !== h || m.home !== h.home || (m.age < 18 && m.hasCar)) bad++;
}
const res = agents.filter((a) => a.household.kind !== "touristes" && a.household.kind !== "pendulaire");
const resH = households.filter((h) => h.kind !== "touristes" && h.kind !== "pendulaire");
const emp = (a: Agent) => a.profile === "salarie" || a.profile === "frontalier" || a.profile === "commercant";
console.log(`${agents.length} agents (${res.length} residents, ${resH.length} households), ${households.length} total households, ${ms.toFixed(0)} ms, integrity errors: ${bad}`);

const totalPop = AGE_SEX_PYRAMID.reduce((s, b) => s + b.male + b.female, 0);
section("Age x sex (share of residents)");
for (const b of AGE_SEX_PYRAMID) {
  const inB = res.filter((a) => a.age >= b.from && a.age <= b.to);
  row(`${b.from}-${b.to} M`, inB.filter((a) => a.sex === "M").length / res.length, b.male / totalPop);
  row(`${b.from}-${b.to} F`, inB.filter((a) => a.sex === "F").length / res.length, b.female / totalPop);
}
const b80 = res.filter((a) => a.age >= 80);
rows.push(`80+ density: 80-84 ${b80.filter((a) => a.age < 85).length}, 85-89 ${b80.filter((a) => a.age >= 85 && a.age < 90).length}, 90+ ${b80.filter((a) => a.age >= 90).length}`);

const w = res.filter((a) => a.age >= 15 && a.age <= 64);
section("Activity 15-64 (share of age group)");
row("employed", w.filter(emp).length / w.length, ACTIVITY_15_64.employed);
row("unemployed", w.filter((a) => a.profile === "chomeur").length / w.length, ACTIVITY_15_64.unemployed);
row("student", w.filter((a) => a.profile === "etudiant").length / w.length, ACTIVITY_15_64.student);
row("retired", w.filter((a) => a.profile === "retraite").length / w.length, ACTIVITY_15_64.retired);
row("other inactive", w.filter((a) => a.profile === "inactif").length / w.length, ACTIVITY_15_64.otherInactive);
const inactive = w.filter((a) => a.profile === "inactif");
rows.push(`inactif: ${(100 * inactive.filter((a) => a.sex === "F").length / inactive.length).toFixed(0)}% women; 65+ employed: ${res.filter((a) => a.age >= 65 && emp(a)).length}/${res.filter((a) => a.age >= 65).length}`);
const act = w.filter((a) => emp(a) || a.profile === "chomeur");
row("unemployment rate", w.filter((a) => a.profile === "chomeur").length / act.length, 0.089);

const workers = res.filter((a) => emp(a) && a.csp);
const cspTotal = CSPS.reduce((s, c) => s + CSP_ACTIVE[c], 0);
section("CSP among employed residents");
for (const c of CSPS) row(c, workers.filter((a) => a.csp === c).length / workers.length, CSP_ACTIVE[c] / cspTotal);
row("frontalier / employed", res.filter((a) => a.profile === "frontalier").length / workers.length, 0.10);
const cadres = workers.filter((a) => a.csp === "cadre");
rows.push(`cadres aged 30-60: ${(100 * cadres.filter((a) => a.age >= 30 && a.age <= 60).length / cadres.length).toFixed(0)}%`);

section("Households (residents)");
for (const k of ["seul", "colocation", "couple", "famille", "monoparentale"] as const) {
  for (const sx of [undefined, "M", "F"] as const) {
    const t = HOUSEHOLD_SHARE.filter((e) => e.kind === k && (sx === undefined ? true : e.sex === sx));
    if (!t.length || (sx && k !== "seul")) continue;
    const hs = resH.filter((h) => h.kind === k && (sx === undefined || h.members[0].sex === sx));
    if (k === "seul" && sx === undefined) continue;
    row(`${k}${sx ? " " + sx : ""}`, hs.length / resH.length, t.reduce((s, e) => s + e.share, 0), 0.025);
  }
}
rows.push(`mean size ${(res.length / resH.length).toFixed(2)} (INSEE ${MEAN_HOUSEHOLD_SIZE})`);
section("Cars per household");
for (const [n, s] of CARS_PER_HOUSEHOLD) row(`${n} car(s)`, resH.filter((h) => h.cars === n).length / resH.length, s);
const carsByKind = (k: string) => { const hs = resH.filter((h) => h.kind === k); return (hs.reduce((s, h) => s + h.cars, 0) / hs.length).toFixed(2); };
rows.push(`mean cars: seul ${carsByKind("seul")}, couple ${carsByKind("couple")}, famille ${carsByKind("famille")}; adult 18+ with car ${(100 * res.filter((a) => a.age >= 18 && a.hasCar).length / res.filter((a) => a.age >= 18).length).toFixed(0)}%`);

section("Income (per resident)");
const inc = res.map((a) => a.household.income).sort((a, b) => a - b);
const med = inc[Math.floor(inc.length / 2)];
rows.push(`median ${med} EUR vs ${INCOME_MEDIAN} (${(100 * (med / INCOME_MEDIAN - 1)).toFixed(1)}%)`);
row("poverty (< 60% median)", inc.filter((v) => v < 0.6 * INCOME_MEDIAN).length / inc.length, POVERTY_RATE);

section("Part-time among salaried 15-64");
for (const sx of ["M", "F"] as const) {
  const sal = res.filter((a) => a.profile === "salarie" && a.sex === sx && a.age >= 15 && a.age <= 64);
  const target = PART_TIME_RATE[sx].reduce((s, b) => s + b.rate * sal.filter((a) => a.age >= b.from && a.age <= b.to).length, 0) / sal.length;
  row(`part-time ${sx}`, sal.filter((a) => a.partTime).length / sal.length, target);
}
const prof: Record<string, number> = {};
for (const a of agents) prof[a.profile] = (prof[a.profile] ?? 0) + 1;
rows.push(`\nprofiles: ${JSON.stringify(prof)}`);
const dogs = resH.filter((h) => h.members.some((m) => m.hasDog)).length;
rows.push(`households with dog: ${(100 * dogs / resH.length).toFixed(0)}%; multi-dog households: ${resH.filter((h) => h.members.filter((m) => m.hasDog).length > 1).length}`);
rows.push(`sample: ${resH.slice(0, 3).map((h) => h.kind + " " + h.members.map((m) => `${m.name}(${m.age}${m.sex},${m.profile})`).join(" + ")).join("\n        ")}`);
console.log(rows.join("\n"));
console.log(worst > 0 ? `\nOut of tolerance: worst ${(100 * worst).toFixed(1)} points` : "\nAll marginals within tolerance");
