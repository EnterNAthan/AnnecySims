// Catalogue des événements que l'on peut déclencher en langage naturel.
// Partagé par le serveur (prompt de Claude, interpréteur local) et la simulation.

export const EVENT_KINDS = [
  // gestion urbaine (par défaut)
  "fermeture", "travaux", "pietonnisation", "manifestation", "marathon", "greve", "marche", "brocante", "concert",
  "festival", "pique_nique", "feu_artifice", "accident", "canicule", "blizzard", "tempete", "panne", "inondation",
  // scénarios extrêmes (interrupteur)
  "meteorite", "tsunami", "incendie", "seisme", "ovni",
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export interface EventSpec {
  icon: string;
  label: string;
  /** description pour Claude et l'interface */
  about: string;
  /** réservé au mode « scénarios extrêmes » */
  extreme: boolean;
  /** les habitants fuient la zone */
  danger: boolean;
  /** part des habitants disponibles qui s'y rendent */
  attraction: number;
  /** rayon d'effet en m pour une intensité moyenne (2) */
  radius: number;
  /** durée par défaut en minutes simulées (par jour) */
  duration: number;
  /** heure de début par défaut si le joueur n'en donne pas ("" = tout de suite) */
  defaultStart: string;
  /** ferme aux voitures : les rues nommées, sinon celles de la zone */
  closesRoads: boolean;
  /** nécessite des rues nommées (fermeture, piétonnisation) ou un parcours (cortège) */
  needs: "streets" | "route" | "place";
  /** change la météo du jour */
  weather?: "pluie" | "neige" | "soleil";
  /** mots-clés de l'interpréteur local (sans accents) */
  keywords: string[];
}

export const EVENT_SPECS: Record<EventKind, EventSpec> = {
  fermeture: {
    icon: "⛔", label: "Fermeture de rue", about: "Une ou plusieurs rues fermées à la circulation automobile (arrêté municipal, sécurité…).",
    extreme: false, danger: false, attraction: 0, radius: 40, duration: 1440, defaultStart: "", closesRoads: true, needs: "streets",
    keywords: ["ferme", "fermer", "fermeture", "bloque", "barrer", "interdi", "coupe", "couper"],
  },
  travaux: {
    icon: "🚧", label: "Travaux", about: "Chantier de voirie : rues fermées aux voitures, souvent plusieurs jours ou semaines.",
    extreme: false, danger: false, attraction: 0, radius: 40, duration: 600, defaultStart: "07:30", closesRoads: true, needs: "streets",
    keywords: ["travaux", "chantier", "refection", "voirie", "tranchee"],
  },
  pietonnisation: {
    icon: "🚶", label: "Piétonnisation", about: "Rues rendues aux piétons : plus de voitures, plus de flâneurs et de clients pour les commerces.",
    extreme: false, danger: false, attraction: 0, radius: 60, duration: 1440, defaultStart: "", closesRoads: true, needs: "streets",
    keywords: ["pieton", "pietonn", "zone pietonne", "sans voiture"],
  },
  manifestation: {
    icon: "📣", label: "Manifestation", about: "Rassemblement puis cortège à pied sur un parcours ; les rues sont fermées au passage du cortège.",
    extreme: false, danger: false, attraction: 0.06, radius: 120, duration: 150, defaultStart: "14:00", closesRoads: true, needs: "route",
    keywords: ["manif", "cortege", "greve generale", "rassemblement", "protest", "defile", "marche pour"],
  },
  marathon: {
    icon: "🏃", label: "Course à pied", about: "Course autour du lac : parcours fermé aux voitures, coureurs et spectateurs.",
    extreme: false, danger: false, attraction: 0.05, radius: 80, duration: 240, defaultStart: "09:00", closesRoads: true, needs: "route",
    keywords: ["marathon", "course a pied", "semi", "trail", "10 km", "courir", "coureurs"],
  },
  greve: {
    icon: "🚆", label: "Grève du Léman Express", about: "Plus de trains vers Genève : les frontaliers sans voiture télétravaillent ou covoiturent.",
    extreme: false, danger: false, attraction: 0, radius: 150, duration: 1440, defaultStart: "", closesRoads: false, needs: "place",
    keywords: ["greve", "sncf", "leman", "train", "cheminot"],
  },
  marche: {
    icon: "🧺", label: "Marché", about: "Marché de producteurs avec étals.",
    extreme: false, danger: false, attraction: 0.15, radius: 60, duration: 300, defaultStart: "08:00", closesRoads: false, needs: "place",
    keywords: ["marche", "fromage", "producteur"],
  },
  brocante: {
    icon: "🪑", label: "Brocante", about: "Vide-greniers en plein air.",
    extreme: false, danger: false, attraction: 0.1, radius: 60, duration: 420, defaultStart: "08:00", closesRoads: false, needs: "place",
    keywords: ["brocante", "vide-grenier", "vide grenier"],
  },
  concert: {
    icon: "🎵", label: "Concert", about: "Concert en plein air avec scène et projecteurs.",
    extreme: false, danger: false, attraction: 0.15, radius: 80, duration: 180, defaultStart: "20:00", closesRoads: false, needs: "place",
    keywords: ["concert", "musique", "groupe", "dj"],
  },
  festival: {
    icon: "🎬", label: "Festival", about: "Festival (par exemple le Festival du film d'animation) : foule et animations.",
    extreme: false, danger: false, attraction: 0.2, radius: 120, duration: 300, defaultStart: "14:00", closesRoads: false, needs: "place",
    keywords: ["festival", "cinema", "film", "animation"],
  },
  pique_nique: {
    icon: "🧺", label: "Pique-nique", about: "Pique-nique convivial sur l'herbe.",
    extreme: false, danger: false, attraction: 0.18, radius: 80, duration: 150, defaultStart: "12:00", closesRoads: false, needs: "place",
    keywords: ["pique", "picnic", "pic-nic"],
  },
  feu_artifice: {
    icon: "🎆", label: "Feu d'artifice", about: "Feu d'artifice au-dessus du lac, comme pour la Fête du Lac.",
    extreme: false, danger: false, attraction: 0.35, radius: 200, duration: 60, defaultStart: "21:30", closesRoads: false, needs: "place",
    keywords: ["artifice", "fete du lac", "feux d'art"],
  },
  accident: {
    icon: "💥", label: "Accident", about: "Accident de la route, voie bloquée le temps de l'intervention.",
    extreme: false, danger: false, attraction: 0, radius: 40, duration: 90, defaultStart: "", closesRoads: true, needs: "streets",
    keywords: ["accident", "collision", "carambolage"],
  },
  canicule: {
    icon: "🥵", label: "Canicule", about: "Chaleur écrasante : tout le monde file au bord du lac.",
    extreme: false, danger: false, attraction: 0, radius: 3000, duration: 600, defaultStart: "", closesRoads: false, needs: "place", weather: "soleil",
    keywords: ["canicule", "chaleur", "chaud", "secheresse"],
  },
  blizzard: {
    icon: "🌨️", label: "Épisode neigeux", about: "Fortes chutes de neige, circulation difficile, on reste chez soi.",
    extreme: false, danger: false, attraction: 0, radius: 3000, duration: 480, defaultStart: "", closesRoads: false, needs: "place", weather: "neige",
    keywords: ["neige", "blizzard", "flocon", "verglas"],
  },
  tempete: {
    icon: "⛈️", label: "Orage violent", about: "Vent violent, pluie battante et éclairs : les sorties sont annulées.",
    extreme: false, danger: false, attraction: 0, radius: 3000, duration: 240, defaultStart: "", closesRoads: false, needs: "place", weather: "pluie",
    keywords: ["tempete", "orage", "ouragan", "eclair", "vent violent"],
  },
  panne: {
    icon: "🔌", label: "Panne de courant", about: "Plus d'électricité : fenêtres et lampadaires éteints, commerces fermés.",
    extreme: false, danger: false, attraction: 0, radius: 3000, duration: 180, defaultStart: "", closesRoads: false, needs: "place",
    keywords: ["panne", "electricite", "courant", "blackout", "coupure de courant"],
  },
  inondation: {
    icon: "🌊", label: "Crue", about: "Le Thiou et le lac débordent, les quais bas sont sous l'eau et fermés.",
    extreme: false, danger: true, attraction: 0, radius: 450, duration: 360, defaultStart: "", closesRoads: true, needs: "place", weather: "pluie",
    keywords: ["inond", "crue", "deborde", "submerg"],
  },
  meteorite: {
    icon: "☄️", label: "Chute de météorite", about: "Une météorite s'écrase : cratère, incendie, onde de choc. Les habitants fuient.",
    extreme: true, danger: true, attraction: 0, radius: 220, duration: 240, defaultStart: "", closesRoads: true, needs: "place",
    keywords: ["meteor", "asteroide", "comete"],
  },
  tsunami: {
    icon: "🌊", label: "Tsunami sur le lac", about: "Une vague géante traverse le lac et déferle sur les quais.",
    extreme: true, danger: true, attraction: 0, radius: 650, duration: 150, defaultStart: "", closesRoads: true, needs: "place",
    keywords: ["tsunami", "vague geante", "raz de maree"],
  },
  incendie: {
    icon: "🔥", label: "Incendie", about: "Un bâtiment prend feu, les pompiers bloquent le quartier.",
    extreme: true, danger: true, attraction: 0, radius: 120, duration: 180, defaultStart: "", closesRoads: true, needs: "place",
    keywords: ["incendie", "brule", "flamme", "pompier"],
  },
  seisme: {
    icon: "🫨", label: "Séisme", about: "La terre tremble : panique, les habitants sortent dans les parcs.",
    extreme: true, danger: true, attraction: 0, radius: 2500, duration: 60, defaultStart: "", closesRoads: false, needs: "place",
    keywords: ["seisme", "tremblement", "secousse"],
  },
  ovni: {
    icon: "🛸", label: "Apparition d'un OVNI", about: "Une soucoupe volante plane au-dessus de la ville. Les curieux affluent.",
    extreme: true, danger: false, attraction: 0.25, radius: 150, duration: 120, defaultStart: "", closesRoads: false, needs: "place",
    keywords: ["ovni", "alien", "extraterrestre", "soucoupe"],
  },
};

/** Ce que l'interprète (Claude ou local) propose, avant confirmation. */
export interface EventProposal {
  kind: EventKind;
  /** lieu principal (centre de l'événement) */
  location: string;
  /** rues concernées, noms exacts OpenStreetMap (fermeture, travaux, piétonnisation) */
  streets: string[];
  /** étapes du parcours, lieux ou rues (manifestation, course) */
  route: string[];
  /** 0 = aujourd'hui, 1 = demain… */
  dayOffset: number;
  /** "HH:MM", ou "" pour tout de suite */
  startTime: string;
  /** durée chaque jour, en minutes */
  durationMinutes: number;
  /** nombre de jours consécutifs */
  days: number;
  /** 1 = léger, 2 = moyen, 3 = fort */
  intensity: 1 | 2 | 3;
  title: string;
  description: string;
  /** question de confirmation posée au joueur */
  question: string;
  /** explication si la demande a été rapprochée d'une action voisine ou si une rue n'a pas été trouvée */
  note: string;
  source: "claude" | "local";
}
