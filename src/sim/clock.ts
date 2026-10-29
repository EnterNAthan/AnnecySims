// Horloge de la simulation : 1 step = 1 jour, animé en DAY_SECONDS secondes réelles à vitesse x1.
// La nuit (0 h – 5 h 30) défile NIGHT_FACTOR fois plus vite pour laisser plus de temps à la journée.
export const DAY_SECONDS = 180;
const NIGHT_END = 5.5 * 60;
const NIGHT_FACTOR = 6;
const MINUTES_PER_REAL_SECOND = (1440 - NIGHT_END + NIGHT_END / NIGHT_FACTOR) / DAY_SECONDS;

const DAYS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

export class SimClock {
  day = 1;
  /** minutes depuis minuit */
  minute: number;
  /** vitesse par défaut : ⅓× (une journée en 9 minutes) */
  speed = 0.33;
  /** 1 seconde réelle = 1 seconde simulée */
  realtime = false;
  paused = false;
  private readonly start: Date;

  constructor(start: Date, startMinute = 6 * 60) {
    this.start = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    this.minute = startMinute;
  }

  get date(): Date {
    const d = new Date(this.start);
    d.setDate(d.getDate() + this.day - 1);
    return d;
  }

  get hour(): number {
    return this.minute / 60;
  }

  /** Avance l'horloge ; renvoie true quand minuit est franchi (fin du jour). */
  tick(dtSeconds: number): boolean {
    if (this.paused) return false;
    if (this.realtime) this.minute += dtSeconds / 60;
    else this.minute += dtSeconds * MINUTES_PER_REAL_SECOND * (this.minute < NIGHT_END ? NIGHT_FACTOR : 1) * this.speed;
    if (this.minute < 1440) return false;
    this.minute -= 1440;
    this.day++;
    return true;
  }

  label(): string {
    const d = this.date;
    const h = Math.floor(this.minute / 60), m = Math.floor(this.minute % 60);
    const sec = this.realtime ? `:${String(Math.floor((this.minute * 60) % 60)).padStart(2, "0")}` : "";
    return `Jour ${this.day} · ${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} · ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}${sec}`;
  }
}
