// Rendu des habitants : bonshommes, cyclistes et voitures low-poly en InstancedMesh.
// L'animation (jambes, bras, pédalage) est calculée dans le vertex shader : coût CPU nul.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { PROFILES, PROFILE_COLOR } from "../sim/population";
import { FRAME_STRIDE } from "../sim/protocol";

const CAR_COLORS = ["#d8d8d8", "#2b2d31", "#a32323", "#2453a8", "#5b6168", "#f2f2ee", "#3d6b45", "#c9a443", "#e06a1b"];

interface PartOptions {
  /** 1 = prend la couleur de l'instance (t-shirt, carrosserie) */
  tint?: number;
  /** sens de balancement (+1 / -1), 0 = fixe */
  limb?: number;
  /** hauteur du pivot de balancement (hanche, épaule) */
  pivot?: number;
  /** 1 = s'allume la nuit (phares) */
  light?: number;
}

function part(geo: THREE.BufferGeometry, color: string, o: PartOptions = {}) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute("uv");
  const n = g.attributes.position.count;
  const c = new THREE.Color(color);
  const fill = (v: number) => new THREE.Float32BufferAttribute(new Float32Array(n).fill(v), 1);
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) colors.set([c.r, c.g, c.b], i * 3);
  g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  g.setAttribute("aTint", fill(o.tint ?? 0));
  g.setAttribute("aLimb", fill(o.limb ?? 0));
  g.setAttribute("aPivot", fill(o.pivot ?? 0));
  g.setAttribute("aLight", fill(o.light ?? 0));
  return g;
}

const SKIN = "#e7c09b", PANTS = "#2f3a4f", SHOES = "#222222", HAIR = "#4a3426";

function personGeometry() {
  return mergeGeometries([
    part(new THREE.BoxGeometry(0.15, 0.82, 0.17).translate(-0.1, 0.43, 0), PANTS, { limb: 1, pivot: 0.84 }),
    part(new THREE.BoxGeometry(0.15, 0.82, 0.17).translate(0.1, 0.43, 0), PANTS, { limb: -1, pivot: 0.84 }),
    part(new THREE.BoxGeometry(0.16, 0.08, 0.26).translate(-0.1, 0.04, 0.04), SHOES, { limb: 1, pivot: 0.84 }),
    part(new THREE.BoxGeometry(0.16, 0.08, 0.26).translate(0.1, 0.04, 0.04), SHOES, { limb: -1, pivot: 0.84 }),
    part(new THREE.BoxGeometry(0.42, 0.6, 0.24).translate(0, 1.13, 0), "#ffffff", { tint: 1 }),
    part(new THREE.BoxGeometry(0.1, 0.56, 0.12).translate(-0.27, 1.1, 0), "#ffffff", { tint: 1, limb: -1, pivot: 1.38 }),
    part(new THREE.BoxGeometry(0.1, 0.56, 0.12).translate(0.27, 1.1, 0), "#ffffff", { tint: 1, limb: 1, pivot: 1.38 }),
    part(new THREE.IcosahedronGeometry(0.15, 0).translate(0, 1.6, 0), SKIN),
    part(new THREE.BoxGeometry(0.3, 0.09, 0.3).translate(0, 1.72, -0.02), HAIR),
  ])!;
}

function cyclistGeometry() {
  const wheel = (z: number) => new THREE.TorusGeometry(0.33, 0.045, 3, 8).rotateY(Math.PI / 2).translate(0, 0.35, z);
  return mergeGeometries([
    part(wheel(0.52), "#1d1d1d"),
    part(wheel(-0.52), "#1d1d1d"),
    part(new THREE.BoxGeometry(0.06, 0.06, 1.05).translate(0, 0.62, 0), "#c0392b"),
    part(new THREE.BoxGeometry(0.06, 0.45, 0.06).translate(0, 0.62, -0.18), "#c0392b"),
    part(new THREE.BoxGeometry(0.45, 0.05, 0.05).translate(0, 1.0, 0.45), "#333333"),
    // cycliste : jambes qui pédalent, buste penché vers le guidon
    part(new THREE.BoxGeometry(0.14, 0.62, 0.16).translate(-0.1, 0.62, 0), PANTS, { limb: 1, pivot: 0.93 }),
    part(new THREE.BoxGeometry(0.14, 0.62, 0.16).translate(0.1, 0.62, 0), PANTS, { limb: -1, pivot: 0.93 }),
    part(new THREE.BoxGeometry(0.4, 0.58, 0.24).rotateX(0.35).translate(0, 1.2, 0.08), "#ffffff", { tint: 1 }),
    part(new THREE.BoxGeometry(0.09, 0.09, 0.5).translate(-0.22, 1.25, 0.32), "#ffffff", { tint: 1 }),
    part(new THREE.BoxGeometry(0.09, 0.09, 0.5).translate(0.22, 1.25, 0.32), "#ffffff", { tint: 1 }),
    part(new THREE.IcosahedronGeometry(0.15, 0).translate(0, 1.62, 0.22), SKIN),
    part(new THREE.SphereGeometry(0.17, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 1.68, 0.22), "#f1c40f"),
  ])!;
}

function carGeometry() {
  const wheel = (x: number, z: number) => new THREE.CylinderGeometry(0.32, 0.32, 0.22, 6).rotateZ(Math.PI / 2).translate(x, 0.32, z);
  return mergeGeometries([
    part(new THREE.BoxGeometry(1.8, 0.62, 4.2).translate(0, 0.62, 0), "#ffffff", { tint: 1 }),
    part(new THREE.BoxGeometry(1.62, 0.55, 2.1).translate(0, 1.2, -0.25), "#26323f"),
    part(new THREE.BoxGeometry(1.58, 0.07, 1.95).translate(0, 1.5, -0.25), "#ffffff", { tint: 1 }),
    part(wheel(-0.88, 1.3), "#151515"),
    part(wheel(0.88, 1.3), "#151515"),
    part(wheel(-0.88, -1.3), "#151515"),
    part(wheel(0.88, -1.3), "#151515"),
    part(new THREE.BoxGeometry(0.36, 0.14, 0.05).translate(-0.6, 0.72, 2.11), "#fff4c8", { light: 1 }),
    part(new THREE.BoxGeometry(0.36, 0.14, 0.05).translate(0.6, 0.72, 2.11), "#fff4c8", { light: 1 }),
    part(new THREE.BoxGeometry(0.34, 0.12, 0.05).translate(-0.62, 0.74, -2.11), "#d42020", { light: 0.6 }),
    part(new THREE.BoxGeometry(0.34, 0.12, 0.05).translate(0.62, 0.74, -2.11), "#d42020", { light: 0.6 }),
  ])!;
}

// Versions lointaines : quelques boîtes, sans membres animés (elles ne font que quelques pixels).
function personFarGeometry() {
  return mergeGeometries([
    part(new THREE.BoxGeometry(0.38, 0.84, 0.18).translate(0, 0.42, 0), PANTS),
    part(new THREE.BoxGeometry(0.5, 0.6, 0.24).translate(0, 1.13, 0), "#ffffff", { tint: 1 }),
    part(new THREE.BoxGeometry(0.26, 0.3, 0.26).translate(0, 1.6, 0), SKIN),
  ])!;
}

function cyclistFarGeometry() {
  return mergeGeometries([
    part(new THREE.BoxGeometry(0.08, 0.7, 1.7).translate(0, 0.35, 0), "#1d1d1d"),
    part(new THREE.BoxGeometry(0.4, 1.0, 0.4).translate(0, 1.15, 0.08), "#ffffff", { tint: 1 }),
  ])!;
}

const NAVETTE = new THREE.Color("#ffd84d");

/** Bus articulé Sibra : caisse teintée à la couleur de la ligne, vitres, toit clair. */
function busGeometry() {
  return mergeGeometries([
    part(new THREE.BoxGeometry(2.5, 2.4, 12).translate(0, 1.55, 0), "#ffffff", { tint: 1 }),
    part(new THREE.BoxGeometry(2.56, 0.9, 11.2).translate(0, 2.05, 0.2), "#1f2a36"),
    part(new THREE.BoxGeometry(2.3, 0.3, 11.4).translate(0, 2.9, 0), "#e8edf2"),
    part(new THREE.BoxGeometry(2.3, 0.5, 0.05).translate(0, 2.4, 6.02), "#fff4c8", { light: 1 }),
  ])!;
}

function carFarGeometry() {
  return mergeGeometries([
    part(new THREE.BoxGeometry(1.8, 0.9, 4.2).translate(0, 0.55, 0), "#ffffff", { tint: 1 }),
    part(new THREE.BoxGeometry(1.62, 0.55, 2.1).translate(0, 1.2, -0.25), "#26323f"),
    part(new THREE.BoxGeometry(1.6, 0.14, 0.05).translate(0, 0.72, 2.11), "#fff4c8", { light: 1 }),
  ])!;
}

/** Matériau Lambert + balancement des membres + teinte par instance + éclairage nocturne. */
function animatedMaterial(uniforms: { uTime: { value: number }; uNight: { value: number } }) {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uNight = uniforms.uNight;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        attribute float aTint;
        attribute float aLimb;
        attribute float aPivot;
        attribute float aLight;
        attribute vec2 aAnim; // (phase, amplitude) par instance
        uniform float uTime;
        varying float vLight;`,
      )
      .replace(
        "#include <begin_vertex>",
        `vec3 transformed = vec3(position);
        float sw = aLimb * aAnim.y * sin(uTime * 8.0 + aAnim.x);
        float cs = cos(sw), sn = sin(sw);
        float yy = transformed.y - aPivot;
        transformed.y = aPivot + yy * cs - transformed.z * sn;
        transformed.z = yy * sn + transformed.z * cs;
        vLight = aLight;`,
      )
      .replace(
        "#include <color_vertex>",
        `vColor = color;
        #ifdef USE_INSTANCING_COLOR
          vColor *= mix(vec3(1.0), instanceColor.xyz, aTint);
        #endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\nuniform float uNight;\nvarying float vLight;`)
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        // couleurs toujours lisibles, même à l'ombre ou la nuit ; phares allumés le soir
        totalEmissiveRadiance += diffuseColor.rgb * (0.22 + 0.3 * uNight) + vLight * uNight * diffuseColor.rgb * 2.5;`,
      );
  };
  return mat;
}

export class AgentsView {
  readonly group = new THREE.Group();
  /** exagération visuelle choisie dans l'interface */
  sizeBoost = 1;
  /** position affichée de chaque habitant (index = id), et numéro de la dernière trame où il était visible */
  readonly shownX: Float32Array;
  readonly shownZ: Float32Array;
  readonly shownFrame: Int32Array;
  frameNo = 0;
  scale = 1;
  /** voitures et bus à ne pas dessiner à cet endroit (file mise en scène autour de Marc) */
  carMask: ((x: number, z: number) => boolean) | null = null;

  // [proche, lointain] pour chaque type
  private readonly walkers: [THREE.InstancedMesh, THREE.InstancedMesh];
  private readonly cyclists: [THREE.InstancedMesh, THREE.InstancedMesh];
  private readonly cars: [THREE.InstancedMesh, THREE.InstancedMesh];
  private readonly buses: THREE.InstancedMesh;
  /** couleur de chaque ligne de bus (index = ligne ; 99 = navette) */
  private busColors: THREE.Color[] = [];
  private readonly frustum = new THREE.Frustum();
  private readonly viewProj = new THREE.Matrix4();
  private readonly sphere = new THREE.Sphere();
  private readonly uniforms = { uTime: { value: 0 }, uNight: { value: 0 } };
  private readonly profileColors = PROFILES.map((p) => new THREE.Color(PROFILE_COLOR[p]));
  private readonly carColors = CAR_COLORS.map((c) => new THREE.Color(c));
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private readonly p = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(capacity: number) {
    this.shownX = new Float32Array(capacity);
    this.shownZ = new Float32Array(capacity);
    this.shownFrame = new Int32Array(capacity).fill(-1);
    const make = (geo: THREE.BufferGeometry, shadow: boolean) => {
      geo.setAttribute("aAnim", new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2).setUsage(THREE.DynamicDrawUsage));
      const mesh = new THREE.InstancedMesh(geo, animatedMaterial(this.uniforms), capacity);
      mesh.count = 0;
      mesh.frustumCulled = false;
      // seuls les habitants proches projettent une ombre : au loin elle serait invisible
      mesh.castShadow = shadow;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.setColorAt(0, new THREE.Color()); // force l'allocation de instanceColor
      this.group.add(mesh);
      return mesh;
    };
    this.walkers = [make(personGeometry(), true), make(personFarGeometry(), false)];
    this.cyclists = [make(cyclistGeometry(), true), make(cyclistFarGeometry(), false)];
    this.cars = [make(carGeometry(), true), make(carFarGeometry(), false)];
    this.buses = make(busGeometry(), true);
    this.group.name = "agents";
  }

  setBusColors(colours: string[]) {
    this.busColors = colours.map((c) => new THREE.Color(c));
  }

  /**
   * Met à jour les instances depuis la trame du worker.
   * Les silhouettes grossissent quand la caméra s'éloigne, pour rester visibles.
   * Seuls les habitants dans le champ de la caméra sont envoyés au GPU ; au-delà de quelques
   * centaines de mètres, ils passent en version simplifiée sans animation ni ombre.
   */
  update(frame: Float32Array, count: number, camera: THREE.Camera, cameraDistance: number, night: number, time: number) {
    this.frameNo++;
    this.uniforms.uTime.value = time;
    this.uniforms.uNight.value = night;
    const zoom = THREE.MathUtils.clamp(cameraDistance / 220, 1.5, 9) * this.sizeBoost;
    this.scale = zoom;
    const carZoom = Math.min(zoom * 0.55, 8);
    // distance (au carré) au-delà de laquelle une silhouette fait moins d'une douzaine de pixels
    const lodPeople = (130 * zoom) ** 2, lodCars = (260 * carZoom) ** 2;
    camera.updateMatrixWorld();
    this.viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.viewProj);
    const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
    const n = [0, 0, 0, 0, 0, 0, 0]; // walkers proche/loin, vélos proche/loin, voitures proche/loin, bus
    const anim = (mesh: THREE.InstancedMesh) => mesh.geometry.attributes.aAnim as THREE.InstancedBufferAttribute;
    const aw = anim(this.walkers[0]), ab = anim(this.cyclists[0]);
    for (let i = 0; i < count; i++) {
      const o = i * FRAME_STRIDE;
      let x = frame[o], z = frame[o + 1], heading = frame[o + 2];
      const mode = frame[o + 3], profile = frame[o + 4], id = frame[o + 5];
      if ((mode === 7 || mode === 3) && this.carMask?.(x, z)) continue;
      if (mode === 7) {
        // bus : « profil » = ligne ; trois fois plus long qu'une voiture, on le grossit moins de loin
        const s = Math.min(zoom * 0.35, 3.5);
        this.sphere.center.set(x, s, z);
        this.sphere.radius = 7 * s;
        if (!this.frustum.intersectsSphere(this.sphere)) continue;
        this.q.setFromAxisAngle(this.up, heading);
        this.p.set(x, 0.4, z);
        this.m.compose(this.p, this.q, this.s.setScalar(s));
        const k = n[6]++;
        this.buses.setMatrixAt(k, this.m);
        this.buses.setColorAt(k, profile === 99 ? NAVETTE : this.busColors[profile] ?? NAVETTE);
        continue;
      }
      if (mode === 0) {
        // à l'arrêt : (x, z) est le centre du groupe, le cap l'angle de la personne autour ;
        // on l'écarte selon le zoom et on la tourne vers le centre (ils discutent)
        const r = 1.4 * Math.min(zoom, 4);
        x += Math.sin(heading) * r;
        z += Math.cos(heading) * r;
        heading += Math.PI;
      }
      // profil ≥ 100 : voiture suiveuse (une voiture simulée en représente plusieurs), pas suivie par la caméra
      const follower = profile >= 100;
      if (!follower) {
        this.shownX[id] = x;
        this.shownZ[id] = z;
        this.shownFrame[id] = this.frameNo;
      }
      const s = mode === 3 ? carZoom : zoom;
      this.sphere.center.set(x, s, z);
      this.sphere.radius = 2.5 * s;
      if (!this.frustum.intersectsSphere(this.sphere)) continue;
      const d2 = (x - cx) ** 2 + cy * cy + (z - cz) ** 2;
      this.q.setFromAxisAngle(this.up, heading);
      this.p.set(x, 0.4, z);
      this.m.compose(this.p, this.q, this.s.setScalar(s));
      if (mode === 3) {
        const far = d2 > lodCars ? 1 : 0, k = n[4 + far]++;
        this.cars[far].setMatrixAt(k, this.m);
        this.cars[far].setColorAt(k, this.carColors[(id + (follower ? profile * 7 : 0)) % this.carColors.length]);
      } else if (mode === 2) {
        const far = d2 > lodPeople ? 1 : 0, k = n[2 + far]++;
        this.cyclists[far].setMatrixAt(k, this.m);
        this.cyclists[far].setColorAt(k, this.profileColors[profile]);
        if (!far) ab.setXY(k, id * 1.7, 0.75);
      } else {
        const far = d2 > lodPeople ? 1 : 0, k = n[far]++;
        this.walkers[far].setMatrixAt(k, this.m);
        this.walkers[far].setColorAt(k, this.profileColors[profile]);
        // marche, course (grande foulée), promenade du chien (pas tranquille), à l'arrêt (bras seulement)
        // mode 6 : spectateur face à la scène, qui danse
        if (!far) aw.setXY(k, id * 1.7, mode === 4 ? 0.95 : mode === 1 ? 0.55 : mode === 5 ? 0.4 : mode === 6 ? 0.3 : 0.06);
      }
    }
    // n'envoie au GPU que la partie utilisée des buffers, pas toute la capacité
    const upload = (attr: THREE.BufferAttribute, k: number) => {
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, k * attr.itemSize);
      attr.needsUpdate = true;
    };
    [...this.walkers, ...this.cyclists, ...this.cars, this.buses].forEach((mesh, j) => {
      const k = n[j];
      mesh.count = k;
      if (!k) return;
      upload(mesh.instanceMatrix, k);
      if (mesh.instanceColor) upload(mesh.instanceColor, k);
      if (j % 2 === 0 && j < 6) upload(anim(mesh), k);
    });
  }

  /** Habitant visible le plus proche d'un point écran (en px), ou -1. */
  pick(camera: THREE.Camera, sx: number, sy: number, width: number, height: number, radiusPx = 22): number {
    let best = -1, bestD = radiusPx * radiusPx;
    const v = new THREE.Vector3();
    for (let id = 0; id < this.shownFrame.length; id++) {
      if (this.shownFrame[id] !== this.frameNo) continue;
      v.set(this.shownX[id], 1.2 * Math.min(this.scale, 6), this.shownZ[id]).project(camera);
      if (v.z > 1) continue;
      const px = ((v.x + 1) / 2) * width, py = ((1 - v.y) / 2) * height;
      const d = (px - sx) ** 2 + (py - sy) ** 2;
      if (d < bestD) { bestD = d; best = id; }
    }
    return best;
  }
}
