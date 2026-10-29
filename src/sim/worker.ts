/// <reference lib="webworker" />
// Worker de simulation : héberge le moteur et répond aux ticks de la page.
import type { City } from "../shared/city";
import { Engine } from "./engine";
import { Intelligence } from "./intelligence";
import type { FromWorker, ToWorker } from "./protocol";

declare const self: DedicatedWorkerGlobalScope;

let engine: Engine | null = null;
let intelligence: Intelligence | null = null;
const post = (msg: FromWorker, transfer: Transferable[] = []) => self.postMessage(msg, transfer);
/** relaie les messages du moteur (réactions à demander, impact, analyses) */
const flush = () => {
  if (!engine) return;
  for (const msg of engine.outbox) post(msg);
  engine.outbox.length = 0;
};
let lastTraffic = -1;

self.onmessage = async (ev: MessageEvent<ToWorker>) => {
  const msg = ev.data;
  if (msg.type === "aiConfig") {
    intelligence?.configure(msg.config);
    if (engine) post({ type: "aiPopulation", population: intelligence?.population() ?? { total: engine.agents.length, tracked: [] } });
    return;
  }
  if (msg.type === "init") {
    const city: City = await fetch("/city.json").then((r) => r.json());
    const transit = await fetch("/transit.json").then((r) => (r.ok ? r.json() : undefined)).catch(() => undefined);
    engine = new Engine(city, { ...msg, startDate: new Date(msg.startDate), transit });
    intelligence = msg.aiEnabled === false ? null : new Intelligence(engine, (entry) => post({ type: "aiLog", entry }));
    const places: Record<string, number> = {};
    for (const [k, list] of engine.places.byKind) places[k] = list.length;
    post({ type: "ready", agents: engine.agents.length, places });
    post({ type: "aiPopulation", population: intelligence?.population() ?? { total: engine.agents.length, tracked: [] } });
    post({ type: "dayStart", day: engine.day, plan: engine.dayPlan });
    return;
  }
  if (!engine) return;
  switch (msg.type) {
    case "chat":
      if (intelligence) void intelligence.converse(msg.id, msg.text, (chat) => post({ type: "chat", chat }));
      else post({ type: "chat", chat: { id: msg.id, name: "Habitant", messages: [], busy: false, error: "IA désactivée dans cette ville" } });
      return;
    case "addEvent": {
      const sid = engine.addEvent(msg.proposal);
      post({ type: "planUpdate", plan: engine.dayPlan, added: sid });
      flush();
      return;
    }
    case "preview":
      post({ type: "preview", preview: msg.proposal ? engine.preview(msg.proposal) : null });
      return;
    case "cohortPlan":
      engine.setCohortPlan(msg.sid, msg.responses);
      flush();
      return;
    case "cancelEvent":
      engine.cancelEvent(msg.sid);
      post({ type: "planUpdate", plan: engine.dayPlan, added: -1 });
      return;
    case "inspect": {
      const info = engine.inspect(msg.id);
      if (info) info.intelligence = intelligence?.inspect(msg.id);
      post({ type: "agent", info });
      return;
    }
    case "tick": {
      // rattrape les jours entiers (vitesse élevée), en émettant un bilan à chaque minuit
      while (engine.day < msg.day) {
        post({ type: "day", report: engine.endDay() });
        post({ type: "dayStart", day: engine.day, plan: engine.dayPlan });
        flush();
      }
      // rattrapage par tranches (démarrage en milieu de journée) : une image toutes les 45 min simulées
      // plutôt qu'un long silence pendant que la nuit et la matinée se calculent
      const previousMinute = engine.minute;
      engine.advanceTo(Math.min(msg.minute, engine.minute + 45));
      if (engine.minute !== previousMinute && engine.minute >= msg.minute) intelligence?.tick();
      const out = new Float32Array(msg.buffer);
      const count = engine.snapshot(out);
      const thoughts = engine.thoughts.slice(-40);
      engine.thoughts.length = 0;
      post({ type: "frame", buffer: out.buffer, count, counts: engine.liveCounts(), day: engine.day, minute: engine.minute, thoughts }, [out.buffer]);
      flush();
      // couche trafic : toutes les 5 minutes simulées
      const slot = engine.day * 288 + Math.floor(engine.minute / 5);
      if (slot !== lastTraffic) {
        lastTraffic = slot;
        const data = engine.traffic();
        const parking = engine.parkings?.snapshot() ?? new Uint16Array(0);
        post({ type: "traffic", data, parking }, [data.buffer, parking.buffer]);
      }
      // tracés des bus (au démarrage, puis à chaque déviation ou navette)
      if (engine.transitChanged && engine.bus) {
        engine.transitChanged = false;
        const g = engine.graph;
        post({
          type: "transit",
          lines: engine.bus.dirs.map((d) => ({
            ref: d.ref, colour: d.colour, line: d.line, name: d.name, stops: d.stops.map(({ name, x, z }) => ({ name, x, z })),
            path: d.path ? Array.from(d.path.nodes, (n) => [Math.round(g.x[n]), Math.round(g.z[n])]).flat() : [],
          })),
        });
      }
    }
  }
};
