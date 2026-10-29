// Rendu des événements du jour (marché, concert, travaux, accident…) et de la météo.
import * as THREE from "three";
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import type { City } from "../shared/city";
import { cortege, EVENT_ICON, type CityEvent, type DayPlan, type EventKind } from "../sim/events";
import { ribbon } from "./cityMeshes";
import { earthquake, fire, fireworks, flood, meteorite, picnic, tsunami, ufo, type Animate, type FxHost } from "./disasters";

const KIND_COLOR: Record<EventKind, string> = {
  marche: "#f2b134", concert: "#c264ff", festival: "#ff5fa2", travaux: "#ff8a1f", accident: "#ff3b3b",
  manifestation: "#4fc3ff", brocante: "#9ccc65", meteorite: "#ff6a1a", inondation: "#3d9bff", tsunami: "#1f7dff",
  tempete: "#8a93a6", incendie: "#ff4a12", seisme: "#c79b5b", panne: "#ffe14d", ovni: "#7dff8a", canicule: "#ff9a3c",
  blizzard: "#dff3ff", feu_artifice: "#ff4dc4", pique_nique: "#ff5a5a",
  fermeture: "#ff4d4d", pietonnisation: "#5fd08a", marathon: "#ffd84d", greve: "#c0c8d4",
};

export const hhmm = (m: number) => `${Math.floor(m / 60)}h${String(Math.round(m % 60)).padStart(2, "0")}`;

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface EventVisual {
  ev: CityEvent;
  label: CSS2DObject;
  ring: THREE.Mesh;
  /** décor visible seulement pendant l'événement */
  props: THREE.Group;
  /** éléments animés (projecteurs, gyrophares, cortège) */
  animate?: (t: number, night: number, minute: number) => void;
  /** effet spectaculaire, animé en temps réel depuis son déclenchement */
  fx?: Animate;
  /** instant réel (s) où l'événement est devenu actif à l'écran */
  shownSince?: number;
}

export class EventsView {
  readonly group = new THREE.Group();
  private visuals: EventVisual[] = [];

  constructor(private readonly city: City, private readonly host: FxHost) {
    this.group.name = "events";
  }

  /** Remplace les événements affichés ; ceux déjà présents (même id) gardent leur animation en cours. */
  setPlan(plan: DayPlan) {
    const keep = new Map(this.visuals.map((v) => [`${v.ev.id}:${v.ev.kind}:${v.ev.title}`, v]));
    const next: EventVisual[] = [];
    for (const ev of plan.events) {
      const key = `${ev.id}:${ev.kind}:${ev.title}`;
      const old = keep.get(key);
      if (old) {
        keep.delete(key);
        old.ev = ev; // horaires à jour (événement annulé ou prolongé)
        next.push(old);
      } else next.push(this.build(ev));
    }
    for (const v of keep.values()) {
      v.label.element.remove();
      this.group.remove(v.label, v.ring, v.props);
    }
    this.visuals = next;
  }

  /** Types d'événements en cours, pour les effets globaux (tempête, panne, canicule). */
  activeKinds(minute: number): Set<EventKind> {
    return new Set(this.visuals.filter((v) => minute >= v.ev.start && minute < v.ev.end).map((v) => v.ev.kind));
  }

  private build(ev: CityEvent): EventVisual {
    const color = KIND_COLOR[ev.kind];
    const el = document.createElement("div");
    el.className = ev.byPlayer ? "event-label player" : "event-label";
    el.style.setProperty("--c", color);
    const when = ev.end - ev.start >= 1439 ? "toute la journée" : `${hhmm(ev.start)} – ${hhmm(ev.end)}`;
    el.innerHTML = `<span class="icon">${EVENT_ICON[ev.kind]}</span><span><b>${ev.title}</b><small>${when}${ev.days && ev.days > 1 ? ` · jour ${ev.dayIndex}/${ev.days}` : ""}</small></span>`;
    const label = new CSS2DObject(el);
    // au-dessus des effets en hauteur (soucoupe, gerbes)
    label.position.set(ev.x, ev.kind === "ovni" ? 230 : ev.kind === "feu_artifice" ? 320 : 45, ev.z);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(22, 30, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, depthWrite: false }),
    );
    ring.position.set(ev.x, 0.8, ev.z);

    const props = new THREE.Group();
    const visual: EventVisual = { ev, label, ring, props };
    if (ev.kind === "marche" || ev.kind === "brocante") this.stalls(ev, props);
    if (ev.kind === "concert" || ev.kind === "festival") visual.animate = this.stage(ev, props, color);
    if (ev.closedRoads.length) this.closure(ev, props, color, ev.kind !== "pietonnisation");
    if (ev.path) visual.animate = this.route(ev, props, color);
    if (ev.kind === "accident") visual.animate = this.beacon(ev, props);
    if (ev.kind === "meteorite") visual.fx = meteorite(ev, props, this.host);
    if (ev.kind === "incendie") visual.fx = fire(ev.x, ev.z, 25 + ev.intensity * 15, props);
    if (ev.kind === "inondation") visual.fx = flood(ev, props);
    if (ev.kind === "tsunami") visual.fx = tsunami(ev, props, this.host);
    if (ev.kind === "seisme") visual.fx = earthquake(ev, props, this.host);
    if (ev.kind === "ovni") visual.fx = ufo(ev, props);
    if (ev.kind === "feu_artifice") visual.fx = fireworks(ev, props, this.host);
    if (ev.kind === "pique_nique") picnic(ev, props);
    // pour les grands phénomènes, l'anneau délimite la zone touchée
    if (ev.radius > 100 && ev.radius < 2000) ring.scale.setScalar(ev.radius / 30);

    this.group.add(label, ring, props);
    return visual;
  }

  /** Étals colorés le long de la rue. */
  private stalls(ev: CityEvent, props: THREE.Group) {
    const rand = mulberry32(ev.id + 11);
    const n = 16;
    const base = new THREE.InstancedMesh(new THREE.BoxGeometry(3, 1, 2), new THREE.MeshLambertMaterial({ color: "#8a6a48" }), n);
    const roof = new THREE.InstancedMesh(new THREE.ConeGeometry(2.4, 1.4, 4).rotateY(Math.PI / 4), new THREE.MeshLambertMaterial({ color: "#ffffff" }), n);
    const palette = ["#e74c3c", "#f5f5f5", "#27ae60", "#2980b9", "#f39c12"].map((c) => new THREE.Color(c));
    const m = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2, r = 6 + rand() * 30;
      const x = ev.x + Math.cos(a) * r, z = ev.z + Math.sin(a) * r;
      m.makeRotationY(rand() * Math.PI).setPosition(x, 0.5, z);
      base.setMatrixAt(i, m);
      m.makeRotationY(rand() * Math.PI).setPosition(x, 2.4, z);
      roof.setMatrixAt(i, m);
      roof.setColorAt(i, palette[i % palette.length]);
    }
    base.castShadow = roof.castShadow = true;
    props.add(base, roof);
  }

  /** Scène avec projecteurs qui balaient le ciel la nuit. */
  private stage(ev: CityEvent, props: THREE.Group, color: string) {
    const stage = new THREE.Mesh(new THREE.BoxGeometry(16, 1.4, 9), new THREE.MeshLambertMaterial({ color: "#2d2d35" }));
    stage.position.set(ev.x, 0.7, ev.z - 12);
    const back = new THREE.Mesh(new THREE.BoxGeometry(16, 8, 0.5), new THREE.MeshLambertMaterial({ color: "#16161c", emissive: color, emissiveIntensity: 0.25 }));
    back.position.set(ev.x, 5, ev.z - 16.5);
    props.add(stage, back);
    const beams: THREE.Mesh[] = [];
    const beamGeo = new THREE.ConeGeometry(6, 70, 16, 1, true).translate(0, -35, 0).rotateX(Math.PI);
    for (let i = 0; i < 4; i++) {
      const beam = new THREE.Mesh(
        beamGeo,
        new THREE.MeshBasicMaterial({ color: i % 2 ? color : "#ffffff", transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
      );
      beam.position.set(ev.x - 6 + i * 4, 9, ev.z - 15);
      beams.push(beam);
      props.add(beam);
    }
    return (t: number, night: number) => {
      beams.forEach((b, i) => {
        b.rotation.z = Math.sin(t * 0.9 + i * 1.3) * 0.5;
        b.rotation.x = -0.25 + Math.cos(t * 0.7 + i) * 0.2;
        (b.material as THREE.MeshBasicMaterial).opacity = 0.05 + 0.22 * night;
      });
    };
  }

  /** Rue fermée : surlignée, avec des cônes de chantier. */
  private closure(ev: CityEvent, props: THREE.Group, color: string, withCones = true) {
    const pts: THREE.Vector3[] = [];
    const cones: THREE.Vector3[] = [];
    for (const r of ev.closedRoads) {
      const ns = this.city.roads[r].n;
      for (let i = 0; i < ns.length - 1; i++) {
        const a = new THREE.Vector3(this.city.nodes[2 * ns[i]], 1, this.city.nodes[2 * ns[i] + 1]);
        const b = new THREE.Vector3(this.city.nodes[2 * ns[i + 1]], 1, this.city.nodes[2 * ns[i + 1] + 1]);
        pts.push(a, b);
        const len = a.distanceTo(b);
        for (let d = 0; d < len; d += 9) cones.push(a.clone().lerp(b, d / len));
      }
    }
    const line = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }),
    );
    // un ruban large par-dessus la chaussée
    const ribbon = new THREE.Group();
    for (let i = 0; i < pts.length; i += 2) {
      const a = pts[i], b = pts[i + 1];
      const len = a.distanceTo(b);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(9, len).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, depthWrite: false }));
      m.position.copy(a).lerp(b, 0.5).setY(0.9);
      m.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
      ribbon.add(m);
    }
    const coneMesh = new THREE.InstancedMesh(new THREE.ConeGeometry(0.6, 1.6, 6), new THREE.MeshLambertMaterial({ color: "#ff7a00", emissive: "#ff5a00", emissiveIntensity: 0.4 }), Math.max(1, cones.length));
    const m = new THREE.Matrix4();
    cones.forEach((p, i) => coneMesh.setMatrixAt(i, m.makeScale(2.5, 2.5, 2.5).setPosition(p.x, 2, p.z)));
    coneMesh.count = withCones ? cones.length : 0;
    props.add(line, ribbon, coneMesh);
  }

  /**
   * Parcours d'un cortège ou d'une course : tracé au sol, départ et arrivée, et pour une manifestation
   * une banderole qui suit la tête du cortège.
   */
  private route(ev: CityEvent, props: THREE.Group, color: string) {
    const path = ev.path!;
    const pts: [number, number][] = [];
    for (let i = 0; i < path.length; i += 2) pts.push([path[i], path[i + 1]]);
    const line = new THREE.Mesh(ribbon([{ pts, w: 6 }], 1.1), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, depthWrite: false }));
    props.add(line);
    const flag = (x: number, z: number, text: string) => {
      const el = document.createElement("div");
      el.className = "route-flag";
      el.style.setProperty("--c", color);
      el.textContent = text;
      const o = new CSS2DObject(el);
      o.position.set(x, 14, z);
      props.add(o);
      return o;
    };
    const [x0, z0] = pts[0], [x1, z1] = pts[pts.length - 1];
    const loop = Math.hypot(x1 - x0, z1 - z0) < 60;
    flag(x0, z0, loop ? "🏁 Départ / arrivée" : "🚩 Départ");
    if (!loop) flag(x1, z1, "🏁 Arrivée");
    if (ev.kind !== "manifestation") return undefined;
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const at = (d: number): [number, number] => {
      let i = 1;
      while (i < cum.length - 1 && cum[i] < d) i++;
      const k = Math.max(0, Math.min(1, (d - cum[i - 1]) / (cum[i] - cum[i - 1] || 1)));
      return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k];
    };
    const banner = flag(x0, z0, "📣 Tête du cortège");
    banner.element.classList.add("banner");
    // segment du parcours occupé par le cortège
    const body = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, depthWrite: false }));
    props.add(body);
    let lastKey = "";
    return (_t: number, _night: number, minute = ev.start) => {
      const [head, tail] = cortege(ev, ev.pathLength ?? cum[cum.length - 1], minute);
      const [hx, hz] = at(head);
      banner.position.set(hx, 16, hz);
      const key = `${Math.round(head / 5)}:${Math.round(tail / 5)}`;
      if (key === lastKey) return;
      lastKey = key;
      const seg: [number, number][] = [at(tail)];
      for (let i = 0; i < pts.length; i++) if (cum[i] > tail && cum[i] < head) seg.push(pts[i]);
      seg.push([hx, hz]);
      body.geometry.dispose();
      body.geometry = ribbon([{ pts: seg, w: 14 }], 1.3);
    };
  }

  /** Gyrophare clignotant au-dessus de l'accident. */
  private beacon(ev: CityEvent, props: THREE.Group) {
    const blue = new THREE.Mesh(new THREE.SphereGeometry(4, 10, 8), new THREE.MeshBasicMaterial({ color: "#3d7bff", transparent: true }));
    const orange = new THREE.Mesh(new THREE.SphereGeometry(4, 10, 8), new THREE.MeshBasicMaterial({ color: "#ff9a1f", transparent: true }));
    blue.position.set(ev.x - 5, 10, ev.z);
    orange.position.set(ev.x + 5, 10, ev.z);
    props.add(blue, orange);
    return (t: number) => {
      const on = Math.sin(t * 10) > 0;
      (blue.material as THREE.MeshBasicMaterial).opacity = on ? 1 : 0.15;
      (orange.material as THREE.MeshBasicMaterial).opacity = on ? 0.15 : 1;
    };
  }

  /** Visibilité selon l'heure : à venir (étiquette pâle), en cours (tout), terminé (masqué). */
  update(minute: number, time: number, night: number) {
    for (const v of this.visuals) {
      const active = minute >= v.ev.start && minute < v.ev.end;
      const upcoming = minute < v.ev.start;
      v.label.visible = active || upcoming;
      v.label.element.classList.toggle("upcoming", upcoming);
      v.ring.visible = active;
      v.props.visible = active;
      if (active) {
        const base = v.ev.radius > 100 && v.ev.radius < 2000 ? v.ev.radius / 30 : 1;
        const k = base * (1 + 0.08 * Math.sin(time * 3));
        v.ring.scale.set(k, 1, k);
        v.ring.visible = v.ev.radius < 2000 && !v.ev.path;
        v.animate?.(time, night, minute);
        v.shownSince ??= time;
        v.fx?.(time - v.shownSince, time, night);
      }
    }
  }
}
