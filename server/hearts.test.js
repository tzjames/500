const test = require("node:test");
const assert = require("node:assert/strict");
const { HeartsGame, buildDeck, cardId } = require("./hearts");
const heartsBot = require("./heartsBot");
const definitions = require("../src/heartsOptions.json");

const card = (value, suit) => ({ value, suit });
const JOKER = card("Joker", "Joker");

// A dealt round with the hands replaced, so a test can state exactly the
// position it is about rather than fish for one.
function dealt({ variant = "blackLady", mode = 4, options = {}, hands } = {}) {
  const game = new HeartsGame({ variant, mode, options });
  const phase = game.resetRound(0);
  if (hands) hands.forEach((hand, seat) => (game.players[seat].hand = hand.map((c) => ({ ...c }))));
  return { game, phase };
}

// Straight to the playing phase from a stated position, with the passing and
// the opening-lead card out of the way.
function playing(config) {
  const { game } = dealt(config);
  game.passed = {};
  game.leadCard = null;
  game.currentSeat = 0;
  game.openTrick();
  return game;
}

const suitRun = (suit, values) => values.map((v) => card(v, suit));

// ---- the pack ----

test("the pack is cut down the way the rules prescribe for the table size", () => {
  const shapes = [
    [3, 17, ["2♣"]],
    [4, 13, []],
    [5, 10, ["2♣", "2♦"]],
    [6, 8, ["2♣", "2♦", "2♠", "3♣"]],
  ];
  for (const [mode, cards, stripped] of shapes) {
    const { game } = dealt({ mode });
    assert.deepEqual(game.stripped, stripped, `${mode} players strip`);
    assert.deepEqual(
      game.players.map((p) => p.hand.length),
      Array(mode).fill(cards),
      `${mode} players hands`
    );
  }
});

test("each rule set deals its own pack", () => {
  const shapes = [
    ["blackLady", 4, 13, 0, 0],
    ["joker", 3, 18, 0, 0],
    ["heartsette", 4, 12, 3, 0],
    ["domino", 4, 6, 0, 28],
    ["cancellation", 7, 14, 0, 0],
  ];
  for (const [variant, mode, cards, widow, stock] of shapes) {
    const { game } = dealt({ variant, mode });
    assert.equal(game.players[0].hand.length, cards, `${variant} hand`);
    assert.equal(game.widow.length, widow, `${variant} widow`);
    assert.equal(game.stock.length, stock, `${variant} stock`);
  }
});

test("two jokers go in where the table asks for them, and nowhere else", () => {
  assert.equal(dealt({ mode: 3 }).game.players.flatMap((p) => p.hand).filter((c) => c.suit === "Joker").length, 0);
  const { game } = dealt({ mode: 3, options: { jokers: true } });
  assert.equal(game.players.flatMap((p) => p.hand).filter((c) => c.suit === "Joker").length, 2);
});

test("Cancellation Hearts really is two packs", () => {
  const deck = buildDeck({ packs: 2 });
  assert.equal(deck.length, 104);
  assert.equal(deck.filter((c) => cardId(c) === "Q♠").length, 2);
});

// ---- what costs ----

test("the most specific rule for a card is the one that counts", () => {
  // Chasse Coeur prices every queen at 13 and the hearts at 1, and the queen of
  // hearts is a queen rather than a heart.
  const { game } = dealt({ variant: "chasseCoeur" });
  assert.equal(game.penaltyOf(card("Q", "♥")), 13);
  assert.equal(game.penaltyOf(card("K", "♥")), 1);
  assert.equal(game.penaltyOf(card("Q", "♠")), 13);
});

test("every rule set prices its own cards", () => {
  const cases = [
    ["blackLady", "Q", "♠", 13],
    ["blackLady", "A", "♥", 1],
    ["blackMaria", "A", "♠", 10],
    ["blackMaria", "K", "♠", 7],
    ["blackJack", "J", "♠", 10],
    ["blackJack", "Q", "♠", 0],
    ["spot", "A", "♥", 14],
    ["spot", "7", "♥", 7],
    ["greek", "Q", "♠", 50],
    ["greek", "A", "♥", 15],
    ["greek", "K", "♥", 10],
    ["omnibus", "10", "♦", -10],
    ["royal", "Q", "♠", 26],
    ["royal", "Q", "♦", -10],
  ];
  for (const [variant, value, suit, points] of cases) {
    const { game } = dealt({ variant });
    assert.equal(game.penaltyOf(card(value, suit)), points, `${variant} ${value}${suit}`);
  }
});

test("a joker never costs anything", () => {
  const { game } = dealt({ variant: "joker" });
  assert.equal(game.penaltyOf(JOKER), 0);
});

test("the 1887 rules' two chip schemes replace a chip a heart", () => {
  assert.equal(dealt({ variant: "earliest" }).game.penaltyOf(card("A", "♥")), 1);
  assert.equal(dealt({ variant: "earliest", options: { heartChips: "spots" } }).game.penaltyOf(card("A", "♥")), 14);
  assert.equal(dealt({ variant: "earliest", options: { heartChips: "low" } }).game.penaltyOf(card("A", "♥")), 5);
  assert.equal(dealt({ variant: "earliest", options: { heartChips: "low" } }).game.penaltyOf(card("7", "♥")), 7);
});

test("Royal Hearts' queens double and cancel", () => {
  const { game } = dealt({ variant: "royal" });
  game.players[0].taken = [card("Q", "♥"), card("A", "♥"), card("K", "♥")];
  // Three hearts at a point each, doubled by the queen among them.
  assert.equal(game.pointsTakenBy(0), 6);
  game.players[1].taken = [card("Q", "♠"), card("Q", "♣")];
  assert.equal(game.pointsTakenBy(1), 0);
  game.players[2].taken = [card("Q", "♠")];
  assert.equal(game.pointsTakenBy(2), 26);
});

// ---- passing ----

test("the rotating cycle goes left, right, across, then nobody", () => {
  const game = new HeartsGame({ variant: "blackLady", mode: 4 });
  assert.deepEqual([1, 2, 3, 4, 5].map((n) => game.directionFor(n)), [
    "left",
    "right",
    "across",
    "hold",
    "left",
  ]);
});

test("a table that isn't four has no across to rotate through", () => {
  const game = new HeartsGame({ variant: "blackLady", mode: 3 });
  assert.deepEqual([1, 2, 3, 4].map((n) => game.directionFor(n)), ["left", "right", "hold", "left"]);
  assert.equal(new HeartsGame({ variant: "blackLady", mode: 3, options: { passing: "across" } }).directionFor(1), "left");
});

test("three cards go the way the direction says, and three come back", () => {
  const { game, phase } = dealt({ options: { passing: "left" } });
  assert.equal(phase, "passing");
  const going = game.players.map((p) => p.hand.slice(0, 3).map((c) => ({ ...c })));
  game.players.forEach((p, seat) => assert.equal(game.choosePass(seat, going[seat]).ok, true));
  for (let seat = 0; seat < 4; seat += 1) {
    const arrived = going[seat].every((c) => game.players[(seat + 1) % 4].hand.some((h) => cardId(h) === cardId(c)));
    assert.ok(arrived, `seat ${seat}'s cards reached the seat on its left`);
    assert.equal(game.players[seat].hand.length, 13);
  }
});

test("a hold hand is dealt straight into play", () => {
  assert.equal(dealt({ options: { passing: "none" } }).phase, "playing");
});

test("you can't pass a card you aren't holding, or the wrong number of them", () => {
  const { game } = dealt({ options: { passing: "left" }, hands: [suitRun("♣", ["2", "3", "4", "5"]), [], [], []] });
  assert.equal(game.choosePass(0, game.players[0].hand.slice(0, 2)).ok, false, "two is not three");
  assert.equal(game.choosePass(0, [card("2", "♣"), card("3", "♣"), card("9", "♥")]).ok, false, "not in hand");
  // And the same card three times is three cards you don't have.
  assert.equal(game.choosePass(0, [card("2", "♣"), card("2", "♣"), card("2", "♣")]).ok, false);
  assert.equal(game.choosePass(0, suitRun("♣", ["2", "3", "4"])).ok, true);
});

// ---- the first trick ----

test("the two of clubs leads, whoever is holding it", () => {
  const { game } = dealt({ options: { passing: "none" } });
  const holder = game.players.find((p) => p.hand.some((c) => cardId(c) === "2♣"));
  assert.equal(game.currentSeat, holder.seat);
  assert.deepEqual(game.legalCards(holder.seat), [{ suit: "♣", value: "2" }]);
});

test("where the two of clubs has been stripped out, the lowest club left leads", () => {
  const { game } = dealt({ mode: 3, options: { passing: "none" } });
  assert.deepEqual(game.stripped, ["2♣"]);
  assert.equal(game.leadCard.value, "3");
  assert.equal(game.leadCard.suit, "♣");
});

test("the eldest hand leads whatever it likes where the table plays it that way", () => {
  const { game } = dealt({ options: { passing: "none", lead: "eldest" } });
  assert.equal(game.currentSeat, 1);
  assert.equal(game.leadCard, null, "no particular card has to be led");
  // Everything but the cards that cost, which the first trick still bars.
  const legal = game.legalCards(1);
  assert.ok(legal.length > 1);
  assert.ok(legal.every((c) => game.penaltyOf(c) <= 0));
});

test("nothing that costs may be thrown to the first trick", () => {
  const game = playing({
    hands: [
      suitRun("♣", ["2", "3", "4"]),
      [card("Q", "♠"), card("A", "♥"), card("5", "♦")],
      suitRun("♦", ["2", "3", "4"]),
      suitRun("♠", ["2", "3", "4"]),
    ],
  });
  game.playCard(0, card("2", "♣"));
  // Void in clubs, holding the lady and a heart — neither may go on this trick.
  assert.deepEqual(game.legalCards(1), [{ value: "5", suit: "♦" }]);
});

test("…unless the hand holds nothing else", () => {
  const game = playing({
    hands: [
      suitRun("♣", ["2", "3", "4"]),
      [card("Q", "♠"), card("A", "♥"), card("K", "♥")],
      suitRun("♦", ["2", "3", "4"]),
      suitRun("♠", ["2", "3", "4"]),
    ],
  });
  game.playCard(0, card("2", "♣"));
  assert.equal(game.legalCards(1).length, 3);
});

// ---- following, and breaking hearts ----

test("you follow suit when you can, and anything when you can't", () => {
  const game = playing({
    hands: [
      suitRun("♣", ["2", "3", "4"]),
      [card("K", "♣"), card("A", "♥"), card("5", "♦")],
      suitRun("♦", ["5", "6", "7"]),
      suitRun("♠", ["2", "3", "4"]),
    ],
  });
  game.trickNumber = 1;
  game.playCard(0, card("2", "♣"));
  assert.deepEqual(game.legalCards(1), [{ value: "K", suit: "♣" }]);
  game.playCard(1, card("K", "♣"));
  assert.equal(game.legalCards(2).length, 3);
});

test("hearts stay down until they are broken", () => {
  const game = playing({
    hands: [
      [card("A", "♥"), card("2", "♣"), card("3", "♦")],
      suitRun("♣", ["4", "5", "6"]),
      suitRun("♦", ["4", "5", "6"]),
      suitRun("♠", ["4", "5", "6"]),
    ],
  });
  game.trickNumber = 1;
  assert.equal(game.legalCards(0).some((c) => c.suit === "♥"), false);
  game.heartsBroken = true;
  assert.equal(game.legalCards(0).some((c) => c.suit === "♥"), true);
});

test("a hand of nothing but hearts may lead one anyway", () => {
  const game = playing({
    hands: [
      suitRun("♥", ["2", "3", "4"]),
      suitRun("♣", ["4", "5", "6"]),
      suitRun("♦", ["4", "5", "6"]),
      suitRun("♠", ["4", "5", "6"]),
    ],
  });
  game.trickNumber = 1;
  assert.equal(game.legalCards(0).length, 3);
});

test("turning the rule off lets a heart be led whenever you like", () => {
  const game = playing({
    options: { breakHearts: false },
    hands: [
      [card("A", "♥"), card("2", "♣"), card("3", "♦")],
      suitRun("♣", ["4", "5", "6"]),
      suitRun("♦", ["4", "5", "6"]),
      suitRun("♠", ["4", "5", "6"]),
    ],
  });
  game.trickNumber = 1;
  assert.equal(game.legalCards(0).length, 3);
});

// ---- the trick itself ----

test("the highest card of the suit led takes it, and nothing else can", () => {
  const game = playing({
    hands: [
      suitRun("♣", ["2", "3", "4"]),
      [card("K", "♣"), card("2", "♥"), card("3", "♥")],
      [card("A", "♥"), card("2", "♦"), card("3", "♦")],
      [card("A", "♠"), card("2", "♠"), card("3", "♠")],
    ],
  });
  game.trickNumber = 1;
  game.playCard(0, card("2", "♣"));
  game.playCard(1, card("K", "♣"));
  game.playCard(2, card("A", "♥"));
  const result = game.playCard(3, card("A", "♠"));
  assert.equal(result.resolved.winnerSeat, 1);
  assert.equal(game.players[1].taken.length, 4);
});

test("a joker may be played at any time and never wins a trick", () => {
  const game = playing({
    variant: "joker",
    hands: [
      suitRun("♣", ["2", "3", "4"]),
      [JOKER, card("K", "♣"), card("2", "♦")],
      suitRun("♦", ["5", "6", "7"]),
      suitRun("♠", ["5", "6", "7"]),
    ],
  });
  game.trickNumber = 1;
  game.playCard(0, card("2", "♣"));
  // Holding a club, and the joker is legal all the same.
  assert.ok(game.legalCards(1).some((c) => c.suit === "Joker"));
  game.playCard(1, JOKER);
  game.playCard(2, card("5", "♦"));
  const result = game.playCard(3, card("5", "♠"));
  assert.equal(result.resolved.winnerSeat, 0);
});

test("Cancellation Hearts: a card played twice knocks both copies out", () => {
  const game = playing({
    variant: "cancellation",
    mode: 6,
    hands: [
      [card("A", "♣")],
      [card("A", "♣")],
      [card("K", "♣")],
      [card("2", "♣")],
      [card("3", "♣")],
      [card("4", "♣")],
    ],
  });
  game.trickNumber = 1;
  game.playCard(0, card("A", "♣"));
  game.playCard(1, card("A", "♣"));
  game.playCard(2, card("K", "♣"));
  game.playCard(3, card("2", "♣"));
  game.playCard(4, card("3", "♣"));
  const result = game.playCard(5, card("4", "♣"));
  assert.equal(result.resolved.winnerSeat, 2, "the king takes it, both aces having cancelled");
  assert.equal(result.resolved.cancelled.length, 2);
});

test("Cancellation Hearts: cancel everything and the trick rides on the next one", () => {
  const game = playing({
    variant: "cancellation",
    mode: 6,
    hands: [
      [card("A", "♣"), card("5", "♦")],
      [card("A", "♣"), card("6", "♦")],
      [card("2", "♥"), card("7", "♦")],
      [card("3", "♥"), card("8", "♦")],
      [card("4", "♥"), card("9", "♦")],
      [card("5", "♥"), card("10", "♦")],
    ],
  });
  game.trickNumber = 1;
  game.heartsBroken = true;
  game.playCard(0, card("A", "♣"));
  game.playCard(1, card("A", "♣"));
  for (let seat = 2; seat < 6; seat += 1) game.playCard(seat, game.players[seat].hand[0]);
  assert.equal(game.held.length, 6, "nobody took it");
  assert.equal(game.currentSeat, 0, "the same seat leads again");
  for (let seat = 0; seat < 6; seat += 1) game.playCard(seat, game.players[seat].hand[0]);
  assert.equal(game.players[5].taken.length, 12, "and the next trick carries both");
});

test("Heartsette's widow goes to whoever wins the first trick", () => {
  const { game } = dealt({ variant: "heartsette", options: { passing: "none" } });
  assert.equal(game.widow.length, 3);
  const before = game.widow.map(cardId);
  let guard = 0;
  while (game.trickNumber === 0 && guard++ < 10) {
    game.playCard(game.currentSeat, game.legalCards(game.currentSeat)[0]);
  }
  assert.equal(game.widow.length, 0);
  const winner = game.players.find((p) => p.tricksWon === 1);
  assert.ok(before.every((id) => winner.taken.some((c) => cardId(c) === id)));
});

test("Domino Hearts draws from the stock rather than discarding", () => {
  const game = playing({
    variant: "domino",
    hands: [[card("2", "♣")], [card("5", "♦")], [card("6", "♦")], [card("7", "♦")]],
  });
  game.stock = [card("9", "♣"), card("8", "♦")];
  game.trickNumber = 1;
  game.playCard(0, card("2", "♣"));
  // Seat 1 has no club, so it draws until it does — the diamond on top first.
  assert.equal(game.players[1].hand.length, 3);
  assert.ok(game.players[1].hand.some((c) => cardId(c) === "9♣"));
  assert.equal(game.stock.length, 0);
});

// ---- scoring ----

test("every card you took goes on your score", () => {
  const { game } = dealt();
  game.players[0].taken = [card("A", "♥"), card("2", "♥"), card("Q", "♠")];
  game.players[1].taken = [card("3", "♥")];
  const result = game.scoreRound();
  assert.deepEqual(result.delta, [15, 1, 0, 0]);
  assert.equal(result.moon, null);
});

test("shooting the moon sends the whole lot the other way", () => {
  const { game } = dealt();
  game.players[0].taken = [
    ...["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"].map((v) => card(v, "♥")),
    card("Q", "♠"),
  ];
  const result = game.scoreRound();
  assert.equal(result.moon.value, 26);
  assert.deepEqual(result.delta, [0, 26, 26, 26]);
});

test("a shooter who has something to clear takes it off their own score instead", () => {
  const { game } = dealt();
  game.players[0].score = 40;
  game.players[0].taken = [
    ...["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"].map((v) => card(v, "♥")),
    card("Q", "♠"),
  ];
  const result = game.scoreRound();
  assert.equal(result.moon.mode, "subtract");
  assert.deepEqual(result.delta, [-26, 0, 0, 0]);
});

test("Omnibus wants the ten of diamonds in the moon as well", () => {
  const hearts = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"].map((v) => card(v, "♥"));
  const { game } = dealt({ variant: "omnibus" });
  game.players[0].taken = [...hearts, card("Q", "♠")];
  game.players[1].taken = [card("10", "♦")];
  assert.equal(game.moonSide(), null, "the ten went elsewhere, so it isn't a moon");
  const { game: clean } = dealt({ variant: "omnibus" });
  clean.players[0].taken = [...hearts, card("Q", "♠"), card("10", "♦")];
  assert.deepEqual(clean.moonSide(), [0]);
});

test("turning shooting the moon off simply charges you for the lot", () => {
  const { game } = dealt({ options: { shootTheMoon: false } });
  game.players[0].taken = [
    ...["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"].map((v) => card(v, "♥")),
    card("Q", "♠"),
  ];
  const result = game.scoreRound();
  assert.equal(result.moon, null);
  assert.deepEqual(result.delta, [26, 0, 0, 0]);
});

test("partners keep one score between them", () => {
  const { game } = dealt({ variant: "partnership" });
  assert.equal(game.partnerships(), true);
  game.players[0].taken = [card("Q", "♠")];
  game.players[3].taken = [card("A", "♥")];
  const result = game.scoreRound();
  assert.deepEqual(result.delta, [13, 1, 13, 1]);
});

test("partners keeping separate scores are not a partnership at all", () => {
  const { game } = dealt({ variant: "partnership", options: { partnerStyle: "individual" } });
  assert.equal(game.partnerships(), false);
  game.players[0].taken = [card("Q", "♠")];
  game.players[1].taken = [card("A", "♥")];
  const result = game.scoreRound();
  assert.deepEqual(result.delta, [13, 1, 0, 0]);
});

test("a side that shoots the moon puts fifty-two on the other one", () => {
  const { game } = dealt({ variant: "partnership" });
  game.players[0].taken = ["2", "3", "4", "5", "6", "7"].map((v) => card(v, "♥"));
  game.players[2].taken = [
    ...["8", "9", "10", "J", "Q", "K", "A"].map((v) => card(v, "♥")),
    card("Q", "♠"),
  ];
  const result = game.scoreRound();
  assert.equal(result.moon.value, 52);
  assert.deepEqual(result.delta, [0, 52, 0, 52]);
});

test("Auction Hearts prices the suit that was named and bills the bidder", () => {
  const { game, phase } = dealt({ variant: "auction" });
  assert.equal(phase, "bidding");
  assert.equal(game.placeBid(1, 3).ok, true);
  game.placeBid(2, 0);
  game.placeBid(3, 0);
  assert.equal(game.placeBid(0, 0).phase, "chooseSuit");
  game.chooseSuit(1, "♠");
  assert.equal(game.penaltyOf(card("7", "♠")), 1);
  assert.equal(game.penaltyOf(card("7", "♥")), 0);
  game.players[2].taken = [card("7", "♠"), card("8", "♠")];
  game.players[3].taken = [card("9", "♠")];
  const result = game.scoreRound();
  assert.equal(result.delta[1], 3, "the bid is paid into the pool");
  assert.equal(result.delta[2], 2);
  assert.equal(result.delta[3], 1);
});

// ---- ending the game ----

test("the game ends at the target and the lowest score wins", () => {
  const { game } = dealt();
  game.players.forEach((p, seat) => (p.score = [98, 40, 101, 55][seat]));
  assert.equal(game.isOver(), true);
  assert.deepEqual(game.winners(), [1]);
});

test("nothing is over until somebody gets there", () => {
  const { game } = dealt();
  game.players.forEach((p) => (p.score = 20));
  assert.equal(game.isOver(), false);
  assert.deepEqual(game.winners(), []);
});

test("an agreed number of deals ends it too", () => {
  const { game } = dealt({ options: { endAfterDeals: "4" } });
  game.dealNumber = 4;
  assert.equal(game.isOver(), true);
});

test("two players level at the bottom share the win", () => {
  const { game } = dealt();
  game.players.forEach((p, seat) => (p.score = [12, 12, 101, 55][seat]));
  assert.deepEqual(game.winners(), [0, 1]);
});

test("the target can be moved, and moving it moves the ending", () => {
  const { game } = dealt({ options: { target: "50" } });
  assert.equal(game.target, 50);
  game.players[0].score = 50;
  assert.equal(game.isOver(), true);
});

// ---- every rule set, played out ----

test("every rule set plays a hand out at every table size it seats", () => {
  for (const spec of definitions.variants) {
    for (const mode of spec.modes) {
      const game = new HeartsGame({ variant: spec.id, mode });
      let phase = game.resetRound(0);
      if (phase === "bidding") {
        while (phase === "bidding") {
          const seat = game.bidState.currentSeat;
          phase = game.placeBid(seat, heartsBot.chooseBid(game, seat)).phase;
        }
        phase = game.chooseSuit(game.bidState.highBidder, heartsBot.chooseSuit(game, game.bidState.highBidder)).phase;
      }
      if (phase === "passing") {
        for (let seat = 0; seat < mode; seat += 1) {
          phase = game.choosePass(seat, heartsBot.choosePass(game, seat)).phase;
        }
      }
      assert.equal(phase, "playing", `${spec.id} reaches play`);
      let guard = 0;
      let finished = false;
      while (!finished && guard++ < 3000) {
        const seat = game.currentSeat;
        const choice = heartsBot.choosePlay(game, seat);
        assert.ok(choice, `${spec.id}/${mode} has something to play at seat ${seat}`);
        const result = game.playCard(seat, choice);
        assert.ok(result.ok, `${spec.id}/${mode}: ${result.reason}`);
        finished = result.finished;
      }
      assert.ok(finished, `${spec.id}/${mode} finishes`);
      const scored = game.scoreRound();
      assert.equal(scored.delta.length, mode);
    }
  }
});
