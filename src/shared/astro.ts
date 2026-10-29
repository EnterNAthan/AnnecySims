// Position du soleil à Annecy pour une date et une heure locale (précision ~1°, suffisante pour l'éclairage).
import { ORIGIN } from "./geo";

const RAD = Math.PI / 180;

/** Dernier dimanche du mois (0 = janvier). */
function lastSunday(year: number, month: number) {
  const d = new Date(Date.UTC(year, month + 1, 0));
  return d.getUTCDate() - d.getUTCDay();
}

/** Décalage horaire de la France (CET/CEST) pour une date civile. */
export function utcOffset(date: Date): number {
  const y = date.getFullYear(), m = date.getMonth(), d = date.getDate();
  const afterStart = m > 2 || (m === 2 && d >= lastSunday(y, 2));
  const beforeEnd = m < 9 || (m === 9 && d < lastSunday(y, 9));
  return afterStart && beforeEnd ? 2 : 1;
}

function dayOfYear(date: Date) {
  return Math.floor((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(date.getFullYear(), 0, 0)) / 86_400_000);
}

/**
 * Direction vers le soleil dans le repère de la scène (x = est, y = haut, z = sud),
 * et son altitude en degrés.
 */
export function sunDirection(date: Date, hour: number): { x: number; y: number; z: number; altitude: number } {
  const n = dayOfYear(date);
  const decl = 23.44 * Math.sin((2 * Math.PI * (284 + n)) / 365) * RAD;
  const lat = ORIGIN.lat * RAD;
  const solarTime = hour - utcOffset(date) + ORIGIN.lon / 15;
  const H = 15 * (solarTime - 12) * RAD;
  const sinAlt = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(H);
  const alt = Math.asin(sinAlt);
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(lat) - Math.tan(decl) * Math.cos(lat)) + Math.PI;
  return {
    x: Math.sin(az) * Math.cos(alt),
    y: sinAlt,
    z: -Math.cos(az) * Math.cos(alt),
    altitude: alt / RAD,
  };
}
