// The games this site deals. `/` is a chooser built from this list and each
// game has its own page below it, so adding a game means adding an entry here
// and a room page for it — the chooser, the routes, the nav links, the stats
// tabs and the new-game screen all read this rather than naming games
// themselves.
//
// Everything below a game's hero — the lobby, your record, your games — is the
// same machinery either way, so it is shared; the identity, the copy, the rule
// sets and what a table size is called are not.
//
// Each game's name, path and prose come from siteContent.json, which the server
// reads as well, so the HTML it prerenders for crawlers carries the same words
// this page renders — see server/seo.js.
import siteContent from "./siteContent.json";
import * as euchre from "./euchreOptions";
import * as hearts from "./heartsOptions";
import {
  definitions as fiveHundredDefinitions,
  defaultOptions as fiveHundredDefaults,
  withDefaults as fiveHundredWithDefaults,
  changedOptionLabels as fiveHundredRules,
} from "./gameOptions";

const seatWord = {
  2: "Two", 3: "Three", 4: "Four", 5: "Five", 6: "Six",
  7: "Seven", 8: "Eight", 9: "Nine", 10: "Ten", 11: "Eleven",
};

// A game whose tables are a rule set plus a size, for the screens that offer
// the choice. 500 has no rule sets, so it answers the same questions with a
// fixed list and one set of house rules.
const variantRules = (module, seatNote) => ({
  variants: module.VARIANTS,
  getVariant: module.getVariant,
  variantLabel: (id) => module.getVariant(id).label,
  defaultOptions: module.defaultOptions,
  withDefaults: module.withDefaults,
  definitionsFor: module.definitionsFor,
  housed: () => true,
  seatNote,
});

export const GAMES = [
  {
    id: "500",
    ...siteContent.games["500"],
    statsPath: "/500/stats",
    taglines: [
      "Bid it, take it, make it",
      "The kitty is where hands are won",
      "Ten for a trick, and everything for the contract",
      "Somebody has to bid",
    ],
    modes: [2, 4],
    rules: {
      variants: null,
      variantLabel: () => null,
      definitionsFor: () => fiveHundredDefinitions,
      defaultOptions: fiveHundredDefaults,
      withDefaults: fiveHundredWithDefaults,
      // Only the four-player game has ever had house rules to offer.
      housed: (mode) => mode === 4,
      seatNote: (spec, count) =>
        count === 2 ? "Two-handed, each playing a dummy" : "Two partnerships, the standard game",
    },
    // Only the four-player game has ever had house rules to advertise.
    tableRules: (table) => (table.mode === 4 ? fiveHundredRules(table.options) : []),
    emptyGames: "No 500 games yet — start one above.",
  },
  {
    id: "euchre",
    ...siteContent.games.euchre,
    statsPath: "/euchre/stats",
    taglines: [
      "Order it up",
      "Right bower, left bower, and the rest is nerve",
      "Alone, if you're feeling it",
      "Six ways to play it, all of them right",
      "Nothing but nines? Declare a farmer's hand",
    ],
    // Every rule set's own table sizes, collapsed — the variant picker narrows
    // this down again as soon as one is chosen.
    modes: [...new Set(euchre.VARIANTS.flatMap((v) => v.modes))].sort((a, b) => a - b),
    rules: variantRules(euchre, (spec, count) =>
      count === 4 && spec.teams ? "Two partnerships sitting opposite" : "Everyone for themselves, one score each"
    ),
    tableRules: (table) => euchre.changedOptionLabels(table.options, table.variant || "northAmerican"),
    emptyGames: "No Euchre games yet — start one above.",
  },
  {
    id: "hearts",
    ...siteContent.games.hearts,
    statsPath: "/hearts/stats",
    taglines: [
      "Duck everything",
      "Somebody has the queen",
      "Lowest score wins, which takes some getting used to",
      "Shoot the moon, or don't",
      "Sixteen ways to lose a trick on purpose",
    ],
    modes: [...new Set(hearts.VARIANTS.flatMap((v) => v.modes))].sort((a, b) => a - b),
    rules: variantRules(hearts, (spec, count) =>
      count === 4 && spec.teams ? "Two partnerships sitting opposite" : "Everyone for themselves, one score each"
    ),
    tableRules: (table) => hearts.changedOptionLabels(table.options, table.variant || "blackLady"),
    emptyGames: "No Hearts games yet — start one above.",
  },
];

const byId = Object.fromEntries(GAMES.map((game) => [game.id, game]));

export const getGame = (id) => byId[id] || GAMES[0];

// One is picked per visit. Site-wide rather than any one game's, since the
// chooser is where they are read.
export const SITE_TAGLINES = [
  "Play with friends or with yourself",
  "Win tricks and influence people",
  "Trick based card games",
  "Honest trick based card games",
  "Our cards are a lot less sticky",
  "Now with less sticky cards!",
  "Tricky games, sticky people",
  "because no one wants to deal",
];

export const seatLabel = (mode) => seatWord[mode] || `${mode}`;
export const seatsLabel = (mode) => `${seatLabel(mode)} player${mode === 1 ? "" : "s"}`;
// "a four-player game", as against "four players" sitting at it.
export const tableAdjective = (mode) => `${seatLabel(mode).toLowerCase()}-player`;
