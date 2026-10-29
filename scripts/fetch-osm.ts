// Télécharge les données OpenStreetMap du centre d'Annecy (une seule fois).
import { writeFileSync, mkdirSync } from "node:fs";
import { BBOX } from "../src/shared/geo";

const MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

const b = `${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}`;
const query = `[out:json][timeout:180];
(
  way["building"](${b});
  relation["building"](${b});
  way["highway"](${b});
  way["natural"="water"](${b});
  relation["natural"="water"](${b});
  way["waterway"](${b});
  way["leisure"~"park|garden|pitch|playground"](${b});
  way["landuse"~"grass|forest|meadow|recreation_ground"](${b});
  way["natural"="wood"](${b});
  way["railway"="rail"](${b});
  node["amenity"](${b});
  node["shop"](${b});
  node["tourism"](${b});
  node["office"](${b});
  node["leisure"](${b});
  way["amenity"](${b});
  way["shop"](${b});
  way["tourism"](${b});
);
out geom;`;

async function main() {
  for (const url of MIRRORS) {
    try {
      console.log(`→ ${url}`);
      const res = await fetch(url, {
        method: "POST",
        headers: { "User-Agent": "ane-sims/0.1", "Content-Type": "application/x-www-form-urlencoded" },
        body: "data=" + encodeURIComponent(query),
        signal: AbortSignal.timeout(240_000),
      });
      const text = await res.text();
      if (!res.ok || !text.startsWith("{")) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      const json = JSON.parse(text);
      mkdirSync("data", { recursive: true });
      writeFileSync("data/osm-raw.json", text);
      console.log(`✓ ${json.elements.length} éléments enregistrés dans data/osm-raw.json`);
      return;
    } catch (e) {
      console.warn(`✗ ${(e as Error).message}`);
    }
  }
  process.exit(1);
}

main();
