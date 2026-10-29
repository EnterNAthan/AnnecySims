import type { Engine } from "./engine";
import type { Agent } from "./population";
import { insertOuting } from "./planner";
import { DecisionSchema, validateBatch, type Decision } from "../shared/intelligence";
import type { AiLog } from "../shared/intelligence";
import { DEFAULT_AI_CONFIG, type AiConfig } from "../shared/aiConfig";
import { buildAiContext } from "./aiContext";
import { selectAiPopulation } from "./aiPopulation";
import type { ResidentChat } from "../shared/chat";

interface Mind {
  memories: string[];
  next: number;
  busy: boolean;
  status: string;
  goal: string;
  plan: string[];
  failures: number;
  revision: number;
}

/** Orchestration réseau séparée du moteur pur : aucun appel ne bloque les ticks. */
export class Intelligence {
  private chats = new Map<number, ResidentChat & { biography: string }>();

  async converse(id: number, text: string | undefined, publish: (state: ResidentChat) => void) {
    const a = this.tracked.find((person) => person.id === id);
    if (!a) { publish({ id, name: "Habitant", messages: [], busy: false, error: "Choisis un habitant IA dans la liste ⚙." }); return; }
    let state = this.chats.get(id);
    if (!state) { state = { id, name: a.name, messages: [], busy: false, biography: "" }; this.chats.set(id, state); }
    const emit = () => publish({ id, name: state.name, messages: [...state.messages], busy: state.busy, error: state.error });
    if (text === undefined || state.busy) { emit(); return; }
    text = text.trim().slice(0, 1000);
    if (!text) return;
    if (!this.config.enabled) { state.error = "IA suspendue dans la configuration"; emit(); return; }
    state.busy = true; state.error = undefined;
    emit();
    try {
      const mind = this.mind(a);
      const response = await fetch("/api/agents/chat", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(95000),
        body: JSON.stringify({ context: buildAiContext(this.engine, a, mind, [], []), biography: state.biography,
          messages: [...state.messages.slice(-18), { role: "user", content: text }] }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Conversation indisponible");
      if (typeof result.reply !== "string" || typeof result.biography !== "string") throw new Error("Réponse invalide");
      state.biography ||= result.biography;
      state.messages.push({ role: "user", content: text }, { role: "assistant", content: result.reply });
      state.messages = state.messages.slice(-100);
      this.remember(a, `Échange avec le visiteur : ${text.slice(0, 200)} — J'ai répondu : ${result.reply.slice(0, 300)}`);
    } catch (error) { state.error = error instanceof Error ? error.message : "Conversation indisponible"; }
    finally { state.busy = false; emit(); }
  }
  private minds = new Map<number, Mind>();
  private active = 0;
  private cursor = 0;
  private nextDispatch = 0;
  private inFlightRequests = 0;
  private failedRequests = 0;
  private cooldownUntil = 0;
  private config = { ...DEFAULT_AI_CONFIG };
  private trackedIds = new Set<number>();
  private tracked: Agent[] = [];
  private pending: { id: number; context: string; resolve: (value: Decision) => void; reject: (error: unknown) => void }[] = [];

  private requestDecision(id: number, context: string): Promise<Decision> {
    return new Promise((resolve, reject) => {
      this.pending.push({ id, context, resolve, reject });
      if (this.pending.length === 1) queueMicrotask(() => void this.flush());
    });
  }

  private async flush() {
    const entries = this.pending.splice(0);
    this.inFlightRequests++;
    try {
      const body = entries.length === 1 ? { context: entries[0].context } : { contexts: entries.map((entry) => ({ agentId: entry.id, context: entry.context })) };
      const response = await fetch("/api/agents/decide", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(95000) });
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        throw new Error(`IA HTTP ${response.status} : ${detail.error ?? "Erreur sans détail"}`);
      }
      const raw = await response.json();
      const decisions = entries.length === 1 ? [{ ...DecisionSchema.parse(raw), agentId: entries[0].id }] : validateBatch(raw, entries.map((entry) => entry.id)).decisions;
      this.failedRequests = 0;
      for (const entry of entries) entry.resolve(decisions.find((d) => d.agentId === entry.id)!);
    } catch (error) {
      if (++this.failedRequests >= 3) this.cooldownUntil = this.now() + 30000;
      for (const entry of entries) entry.reject(error);
    } finally { this.inFlightRequests--; }
  }

  configure(config: AiConfig) {
    const oldInterval = this.config.intervalSeconds * 1000;
    this.config = { ...config };
    this.tracked = selectAiPopulation(this.engine.agents, config.agentLimit);
    this.trackedIds = new Set(this.tracked.map((a) => a.id));
    for (const mind of this.minds.values()) {
      mind.next = Math.max(this.now(), mind.next + config.intervalSeconds * 1000 - oldInterval);
      mind.memories = mind.memories.slice(-config.memoryLimit);
    }
  }

  constructor(private engine: Engine, private onLog: (entry: AiLog) => void = () => {}, private now = () => performance.now()) {
    this.configure(this.config);
  }

  population() {
    return { total: this.engine.agents.length, tracked: this.tracked.map((a) => ({ id: a.id, name: a.name, profile: a.profile })) };
  }

  private log(a: Agent, kind: AiLog["kind"], text: string, started?: number) {
    this.onLog({ kind, agentId: a.id, name: a.name, day: this.engine.day,
      minute: this.engine.minute, timestamp: Date.now(), text, active: this.active,
      durationMs: started === undefined ? undefined : Math.round(performance.now() - started) });
  }

  private mind(a: Agent): Mind {
    let mind = this.minds.get(a.id);
    if (!mind) {
      mind = { memories: [], next: 0, busy: false, status: "En attente", goal: "Organiser ma journée et entretenir mes relations", plan: [], failures: 0, revision: 0 };
      this.minds.set(a.id, mind);
    }
    return mind;
  }

  private remember(a: Agent, text: string) {
    const mind = this.mind(a);
    mind.memories.push(`Jour ${this.engine.day}, ${Math.round(this.engine.minute)} min : ${text}`);
    mind.revision++;
    if (mind.memories.length > this.config.memoryLimit) mind.memories.shift();
  }

  private nearby(a: Agent) {
    const place = a.plan[a.step]?.place;
    return this.engine.agents.filter((b) => b !== a && !a.trip && !b.trip && place && b.plan[b.step]?.place === place);
  }

  tick() {
    const agents = this.tracked;
    const now = this.now();
    if (!this.config.enabled || !agents.length || now < this.nextDispatch || now < this.cooldownUntil || this.inFlightRequests >= this.config.concurrency) return;
    let dispatched = 0;
    for (let n = 0; n < agents.length; n++) {
      const a = agents[this.cursor++ % agents.length];
      const mind = this.mind(a);
      if (!mind.busy && now >= mind.next) {
        this.nextDispatch = now + Math.max(1000 / this.config.requestsPerSecond, this.config.intervalSeconds * 1000 * this.config.batchSize / agents.length);
        void this.reflect(a);
        if (++dispatched >= this.config.batchSize) break;
      }
    }
  }

  inspect(id: number) {
    if (!this.trackedIds.has(id)) return { status: "Comportement automatique", memories: [], mode: "automatic" as const };
    const mind = this.minds.get(id);
    return mind ? { status: mind.status, memories: [...mind.memories], goal: mind.goal, plan: [...mind.plan], mode: "llm" as const } : { status: "En attente", memories: [], mode: "llm" as const };
  }

  private async reflect(a: Agent) {
    const mind = this.mind(a);
    mind.busy = true;
    mind.status = "Réfléchit";
    this.active++;
    const started = performance.now();
    const scheduled = this.now();
    this.log(a, "request", "Demande de décision IA envoyée");
    const day = this.engine.day;
    const minute = this.engine.minute;
    const revision = mind.revision;
    const candidates = ["park", "lake", "food", "grocery", "culture", "sport"] as const;
    const canVisit = !a.trip && a.age >= 18 && !a.household.members.some((m) => m.age < 12) && a.plan[a.step]?.place === a.home;
    const places = canVisit ? candidates.flatMap((kind) => [...this.engine.places.list(kind)]
      .sort((p, q) => Math.hypot(p.x - a.x, p.z - a.z) - Math.hypot(q.x - a.x, q.z - a.z)).slice(0, 2)) : [];
    const nearby = this.nearby(a).slice(0, 5);
    try {
      const context = buildAiContext(this.engine, a, mind, nearby, places);
      const decision = await this.requestDecision(a.id, context);
      if (!this.trackedIds.has(a.id)) { mind.status = "Retour au comportement automatique"; return; }
      mind.failures = 0;
      if (day !== this.engine.day || this.engine.minute - minute > 15) {
        mind.status = "Situation modifiée, nouvelle décision nécessaire";
        this.log(a, "ignored", mind.status, started);
        return;
      }
      let outcome = "Activité poursuivie";
      if (decision.goal) mind.goal = decision.goal;
      if (decision.plan) mind.plan = decision.plan;
      if (decision.action === "visit") {
        const place = places.find((p) => p.id === decision.placeId);
        // Première version : protéger les accompagnements et les obligations des familles.
        const familyDuty = a.household.members.some((m) => m.age < 12);
        outcome = place && !a.trip && a.age >= 18 && !familyDuty && insertOuting(a, place, this.engine.minute + 2, decision.durationMinutes ?? 30)
          ? `Sortie planifiée : ${place.name ?? place.kind}` : "Sortie refusée : planning ou contraintes familiales";
      }
      if (decision.action === "talk") {
        const target = this.nearby(a).find((b) => b.id === decision.targetId && nearby.includes(b));
        if (target && decision.message) {
          if (mind.revision !== revision) {
            outcome = "Conversation différée : une nouvelle parole est arrivée pendant la réflexion";
          } else {
          if (this.trackedIds.has(target.id)) this.remember(target, `${a.name} te dit : ${decision.message}`);
          outcome = `À ${target.name} : ${decision.message}`;
          this.log(a, "conversation", outcome);
          if (!this.trackedIds.has(target.id)) {
            // Les figurants gardent leurs règles : réponse simple, sans appel ni mémoire LLM.
            const reply = target.needs.energy < 0.3 ? "Je suis fatigué, je vais me reposer." : target.plan[target.step]?.place === target.work ? "Je travaille pour le moment, on se reparle plus tard." : "Bonjour ! Je continue ma journée, à bientôt.";
            this.remember(a, `${target.name} te répond (automatique) : ${reply}`);
            this.log(target, "conversation", `Réponse automatique à ${a.name} : ${reply}`);
          }
          }
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
      mind.failures++;
      this.log(a, "error", mind.status, started);
    } finally {
      mind.busy = false;
      mind.next = Math.max(scheduled + this.config.intervalSeconds * 1000, this.now() + (mind.failures ? Math.min(30000, 1000 * 2 ** Math.min(mind.failures, 5)) : 0));
      this.active--;
      this.onLog({ kind: "request", agentId: a.id, name: a.name, day: this.engine.day,
        minute: this.engine.minute, timestamp: Date.now(), text: "", active: this.active });
    }
  }
}
