/// <reference lib="webworker" />
// Worker de simulation : héberge le moteur et répond aux ticks de la page.
import type { City } from "../shared/city";
import { Engine } from "./engine";
import type { FromWorker, ToWorker } from "./protocol";

declare const self: DedicatedWorkerGlobalScope;

let engine: Engine | null = null;
const post = (msg: FromWorker, transfer: Transferable[] = []) => self.postMessage(msg, transfer);

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
  if (msg.type === "inspect" && engine) {
    post({ type: "agent", info: engine.inspect(msg.id) });
    return;
  }
  if (msg.type === "tick" && engine) {
    // rattrape les jours entiers (vitesse élevée), en émettant un bilan à chaque minuit
    while (engine.day < msg.day) {
      post({ type: "day", report: engine.endDay() });
      post({ type: "dayStart", day: engine.day, plan: engine.dayPlan });
    }
    engine.advanceTo(msg.minute);
    const out = new Float32Array(msg.buffer);
    const count = engine.snapshot(out);
    const thoughts = engine.thoughts.slice(-40);
    engine.thoughts.length = 0;
    post({ type: "frame", buffer: out.buffer, count, counts: engine.liveCounts(), day: engine.day, minute: engine.minute, thoughts }, [out.buffer]);
  }
};
