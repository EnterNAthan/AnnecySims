// Format de public/city.json, partagé entre le script de build, le rendu et la simulation.
// Toutes les coordonnées sont en mètres, aplaties [x0, z0, x1, z1, …].

export const ROAD_FLAGS = {
  CAR: 1,
  FOOT: 2,
  BIKE: 4,
  ALL: 7,
  ONEWAY: 8,
  BRIDGE: 16,
} as const;

export interface Building {
  id: number;
  p: number[];
  h: number;
  k: string; // house | apartments | commercial | industrial | public | religious | historic | small | generic
  n?: string;
}

export interface WaterPoly {
  outer: number[];
  holes: number[][];
  n?: string;
}

export interface Line {
  p: number[];
  w: number;
  n?: string;
}

export interface Green {
  p: number[];
  k: string; // park | pitch | forest | grass
}

export interface Road {
  id: number;
  t: string; // valeur OSM highway=*
  w: number;
  f: number; // ROAD_FLAGS
  n: number[]; // indices dans City.nodes
  name?: string;
}

export interface Poi {
  k: string; // food | bar | grocery | shop | school | health | office | culture | hotel | sport | boat | worship
  x: number;
  z: number;
  n?: string;
}

export interface City {
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  buildings: Building[];
  water: WaterPoly[];
  waterways: Line[];
  greens: Green[];
  roads: Road[];
  rail: Line[];
  nodes: number[];
  pois: Poi[];
  terrain: { half: number; res: number; h: number[] }; // grille (res+1)², hauteurs en m
}
