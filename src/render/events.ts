// Rendu des événements du jour (marché, concert, travaux, accident…) et de la météo.
import * as THREE from "three";
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import type { City } from "../shared/city";
import { EVENT_ICON, type CityEvent, type DayPlan, type EventKind } from "../sim/events";

const KIND_COLOR: Record<EventKind, string> = {
  marche: "#f2b134", concert: "#c264ff", festival: "#ff5fa2", travaux: "#ff8a1f", accident: "#ff3b3b",
  manifestation: "#4fc3ff", brocante: "#9ccc65",
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
  /** éléments animés (projecteurs, gyrophares) */
  animate?: (t: number, night: number) => void;
}

export class EventsView {
  readonly group = new THREE.Group();
  private visuals: EventVisual[] = [];

  constructor(private readonly city: City) {
    this.group.name = "events";
  }

  setPlan(plan: DayPlan) {
    for (const v of this.visuals) v.label.element.remove();
    this.group.clear();
    this.visuals = plan.events.map((ev) => this.build(ev));
  }

  private build(ev: CityEvent): EventVisual {
    const color = KIND_COLOR[ev.kind];
    const el = document.createElement("div");
    el.className = "event-label";
    el.style.setProperty("--c", color);
    el.innerHTML = `<span class="icon">${EVENT_ICON[ev.kind]}</span><span><b>${ev.title}</b><small>${hhmm(ev.start)} – ${hhmm(ev.end)}</small></span>`;
    const label = new CSS2DObject(el);
    label.position.set(ev.x, 45, ev.z);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(22, 30, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, depthWrite: false }),
    );
    ring.position.set(ev.x, 0.8, ev.z);

    const props = new THREE.Group();
    const visual: EventVisual = { ev, label, ring, props };
    if (ev.kind === "marche" || ev.kind === "brocante") this.stalls(ev, props);
    if (ev.kind === "concert" || ev.kind === "festival") visual.animate = this.stage(ev, props, color);
    if (ev.closedRoads.length) this.closure(ev, props, color);
    if (ev.kind === "accident") visual.animate = this.beacon(ev, props);

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
  private closure(ev: CityEvent, props: THREE.Group, color: string) {
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
    coneMesh.count = cones.length;
    props.add(line, ribbon, coneMesh);
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
        const k = 1 + 0.15 * Math.sin(time * 3);
        v.ring.scale.set(k, 1, k);
        v.animate?.(time, night);
      }
    }
  }
}
