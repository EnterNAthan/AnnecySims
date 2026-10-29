// Banque de modèles 3D (CC0, Kenney et Quaternius) : recherche par mots-clés, téléchargement à la demande, cache local.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface AssetEntry {
  id: string;
  name: string;
  pack: string;
  tags: string[];
  url: string;
  bytes: number;
  author: string;
}

const CACHE = "data/asset-cache";
let index: AssetEntry[] | null = null;
export const assetIndex = () => (index ??= JSON.parse(readFileSync("public/assets/index.json", "utf8")) as AssetEntry[]);

/** Liste compacte pour le prompt de Claude : identifiants regroupés par pack. */
export function assetCatalog(): string {
  const byPack = new Map<string, string[]>();
  for (const a of assetIndex()) {
    let l = byPack.get(a.pack);
    if (!l) byPack.set(a.pack, (l = []));
    l.push(a.id.split("/")[1]);
  }
  return [...byPack].map(([pack, ids]) => `${pack}/ : ${ids.join(" ")}`).join("\n");
}

const words = (s: string) =>
  s.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w));

/** Identifiant exact, sinon le modèle dont les mots-clés recouvrent le mieux la requête. */
export function findAsset(query: string): AssetEntry | null {
  const all = assetIndex();
  const q = query.trim().toLowerCase();
  const flat = q.replace(/[^a-z0-9]/g, "");
  const exact = all.find((a) => a.id === q || a.id.endsWith("/" + q) || a.name.toLowerCase().replace(/[^a-z0-9]/g, "") === flat);
  if (exact) return exact;
  const qw = words(query);
  if (!qw.length) return null;
  let best: AssetEntry | null = null, bestScore = 0;
  for (const a of all) {
    const tags = a.tags.map((t) => (t.length > 3 && t.endsWith("s") ? t.slice(0, -1) : t));
    const hits = qw.filter((w) => tags.includes(w)).length;
    if (!hits) continue;
    // couverture de la requête, en préférant les noms courts (moins spécifiques à autre chose)
    const score = hits / qw.length + hits / tags.length * 0.3 - a.bytes / 2e7;
    if (score > bestScore) [best, bestScore] = [a, score];
  }
  return bestScore >= 0.5 ? best : null;
}

/** Fichier .glb local (téléchargé et mis en cache la première fois). */
export async function assetFile(id: string): Promise<string | null> {
  const a = assetIndex().find((x) => x.id === id);
  if (!a) return null;
  const file = join(CACHE, id.replace(/\//g, "__") + ".glb");
  if (existsSync(file)) return file;
  const res = await fetch(a.url);
  if (!res.ok) throw new Error(`téléchargement ${a.url} : ${res.status}`);
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return file;
}
