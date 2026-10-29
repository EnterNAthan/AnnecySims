// Zone simulée et projection lat/lon → mètres locaux (x = est, z = sud, comme Three.js).
export const BBOX = { south: 45.888, west: 6.105, north: 45.930, east: 6.165 };

export const ORIGIN = { lat: 45.8992, lon: 6.1294 }; // Vieille ville / Palais de l'Île

const R = 6_378_137;
const cosLat = Math.cos((ORIGIN.lat * Math.PI) / 180);

export function project(lat: number, lon: number): [number, number] {
  const x = ((lon - ORIGIN.lon) * Math.PI) / 180 * R * cosLat;
  const z = -((lat - ORIGIN.lat) * Math.PI) / 180 * R;
  return [x, z];
}
