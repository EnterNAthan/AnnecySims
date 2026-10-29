// Construit l'index de la banque de modèles 3D (CC0) à partir de dépôts publics :
// Kenney (objets, véhicules) et Quaternius (animaux, bateaux, nature, personnages…).
// Les modèles eux-mêmes sont téléchargés à la demande par le serveur (voir server/assets.ts).
// Usage : npx tsx scripts/build-asset-index.ts
import { writeFileSync } from "node:fs";

interface Source {
  repo: string;
  branch: string;
  /** auteur, pour les crédits */
  author: string;
  /** fichiers à ignorer : pièces de construction modulaires, armes, chiffres… */
  skip: RegExp;
  /** packs entiers à ignorer */
  skipPack?: RegExp;
}

const SOURCES: Source[] = [
  { repo: "Kenney-CCO/Kenney-CCO.glb", branch: "main", author: "Kenney", skip: /^(blaster|foamBullet|corridor|floor|wall|pipe|platform|stairs|terrain|monorail_track|rail|structure|supports|weapon|clipA|scope|turret|wheel-)/i },
  {
    repo: "trebeljahr/quaternius-showcase", branch: "main", author: "Quaternius",
    skip: /^(Numbers_|Cube_|Pipe_|Stairs_|Street_|Streets_all)|Wall|Floor|Corner|Door|Roof|Window|Column|Tile|Platform/i,
    skipPack: /modular_dungeon|modular_sci_fi|guns_pack|weapons_pack|house_interior/i,
  },
];

const words = (name: string) =>
  name.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_\-.]+/g, " ").toLowerCase().split(" ").filter((w) => w && !/^\d+$/.test(w));

async function tree(src: Source) {
  const res = await fetch(`https://api.github.com/repos/${src.repo}/git/trees/${src.branch}?recursive=1`, { headers: { "User-Agent": "annecy-sim" } });
  if (!res.ok) throw new Error(`${src.repo} : ${res.status}`);
  return ((await res.json()) as { tree: { path: string; size: number }[] }).tree;
}

const out: { id: string; name: string; pack: string; tags: string[]; url: string; bytes: number; author: string }[] = [];
for (const src of SOURCES) {
  for (const f of await tree(src)) {
    if (!/\.glb$/i.test(f.path) || f.size > 3_000_000) continue;
    const file = f.path.split("/").pop()!.replace(/\.glb$/i, "");
    const pack = f.path.includes("/") ? f.path.split("/").at(-2)! : "kenney";
    if (src.skip.test(file) || src.skipPack?.test(pack)) continue;
    const id = `${pack}/${file}`.toLowerCase().replace(/[^a-z0-9/_-]/g, "_");
    if (out.some((o) => o.id === id)) continue;
    out.push({
      id, name: file, pack, tags: [...new Set([...words(file), ...words(pack).filter((w) => w !== "pack")])],
      url: `https://raw.githubusercontent.com/${src.repo}/${src.branch}/${f.path.split("/").map(encodeURIComponent).join("/")}`,
      bytes: f.size, author: src.author,
    });
  }
}
writeFileSync("public/assets/index.json", JSON.stringify(out));
console.log(`${out.length} modèles indexés`);
