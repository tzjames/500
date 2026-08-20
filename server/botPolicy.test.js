const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { Game500Four } = require("./game4");
const bot = require("./bot");
const { ACTION_COUNT, OBS_SIZE } = require("./obs");

// botPolicy decides once, at load, whether there's a model to use — so each of
// these cases gets a fresh copy of the module with the environment it's testing.
function loadPolicy(modelPath) {
  delete require.cache[require.resolve("./botPolicy")];
  if (modelPath) process.env.BOT_MODEL_PATH = modelPath;
  else process.env.BOT_MODEL_PATH = path.join(os.tmpdir(), "no-such-500-model.json");
  return require("./botPolicy");
}

// An untrained net of the right shape. It plays badly, which doesn't matter —
// what's under test is that every move it makes is one the engine accepts, and
// that the sequential picks are unrolled correctly.
function writeRandomModel(hidden = [64, 64], obsSize = OBS_SIZE) {
  const sizes = [obsSize, ...hidden, ACTION_COUNT];
  const layers = sizes.slice(0, -1).map((inSize, i) => {
    const outSize = sizes[i + 1];
    const weight = new Float32Array(inSize * outSize);
    for (let w = 0; w < weight.length; w++) weight[w] = (Math.random() - 0.5) * 0.2;
    const bias = new Float32Array(outSize);
    for (let b = 0; b < bias.length; b++) bias[b] = (Math.random() - 0.5) * 0.1;
    return {
      in: inSize,
      out: outSize,
      activation: i === sizes.length - 2 ? "none" : "relu",
      weight: Buffer.from(weight.buffer).toString("base64"),
      bias: Buffer.from(bias.buffer).toString("base64"),
    };
  });

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "500-model-"));
  const file = path.join(dir, "bot.json");
  fs.writeFileSync(
    file,
    JSON.stringify({ format: "500-bot-mlp-1", obsSize, actionCount: ACTION_COUNT, layers })
  );
  return file;
}

// The hand as room4.js walks it, asking `policy` for every decision and holding
// each answer to the rules. This is the shape of the interface that matters: if
// a policy can get through this, the room can use it.
function playFullHand(policy, options, dealerSeat) {
  const game = new Game500Four(options);
  game.players.forEach((player, seat) => {
    player.id = `u${seat}`;
    player.name = `Bot ${seat}`;
    player.isBot = true;
  });
  game.deal(dealerSeat);

  let guard = 0;
  while (!game.auction.complete) {
    const seat = game.auction.turnSeat;
    const call = policy.chooseBid(game, seat);
    const legality = game.bidLegality(seat, call);
    assert.equal(legality.ok, true, `illegal call ${call}: ${legality.reason}`);
    game.bid(seat, call);
    assert.ok(++guard < 40, "the auction never ended");
  }

  const winning = game.completeBidding();
  if (!winning) {
    if (!options.allPassNoTrump) return { game, allPassed: true };
  } else {
    game.takeKitty(winning.seat);
    const keep = policy.chooseDiscard(game, winning.seat);
    assert.equal(keep.length, 10, "the bidder has to keep ten");
    assert.equal(game.discard(winning.seat, keep).success, true, "discard rejected");

    const exchange = game.exchangeSeats();
    if (exchange) {
      for (const seat of exchange) {
        const cards = policy.choosePass(game, seat);
        assert.equal(cards.length, 5, "five cards go across the table");
        assert.equal(game.setPass(seat, cards).success, true, "pass rejected");
      }
      game.completeExchange();
    }
  }

  guard = 0;
  while (!game.isRoundDecided()) {
    const seat = game.currentSeat;
    const choice = policy.choosePlay(game, seat);
    assert.ok(choice, `no card offered by seat ${seat}`);
    const played = game.playCard(seat, choice.card, choice.nominatedSuit);
    assert.equal(played.success, true, `play rejected: ${played.reason}`);
    if (game.trickIsComplete()) game.resolveTrick();
    else game.currentSeat = game.nextActiveSeat(seat);
    assert.ok(++guard < 60, "the hand never finished");
  }

  return { game, allPassed: false };
}

const RULESETS = [
  {},
  { misereAnytime: true, hiLo: true, doubleNullo: true },
  { j5: true, jokerLeadAnytime: false },
  { allPassNoTrump: true, ralphing: true },
];

test("with no model file the bots play exactly as they did before", () => {
  const policy = loadPolicy(null);
  assert.equal(policy.usingModel(), false);

  // Same positions, same answers: the fallback is a delegation, not a rewrite.
  for (let round = 0; round < 20; round++) {
    const game = new Game500Four({ misereAnytime: true });
    game.deal(round % 4);
    const seat = game.auction.turnSeat;
    assert.equal(policy.chooseBid(game, seat), bot.chooseBid(game, seat));
  }
});

test("the heuristic fallback still plays a legal hand on any house rules", () => {
  const policy = loadPolicy(null);
  for (const options of RULESETS) {
    for (let round = 0; round < 8; round++) playFullHand(policy, options, round % 4);
  }
});

test("a model-driven bot plays a legal hand on any house rules", () => {
  const policy = loadPolicy(writeRandomModel());
  assert.equal(policy.usingModel(), true, "the generated model should have loaded");

  for (const options of RULESETS) {
    for (let round = 0; round < 8; round++) playFullHand(policy, options, round % 4);
  }
});

test("a model-driven bot leads the Joker with a suit named", () => {
  const policy = loadPolicy(writeRandomModel());
  const game = new Game500Four();
  game.currentBid = { seat: 0, player: "u0", bid: "7 NT", points: 220 };
  game.players[0].hand = [
    { suit: "Joker", value: "Joker" },
    { value: "4", suit: "♥" },
    { value: "5", suit: "♥" },
  ];
  // Whatever it leads, a Joker at no trumps has to carry a nomination or the
  // engine rejects it outright.
  const choice = policy.choosePlay(game, 0);
  if (choice.card.suit === "Joker") {
    assert.ok(["♠", "♣", "♦", "♥"].includes(choice.nominatedSuit));
  }
  assert.equal(game.playCard(0, choice.card, choice.nominatedSuit).success, true);
});

// The stale-export case: a model whose shapes are self-consistent but built for
// a different observation than this server encodes. It has to be refused at
// load, because a model that runs on the wrong width produces NaNs and then the
// bots can't move at all.
test("a model built for a different observation is refused at load", () => {
  const stale = writeRandomModel([32], OBS_SIZE + 1);
  const policy = loadPolicy(stale);
  assert.equal(policy.usingModel(), false, "a stale model must not be used");
  playFullHand(policy, {}, 0);
});

// room4.js catches what a bot throws but has already cleared the timer that
// would ask again, so a throw in here would leave the hand with nobody to play.
test("a model that fails mid-hand degrades to the heuristics", () => {
  const policy = loadPolicy(writeRandomModel());
  assert.equal(policy.usingModel(), true);

  const game = new Game500Four();
  game.deal(0);
  const seat = game.auction.turnSeat;
  // A hand holding a card the encoder can't index is the simplest way to make
  // the model's decision throw where the heuristics still cope.
  game.players[seat].hand = [{ suit: "Sausages", value: "17" }];
  assert.doesNotThrow(() => policy.chooseBid(game, seat));
});

test("a model that won't load falls back rather than taking the server down", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "500-bad-model-"));
  const file = path.join(dir, "bot.json");
  fs.writeFileSync(file, JSON.stringify({ format: "from-the-future", layers: [] }));

  const policy = loadPolicy(file);
  assert.equal(policy.usingModel(), false);
  playFullHand(policy, {}, 0);
});

test("everything room4 asks of the bot module is still there", () => {
  const policy = loadPolicy(null);
  for (const name of ["chooseBid", "chooseDiscard", "choosePass", "choosePlay", "acceptsClaim", "botName", "bidInfo"]) {
    assert.equal(typeof policy[name], "function", `botPolicy is missing ${name}`);
  }
});
