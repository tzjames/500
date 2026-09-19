// Which card packs a room may use. Mirrors the DECKS list in src/theme.js,
// and is required by both room.js and room4.js so the two sizes of game can't
// drift apart on what's allowed.

const DECK_IDS = ["scientists", "traveller", "classic"];

// Packs that belong to particular people rather than to everyone. A private
// pack is offered when any one of its owners is at the table, alongside
// whoever else — the same rule the private backdrops use in tableTheme.js.
const PRIVATE_TO = { traveller: ["graham", "james"] };

const normalise = (name) => String(name || "").trim().toLowerCase();

function deckAllowed(deckId, playerNames = []) {
  const owners = PRIVATE_TO[deckId];
  return !owners || playerNames.filter(Boolean).some((n) => owners.includes(normalise(n)));
}

// The fallback pack has to be one anybody can use, so it's derived rather
// than named: the first pack in display order that isn't private to someone.
const DEFAULT_DECK = DECK_IDS.find((id) => !PRIVATE_TO[id]);

module.exports = { DECK_IDS, PRIVATE_TO, DEFAULT_DECK, deckAllowed };
