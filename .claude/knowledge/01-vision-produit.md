# Vision produit

## L'idée

Un **simulateur de ville jouable en langage naturel**, sur le centre d'Annecy réel
(extrait d'OpenStreetMap, bbox 45.888–45.930 N / 6.105–6.165 E, origine au Palais de l'Île).
Le joueur est le maire ou un agent municipal. Il tape une phrase en français dans la
barre de commande — « ferme la rue Royale ce week-end », « un festival de musique au
Pâquier samedi » — et la ville réagit, minute par minute, en 3D.

Projet de hackathon : la démonstration vise l'effet « j'écris une phrase, la ville change ».

## La boucle de jeu

1. **Observer** — la ville vit : ~2 550 résidents vaquent à leur journée (domicile, travail,
   courses, lac), les bus Sibra circulent, les parkings se remplissent, le trafic se colore.
2. **Décider** — le joueur écrit une décision. Claude l'interprète en un `EventProposal`
   typé (type d'événement, rues exactes, horaires, fréquentation, décor 3D, modèle 3D
   improvisé si besoin) et pose une **question de confirmation**.
3. **Réagir** — l'événement entre dans le moteur. Les habitants sont regroupés en
   ~16 **cohortes** (profil × quartier) ; Claude décide pour chaque cohorte un ajustement
   de comportement (décalage des départs, report modal, évitement de la zone,
   participation, humeur, citation à la première personne) que le moteur applique
   individuellement avec variabilité.
4. **Mesurer** — panneau d'impact comparant « maintenant » à « la même heure sans
   l'événement » : congestion, parts modales, parkings, CA de la zone, satisfaction.
5. **Conclure** — à la clôture de l'événement, un **bilan** chiffré (fréquentation,
   billetterie, dépenses, CA commerçant, km voiture, CO₂, plaintes) rédigé par Claude.
   Et chaque minuit, un `DayReport`.

## Ce qui donne vie à la scène

- **Voix de la ville** : un fil de pensées (`Thought`) remontées des habitants, avec
  porte-parole de cohorte, affichées aussi en bulles 3D au-dessus des personnages.
- **Fiche habitant** : clic sur une personne → nom, âge, CSP, foyer, revenu, besoins,
  planning du jour, pensées récentes. Les habitants sont générés d'après les cibles
  **INSEE réelles** d'Annecy (pyramide des âges, CSP, frontaliers, temps partiel,
  taille des ménages, motorisation, revenus — `src/sim/demographics.ts`).
- **Scénarios extrêmes** (interrupteur) : météorite, tsunami, séisme, incendie, OVNI,
  avec panique et fuite des habitants. Hors interrupteur, Claude refuse le fantastique.
- **Intro cinématique** : carte plate vue du ciel, puis plongée et élévation des bâtiments.

## Textes

Tout ce que voit le joueur est en **français** (tutoiement dans les questions de
confirmation). Les identifiants techniques restent en anglais.
