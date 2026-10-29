import "./style.css";
import * as THREE from "three";
import type { City } from "./shared/city";
import { World } from "./render/scene";
import { buildBuildings, buildGreens, buildRoads, buildTerrain, buildTrees, buildWater } from "./render/cityMeshes";
import { buildLandmarks } from "./render/landmarks";
import { AgentsView } from "./render/agents";
import { EventsView, hhmm } from "./render/events";
import { SimClock } from "./sim/clock";
import { EVENT_ICON, WEATHER_ICON, type DayPlan } from "./sim/events";
import { PROFILES, PROFILE_COLOR, PROFILE_LABEL } from "./sim/population";
import { FRAME_STRIDE, type AgentInfo, type DayReport, type FromWorker, type LiveCounts, type ToWorker } from "./sim/protocol";

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const fmt = (n: number) => Math.round(n).toLocaleString("fr-FR");
const pct = (v: number) => `${Math.round(v * 100)} %`;

async function main() {
  const params = new URLSearchParams(location.search);
  const residents = Number(params.get("pop") ?? 5000);
  // fin octobre : peu de touristes ; le calendrier saisonnier ajustera ce nombre
  const tourists = Math.round(residents * 0.04);
  const commuters = Math.round(residents * 0.12);
  const startDate = new Date();

  const worker = new Worker(new URL("./sim/worker.ts", import.meta.url), { type: "module" });
  const send = (msg: ToWorker, transfer: Transferable[] = []) => worker.postMessage(msg, transfer);
  const ready = new Promise<void>((resolve) => {
    worker.addEventListener("message", (e: MessageEvent<FromWorker>) => e.data.type === "ready" && resolve(), { once: true });
  });
  send({ type: "init", residents, tourists, commuters, seed: 2026, startDate: startDate.toISOString() });

  const city: City = await fetch("/city.json").then((r) => r.json());
  const world = new World($("#app"));
  const buildings = buildBuildings(city);
  world.setWindowMaterial(buildings.material);
  world.scene.add(buildTerrain(city), buildWater(city), buildGreens(city), buildRoads(city), buildTrees(city.greens), buildings.mesh, buildLandmarks());

  const total = residents + tourists + commuters;
  const agents = new AgentsView(total);
  const events = new EventsView(city);
  world.scene.add(agents.group, events.group);

  const clock = new SimClock(startDate, params.has("h") ? Number(params.get("h")) * 60 : 6 * 60);
  if (params.has("paused")) clock.paused = true;
  setupControls(clock, agents);
  renderLegend();

  // --- sélection d'un habitant ---
  const marker = new THREE.Mesh(new THREE.ConeGeometry(1, 2, 4).rotateX(Math.PI), new THREE.MeshBasicMaterial({ color: "#ffe14d" }));
  marker.visible = false;
  world.scene.add(marker);
  let selected = -1, follow = true, info: AgentInfo | null = null;
  const select = (id: number) => {
    selected = id;
    follow = true;
    info = null;
    if (id >= 0) send({ type: "inspect", id });
    else {
      $("#agent").classList.add("hidden");
      world.flyTo = null;
    }
  };
  setInterval(() => selected >= 0 && send({ type: "inspect", id: selected }), 400);
  const canvas = world.renderer.domElement;
  let down: [number, number] | null = null;
  canvas.addEventListener("pointerdown", (e) => (down = [e.clientX, e.clientY]));
  canvas.addEventListener("pointerup", (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
    const id = agents.pick(world.camera, e.clientX, e.clientY, canvas.clientWidth, canvas.clientHeight);
    if (id >= 0) select(id);
  });
  // un glissement de la carte arrête le suivi
  world.controls.addEventListener("start", () => {
    follow = false;
    world.flyTo = null;
  });
  $("#agent").addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t.dataset.action === "close") select(-1);
    if (t.dataset.action === "follow") follow = true;
  });

  // accès console pour le débogage : ?debug
  if (params.has("debug")) Object.assign(window, { sim: { world, agents, clock, select } });

  $("#loading").textContent = "Installation des habitants…";
  await ready;
  $("#loading").remove();

  // Échange de trames avec le worker : la trame est copiée avant que le buffer reparte.
  let buffer: ArrayBuffer | null = new ArrayBuffer(total * FRAME_STRIDE * 4);
  const frame = new Float32Array(total * FRAME_STRIDE);
  let frameCount = 0;
  worker.onmessage = (e: MessageEvent<FromWorker>) => {
    const msg = e.data;
    if (msg.type === "frame") {
      frame.set(new Float32Array(msg.buffer, 0, msg.count * FRAME_STRIDE));
      buffer = msg.buffer;
      frameCount = msg.count;
      renderCounts(msg.counts);
    } else if (msg.type === "day") renderReport(msg.report);
    else if (msg.type === "dayStart") {
      events.setPlan(msg.plan);
      world.setWeather(msg.plan.weather.kind);
      renderToday(msg.plan, (x, z) => {
        follow = false;
        world.flyTo = new THREE.Vector3(x, 0, z);
      });
    } else if (msg.type === "agent" && msg.info && msg.info.id === selected) {
      info = msg.info;
      renderAgent(info, follow);
    }
  };

  let last = performance.now();
  const loop = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    clock.tick(dt);
    if (buffer) {
      const b = buffer;
      buffer = null;
      send({ type: "tick", day: clock.day, minute: clock.minute, buffer: b }, [b]);
    }
    world.setTime(clock.date, clock.hour);
    $("#time").textContent = clock.label();
    const t = now / 1000;
    if (frameCount) agents.update(frame, frameCount, world.camera.position.distanceTo(world.controls.target), world.night, t);
    events.update(clock.minute, t, world.night);

    if (selected >= 0) {
      const shown = agents.shownFrame[selected] === agents.frameNo;
      const x = shown ? agents.shownX[selected] : info?.x, z = shown ? agents.shownZ[selected] : info?.z;
      if (x !== undefined && z !== undefined) {
        const s = Math.min(agents.scale, 6);
        marker.visible = true;
        marker.scale.setScalar(s);
        marker.position.set(x, 2.6 * s + Math.sin(t * 4) * 0.4 * s, z);
        if (follow) world.flyTo = new THREE.Vector3(x, 0, z);
      }
    } else marker.visible = false;

    world.render(dt);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

function setupControls(clock: SimClock, agents: AgentsView) {
  const playBtn = $<HTMLButtonElement>("#play");
  const syncPlay = () => (playBtn.textContent = clock.paused ? "▶" : "⏸");
  playBtn.onclick = () => {
    clock.paused = !clock.paused;
    syncPlay();
  };
  syncPlay();
  document.querySelectorAll<HTMLButtonElement>("[data-speed]").forEach((btn) => {
    btn.onclick = () => {
      clock.realtime = btn.dataset.speed === "realtime";
      if (!clock.realtime) clock.speed = Number(btn.dataset.speed);
      document.querySelectorAll("[data-speed]").forEach((b) => b.classList.toggle("active", b === btn));
    };
  });
  $<HTMLInputElement>("#labels").onchange = (e) => {
    document.body.classList.toggle("hide-labels", !(e.target as HTMLInputElement).checked);
  };
  const sizeInput = $<HTMLInputElement>("#agentSize");
  sizeInput.oninput = () => (agents.sizeBoost = Number(sizeInput.value));
}

function renderLegend() {
  $("#legend").innerHTML = PROFILES.map((p) => `<span style="--c:${PROFILE_COLOR[p]}">${PROFILE_LABEL[p].replace(/ \(.*\)/, "")}</span>`).join("");
}

function renderCounts(c: LiveCounts) {
  const rows: [string, number][] = [
    ["🚶 À pied", c.walk], ["🚲 À vélo", c.bike], ["🚗 En voiture", c.car], ["🌳 Dehors (lac, parc, événement)", c.outdoor], ["🚆 Hors d'Annecy", c.outside],
  ];
  $("#counts").innerHTML = rows.map(([k, v]) => `<span>${k}</span><span class="v">${fmt(v)}</span>`).join("");
}

function renderToday(plan: DayPlan, goTo: (x: number, z: number) => void) {
  const w = plan.weather;
  $("#weather").textContent = `${WEATHER_ICON[w.kind]} ${w.tempC} °C`;
  const el = $("#today");
  el.innerHTML = `<div class="panel-title">Aujourd'hui · ${WEATHER_ICON[w.kind]} ${w.kind}, ${w.tempC} °C</div>` +
    (plan.events.length
      ? plan.events.map((ev) => `<button class="event-row" data-x="${ev.x}" data-z="${ev.z}" title="${ev.description}">${EVENT_ICON[ev.kind]} <b>${ev.title}</b><small>${hhmm(ev.start)} – ${hhmm(ev.end)}</small></button>`).join("")
      : `<div class="muted">Journée calme, aucun événement.</div>`);
  el.querySelectorAll<HTMLButtonElement>(".event-row").forEach((b) => (b.onclick = () => goTo(Number(b.dataset.x), Number(b.dataset.z))));
}

function renderAgent(a: AgentInfo, following: boolean) {
  const el = $("#agent");
  el.classList.remove("hidden");
  const bar = (label: string, v: number) => `<div class="need"><span>${label}</span><i style="--v:${Math.round(v * 100)}%"></i></div>`;
  el.innerHTML = `
    <div class="agent-head">
      <span class="dot" style="--c:${PROFILE_COLOR[a.profile]}"></span>
      <div><h3>${a.name}</h3><small>${PROFILE_LABEL[a.profile]} · ${a.age} ans</small></div>
      <button data-action="close" title="Fermer">✕</button>
    </div>
    <div class="now">${a.now}</div>
    ${bar("Énergie", a.needs.energy)}${bar("Vie sociale", a.needs.social)}${bar("Loisirs", a.needs.fun)}${bar("Satisfaction", a.satisfaction)}
    <div class="muted small">${a.hasCar ? "🚗 voiture" : "pas de voiture"} · ${a.hasBike ? "🚲 vélo" : "pas de vélo"} · ${a.travelMinutes} min de trajet · ${a.spentToday} € dépensés</div>
    <div class="panel-title">Sa journée</div>
    <ol class="schedule">${a.schedule.map((s) => `<li class="${s.current ? "current" : s.done ? "done" : ""}"><span>${s.from}</span>${s.place}</li>`).join("")}</ol>
    ${following ? "" : `<button data-action="follow" class="wide">🎥 Suivre avec la caméra</button>`}
    ${a.visible ? "" : `<div class="muted small">À l'intérieur : invisible pour l'instant.</div>`}`;
}

const KIND_LABEL: Record<string, string> = {
  food: "Restaurants", bar: "Bars", grocery: "Alimentation", shop: "Commerces", culture: "Culture", sport: "Sport", lake: "Lac", event: "Événements",
};

function renderReport(r: DayReport) {
  const el = $("#report");
  el.classList.remove("hidden");
  const trips = r.trips.walk + r.trips.bike + r.trips.car;
  const share = (n: number) => `${Math.round((100 * n) / Math.max(1, trips))} %`;
  const revenue = Object.entries(r.revenue).sort((a, b) => b[1] - a[1]);
  el.innerHTML = `
    <details ${el.querySelector("details")?.open === false ? "" : "open"}>
    <summary class="panel-title">Bilan du jour ${r.day} · ${new Date(r.date).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}</summary>
    <div class="kpis">
      <div class="kpi"><small>Satisfaction</small><b>${pct(r.satisfaction)}</b></div>
      <div class="kpi"><small>Congestion</small><b>+${pct(r.congestion)}</b></div>
      <div class="kpi"><small>Chiffre d'affaires</small><b>${fmt(r.revenueTotal / 1000)} k€</b></div>
      <div class="kpi"><small>CO₂ voitures</small><b>${r.co2Tonnes} t</b></div>
    </div>
    <div class="panel-title">Trajets (${fmt(trips)})</div>
    <ul><li>À pied ${share(r.trips.walk)}</li><li>À vélo ${share(r.trips.bike)}</li><li>En voiture ${share(r.trips.car)} · ${fmt(r.carKm)} km</li></ul>
    ${r.events.length ? `<div class="panel-title">Événements</div><ul>${r.events.map((e) => `<li>${EVENT_ICON[e.kind]} ${e.title}${e.visits ? ` (${fmt(e.visits)} visiteurs)` : ""}</li>`).join("")}</ul>` : ""}
    ${r.jams.length ? `<div class="panel-title">Bouchons</div><ul>${r.jams.map((j) => `<li>${j.name} (−${Math.round(j.slowdown * 100)} % de vitesse)</li>`).join("")}</ul>` : ""}
    <div class="panel-title">Commerces</div>
    <ul>${revenue.map(([k, v]) => `<li>${KIND_LABEL[k] ?? k} : ${fmt(v)} €</li>`).join("")}</ul>
    <div class="panel-title">Lieux les plus fréquentés</div>
    <ul>${r.topPlaces.map((p) => `<li>${p.name} (${fmt(p.visits)})</li>`).join("")}</ul>
    <div class="panel-title">Satisfaction par profil</div>
    <ul>${Object.entries(r.satisfactionByProfile).map(([p, s]) => `<li>${PROFILE_LABEL[p as keyof typeof PROFILE_LABEL]} : ${pct(s)}</li>`).join("")}</ul>
    </details>`;
}

main();
