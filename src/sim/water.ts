// Masque de l'eau (lac, Thiou, canaux) rastérisé sur une grille, pour ne jamais placer quelqu'un dans l'eau.
import type { City } from "../shared/city";

const CELL = 4; // m

export class WaterMask {
  private readonly cols: number;
  private readonly rows: number;
  private readonly minX: number;
  private readonly minZ: number;
  private readonly bits: Uint8Array;

  constructor(city: City) {
    const b = city.bounds;
    this.minX = b.minX;
    this.minZ = b.minZ;
    this.cols = Math.ceil((b.maxX - b.minX) / CELL);
    this.rows = Math.ceil((b.maxZ - b.minZ) / CELL);
    this.bits = new Uint8Array(this.cols * this.rows);
    for (const w of city.water) {
      // les îles (trous) ressortent grâce à la règle pair-impair
      this.fill([w.outer, ...w.holes]);
    }
  }

  /** Remplissage par balayage de lignes : les intersections triées, prises par paires, donnent les segments intérieurs. */
  private fill(rings: number[][]) {
    const xs: number[] = [];
    for (let row = 0; row < this.rows; row++) {
      const z = this.minZ + (row + 0.5) * CELL;
      xs.length = 0;
      for (const p of rings) {
        const n = p.length / 2;
        for (let i = 0, j = n - 1; i < n; j = i++) {
          const zi = p[2 * i + 1], zj = p[2 * j + 1];
          if (zi > z === zj > z) continue;
          xs.push(p[2 * i] + ((z - zi) / (zj - zi)) * (p[2 * j] - p[2 * i]));
        }
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const c0 = Math.max(0, Math.ceil((xs[k] - this.minX) / CELL - 0.5));
        const c1 = Math.min(this.cols - 1, Math.floor((xs[k + 1] - this.minX) / CELL - 0.5));
        for (let c = c0; c <= c1; c++) this.bits[row * this.cols + c] = 1;
      }
    }
  }

  isWater(x: number, z: number): boolean {
    const c = Math.floor((x - this.minX) / CELL), r = Math.floor((z - this.minZ) / CELL);
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return false;
    return this.bits[r * this.cols + c] === 1;
  }
}
