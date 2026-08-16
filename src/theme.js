// Table theming: where you're playing (backdrop, felt, table silhouette) and
// what you're playing with (card faces and backs). The two are independent
// pickers, and both are room-wide settings synced through the server — see
// `gameSettings` in server/room.js — so both players always see the same table.
//
// Everything here is data. Adding a location or a deck means adding one entry,
// never a new branch: consumers read these objects and nothing else.

// The felt silhouette. Applied to the felt element inside the tilted plane, so
// the shapes are expressed in that element's own coordinate space.
export const TABLE_SHAPES = {
  oval: { borderRadius: "50% / 50%", inset: "0" },
  round: { borderRadius: "50%", inset: "0 280px" },
  rect: { borderRadius: "54px", inset: "40px 60px" },
  hex: {
    borderRadius: "0",
    inset: "0",
    clipPath: "polygon(16% 0, 84% 0, 100% 50%, 84% 100%, 16% 100%, 0 50%)",
  },
};

// `photo` is the backdrop photography slot. No shots have been supplied yet, so
// every location currently renders its `wash` gradient alone; setting `photo` to
// a URL layers the image under the wash without any other change.
export const LOCATIONS = [
  {
    id: "falls",
    name: "Victoria Falls",
    caption: "Victoria Falls — dawn mist, from the eastern cataract",
    photo: null,
    shape: "oval",
    dot: "#7fd6c1",
    wash: "linear-gradient(180deg,#0f2c34,#1d4e4c 45%,#2f6d5c 74%,#0f2b29)",
    tint: "linear-gradient(180deg,rgba(15,44,52,.35),rgba(15,43,41,.55))",
    felt: "radial-gradient(58% 62% at 50% 46%, #1e5a4f, #123a36 66%, rgba(9,24,24,.72))",
    back: "linear-gradient(150deg,#2b7d6c,#12403c)",
  },
  {
    id: "zanzibar",
    name: "Zanzibar Beach",
    caption: "Zanzibar — low tide at Nungwi, late afternoon",
    photo: null,
    shape: "round",
    dot: "#7fc7e8",
    wash: "linear-gradient(180deg,#123a5e,#2f6f95 32%,#79b2c4 58%,#d9c49c 100%)",
    tint: "linear-gradient(180deg,rgba(18,58,94,.34),rgba(18,58,94,.6))",
    felt: "radial-gradient(58% 62% at 50% 46%, #1d6f7a, #124450 66%, rgba(8,26,32,.72))",
    back: "linear-gradient(150deg,#2f8fa6,#123f4e)",
  },
  {
    id: "canyon",
    name: "Grand Canyon Rim",
    caption: "Grand Canyon — south rim, twenty minutes before sunset",
    photo: "/backdrops/canyon.jpg",
    shape: "rect",
    dot: "#e0a072",
    wash: "linear-gradient(180deg,#28183a,#4e2742 30%,#8d4636 62%,#3a1d20 100%)",
    tint: "linear-gradient(180deg,rgba(40,24,58,.34),rgba(58,29,32,.58))",
    felt: "radial-gradient(58% 62% at 50% 46%, #6b3a2f, #3a1f1e 66%, rgba(26,12,12,.72))",
    back: "linear-gradient(150deg,#a35a3c,#4a231f)",
  },
  {
    id: "kyoto",
    name: "Kyoto Garden",
    caption: "Kyoto — moss garden after rain, maples turning",
    photo: null,
    shape: "hex",
    dot: "#c9a6c8",
    wash: "linear-gradient(180deg,#1a2430,#2c3f3c 38%,#4a5a44 68%,#1b2320 100%)",
    tint: "linear-gradient(180deg,rgba(26,36,48,.34),rgba(27,35,32,.58))",
    felt: "radial-gradient(58% 62% at 50% 46%, #3b4a3a, #232e26 66%, rgba(12,18,14,.72))",
    back: "linear-gradient(150deg,#6a5470,#2c2233)",
  },
];

// `art: "image"` decks load a face per card from `path`; `art: "glyph"` decks
// draw the face from the rank and the Unicode suit character. A glyph deck has
// no back image of its own, so it borrows the current location's `back`
// gradient — which is how the deck picker still yields a per-location back.
export const DECKS = [
  {
    // The id stays "traveller" even though the deck is now called "Travelers" —
    // it's the value persisted in every saved game's gameSettings, so renaming
    // it would silently reset existing games to the default deck.
    id: "traveller",
    name: "Travelers",
    blurb: "Labrador courts, navy and gold",
    art: "image",
    path: "/cards/traveller",
    back: "/cards/traveller/BACK.jpg",
  },
  {
    id: "classic",
    name: "Classic",
    blurb: "Plain faces, back follows the location",
    art: "glyph",
    path: null,
    back: null,
  },
];

export const DEFAULT_LOCATION = LOCATIONS[0].id;
export const DEFAULT_DECK = DECKS[0].id;

export const getLocation = (id) =>
  LOCATIONS.find((l) => l.id === id) || LOCATIONS[0];
export const getDeck = (id) => DECKS.find((d) => d.id === id) || DECKS[0];

// "Surprise me" — always a different location than the one showing, so the
// pick always visibly does something.
export function randomLocationId(currentId) {
  const others = LOCATIONS.filter((l) => l.id !== currentId);
  const pool = others.length > 0 ? others : LOCATIONS;
  return pool[Math.floor(Math.random() * pool.length)].id;
}

const SUIT_LETTER = { "♠": "S", "♥": "H", "♦": "D", "♣": "C" };

// Card art is named <rank><suit>.jpg — AS, 10H, QC — with the Joker and the
// back as JOKER and BACK. Returns null for glyph decks, whose faces are drawn.
export function cardImageUrl(card, deck) {
  if (deck.art !== "image") return null;
  if (card.suit === "Joker") return `${deck.path}/JOKER.jpg`;
  const letter = SUIT_LETTER[card.suit];
  if (!letter) return null;
  return `${deck.path}/${card.value}${letter}.jpg`;
}

export function cardBackUrl(deck) {
  return deck.art === "image" ? deck.back : null;
}

// The CSS custom properties every themed surface reads. Spread onto the style
// of a wrapper element; children reference them by name and never touch the
// theme objects directly.
export function themeVars(locationId, deckId) {
  const location = getLocation(locationId);
  const deck = getDeck(deckId);
  const shape = TABLE_SHAPES[location.shape] || TABLE_SHAPES.oval;
  return {
    "--wash": location.wash,
    "--tint": location.tint,
    "--felt": location.felt,
    "--card-back": location.back,
    "--theme-dot": location.dot,
    "--felt-radius": shape.borderRadius,
    "--felt-inset": shape.inset,
    "--felt-clip": shape.clipPath || "none",
    "--card-back-image": deck.art === "image" ? `url(${deck.back})` : "none",
  };
}
