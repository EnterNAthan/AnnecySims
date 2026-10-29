// Ouverture : une carte vue du ciel, plate comme du papier ; au clic, la caméra plonge sur Annecy
// en tournant, la perspective s'ouvre et les bâtiments s'élèvent en vague depuis le centre.
import * as THREE from "three";
import type { World } from "./scene";

const DURATION = 4.6; // s
const TOP_HEIGHT = 26000; // m, avec un champ très étroit : presque orthographique
const TOP_FOV = 9;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export class Intro {
  private readonly reveal = { value: -400 };
  private readonly center = { value: new THREE.Vector2() };
  private t = -1; // -1 : en attente du clic ; 0..1 : plongée
  private readonly from = { target: new THREE.Vector3(), fov: TOP_FOV };
  private readonly to = { target: new THREE.Vector3(), position: new THREE.Vector3(), fov: 50 };
  private readonly saved: { fog: THREE.Fog | THREE.FogExp2 | null; maxDistance: number; maxPolar: number; shadow: boolean };
  private readonly overlay: HTMLElement;
  done = false;

  constructor(
    private readonly world: World,
    private readonly buildings: THREE.Mesh,
    /** objets qui poussent avec les bâtiments (arbres, monuments) */
    private readonly tall: THREE.Object3D[],
    private readonly onDone: () => void,
  ) {
    const { camera, controls, scene } = world;
    // destination : la vue de départ habituelle
    this.to.position.copy(camera.position);
    this.to.target.copy(controls.target);
    this.to.fov = camera.fov;
    this.saved = { fog: scene.fog, maxDistance: controls.maxDistance, maxPolar: controls.maxPolarAngle, shadow: buildings.castShadow };

    // bâtiments écrasés au sol, sauf dans le rayon déjà « révélé »
    const mat = buildings.material as THREE.MeshStandardMaterial;
    const previous = mat.onBeforeCompile;
    mat.onBeforeCompile = (shader, renderer) => {
      previous?.call(mat, shader, renderer);
      shader.uniforms.uReveal = this.reveal;
      shader.uniforms.uRevealCenter = this.center;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nuniform float uReveal;\nuniform vec2 uRevealCenter;")
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
          float rd = length(position.xz - uRevealCenter);
          // front de la vague : les bâtiments jaillissent avec un léger rebond
          float g = clamp((uReveal - rd) / 260.0, 0.0, 1.0);
          float rise = g < 1.0 ? g * g * (3.0 - 2.0 * g) * (1.0 + 0.18 * sin(g * 3.14159)) : 1.0;
          transformed.y *= max(0.012, rise);`,
        );
    };
    mat.needsUpdate = true;

    this.overlay = document.createElement("div");
    this.overlay.id = "intro";
    this.overlay.innerHTML = `<div class="intro-title">Annecy</div>`;
    document.body.appendChild(this.overlay);
  }

  /** Vue de dessus, comme une carte. */
  start() {
    const { camera, controls, scene } = this.world;
    document.body.classList.add("intro");
    scene.fog = null;
    this.buildings.castShadow = false;
    for (const o of this.tall) o.scale.y = 0.01;
    controls.enabled = false;
    controls.maxDistance = TOP_HEIGHT * 2;
    this.from.target.copy(this.to.target);
    camera.fov = TOP_FOV;
    camera.updateProjectionMatrix();
    camera.position.set(this.from.target.x, TOP_HEIGHT, this.from.target.z + 0.01);
    controls.target.copy(this.from.target);
    this.center.value.set(this.to.target.x, this.to.target.z);
    this.reveal.value = -400;
    const go = () => {
      if (this.t >= 0) return;
      this.t = 0;
      this.overlay.classList.add("leaving");
    };
    this.overlay.addEventListener("click", go);
    this.world.renderer.domElement.addEventListener("pointerdown", go, { once: true });
  }

  /** À appeler à chaque image, avant le rendu. */
  update(dt: number) {
    if (this.done || this.t < 0) return;
    this.t = Math.min(1, this.t + dt / DURATION);
    const e = easeInOut(this.t);
    const { camera, controls } = this.world;

    // cible, distance, inclinaison et rotation interpolées en coordonnées sphériques
    const target = this.from.target.clone().lerp(this.to.target, e);
    const end = new THREE.Spherical().setFromVector3(this.to.position.clone().sub(this.to.target));
    // le champ s'ouvre pendant que la caméra descend ; on interpole la largeur visible (et non la distance)
    // pour que la ville grossisse continûment au lieu de rapetisser au milieu de la plongée
    const fov = THREE.MathUtils.lerp(TOP_FOV, this.to.fov, smooth(0.05, 0.85, this.t));
    const halfTan = (f: number) => Math.tan(THREE.MathUtils.degToRad(f) / 2);
    const startView = TOP_HEIGHT * halfTan(TOP_FOV), endView = end.radius * halfTan(this.to.fov);
    const view = startView * Math.pow(endView / startView, e);
    const radius = view / halfTan(fov);
    const phi = THREE.MathUtils.lerp(0.0001, end.phi, smooth(0.15, 1, this.t));
    // un quart de tour pendant la descente
    const theta = end.theta + (1 - smooth(0, 1, this.t)) * 1.4;
    camera.position.copy(target).add(new THREE.Vector3().setFromSpherical(new THREE.Spherical(radius, phi, theta)));
    camera.fov = fov;
    camera.updateProjectionMatrix();
    controls.target.copy(target);

    // la ville se lève : vague depuis le centre, puis arbres et monuments
    this.reveal.value = smooth(0.3, 0.95, this.t) * 7000 - 400;
    const grow = smooth(0.45, 1, this.t);
    for (const o of this.tall) o.scale.y = Math.max(0.01, grow);

    if (this.t >= 1) this.finish();
  }

  private finish() {
    const { controls, scene } = this.world;
    this.done = true;
    this.reveal.value = 1e7;
    scene.fog = this.saved.fog;
    controls.maxDistance = this.saved.maxDistance;
    controls.maxPolarAngle = this.saved.maxPolar;
    controls.enabled = true;
    this.buildings.castShadow = this.saved.shadow;
    for (const o of this.tall) o.scale.y = 1;
    document.body.classList.remove("intro");
    this.overlay.remove();
    this.onDone();
  }

  /** Sans animation (tests, `?nointro`). */
  skip() {
    this.reveal.value = 1e7;
    this.done = true;
    this.overlay.remove();
  }
}
