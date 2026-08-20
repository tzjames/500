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

// `photo` is the backdrop photography slot: a URL layers that image under the
// wash and tint, `null` renders the wash alone.
const PLACES = [
  {
    id: "falls",
    name: "Victoria Falls",
    caption: "Victoria Falls — dawn mist, from the eastern cataract",
    photo: "/backdrops/falls.jpg",
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
    photo: "/backdrops/zanzibar.jpg",
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
    // Dusk over a high lake: lavender sky, the last gold along the ridge line,
    // then slate water over pale granite. Same rounded-rectangle table as the
    // Grand Canyon.
    id: "sierras",
    name: "Sierra Nevada",
    caption: "Sierra Nevada — granite and still water at dusk",
    photo: "/backdrops/sierras.jpg",
    shape: "rect",
    dot: "#a9a3c8",
    wash: "linear-gradient(180deg,#59537a,#8f89a6 28%,#d3bd96 54%,#39414f 100%)",
    tint: "linear-gradient(180deg,rgba(70,64,100,.34),rgba(40,45,56,.58))",
    felt: "radial-gradient(58% 62% at 50% 46%, #3f5068, #28323f 66%, rgba(14,18,24,.72))",
    back: "linear-gradient(150deg,#5b6f8c,#28323f)",
  },
  {
    // Sampled off the photograph: blue sky down through the gold band at the
    // horizon into the turquoise shallows, with the headland's dark green
    // closing the bottom.
    id: "samana",
    name: "Samaná",
    caption: "Samaná — sunrise over the bay, from Playa Rincón",
    photo: "/backdrops/samana.jpg",
    shape: "oval",
    dot: "#6fd3d8",
    wash: "linear-gradient(180deg,#14476e,#3781ab 30%,#e5a763 60%,#1c6570 82%,#123f45 100%)",
    tint: "linear-gradient(180deg,rgba(20,71,110,.32),rgba(18,63,69,.58))",
    felt: "radial-gradient(58% 62% at 50% 46%, #1f8189, #11525d 66%, rgba(7,31,37,.72))",
    back: "linear-gradient(150deg,#2f9fae,#10454f)",
  },
  {
    // The photograph is a backlit silhouette — pale sky, dark grass — so this
    // one carries a heavier tint than the others: white UI has nothing to read
    // against up top otherwise.
    id: "serengeti",
    name: "Serengeti",
    caption: "Serengeti — acacia and giraffe, late afternoon haze",
    photo: "/backdrops/serengeti.jpg",
    shape: "oval",
    dot: "#d8b878",
    wash: "linear-gradient(180deg,#6d5c42,#a08765 32%,#7a6246 64%,#332a1e 100%)",
    tint: "linear-gradient(180deg,rgba(44,36,25,.44),rgba(28,23,16,.62))",
    felt: "radial-gradient(58% 62% at 50% 46%, #6b6139, #423b23 66%, rgba(22,19,11,.72))",
    back: "linear-gradient(150deg,#9c7b46,#4a3a1f)",
  },
].map((place) => ({ ...place, group: "Locations" }));

// Each place's palette, minus the photograph — a plain gradient table for when
// you'd rather not play over scenery. Derived from PLACES rather than written
// out again, so a tweak to a location's colours carries to its plain twin and
// the two can't drift apart. They're named for the colour, not the place,
// because without the backdrop that's all they are.
const PLAIN_NAMES = {
  falls: "Teal",
  zanzibar: "Ocean",
  samana: "Turquoise",
  canyon: "Ember",
  sierras: "Slate",
  serengeti: "Ochre",
};

const PLAIN = PLACES.map((place) => ({
  ...place,
  id: `plain-${place.id}`,
  name: PLAIN_NAMES[place.id],
  caption: null,
  photo: null,
  group: "Plain colours",
}));

export const LOCATIONS = [...PLACES, ...PLAIN];

// `art: "image"` decks load a face per card from `path`; `art: "glyph"` decks
// draw the face from the rank and the Unicode suit character. A glyph deck has
// no back image of its own, so it borrows the current location's `back`
// gradient — which is how the deck picker still yields a per-location back.
// `ratio` is the card's height divided by its width. Packs aren't all drawn to
// the same shape, so it travels with the deck rather than being baked into the
// card component — everything that sizes a card reads it.
export const DECKS = [
  {
    id: "scientists",
    name: "Scientists",
    blurb: "Engraved portraits, cream and ink",
    art: "image",
    path: "/cards/scientists",
    back: "/cards/scientists/BACK.jpg",
    ratio: 600 / 399,
  },
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
    ratio: 1400 / 1000,
  },
  {
    id: "classic",
    name: "Classic",
    blurb: "Plain faces, back follows the location",
    art: "glyph",
    path: null,
    back: null,
    ratio: 1400 / 1000,
  },
];

// How much of the felt to draw. Fading or hiding it lets the backdrop through,
// which is the point of having photographs behind the table at all.
export const FELT_MODES = [
  { id: "solid", label: "Table shown", opacity: 1 },
  { id: "faded", label: "Table faded", opacity: 0.5 },
  { id: "hidden", label: "Table hidden", opacity: 0 },
];

// Tables start half-faded — it shows off the backdrop the location was picked
// for while still reading as a table to play on. The cycle order above is
// unchanged, so the button still runs shown -> faded -> hidden.
export const DEFAULT_FELT = "faded";

export const getFeltMode = (id) =>
  FELT_MODES.find((m) => m.id === id) || FELT_MODES[0];

export const nextFeltMode = (id) => {
  const i = FELT_MODES.findIndex((m) => m.id === id);
  return FELT_MODES[(i + 1) % FELT_MODES.length].id;
};

// Packs that belong to particular people rather than to everyone, keyed by
// deck id. A private pack is offered only when the room is exactly those
// players, in any order — mirrored server-side in server/decks.js, which is
// what actually enforces it.
const PRIVATE_TO = { traveller: ["graham", "james"] };

export function deckAllowed(deckId, playerNames = []) {
  const owners = PRIVATE_TO[deckId];
  if (!owners) return true;
  const seated = playerNames
    .filter(Boolean)
    .map((n) => String(n).trim().toLowerCase());
  return (
    seated.length === owners.length &&
    seated.every((s) => owners.includes(s)) &&
    owners.every((o) => seated.includes(o))
  );
}

export const decksFor = (playerNames) =>
  DECKS.filter((d) => deckAllowed(d.id, playerNames));

// Resolve a stored deck id against who's actually playing. A game that had a
// private pack set keeps working for everyone else — it just falls back to the
// default rather than showing them a pack that isn't theirs.
export const resolveDeckId = (deckId, playerNames) =>
  deckAllowed(deckId, playerNames) ? deckId : DEFAULT_DECK;

export const DEFAULT_LOCATION = LOCATIONS[0].id;
// Whatever the picker shows first that isn't private to particular players —
// a private pack can't be the fallback, or the people it excludes would fall
// back onto the very thing they're not allowed.
export const DEFAULT_DECK = (DECKS.find((d) => deckAllowed(d.id, [])) || DECKS[0]).id;

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
export function themeVars(locationId, deckId, feltId) {
  const location = getLocation(locationId);
  const deck = getDeck(deckId);
  const shape = TABLE_SHAPES[location.shape] || TABLE_SHAPES.oval;
  return {
    "--felt-opacity": getFeltMode(feltId).opacity,
    "--wash": location.wash,
    "--tint": location.tint,
    "--felt": location.felt,
    "--card-back": location.back,
    "--theme-dot": location.dot,
    "--felt-radius": shape.borderRadius,
    "--felt-inset": shape.inset,
    "--felt-clip": shape.clipPath || "none",
    "--card-back-image": deck.art === "image" ? `url(${deck.back})` : "none",
    "--card-ratio": deck.ratio || 1.4,
  };
}
