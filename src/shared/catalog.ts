// Catalogue des événements que l'on peut déclencher en langage naturel.
// Partagé par le serveur (prompt de Claude, interpréteur local) et la simulation.

export const EVENT_KINDS = [
  // gestion urbaine (par défaut)
  "fermeture", "travaux", "pietonnisation", "manifestation", "marathon", "greve", "marche", "brocante", "concert",
  "festival", "pique_nique", "feu_artifice", "accident", "canicule", "blizzard", "tempete", "panne", "inondation",
  // grands rassemblements festifs
  "festival_musique", "fete_musique", "fete_foraine", "marche_noel", "cinema_plein_air", "salon", "carnaval", "competition",
  // n'importe quel autre événement, décrit par ses caractéristiques
  "evenement",
  // scénarios extrêmes (interrupteur)
  "meteorite", "tsunami", "incendie", "seisme", "ovni",
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

/** Éléments de décor 3D que l'on peut installer pour un événement. */
export const PROPS = [
  "scene", "ecran", "tentes", "stands", "foodtrucks", "bar", "barrieres", "grande_roue", "manege",
  "chalets", "tribunes", "arche", "podium", "drapeaux", "guirlandes", "toilettes",
] as const;
export type Prop = (typeof PROPS)[number];

export const PROP_LABEL: Record<Prop, string> = {
  scene: "🎤 grande scène", ecran: "📺 écran géant", tentes: "⛺ tentes", stands: "🧺 stands", foodtrucks: "🚚 food trucks",
  bar: "🍺 buvette", barrieres: "🚧 barrières", grande_roue: "🎡 grande roue", manege: "🎠 manège", chalets: "🏠 chalets",
  tribunes: "🏟️ tribunes", arche: "🏁 arche", podium: "🏆 podium", drapeaux: "🚩 drapeaux", guirlandes: "✨ guirlandes", toilettes: "🚻 toilettes",
};

export type Audience = "tous" | "jeunes" | "familles" | "seniors";

/**
 * Modèle 3D composé par Claude pour tout ce qui n'a pas de décor prévu (un dragon, un canard géant…) :
 * des primitives assemblées, un mouvement et des effets.
 */
export const SHAPES = ["box", "sphere", "cylinder", "cone", "torus"] as const;
export const MOTIONS = ["fixe", "flotte", "tourne", "orbite", "pulse"] as const;
export const EFFECTS = ["feu", "fumee", "lumiere", "etincelles"] as const;
export interface ModelPart {
  shape: (typeof SHAPES)[number];
  /** position du centre en m (y vers le haut), taille et rotation (degrés) */
  x: number; y: number; z: number;
  sx: number; sy: number; sz: number;
  rx: number; ry: number; rz: number;
  color: string;
  /** lueur propre, 0..1 */
  glow: number;
}
/** Objet de la banque de modèles 3D placé sur le lieu de l'événement. */
export const PLACEMENTS = ["centre", "cercle", "ligne", "disperse", "ciel", "lac"] as const;
export interface AssetPlacement {
  /** identifiant dans la banque (public/assets/index.json), vide si introuvable */
  id: string;
  /** ce que Claude cherchait (pour le repli) */
  query: string;
  count: number;
  /** plus grande dimension souhaitée, en m (taille réelle) */
  size: number;
  placement: (typeof PLACEMENTS)[number];
  motion: (typeof MOTIONS)[number];
  /** altitude pour ce qui vole, en m */
  altitude: number;
}

export interface EventModel {
  parts: ModelPart[];
  motion: (typeof MOTIONS)[number];
  /** altitude du modèle (m) et rayon de l'orbite (m) */
  altitude: number;
  orbit: number;
  effects: (typeof EFFECTS)[number][];
}

/** Nature d'un événement libre : elle détermine comment la ville réagit. */
export const NATURES = ["festif", "culturel", "sportif", "commercial", "civique", "perturbation", "danger"] as const;
export type Nature = (typeof NATURES)[number];

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
  /** fréquentation attendue par jour (personnes), 0 = sans objet */
  attendance?: number;
  /** part des visiteurs venus de l'extérieur d'Annecy */
  outsiders?: number;
  /** prix d'entrée par défaut, en € */
  ticket?: number;
  /** dépense moyenne sur place (boissons, restauration), en € */
  spend?: number;
  /** décor installé par défaut */
  setup?: Prop[];
  audience?: Audience;
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
  festival_musique: {
    icon: "🎸", label: "Festival de musique", about: "Grand festival en plein air (type Musilac) : grande scène, écrans, food trucks, buvettes ; des milliers de spectateurs, dont beaucoup viennent de loin.",
    extreme: false, danger: false, attraction: 0.08, radius: 160, duration: 420, defaultStart: "17:00", closesRoads: false, needs: "place",
    keywords: ["musilac", "festival de musique", "festival rock", "festival electro", "open air", "line-up"],
    attendance: 20000, outsiders: 0.65, ticket: 59, spend: 28, audience: "jeunes",
    setup: ["scene", "ecran", "foodtrucks", "bar", "tentes", "barrieres", "toilettes", "drapeaux"],
  },
  fete_musique: {
    icon: "🎶", label: "Fête de la musique", about: "Scènes gratuites en ville, foule dense en soirée, bars et terrasses pleins.",
    extreme: false, danger: false, attraction: 0.12, radius: 120, duration: 360, defaultStart: "18:00", closesRoads: false, needs: "place",
    keywords: ["fete de la musique", "21 juin"], attendance: 8000, outsiders: 0.25, ticket: 0, spend: 15, audience: "tous",
    setup: ["podium", "bar", "foodtrucks", "guirlandes"],
  },
  fete_foraine: {
    icon: "🎡", label: "Fête foraine", about: "Manèges, grande roue, stands de confiseries ; familles et adolescents.",
    extreme: false, danger: false, attraction: 0.06, radius: 120, duration: 540, defaultStart: "14:00", closesRoads: false, needs: "place",
    keywords: ["fete foraine", "grande roue", "manege", "vogue", "foire"], attendance: 6000, outsiders: 0.3, ticket: 0, spend: 18, audience: "familles",
    setup: ["grande_roue", "manege", "stands", "foodtrucks", "guirlandes"],
  },
  marche_noel: {
    icon: "🎄", label: "Marché de Noël", about: "Chalets en bois, vin chaud, illuminations ; touristes et familles en fin de journée.",
    extreme: false, danger: false, attraction: 0.07, radius: 90, duration: 600, defaultStart: "11:00", closesRoads: false, needs: "place",
    keywords: ["marche de noel", "noel", "vin chaud", "chalets"], attendance: 5000, outsiders: 0.4, ticket: 0, spend: 22, audience: "familles",
    setup: ["chalets", "guirlandes", "bar"],
  },
  cinema_plein_air: {
    icon: "🎬", label: "Cinéma en plein air", about: "Projection sur écran géant à la tombée de la nuit, transats sur l'herbe.",
    extreme: false, danger: false, attraction: 0.05, radius: 80, duration: 180, defaultStart: "20:30", closesRoads: false, needs: "place",
    keywords: ["cinema plein air", "projection", "ecran geant", "film en plein air"], attendance: 2500, outsiders: 0.1, ticket: 0, spend: 6, audience: "tous",
    setup: ["ecran", "foodtrucks"],
  },
  salon: {
    icon: "🏛️", label: "Salon / foire exposition", about: "Salon sous chapiteaux (gastronomie, artisanat, emploi…) : exposants et visiteurs en journée.",
    extreme: false, danger: false, attraction: 0.04, radius: 100, duration: 540, defaultStart: "09:30", closesRoads: false, needs: "place",
    keywords: ["salon", "foire", "exposition", "expo", "exposants"], attendance: 4000, outsiders: 0.45, ticket: 8, spend: 30, audience: "tous",
    setup: ["tentes", "stands", "drapeaux", "foodtrucks"],
  },
  carnaval: {
    icon: "🎭", label: "Carnaval / défilé", about: "Défilé costumé avec chars sur un parcours ; rues fermées au passage, spectateurs sur les trottoirs.",
    extreme: false, danger: false, attraction: 0.08, radius: 100, duration: 180, defaultStart: "14:30", closesRoads: true, needs: "route",
    keywords: ["carnaval", "defile", "parade", "chars", "fete venitienne"], attendance: 8000, outsiders: 0.3, ticket: 0, spend: 10, audience: "familles",
  },
  competition: {
    icon: "🏆", label: "Compétition sportive", about: "Tournoi ou compétition avec tribunes, podium et arche d'arrivée.",
    extreme: false, danger: false, attraction: 0.04, radius: 100, duration: 360, defaultStart: "10:00", closesRoads: false, needs: "place",
    keywords: ["tournoi", "competition", "championnat", "match", "triathlon", "regate"], attendance: 3000, outsiders: 0.4, ticket: 5, spend: 12, audience: "tous",
    setup: ["tribunes", "podium", "arche", "drapeaux", "foodtrucks", "barrieres"],
  },
  evenement: {
    icon: "📍", label: "Événement", about: "N'importe quel autre événement, décrit par sa nature, sa fréquentation, son décor, les rues fermées ou son parcours.",
    extreme: false, danger: false, attraction: 0.04, radius: 100, duration: 240, defaultStart: "", closesRoads: false, needs: "place",
    keywords: [], attendance: 0, outsiders: 0.3, ticket: 0, spend: 10, audience: "tous", setup: [],
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
  /** fréquentation attendue par jour (personnes) ; 0 = sans objet */
  attendance: number;
  /** prix d'entrée en € (0 = gratuit) */
  ticketPrice: number;
  /** décor installé */
  setup: Prop[];
  audience: Audience;
  /** navettes gratuites depuis la gare et les parkings relais */
  shuttles: boolean;
  /** caractéristiques propres (surtout pour un événement libre) ; vides = celles du type */
  icon: string;
  label: string;
  nature: Nature | "";
  /** les habitants fuient la zone */
  danger: boolean;
  /** ferme aux voitures les rues listées, le parcours ou la zone */
  closesRoads: boolean;
  /** effet sur l'humeur des riverains, -2 (nuisance forte) à +2 (très apprécié) */
  mood: number;
  /** modèle 3D sur mesure, ou null */
  model: EventModel | null;
  /** objets de la banque de modèles à montrer sur place */
  assets: AssetPlacement[];
  source: "claude" | "local";
}

/** Comportement résolu d'un événement : celui du type, ajusté par les paramètres de la proposition. */
export interface EventTraits {
  icon: string;
  label: string;
  nature: Nature;
  attraction: number;
  danger: boolean;
  closesRoads: boolean;
  needs: EventSpec["needs"];
  mood: number;
  attendance: number;
  outsiders: number;
  ticket: number;
  spend: number;
  setup: Prop[];
  audience: Audience;
  shuttles: boolean;
  model: EventModel | null;
  assets: AssetPlacement[];
}

const NATURE_OF: Partial<Record<EventKind, Nature>> = {
  fermeture: "perturbation", travaux: "perturbation", accident: "perturbation", greve: "perturbation", panne: "perturbation",
  canicule: "perturbation", blizzard: "perturbation", tempete: "perturbation", pietonnisation: "civique", manifestation: "civique",
  marathon: "sportif", competition: "sportif", concert: "culturel", cinema_plein_air: "culturel", festival: "festif",
  festival_musique: "festif", fete_musique: "festif", fete_foraine: "festif", feu_artifice: "festif", pique_nique: "festif",
  carnaval: "festif", marche: "commercial", brocante: "commercial", marche_noel: "commercial", salon: "commercial",
  inondation: "danger", meteorite: "danger", tsunami: "danger", incendie: "danger", seisme: "danger", ovni: "festif",
};

/** Part des habitants disponibles attirés, selon la nature, pour un événement libre. */
const NATURE_ATTRACTION: Record<Nature, number> = {
  festif: 0.08, culturel: 0.05, sportif: 0.05, commercial: 0.06, civique: 0.04, perturbation: 0, danger: 0,
};

export function traitsOf(p: Pick<EventProposal, "kind" | "attendance" | "ticketPrice" | "setup" | "audience" | "shuttles" | "icon" | "label" | "nature" | "danger" | "closesRoads" | "mood" | "route" | "streets" | "model" | "assets">): EventTraits {
  const spec = EVENT_SPECS[p.kind];
  const nature = (p.nature || NATURE_OF[p.kind] || "festif") as Nature;
  const free = p.kind === "evenement";
  const needs: EventSpec["needs"] = free ? (p.route.length >= 2 ? "route" : p.streets.length && p.closesRoads ? "streets" : "place") : spec.needs;
  const attendance = p.attendance > 0 ? p.attendance : spec.attendance ?? 0;
  return {
    icon: p.icon || spec.icon,
    label: p.label || spec.label,
    nature,
    // un événement qui annonce du monde attire, même s'il n'est pas « festif »
    attraction: free ? (attendance > 0 ? Math.max(0.02, NATURE_ATTRACTION[nature]) : NATURE_ATTRACTION[nature]) : spec.attraction,
    danger: free ? p.danger || nature === "danger" : spec.danger,
    closesRoads: free ? p.closesRoads : spec.closesRoads || (p.closesRoads && p.streets.length > 0),
    needs,
    mood: Number.isFinite(p.mood) ? Math.max(-2, Math.min(2, p.mood)) : 0,
    attendance,
    outsiders: spec.outsiders ?? 0.3,
    ticket: p.ticketPrice >= 0 ? p.ticketPrice : spec.ticket ?? 0,
    spend: spec.spend ?? 10,
    setup: p.setup.length ? p.setup.filter((x) => (PROPS as readonly string[]).includes(x)) : spec.setup ?? [],
    audience: p.audience || spec.audience || "tous",
    shuttles: !!p.shuttles,
    model: p.model?.parts?.length ? p.model : null,
    assets: (p.assets ?? []).filter((a) => a.id),
  };
}

/** Valeurs par défaut des paramètres pour un type donné (interpréteur local, compléments). */
export function defaultParams(kind: EventKind) {
  const spec = EVENT_SPECS[kind];
  return {
    attendance: spec.attendance ?? 0, ticketPrice: spec.ticket ?? 0, setup: spec.setup ?? [], audience: spec.audience ?? "tous" as Audience,
    shuttles: false, icon: "", label: "", nature: "" as const, danger: spec.danger, closesRoads: spec.closesRoads, mood: 0, model: null, assets: [] as AssetPlacement[],
  };
}

/** Défilé qui avance sur son parcours (cortège, carnaval…) plutôt qu'une course qui boucle. */
export function isProcession(kind: EventKind, nature: Nature): boolean {
  return kind === "manifestation" || kind === "carnaval" || (kind === "evenement" && nature !== "sportif");
}
