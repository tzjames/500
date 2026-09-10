// The games this site deals. `/` is a chooser built from this list and each
// game has its own page below it, so adding a game means adding an entry here
// and a room page for it — the chooser, the routes, the nav links and the stats
// tabs all read this rather than naming games themselves.
//
// Everything below a game's hero — the lobby, your record, your games — is the
// same machinery either way, so it is shared; the identity, the copy and what a
// table size is called are not.
import { VARIANTS } from "./euchreOptions";
import { changedOptionLabels as fiveHundredRules } from "./gameOptions";
import { changedOptionLabels as euchreRules } from "./euchreOptions";

const seatWord = { 2: "Two", 3: "Three", 4: "Four" };

export const GAMES = [
  {
    id: "500",
    name: "500",
    path: "/500",
    statsPath: "/500/stats",
    kicker: "Ten tricks, a kitty and a joker",
    blurb:
      "The Australian national card game. Bid for the contract, take the kitty, and make the tricks you promised — two-handed with a dummy each, or four in partnerships.",
    about: [
      "Ten cards each from a 43-card pack, an auction that runs from six tricks to ten, and three cards in the kitty for whoever wins it. Bid what you think you can make, take the kitty and throw three back, name your trumps, and bring it home — miss it and you lose what you bid.",
      "Above the ace of trumps sit the Joker and both bowers, which is the part everyone learns the hard way. Play four in partnerships, or two-handed where each of you plays a dummy as a second seat. First side to 500 wins, and falling to −500 goes out the back door.",
    ],
    taglines: [
      "Bid it, take it, make it",
      "The kitty is where hands are won",
      "Ten for a trick, and everything for the contract",
      "Somebody has to bid",
    ],
    modes: [2, 4],
    // Only the four-player game has ever had house rules to advertise.
    tableRules: (table) => (table.mode === 4 ? fiveHundredRules(table.options) : []),
    emptyGames: "No 500 games yet — start one above.",
  },
  {
    id: "euchre",
    name: "Euchre",
    path: "/euchre",
    statsPath: "/euchre/stats",
    kicker: "Five cards, two bowers, ten points",
    blurb:
      "Short, sharp hands off a small pack: order up the turned card or name your own, then take three of the five. Six rule sets, from the 1844 original to Bid Euchre and Set-Back.",
    about: [
      "A small pack and a five-card hand, so a game is a run of quick decisions rather than one long one. A card is turned for trump: order it up and the dealer takes it into hand, or pass and let somebody name a suit of their own. Make three of the five tricks and you score; fail and you are euchred.",
      "Six rule sets here — the 1844 original, the North American standard, the British game with its Benny, three-handed, Bid Euchre's auction and Set-Back's race down from five — and the variations the rules picked up along the way as house rules: stick the dealer, farmer's hand, defending alone, and the rest.",
    ],
    taglines: [
      "Order it up",
      "Right bower, left bower, and the rest is nerve",
      "Alone, if you're feeling it",
      "Six ways to play it, all of them right",
      "Nothing but nines? Declare a farmer's hand",
    ],
    // Every rule set's own table sizes, collapsed — the variant picker narrows
    // this down again as soon as one is chosen.
    modes: [...new Set(VARIANTS.flatMap((v) => v.modes))].sort(),
    tableRules: (table) => euchreRules(table.options, table.variant || "northAmerican"),
    emptyGames: "No Euchre games yet — start one above.",
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
