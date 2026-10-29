// Scène, caméra, ciel et éclairage jour/nuit.
import * as THREE from "three";
import { MapControls } from "three/examples/jsm/controls/MapControls.js";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { sunDirection } from "../shared/astro";
import { streetMaterials, waterMaterial } from "./cityMeshes";
import type { WeatherKind } from "../sim/events";
import type { ViewStyle } from "./viewStyle";

const SHADOW_RADIUS = 1400;
const PRECIP_BOX = 1800;
const PRECIP_HEIGHT = 500;

export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly labels: CSS2DRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: MapControls;
  private readonly sky = new Sky();
  private readonly sun = new THREE.DirectionalLight("#fff4e0", 3);
  private readonly moon = new THREE.DirectionalLight("#9bb4ff", 0);
  private readonly hemi = new THREE.HemisphereLight("#cfe3ff", "#6d6a5a", 1);
  private readonly fog = new THREE.Fog("#c9d8e6", 3000, 26000);
  /** « verre » : ville nocturne bleutée sans ciel ; « réaliste » : ciel physique et couleurs naturelles */
  viewStyle: ViewStyle = "verre";
  /** 0 en plein jour, 1 en pleine nuit */
  night = 0;
  private windowMaterial?: THREE.MeshStandardMaterial;
  private weather: WeatherKind = "soleil";
  private precip?: THREE.LineSegments | THREE.Points;
  /** point que la caméra rejoint en douceur (lieu cliqué, habitant suivi) */
  flyTo: THREE.Vector3 | null = null;
  /** panne de courant : fenêtres et lampadaires éteints */
  blackout = false;
  /** tempête : éclairs aléatoires et pluie penchée par le vent */
  storm = false;
  /** canicule : brume chaude orangée */
  heat = false;
  private flashLight = new THREE.PointLight("#dfe8ff", 0, 0, 0);
  private flashLevel = 0;
  private shakeLevel = 0;
  private nextLightning = 0;
  private bolt?: THREE.Line;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(this.renderer.domElement);

    this.labels = new CSS2DRenderer();
    this.labels.domElement.className = "labels";
    container.appendChild(this.labels.domElement);

    this.camera = new THREE.PerspectiveCamera(50, 1, 1, 60000);
    this.camera.position.set(-950, 750, 1250);
    this.controls = new MapControls(this.camera, this.renderer.domElement);
    this.controls.target.set(250, 0, -50);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = 1.42;
    this.controls.minDistance = 25;
    this.controls.maxDistance = 14000;
    this.controls.zoomToCursor = true;
    this.controls.update();

    this.sky.scale.setScalar(50000);
    const u = this.sky.material.uniforms;
    u.turbidity.value = 4;
    u.rayleigh.value = 1.6;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.8;
    this.scene.add(this.sky);
    this.scene.fog = this.fog;

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -SHADOW_RADIUS;
    sc.right = sc.top = SHADOW_RADIUS;
    sc.near = 10;
    sc.far = 8000;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    this.scene.add(this.sun, this.sun.target, this.moon, this.moon.target, this.hemi);

    this.flashLight.position.set(0, 1500, 0);
    this.scene.add(this.flashLight);
    window.addEventListener("resize", () => this.resize());
    this.resize();
  }

  setWindowMaterial(m: THREE.MeshStandardMaterial) {
    this.windowMaterial = m;
  }

  private resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.labels.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Pluie ou neige autour de la caméra, ciel plus ou moins couvert. */
  setWeather(kind: WeatherKind) {
    this.weather = kind;
    if (this.precip) {
      this.scene.remove(this.precip);
      this.precip.geometry.dispose();
      this.precip = undefined;
    }
    if (kind !== "pluie" && kind !== "neige") return;
    const n = kind === "pluie" ? 9000 : 6000;
    const rain = kind === "pluie";
    const pos = new Float32Array(n * (rain ? 6 : 3));
    for (let i = 0; i < n; i++) {
      const x = (Math.random() - 0.5) * PRECIP_BOX, y = Math.random() * PRECIP_HEIGHT, z = (Math.random() - 0.5) * PRECIP_BOX;
      if (rain) pos.set([x, y, z, x + 0.6, y + 9, z], i * 6);
      else pos.set([x, y, z], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.precip = rain
      ? new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: "#a9c4dd", transparent: true, opacity: 0.45 }))
      : new THREE.Points(geo, new THREE.PointsMaterial({ color: "#ffffff", size: 3, transparent: true, opacity: 0.9 }));
    this.precip.frustumCulled = false;
    this.scene.add(this.precip);
  }

  /** Éclair de lumière (impact, foudre) ; `power` ~1 pour un éclair, 3 pour une météorite. */
  flash(at: THREE.Vector3, power = 1) {
    this.flashLight.position.set(at.x, 400, at.z);
    this.flashLevel = Math.max(this.flashLevel, power);
  }

  /** Secousse de caméra (séisme, impact). */
  shake(power: number) {
    this.shakeLevel = Math.max(this.shakeLevel, power);
  }

  private updateEffects(dt: number) {
    this.flashLevel *= Math.exp(-dt * 8);
    this.flashLight.intensity = Math.min(this.flashLevel, 2) * 1.2e6;
    if (this.bolt) {
      const m = this.bolt.material as THREE.LineBasicMaterial;
      m.opacity -= dt * 4;
      if (m.opacity <= 0) {
        this.scene.remove(this.bolt);
        this.bolt.geometry.dispose();
        this.bolt = undefined;
      }
    }
    if (this.storm && performance.now() > this.nextLightning) {
      this.nextLightning = performance.now() + 1500 + Math.random() * 5000;
      const t = this.controls.target;
      const x = t.x + (Math.random() - 0.5) * 2500, z = t.z + (Math.random() - 0.5) * 2500;
      const pts: THREE.Vector3[] = [];
      for (let y = 900, px = x, pz = z; y > 0; y -= 60 + Math.random() * 60) {
        pts.push(new THREE.Vector3(px, y, pz));
        px += (Math.random() - 0.5) * 80;
        pz += (Math.random() - 0.5) * 80;
      }
      if (this.bolt) this.scene.remove(this.bolt);
      this.bolt = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: "#eef3ff", transparent: true, opacity: 1 }));
      this.scene.add(this.bolt);
      this.flash(new THREE.Vector3(x, 0, z), 1.2);
    }
    this.shakeLevel *= Math.exp(-dt * 1.5);
  }

  private updatePrecip(dt: number) {
    if (!this.precip) return;
    const rain = this.weather === "pluie";
    const fall = (rain ? 140 : 18) * dt;
    const t = this.controls.target;
    this.precip.position.set(Math.round(t.x / 50) * 50, 0, Math.round(t.z / 50) * 50);
    const pos = this.precip.geometry.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const stride = rain ? 6 : 3;
    for (let i = 0; i < arr.length; i += stride) {
      arr[i + 1] -= fall;
      if (rain) {
        arr[i + 4] -= fall;
        if (this.storm) {
          // vent : la pluie part en diagonale
          arr[i] += fall * 0.5;
          arr[i + 3] = arr[i] + 6;
          if (arr[i] > PRECIP_BOX / 2) {
            arr[i] -= PRECIP_BOX;
            arr[i + 3] -= PRECIP_BOX;
          }
        }
      } else arr[i] += Math.sin(arr[i + 1] * 0.05) * 0.3;
      if (arr[i + 1] < 0) {
        arr[i + 1] += PRECIP_HEIGHT;
        if (rain) arr[i + 4] += PRECIP_HEIGHT;
      }
    }
    pos.needsUpdate = true;
  }

  /** Met à jour soleil, ciel, brouillard et fenêtres pour la date et l'heure locale. */
  setTime(date: Date, hour: number) {
    const s = sunDirection(date, hour);
    const dir = new THREE.Vector3(s.x, s.y, s.z).normalize();
    // jour = 1 au-dessus de 6°, 0 en dessous de -8° (fin du crépuscule civil approx.)
    const day = THREE.MathUtils.smoothstep(s.altitude, -8, 6);
    this.night = 1 - day;
    const golden = 1 - THREE.MathUtils.smoothstep(s.altitude, 2, 18);

    this.sky.material.uniforms.sunPosition.value.copy(dir);
    this.sky.material.uniforms.rayleigh.value = 1.2 + golden * 1.5;
    this.renderer.toneMappingExposure = 0.25 + day * 0.35;

    const target = this.controls.target;
    this.sun.position.copy(target).addScaledVector(dir, 4000);
    this.sun.target.position.copy(target);
    const overcast = this.weather === "soleil" ? 0 : this.weather === "nuageux" ? 0.55 : 0.8;
    this.sky.material.uniforms.turbidity.value = 4 + overcast * 14;
    this.sun.intensity = 3.2 * THREE.MathUtils.smoothstep(s.altitude, -2, 10) * (1 - overcast * 0.75);
    this.sun.color.setHSL(0.09 - golden * 0.04, 0.4 + golden * 0.5, 0.92 - golden * 0.18);
    this.sun.castShadow = s.altitude > 0;

    // une lune fixe, assez haute, pour qu'on voie encore la ville la nuit
    this.moon.position.copy(target).add(new THREE.Vector3(-1500, 3000, 1200));
    this.moon.target.position.copy(target);
    this.moon.intensity = 1.5 * this.night;

    this.hemi.intensity = 0.55 + day * 1.05;
    this.hemi.color.setHSL(0.6, 0.5, 0.35 + day * 0.5);

    const fogDay = new THREE.Color("#c4d3e1"), fogDusk = new THREE.Color("#e3a982"), fogNight = new THREE.Color("#0c1424");
    this.fog.color.copy(fogDay).lerp(new THREE.Color("#8d969e"), overcast).lerp(fogDusk, golden * day * (1 - overcast)).lerp(fogNight, this.night);
    this.fog.near = 3000 - overcast * 2200;
    this.fog.far = 26000 - overcast * 17000;

    const power = this.blackout ? 0 : 1;
    if (this.windowMaterial) this.windowMaterial.emissiveIntensity = 1.6 * this.night * power;
    for (const m of streetMaterials) m.emissiveIntensity = 0.22 * this.night * power;
    if (this.heat) this.fog.color.lerp(new THREE.Color("#e8b26a"), 0.45 * day);
    if (this.storm) {
      this.fog.color.lerp(new THREE.Color("#3b4450"), 0.6 * day);
      this.hemi.intensity *= 0.55;
    }
    waterMaterial.color.set("#3a7ca3").lerp(new THREE.Color("#0b1d33"), this.night * 0.85);
    if (this.viewStyle === "verre") this.applyGlass(day, power);
    else {
      this.sky.visible = true;
      this.scene.background = null;
      this.hemi.groundColor.set("#6d6a5a");
    }
  }

  /** Ambiance « verre » : fond bleu nuit uni, lumière froide, fenêtres toujours un peu allumées. */
  private applyGlass(day: number, power: number) {
    this.sky.visible = false;
    const bg = new THREE.Color("#121c2c").lerp(new THREE.Color("#070b12"), this.night);
    if (this.storm) bg.lerp(new THREE.Color("#1a1f27"), 0.5);
    this.scene.background = bg;
    this.fog.color.copy(bg);
    this.fog.near = 1800;
    this.fog.far = 16000;
    this.renderer.toneMappingExposure = 0.8 + day * 0.2;
    this.sun.color.set("#dfe8ff");
    this.sun.intensity *= 0.8;
    this.hemi.color.set("#9db4dc");
    this.hemi.groundColor.set("#1a2130");
    this.hemi.intensity = 1.4 + day * 0.6;
    this.moon.intensity = 1.2;
    if (this.windowMaterial) this.windowMaterial.emissiveIntensity = (0.6 + 1.1 * this.night) * power;
    waterMaterial.color.set("#1d4166").lerp(new THREE.Color("#0f2540"), this.night);
  }

  render(dt: number) {
    if (this.flyTo) {
      // déplace cible et caméra ensemble pour garder l'angle de vue
      const delta = this.flyTo.clone().sub(this.controls.target).multiplyScalar(Math.min(1, dt * 4));
      this.controls.target.add(delta);
      this.camera.position.add(delta);
    }
    this.updatePrecip(dt);
    this.updateEffects(dt);
    this.controls.update();
    // la secousse est appliquée juste pour le rendu, puis annulée
    const shake = new THREE.Vector3(
      (Math.random() - 0.5) * this.shakeLevel * 6, (Math.random() - 0.5) * this.shakeLevel * 4, (Math.random() - 0.5) * this.shakeLevel * 6,
    );
    this.camera.position.add(shake);
    this.renderer.render(this.scene, this.camera);
    this.camera.position.sub(shake);
    this.labels.render(this.scene, this.camera);
  }
}
