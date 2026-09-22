// The games this server deals. Every reader of a game document or a query
// string needs the same thing from it — which of them this is — and anything
// unrecognised is 500, which predates the field and so is what unlabelled
// documents are. Adding a game means adding it to this list.
const GAME_TYPES = ["500", "euchre", "hearts"];
const DEFAULT_GAME_TYPE = "500";

const gameTypeOf = (value) => (GAME_TYPES.includes(value) ? value : DEFAULT_GAME_TYPE);

module.exports = { GAME_TYPES, DEFAULT_GAME_TYPE, gameTypeOf };
