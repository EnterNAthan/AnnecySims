/// <reference lib="webworker" />
// Worker de simulation : héberge le moteur et répond aux ticks de la page.
import type { City } from "../shared/city";
import { Engine } from "./engine";
import type { FromWorker, ToWorker } from "./protocol";

declare const self: DedicatedWorkerGlobalScope;

let engine: Engine | null = null;
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
  if (msg.type === "init") {
    const city: City = await fetch("/city.json").then((r) => r.json());
    engine = new Engine(city, { ...msg, startDate: new Date(msg.startDate) });
    const places: Record<string, number> = {};
    for (const [k, list] of engine.places.byKind) places[k] = list.length;
    post({ type: "ready", agents: engine.agents.length, places });
    post({ type: "dayStart", day: engine.day, plan: engine.dayPlan });
    return;
  }
  if (!engine) return;
  switch (msg.type) {
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
    case "inspect":
      post({ type: "agent", info: engine.inspect(msg.id) });
      return;
    case "tick": {
      // rattrape les jours entiers (vitesse élevée), en émettant un bilan à chaque minuit
      while (engine.day < msg.day) {
        post({ type: "day", report: engine.endDay() });
        post({ type: "dayStart", day: engine.day, plan: engine.dayPlan });
        flush();
      }
      engine.advanceTo(msg.minute);
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
        post({ type: "traffic", data }, [data.buffer]);
      }
    }
  }
};
