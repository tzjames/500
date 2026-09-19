// Mirrors of the client's theme registry (src/theme.js), kept here only to
// reject junk before it reaches the shared, persisted gameSettings — a value
// off this list would render as an unstyled table for everyone at it.
const { DECK_IDS, DEFAULT_DECK, deckAllowed } = require("./decks");

const PUBLIC_LOCATION_IDS = [
  "falls",
  "zanzibar",
  "samana",
  "canyon",
  "sierras",
  "serengeti",
  // The same palettes without their backdrop photograph.
  "plain-falls",
  "plain-zanzibar",
  "plain-samana",
  "plain-canyon",
  "plain-sierras",
  "plain-serengeti",
];

// Backdrops private to particular people, offered when any one of them is at
// the table, alongside whoever else — the same rule private packs use, in
// decks.js. Mirrors MZUMBE in src/theme.js.
const PRIVATE_LOCATION_IDS = [
  "mzumbe-road",
  "mzumbe-ridge",
  "mzumbe-valley",
  "mzumbe-peaks",
  "mzumbe-quad",
  "mzumbe-common-room",
];
const MZUMBE_OWNERS = ["graham", "james"];

const LOCATION_IDS = [...PUBLIC_LOCATION_IDS, ...PRIVATE_LOCATION_IDS];

const normalise = (name) => String(name || "").trim().toLowerCase();

function locationAllowed(locationId, playerNames = []) {
  if (!PRIVATE_LOCATION_IDS.includes(locationId)) return true;
  return playerNames.filter(Boolean).some((n) => MZUMBE_OWNERS.includes(normalise(n)));
}

const FELT_IDS = ["solid", "faded", "hidden"];

const DEFAULT_TABLE_THEME = { location: "falls", deck: DEFAULT_DECK, felt: "faded" };

// Whichever of the three a client sent that is real, over what the table had.
// Some packs and backdrops belong to particular people (see decks.js and
// PRIVATE_LOCATION_IDS), so who is seated matters.
function applyTableTheme(current, settings = {}, playerNames = []) {
  const next = { ...current };
  if (LOCATION_IDS.includes(settings.location) && locationAllowed(settings.location, playerNames))
    next.location = settings.location;
  if (DECK_IDS.includes(settings.deck) && deckAllowed(settings.deck, playerNames)) next.deck = settings.deck;
  if (FELT_IDS.includes(settings.felt)) next.felt = settings.felt;
  return next;
}

module.exports = { LOCATION_IDS, PRIVATE_LOCATION_IDS, FELT_IDS, DECK_IDS, DEFAULT_DECK,
  DEFAULT_TABLE_THEME, applyTableTheme, locationAllowed };
