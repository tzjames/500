// What room4.js actually asks for a move. Either the trained policy or, if
// there isn't one, the rules of thumb in bot.js.
//
// The two present the same four functions with the same signatures, so the room
// doesn't know or care which it is talking to — and a deploy with no model file
// behaves exactly as it did before the model existed. That's deliberate: the
// fallback is what makes shipping this safe before any training has been done.
//
// The sequential decisions are unrolled here the same way ai/harness.js unrolls
// them for training. A network that learnt to throw three cards one at a time
// has to be asked for them one at a time.
const path = require("node:path");

const bot = require("./bot");
const { loadNet } = require("./net");
const {
  ACTION_COUNT,
  OBS_SIZE,
  decodeAction,
  encodeObservation,
  legalActionMask,
} = require("./obs");

const MODEL_PATH =
  process.env.BOT_MODEL_PATH || path.join(__dirname, "models", "bot.json");

let net = null;
try {
  // The dimensions are checked against this server's own encoder, so a model
  // exported before obs.js last changed is rejected here rather than quietly
  // reading past the end of every observation it's given.
  net = loadNet(MODEL_PATH, { obsSize: OBS_SIZE, actionCount: ACTION_COUNT });
  if (net) console.log(`bot policy: trained model from ${MODEL_PATH}`);
  else console.log("bot policy: no model file, using the built-in heuristics");
} catch (err) {
  // A model that won't load is worth shouting about, but not worth refusing to
  // start over — the heuristics are still a playable opponent.
  console.error(`bot policy: ${MODEL_PATH} failed to load, falling back`, err);
  net = null;
}

const sameCard = (a, b) => a.suit === b.suit && a.value === b.value;

const choose = (game, seat, context) =>
  decodeAction(net.best(encodeObservation(game, seat, context), legalActionMask(game, seat, context)));

// Picks `needed` cards one at a time, exactly as the trainer asked for them.
// Returns both halves, since the discard wants what's left and the Double Nullo
// exchange wants what was taken.
function pickCards(game, seat, kind, needed) {
  const pool = [...game.players[seat].hand];
  const chosen = [];
  for (let pick = 0; pick < needed; pick++) {
    const { card } = choose(game, seat, {
      kind,
      pool,
      chosen,
      picksRemaining: needed - pick,
    });
    const index = pool.findIndex((held) => sameCard(held, card));
    if (index === -1) throw new Error(`the model picked ${card.value}${card.suit}, which isn't in the pool`);
    chosen.push(pool.splice(index, 1)[0]);
  }
  return { chosen, rest: pool };
}

// Every decision falls back to the heuristics if the model can't make it.
//
// room4.js catches what runBotTurn throws, but it has already cleared the timer
// that would ask again — so an exception in here doesn't just lose a move, it
// leaves the hand with a bot to play and nothing to make it play. Degrading to
// bot.js is the same promise the missing-model path already makes, extended to
// cover a model that loads and then misbehaves.
const warned = new Set();

function withFallback(name, decide) {
  return (game, seat) => {
    if (!net) return bot[name](game, seat);
    try {
      return decide(game, seat);
    } catch (err) {
      if (!warned.has(name)) {
        warned.add(name);
        console.error(`bot policy: ${name} failed, using the heuristics for it from now on`, err);
      }
      return bot[name](game, seat);
    }
  };
}

const chooseBid = withFallback("chooseBid", (game, seat) => choose(game, seat, { kind: "bid" }).bid);

// The ten the bidder keeps.
const chooseDiscard = withFallback(
  "chooseDiscard",
  (game, seat) => pickCards(game, seat, "discard", 3).rest
);

// The five that go across the table on a Double Nullo.
const choosePass = withFallback(
  "choosePass",
  (game, seat) => pickCards(game, seat, "pass", 5).chosen
);

const choosePlay = withFallback("choosePlay", (game, seat) => {
  if (game.legalPlays(seat).length === 0) return null;
  const { card, nominatedSuit } = choose(game, seat, { kind: "play" });
  return nominatedSuit ? { card, nominatedSuit } : { card };
});

module.exports = {
  // acceptsClaim and botName are left to bot.js on purpose. Naming a robot has
  // nothing to learn, and accepting a claim is a question of fact — do I hold a
  // card nothing out there can beat — that a policy could only get wrong.
  ...bot,
  chooseBid,
  chooseDiscard,
  choosePass,
  choosePlay,
  usingModel: () => net !== null,
};
