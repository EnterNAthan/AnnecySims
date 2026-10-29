import type { Engine } from "./engine";
import type { Agent } from "./population";
import { insertOuting } from "./planner";
import { DecisionSchema } from "../shared/intelligence";
import type { AiLog } from "../shared/intelligence";

interface Mind {
  memories: string[];
  next: number;
  busy: boolean;
  status: string;
}

/** Orchestration réseau séparée du moteur pur : aucun appel ne bloque les ticks. */
export class Intelligence {
  private minds = new Map<number, Mind>();
  private active = 0;
  private cursor = 0;

  constructor(private engine: Engine, private onLog: (entry: AiLog) => void = () => {}) {}

  private log(a: Agent, kind: AiLog["kind"], text: string, started?: number) {
    this.onLog({ kind, agentId: a.id, name: a.name, day: this.engine.day,
      minute: this.engine.minute, timestamp: Date.now(), text, active: this.active,
      durationMs: started === undefined ? undefined : Math.round(performance.now() - started) });
  }

  private mind(a: Agent): Mind {
    let mind = this.minds.get(a.id);
    if (!mind) {
      mind = { memories: [], next: 0, busy: false, status: "En attente" };
      this.minds.set(a.id, mind);
    }
    return mind;
  }

  private remember(a: Agent, text: string) {
    const mind = this.mind(a);
    mind.memories.push(`Jour ${this.engine.day}, ${Math.round(this.engine.minute)} min : ${text}`);
    if (mind.memories.length > 24) mind.memories.shift();
  }

  private nearby(a: Agent) {
    const place = a.plan[a.step]?.place;
    return this.engine.agents.filter((b) => b !== a && !a.trip && !b.trip && place && b.plan[b.step]?.place === place);
  }

  tick() {
    const agents = this.engine.agents;
    for (let n = 0; n < agents.length && this.active < 4; n++) {
      const a = agents[this.cursor++ % agents.length];
      const mind = this.mind(a);
      if (!mind.busy && performance.now() >= mind.next) void this.reflect(a);
    }
  }

  inspect(id: number) {
    const mind = this.minds.get(id);
    return mind ? { status: mind.status, memories: [...mind.memories] } : { status: "En attente", memories: [] };
  }

  private async reflect(a: Agent) {
    const mind = this.mind(a);
    mind.busy = true;
    mind.status = "Réfléchit";
    this.active++;
    const started = performance.now();
    this.log(a, "request", "Demande de décision envoyée à DeepSeek");
    const day = this.engine.day;
    const minute = this.engine.minute;
    const candidates = ["park", "lake", "food", "grocery", "culture", "sport"] as const;
    const places = candidates.flatMap((kind) => this.engine.places.list(kind).slice(0, 3));
    const nearby = this.nearby(a).slice(0, 8);
    try {
      const context = JSON.stringify({
        day, minute, person: this.engine.inspect(a.id),
        personality: ["sociable", "réservée", "curieuse", "pragmatique"][a.id % 4],
        memories: mind.memories,
        nearby: nearby.map((b) => ({ id: b.id, name: b.name })),
        destinations: places.map((p) => ({ id: p.id, kind: p.kind, name: p.name })),
      });
      const response = await fetch("/api/agents/decide", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context }), signal: AbortSignal.timeout(50000),
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        throw new Error(`IA HTTP ${response.status} : ${detail.error ?? "Erreur sans détail"}`);
      }
      const decision = DecisionSchema.parse(await response.json());
      if (day !== this.engine.day || this.engine.minute - minute > 15) {
        mind.status = "Situation modifiée, nouvelle décision nécessaire";
        this.log(a, "ignored", mind.status, started);
        return;
      }
      let outcome = "Activité poursuivie";
      if (decision.action === "visit") {
        const place = places.find((p) => p.id === decision.placeId);
        // Première version : protéger les accompagnements et les obligations des familles.
        const familyDuty = a.household.members.some((m) => m.age < 12);
        outcome = place && !a.trip && a.age >= 18 && !familyDuty && insertOuting(a, place, this.engine.minute + 2, 30)
          ? `Sortie planifiée : ${place.name ?? place.kind}` : "Sortie refusée : planning ou contraintes familiales";
      }
      if (decision.action === "talk") {
        const target = this.nearby(a).find((b) => b.id === decision.targetId && nearby.includes(b));
        if (target && decision.message) {
          this.remember(target, `${a.name} te dit : ${decision.message}`);
          outcome = `À ${target.name} : ${decision.message}`;
          this.log(a, "conversation", outcome);
          this.mind(target).next = Math.min(this.mind(target).next, performance.now() + 1000);
        } else outcome = "Conversation impossible : interlocuteur absent ou message vide";
      }
      this.remember(a, `${decision.thought} — ${outcome}`);
      mind.status = outcome;
      this.log(a, "decision", `${decision.thought} — ${outcome}`, started);
      a.thoughtLog.push({ icon: "🧠", text: decision.thought, day, minute: this.engine.minute });
      if (a.thoughtLog.length > 8) a.thoughtLog.shift();
      this.engine.thoughts.push({ id: a.id, name: a.name, profile: a.profile, icon: "🧠", text: decision.thought, minute: this.engine.minute });
    } catch (error) {
      mind.status = error instanceof Error ? error.message : "Erreur IA";
      this.log(a, "error", mind.status, started);
    } finally {
      mind.busy = false;
      mind.next = performance.now() + 30000;
      this.active--;
      this.onLog({ kind: "request", agentId: a.id, name: a.name, day: this.engine.day,
        minute: this.engine.minute, timestamp: Date.now(), text: "", active: this.active });
    }
  }
}
