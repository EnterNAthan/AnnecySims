// Catalogue des événements que l'on peut déclencher en langage naturel.
// Partagé par le serveur (prompt de Claude, interpréteur local) et la simulation.

export const EVENT_KINDS = [
  "meteorite", "inondation", "tsunami", "tempete", "incendie", "seisme", "panne", "ovni", "canicule", "blizzard",
  "feu_artifice", "pique_nique", "concert", "festival", "marche", "brocante", "manifestation", "travaux", "accident",
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export interface EventSpec {
  icon: string;
  label: string;
  /** description pour Claude et l'interface */
  about: string;
  /** les habitants fuient la zone (0) ou s'y rendent (attraction > 0) */
  danger: boolean;
  attraction: number;
  /** rayon d'effet en m pour une intensité moyenne (2) */
  radius: number;
  /** durée par défaut en minutes simulées */
  duration: number;
  /** ferme les rues de la zone aux voitures */
  closesRoads: boolean;
  /** change la météo du jour */
  weather?: "pluie" | "neige" | "soleil";
  /** mots-clés de l'interpréteur local (sans accents) */
  keywords: string[];
}

export const EVENT_SPECS: Record<EventKind, EventSpec> = {
  meteorite: {
    icon: "☄️", label: "Chute de météorite", about: "Une météorite s'écrase : cratère, incendie, onde de choc. Les habitants fuient.",
    danger: true, attraction: 0, radius: 220, duration: 240, closesRoads: true, keywords: ["meteor", "asteroide", "comete", "caillou", "espace"],
  },
  inondation: {
    icon: "🌊", label: "Inondation", about: "Le lac et le Thiou débordent, les rues basses sont sous l'eau.",
    danger: true, attraction: 0, radius: 550, duration: 360, closesRoads: true, weather: "pluie", keywords: ["inond", "crue", "deborde", "submerg"],
  },
  tsunami: {
    icon: "🌊", label: "Tsunami sur le lac", about: "Une vague géante traverse le lac et déferle sur les quais.",
    danger: true, attraction: 0, radius: 650, duration: 150, closesRoads: true, keywords: ["tsunami", "vague", "raz de maree"],
  },
  tempete: {
    icon: "⛈️", label: "Tempête", about: "Vent violent, pluie battante et éclairs sur toute la ville.",
    danger: true, attraction: 0, radius: 3000, duration: 300, closesRoads: false, weather: "pluie", keywords: ["tempete", "orage", "ouragan", "tornade", "eclair", "vent"],
  },
  incendie: {
    icon: "🔥", label: "Incendie", about: "Un bâtiment prend feu, les pompiers bloquent le quartier.",
    danger: true, attraction: 0, radius: 120, duration: 180, closesRoads: true, keywords: ["incendie", "feu ", "brule", "flamme", "pompier"],
  },
  seisme: {
    icon: "🫨", label: "Séisme", about: "La terre tremble : panique, les habitants sortent dans les parcs.",
    danger: true, attraction: 0, radius: 2500, duration: 60, closesRoads: false, keywords: ["seisme", "tremblement", "seismes", "secousse"],
  },
  panne: {
    icon: "🔌", label: "Panne de courant géante", about: "Plus d'électricité : fenêtres et lampadaires éteints, commerces fermés.",
    danger: false, attraction: 0, radius: 3000, duration: 180, closesRoads: false, keywords: ["panne", "electricite", "courant", "blackout", "noir"],
  },
  ovni: {
    icon: "🛸", label: "Apparition d'un OVNI", about: "Une soucoupe volante plane au-dessus de la ville. Les curieux affluent.",
    danger: false, attraction: 0.25, radius: 150, duration: 120, closesRoads: false, keywords: ["ovni", "alien", "extraterrestre", "soucoupe", "martien"],
  },
  canicule: {
    icon: "🥵", label: "Canicule", about: "Chaleur écrasante : tout le monde file au bord du lac.",
    danger: false, attraction: 0, radius: 3000, duration: 600, closesRoads: false, weather: "soleil", keywords: ["canicule", "chaleur", "chaud", "secheresse"],
  },
  blizzard: {
    icon: "🌨️", label: "Tempête de neige", about: "La neige paralyse la ville, on reste chez soi.",
    danger: false, attraction: 0, radius: 3000, duration: 480, closesRoads: false, weather: "neige", keywords: ["neige", "blizzard", "flocon", "hiver"],
  },
  feu_artifice: {
    icon: "🎆", label: "Feu d'artifice", about: "Feu d'artifice au-dessus du lac, comme pour la Fête du Lac.",
    danger: false, attraction: 0.35, radius: 200, duration: 60, closesRoads: false, keywords: ["artifice", "fete du lac", "feux"],
  },
  pique_nique: {
    icon: "🧺", label: "Pique-nique géant", about: "Pique-nique convivial sur l'herbe.",
    danger: false, attraction: 0.18, radius: 80, duration: 150, closesRoads: false, keywords: ["pique", "picnic", "pic-nic"],
  },
  concert: {
    icon: "🎵", label: "Concert", about: "Concert en plein air avec scène et projecteurs.",
    danger: false, attraction: 0.15, radius: 80, duration: 180, closesRoads: false, keywords: ["concert", "musique", "groupe", "dj"],
  },
  festival: {
    icon: "🎬", label: "Festival", about: "Festival (par exemple le Festival du film d'animation) : foule et animations.",
    danger: false, attraction: 0.2, radius: 120, duration: 300, closesRoads: false, keywords: ["festival", "cinema", "film", "animation"],
  },
  marche: {
    icon: "🧺", label: "Marché", about: "Marché avec étals de produits savoyards.",
    danger: false, attraction: 0.15, radius: 60, duration: 300, closesRoads: false, keywords: ["marche", "fromage", "producteur"],
  },
  brocante: {
    icon: "🪑", label: "Brocante", about: "Vide-greniers en plein air.",
    danger: false, attraction: 0.1, radius: 60, duration: 420, closesRoads: false, keywords: ["brocante", "vide-grenier", "vide grenier"],
  },
  manifestation: {
    icon: "📣", label: "Manifestation", about: "Rassemblement et cortège, rues bloquées.",
    danger: false, attraction: 0.08, radius: 150, duration: 150, closesRoads: true, keywords: ["manif", "greve", "protest", "revolte", "cortege"],
  },
  travaux: {
    icon: "🚧", label: "Travaux", about: "Chantier, la rue est fermée à la circulation.",
    danger: false, attraction: 0, radius: 60, duration: 480, closesRoads: true, keywords: ["travaux", "chantier"],
  },
  accident: {
    icon: "💥", label: "Accident", about: "Accident de la route, voie bloquée.",
    danger: false, attraction: 0, radius: 40, duration: 90, closesRoads: true, keywords: ["accident", "collision", "carambolage"],
  },
};

/** Ce que l'interprète (Claude ou local) propose, avant confirmation. */
export interface EventProposal {
  kind: EventKind;
  location: string;
  /** minutes avant le début (0 = tout de suite) */
  startIn: number;
  durationMinutes: number;
  /** 1 = léger, 2 = moyen, 3 = extrême */
  intensity: 1 | 2 | 3;
  title: string;
  description: string;
  /** question de confirmation posée au joueur */
  question: string;
  /** explication si la demande a été rapprochée d'une action voisine */
  note: string;
  source: "claude" | "local";
}
