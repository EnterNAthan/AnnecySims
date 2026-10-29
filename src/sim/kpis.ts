// Journal minute par minute d'une journée, pour comparer la ville avant / pendant un événement
// à la même heure (la veille sans l'événement, ou juste avant son début).
import type { Kpis } from "../shared/advisors";
import { cellCenter, type Zone } from "./eventGeometry";

export class DayLog {
  /** trajets terminés : [minute d'arrivée, habitant, mode, durée, durée à vide] à plat */
  readonly trips: number[] = [];
  /** dépenses : [minute, x, z, montant] à plat */
  readonly spends: number[] = [];
  /** personnes hors de chez elles par cellule de 40 m, relevé à chaque heure */
  readonly people: (Map<number, number> | null)[] = Array(24).fill(null);
  readonly satisfaction = new Float32Array(24);
  /** occupation de chaque parking (‰), relevée à chaque heure */
  readonly parking: (Uint16Array | null)[] = Array(24).fill(null);

  arrival(minute: number, id: number, mode: number, actual: number, free: number) {
    this.trips.push(minute, id, mode, actual, free);
  }

  spend(minute: number, x: number, z: number, amount: number) {
    this.spends.push(minute, x, z, amount);
  }

  /**
   * Indicateurs sur [from, to[. Les trajets ne comptent que ceux des habitants concernés (`who`),
   * la fréquentation de la zone vient du dernier relevé horaire.
   */
  kpis(from: number, to: number, zone: Zone | null, who: Uint8Array | null, scale: number, parks: number[] = []): Kpis {
    const modes = [0, 0, 0, 0];
    let n = 0, trip = 0, delay = 0, free = 0;
    for (let i = 0; i < this.trips.length; i += 5) {
      const m = this.trips[i];
      if (m < from || m >= to || (who && !who[this.trips[i + 1]])) continue;
      const mode = this.trips[i + 2];
      modes[mode - 1]++;
      n++;
      trip += this.trips[i + 3];
      if (mode === 3) {
        delay += Math.max(0, this.trips[i + 3] - this.trips[i + 4]);
        free += this.trips[i + 4];
      }
    }
    const total = Math.max(1, n);
    let revenue = 0, people = 0;
    if (zone) {
      for (let i = 0; i < this.spends.length; i += 4) {
        const m = this.spends[i];
        if (m >= from && m < to && zone.contains(this.spends[i + 1], this.spends[i + 2])) revenue += this.spends[i + 3];
      }
      const h = this.lastHour(to);
      const cells = h >= 0 ? this.people[h]! : null;
      if (cells) for (const [k, c] of cells) if (zone.contains(...cellCenter(k))) people += c;
    }
    const h = Math.max(0, this.lastHour(to));
    return {
      congestion: free > 0 ? +(delay / free).toFixed(3) : 0,
      tripMinutes: +(trip / total).toFixed(1),
      walkShare: +(modes[0] / total).toFixed(3),
      bikeShare: +(modes[1] / total).toFixed(3),
      carShare: +(modes[2] / total).toFixed(3),
      busShare: +(modes[3] / total).toFixed(3),
      parking: this.parkingAt(to, parks),
      zoneRevenue: Math.round(revenue),
      zonePeople: people * scale,
      satisfaction: +this.satisfaction[h].toFixed(3),
    };
  }

  /** Occupation moyenne des parkings `parks` au dernier relevé (0..1), -1 s'il n'y en a pas. */
  private parkingAt(to: number, parks: number[]) {
    const h = this.lastHour(to), occ = h >= 0 ? this.parking[h] : null;
    if (!occ || !parks.length) return -1;
    return +(parks.reduce((s, i) => s + occ[i], 0) / parks.length / 1000).toFixed(3);
  }

  /** Dernière heure relevée avant la minute `to`. */
  private lastHour(to: number) {
    for (let h = Math.min(23, Math.floor((to - 1) / 60)); h >= 0; h--) if (this.people[h]) return h;
    return -1;
  }

  /** Nombre de trajets enregistrés sur la fenêtre (pour savoir si elle est exploitable). */
  count(from: number, to: number, who: Uint8Array | null) {
    let n = 0;
    for (let i = 0; i < this.trips.length; i += 5) if (this.trips[i] >= from && this.trips[i] < to && (!who || who[this.trips[i + 1]])) n++;
    return n;
  }
}
