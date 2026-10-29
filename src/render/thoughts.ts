// Bulles de pensée au-dessus des habitants (façon Planet Zoo) : éphémères pour la foule,
// permanente pour l'habitant sélectionné.
import * as THREE from "three";
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import type { Thought } from "../sim/protocol";
import type { AgentsView } from "./agents";

const LIFETIME = 6; // s réelles
const MAX_BUBBLES = 30;

interface Bubble {
  id: number;
  obj: CSS2DObject;
  born: number;
}

export class ThoughtBubbles {
  readonly group = new THREE.Group();
  private bubbles: Bubble[] = [];
  private readonly selectedObj: CSS2DObject;
  private readonly selectedEl: HTMLDivElement;

  constructor(private readonly agents: AgentsView, private readonly onPick: (id: number) => void) {
    this.group.name = "thoughts";
    this.selectedEl = document.createElement("div");
    this.selectedEl.className = "mind-bubble";
    this.selectedObj = new CSS2DObject(this.selectedEl);
    this.selectedObj.visible = false;
    this.group.add(this.selectedObj);
  }

  /** Nouvelles pensées de la foule : une bulle si la personne est visible à l'écran. */
  push(thoughts: Thought[], now: number) {
    for (const th of thoughts) {
      if (this.agents.shownFrame[th.id] !== this.agents.frameNo) continue;
      if (this.bubbles.length >= MAX_BUBBLES) this.remove(this.bubbles[0]);
      const el = document.createElement("div");
      el.className = "thought-bubble";
      el.textContent = th.icon;
      el.title = `${th.name} : « ${th.text} »`;
      el.onclick = () => this.onPick(th.id);
      const obj = new CSS2DObject(el);
      this.group.add(obj);
      this.bubbles.push({ id: th.id, obj, born: now });
    }
  }

  private remove(b: Bubble) {
    b.obj.element.remove();
    this.group.remove(b.obj);
    this.bubbles.splice(this.bubbles.indexOf(b), 1);
  }

  /** Suit les habitants, fait disparaître les vieilles bulles ; met à jour la bulle de l'habitant sélectionné. */
  update(now: number, selected: number, mind: { icon: string; text: string } | null, fallback?: { x: number; z: number }) {
    const a = this.agents;
    const h = 2.4 * Math.min(a.scale, 6) + 2;
    for (const b of [...this.bubbles]) {
      const age = now - b.born;
      if (age > LIFETIME || b.id === selected) {
        this.remove(b);
        continue;
      }
      const shown = a.shownFrame[b.id] === a.frameNo;
      b.obj.visible = shown;
      if (shown) b.obj.position.set(a.shownX[b.id], h + age * 1.5, a.shownZ[b.id]);
      b.obj.element.style.opacity = String(Math.min(1, (LIFETIME - age) / 1.5));
    }

    const shown = selected >= 0 && a.shownFrame[selected] === a.frameNo;
    this.selectedObj.visible = selected >= 0 && !!mind && (shown || !!fallback);
    if (this.selectedObj.visible && mind) {
      const x = shown ? a.shownX[selected] : fallback!.x, z = shown ? a.shownZ[selected] : fallback!.z;
      this.selectedObj.position.set(x, h * 1.6 + 4, z);
      const html = `<span>${mind.icon}</span>${mind.text}`;
      if (this.selectedEl.innerHTML !== html) this.selectedEl.innerHTML = html;
    }
  }
}
