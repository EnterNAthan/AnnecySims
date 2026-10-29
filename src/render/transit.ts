// Couche transports : tracés des lignes de bus et arrêts, parkings avec leur remplissage en direct.
import * as THREE from "three";
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import type { Transit } from "../shared/city";
import { ribbon } from "./cityMeshes";
import type { FromWorker } from "../sim/protocol";

type Lines = Extract<FromWorker, { type: "transit" }>["lines"];

export class TransitView {
  readonly group = new THREE.Group();
  private readonly lines = new THREE.Group();
  private readonly labels: { obj: CSS2DObject; el: HTMLElement }[] = [];

  constructor(private readonly transit: Transit) {
    this.group.add(this.lines);
    this.lines.visible = false;
    // parkings : pastille « P » colorée selon le remplissage
    for (const p of transit.parkings) {
      if (p.capacity < 80) continue;
      const el = document.createElement("div");
      el.className = "parking-label";
      el.title = `${p.name} · ${p.capacity} places`;
      el.innerHTML = `<b>P</b><span>–</span>`;
      const obj = new CSS2DObject(el);
      obj.position.set(p.x, 8, p.z);
      this.group.add(obj);
      this.labels.push({ obj, el });
    }
  }

  /** Affiche les tracés des lignes et les arrêts (bouton « Bus »). */
  set showLines(on: boolean) {
    this.lines.visible = on;
  }

  setLines(lines: Lines) {
    for (const c of [...this.lines.children]) {
      this.lines.remove(c);
      (c as THREE.Mesh).geometry?.dispose();
    }
    const stopGeo = new THREE.CylinderGeometry(0.9, 0.9, 3.2, 8).translate(0, 1.6, 0);
    const seen = new Set<string>();
    lines.forEach((l, i) => {
      if (l.path.length < 4) return;
      const pts: [number, number][] = [];
      for (let k = 0; k < l.path.length; k += 2) pts.push([l.path[k], l.path[k + 1]]);
      // les deux sens d'une ligne côte à côte, légèrement décalés
      const mesh = new THREE.Mesh(ribbon([{ pts, w: 3 }], 1.4 + (i % 4) * 0.05), new THREE.MeshBasicMaterial({ color: l.colour, transparent: true, opacity: 0.75, depthWrite: false }));
      this.lines.add(mesh);
      for (const s of l.stops) {
        const key = `${Math.round(s.x / 15)}:${Math.round(s.z / 15)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const stop = new THREE.Mesh(stopGeo, new THREE.MeshBasicMaterial({ color: l.colour }));
        stop.position.set(s.x, 0, s.z);
        this.lines.add(stop);
      }
    });
  }

  /** Remplissage de chaque parking (‰). */
  setParking(occ: Uint16Array) {
    let j = 0;
    this.transit.parkings.forEach((p, i) => {
      if (p.capacity < 80) return;
      const { el } = this.labels[j++];
      const v = occ[i] / 1000;
      el.style.setProperty("--c", v > 0.95 ? "#e8323c" : v > 0.8 ? "#ffb020" : "#35c46a");
      el.querySelector("span")!.textContent = v > 0.98 ? "complet" : `${Math.round(v * 100)} %`;
      el.title = `${p.name} · ${Math.round(v * p.capacity)} / ${p.capacity} places`;
    });
  }
}
