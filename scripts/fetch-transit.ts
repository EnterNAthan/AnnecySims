// Télécharge les lignes de bus (réseau Sibra) qui desservent le centre d'Annecy, avec leurs arrêts ordonnés.
import { mkdirSync, writeFileSync } from "node:fs";
import { BBOX } from "../src/shared/geo";

const MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const b = `${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}`;
const query = `[out:json][timeout:180];
relation["type"="route"]["route"="bus"](${b});
out body;
node(r)(${b});
out;`;

for (const url of MIRRORS) {
  try {
    console.log(`→ ${url}`);
    const res = await fetch(url, {
      method: "POST",
      headers: { "User-Agent": "ane-sims/0.1", "Content-Type": "application/x-www-form-urlencoded" },
      body: "data=" + encodeURIComponent(query),
      signal: AbortSignal.timeout(200_000),
    });
    const text = await res.text();
    if (!res.ok || !text.startsWith("{")) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    mkdirSync("data", { recursive: true });
    writeFileSync("data/transit-raw.json", text);
    console.log(`✓ ${JSON.parse(text).elements.length} éléments`);
    process.exit(0);
  } catch (e) {
    console.warn(`✗ ${(e as Error).message}`);
  }
}
process.exit(1);
