import type { Agent } from "./population";
import type { Engine } from "./engine";
import type { Place } from "./places";

/** Contexte de décision, distinct de la fiche UI complète. */
export function buildAiContext(engine: Engine, a: Agent, mind: { memories: string[]; goal: string; plan: string[] }, nearby: Agent[], places: Place[]) {
  const current = a.plan[a.step];
  const recent = mind.memories.slice(-8);
  // Garder les paroles reçues récentes quand les résultats d'actions remplissent le journal.
  const received = mind.memories.filter((m) => m.includes(" te dit : ")).slice(-3);
  const memories = [...new Set([...received, ...recent])].slice(-10).map((m) => m.slice(0, 500));
  return JSON.stringify({
    day: engine.day, minute: Math.round(engine.minute),
    person: {
      id: a.id, name: a.name, age: a.age, profile: a.profile, csp: a.csp,
      monthlyIncome: Math.round(a.household.income / 12), partTime: a.partTime,
      needs: Object.fromEntries(Object.entries(a.needs).map(([key, value]) => [key, Math.round(value * 100) / 100])),
      now: a.trip ? "travelling" : current?.place.name ?? current?.place.kind,
      until: current ? Math.round(current.until) : undefined,
      household: a.household.members.filter((m) => m !== a).slice(0, 6).map((m) => ({ id: m.id, name: m.name, age: m.age })),
      transport: { car: a.hasCar, bike: a.hasBike },
      obligations: a.plan.slice(a.step + 1, a.step + 3).map((step) => ({ place: step.place.name ?? step.place.kind, until: Math.round(step.until) })),
    },
    personality: ["sociable", "réservée", "curieuse", "pragmatique"][a.id % 4],
    memories, goal: mind.goal, remainingPlan: mind.plan.slice(0, 3),
    constraints: { travelling: !!a.trip, youngChildren: a.household.members.some((m) => m.age < 12), visitOnlyDuringFreeTimeAtHome: true },
    nearby: nearby.map((b) => ({ id: b.id, name: b.name })),
    destinations: places.map((p) => ({ id: p.id, kind: p.kind, name: p.name })),
  });
}
