import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { loadEnv } from "vite";
import { decide, type RequestMetrics } from "../server/intelligence";
import { DEFAULT_AI_CONFIG } from "../src/shared/aiConfig";
import type { Decision } from "../src/shared/intelligence";
import { Engine } from "../src/sim/engine";
import { buildAiContext } from "../src/sim/aiContext";

// Test indépendant de Vite et du navigateur. Aucun état de la ville ouverte n'est modifié.
const args = process.argv.slice(2);
const quick = args.includes("--quick");
const dryRun = args.includes("--dry-run");
const samples = Number(args.find((a) => a.startsWith("--samples="))?.split("=")[1] ?? (quick ? 1 : 3));
if (!Number.isInteger(samples) || samples < 1 || samples > 10) throw new Error("--samples doit être compris entre 1 et 10");
const model = args.find((a) => a.startsWith("--model="))?.slice(8) ?? DEFAULT_AI_CONFIG.model;
const env = loadEnv("development", process.cwd(), "");
const engine = new Engine(JSON.parse(readFileSync("public/city.json", "utf8")), { residents: 100, tourists: 0, commuters: 0, seed: 2026, startDate: new Date("2026-10-29") });
engine.advanceTo(6 * 60);
const memories = Array.from({ length: 16 }, (_, i) => `J1 ${i} : Activité poursuivie, je respecte mon planning et souhaite voir mes proches.`);
const fixtures = engine.agents.slice(0, 5).map((a) => {
  const nearby = engine.agents.filter((b) => b !== a && !a.trip && !b.trip && b.plan[b.step]?.place === a.plan[a.step]?.place).slice(0, 5);
  const destinations = !a.trip && a.age >= 18 && !a.household.members.some((m) => m.age < 12) && a.plan[a.step]?.place === a.home
    ? ["park", "lake", "food", "grocery", "culture", "sport"].flatMap((kind) => [...engine.places.list(kind as "park")].sort((p, q) => Math.hypot(p.x - a.x, p.z - a.z) - Math.hypot(q.x - a.x, q.z - a.z)).slice(0, 2)) : [];
  const compact = JSON.parse(buildAiContext(engine, a, { memories, goal: "Organiser ma journée", plan: ["Respecter mes obligations", "Prendre des nouvelles"] }, nearby, destinations));
  return { agentId: a.id, compact, full: { ...compact, person: engine.inspect(a.id), memories }, light: { ...compact, memories: compact.memories.slice(-3), nearby: compact.nearby.slice(0, 3), destinations: compact.destinations.slice(0, 6) } };
});

interface Scenario { name: string; batch: number; concurrency: number; context: "compact" | "full" | "light"; tokens: number; reasoningEffort?: "none" }
const scenarioFilter = args.find((a) => a.startsWith("--scenario="))?.slice(11);
const scenarios: Scenario[] = [
  { name: "individuel-compact", batch: 1, concurrency: 1, context: "compact", tokens: 1500 },
  { name: "lot5-compact", batch: 5, concurrency: 1, context: "compact", tokens: 3000 },
  { name: "lot5-leger", batch: 5, concurrency: 1, context: "light", tokens: 3000 },
  { name: "lot5-concurrence2", batch: 5, concurrency: 2, context: "compact", tokens: 3000 },
  ...(!quick ? [
    { name: "lot5-complet", batch: 5, concurrency: 1, context: "full", tokens: 3000 },
    { name: "lot5-budget1500", batch: 5, concurrency: 1, context: "compact", tokens: 1500 },
    { name: "lot5-sans-raisonnement", batch: 5, concurrency: 1, context: "compact", tokens: 3000, reasoningEffort: "none" },
  ] satisfies Scenario[] : []),
].filter((scenario) => !scenarioFilter || scenario.name === scenarioFilter) as Scenario[];
if (!scenarios.length) throw new Error("Scénario inconnu, utiliser --dry-run pour la liste");

interface Trial { scenario: string; sample: number; batch: number; durationMs: number; validDecisions: number; error?: string; metrics?: RequestMetrics }
const trials: Trial[] = [];
const summaries: { scenario: string; calls: number; success: number; p50Ms: number; p95Ms: number; decisionsPerMinute: number; residentsAt60s: number }[] = [];
const output = `benchmarks/results/${new Date().toISOString().replace(/[:.]/g, "-")}`;
mkdirSync(output, { recursive: true });
function save() {
  writeFileSync(`${output}/results.json`, JSON.stringify({ date: new Date().toISOString(), model, samples, dryRun, scenarios, defaults: DEFAULT_AI_CONFIG, trials, summaries }, null, 2));
}
function bodyFor(scenario: Scenario) {
  const contexts = fixtures.slice(0, scenario.batch).map((f) => ({ agentId: f.agentId, context: JSON.stringify(f[scenario.context]) }));
  return scenario.batch === 1 ? { context: contexts[0].context } : { contexts };
}
function allowed(decision: Decision, id: number, scenario: Scenario) {
  const f = fixtures.find((f) => f.agentId === id)![scenario.context];
  if (decision.action === "talk") return !!decision.message && f.nearby.some((p: { id: number }) => p.id === decision.targetId);
  if (decision.action === "visit") return f.destinations.some((p: { id: number }) => p.id === decision.placeId);
  return true;
}
const percentile = (values: number[], p: number) => values.length ? [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * p) - 1)] : 0;
for (const scenario of scenarios) {
  const body = bodyFor(scenario);
  if (dryRun) { console.log(`${scenario.name}: ${JSON.stringify(body).length} caractères, lot ${scenario.batch}, concurrence ${scenario.concurrency}, budget ${scenario.tokens}`); continue; }
  console.log(`\n${scenario.name} : ${samples} appels, concurrence ${scenario.concurrency}`);
  let cursor = 0;
  const start = performance.now();
  await Promise.all(Array.from({ length: Math.min(samples, scenario.concurrency) }, async (_, worker) => {
    if (worker) await new Promise((resolve) => setTimeout(resolve, worker * 500));
    while (cursor < samples) {
      const sample = ++cursor;
      const at = performance.now();
      const trial: Trial = { scenario: scenario.name, sample, batch: scenario.batch, durationMs: 0, validDecisions: 0 };
      try {
        const result = await decide(body, env, { ...DEFAULT_AI_CONFIG, model, maxTokens: scenario.tokens, reasoningEffort: scenario.reasoningEffort ?? "provider" }, (metrics) => { trial.metrics = metrics; });
        const decisions = "decisions" in result ? result.decisions : [{ ...result, agentId: fixtures[0].agentId }];
        trial.validDecisions = decisions.filter((d) => allowed(d, d.agentId, scenario)).length;
        if (trial.validDecisions !== scenario.batch) trial.error = "Décisions impossibles : cible ou lieu absent du contexte";
      } catch (error) {
        const key = env.ARKANE_API_KEY || env.ARKANE_CLOUD_API_KEY;
        const message = error instanceof Error ? error.message : String(error);
        trial.error = key ? message.replaceAll(key, "[clé masquée]") : message;
      }
      trial.durationMs = Math.round(performance.now() - at);
      trials.push(trial);
      save();
      console.log(`  ${sample}: ${(trial.durationMs / 1000).toFixed(1)} s, ${trial.validDecisions}/${scenario.batch} décisions valides${trial.error ? ` — ${trial.error.slice(0, 180)}` : ""}`);
    }
  }));
  const elapsed = (performance.now() - start) / 1000;
  const group = trials.filter((t) => t.scenario === scenario.name);
  const throughput = group.reduce((sum, t) => sum + t.validDecisions, 0) / elapsed;
  // Marge de 30 %, plafond de départs du profil stable et renouvellement en 60 s.
  const sustainable = Math.min(throughput * 0.7, DEFAULT_AI_CONFIG.requestsPerSecond * scenario.batch);
  summaries.push({ scenario: scenario.name, calls: group.length, success: group.filter((t) => !t.error).length, p50Ms: percentile(group.map((t) => t.durationMs), 0.5), p95Ms: percentile(group.map((t) => t.durationMs), 0.95), decisionsPerMinute: Math.round(throughput * 60), residentsAt60s: Math.floor(sustainable * 60) });
  save();
}
const rows = summaries.map((s) => `| ${s.scenario} | ${s.success}/${s.calls} | ${(s.p50Ms / 1000).toFixed(1)} | ${(s.p95Ms / 1000).toFixed(1)} | ${s.decisionsPerMinute} | ${s.residentsAt60s} |`);
writeFileSync(`${output}/report.md`, `# Essai Arkane\n\nModèle : ${model}. ${samples} échantillon(s) par scénario.\n\n| Scénario | Appels valides | p50 s | p95 s | Décisions/min mesurées | Personnes estimées à 60 s |\n| --- | --- | --- | --- | --- | --- |\n${rows.join("\n")}\n\nEstimations du débit IA, pas un maximum de rendu 3D. Marge de 30 % et plafond du profil stable. Les percentiles sur peu d'échantillons sont indicatifs. Les timings des en-têtes ne sont pas un temps au premier token. Aucun retry automatique. Les erreurs et réponses tronquées sont incluses. Résultats sensibles à la charge du provider et au cache ; répéter à plusieurs heures. Les fixtures ne valident pas la cohérence sociale à long terme.\n`);
console.table(summaries);
save();
console.log(`Rapport : ${output}/report.md`);
