// Étiquettes des lieux emblématiques d'Annecy.
import * as THREE from "three";
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { project } from "../shared/geo";

// Positions issues d'OpenStreetMap ; la dernière valeur est la hauteur de l'étiquette.
const LANDMARKS: [string, number, number, number][] = [
  ["Palais de l'Île", 45.89855, 6.12715, 25],
  ["Château d'Annecy", 45.89758, 6.12593, 40],
  ["Cathédrale Saint-Pierre", 45.89933, 6.12549, 35],
  ["Hôtel de Ville", 45.89935, 6.1288, 25],
  ["Le Pâquier", 45.90158, 6.13194, 10],
  ["Jardins de l'Europe", 45.89935, 6.13082, 15],
  ["Pont des Amours", 45.9002, 6.13136, 10],
  ["Gare d'Annecy", 45.9016, 6.1221, 20],
  ["Bonlieu", 45.90187, 6.12791, 25],
  ["Courier", 45.9042, 6.1233, 30],
  ["L'Impérial", 45.904, 6.1445, 25],
  ["Les Marquisats", 45.893, 6.136, 15],
  ["Lac d'Annecy", 45.896, 6.1405, 10],
];

export function buildLandmarks(): THREE.Group {
  const group = new THREE.Group();
  group.name = "landmarks";
  for (const [name, lat, lon, h] of LANDMARKS) {
    const el = document.createElement("div");
    el.className = name === "Lac d'Annecy" ? "landmark lake" : "landmark";
    el.textContent = name;
    const obj = new CSS2DObject(el);
    const [x, z] = project(lat, lon);
    obj.position.set(x, h, z);
    group.add(obj);
  }
  return group;
}
