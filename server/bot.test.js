const test = require("node:test");
const assert = require("node:assert/strict");

const { Game500Four, availableBids, isNoTricksBid } = require("./game4");
const bot = require("./bot");

const c = (value, suit) => ({ value, suit });
const JOKER = { suit: "Joker", value: "Joker" };
const key = (card) => `${card.value}${card.suit}`;

function table(options) {
  const game = new Game500Four(options);
  game.players.forEach((p, seat) => {
    p.id = `u${seat}`;
    p.name = `Bot ${seat}`;
    p.isBot = true;
  });
  return game;
}

// Plays a whole hand out with four robots, from the deal to the score. Returns
// what happened, and asserts along the way that every call and every card was
// one the rules allowed.
function playFullHand(options, dealerSeat = 0) {
  const game = table(options);
  game.deal(dealerSeat);

  let calls = 0;
  while (!game.auction.complete) {
    const seat = game.auction.turnSeat;
    const call = bot.chooseBid(game, seat);
    const legality = game.bidLegality(seat, call);
    assert.equal(legality.ok, true, `robot made an illegal call ${call}: ${legality.reason}`);
    game.bid(seat, call);
    assert.ok(++calls < 40, "the auction never ended");
  }

  const winning = game.completeBidding();
  if (!winning) {
    if (!options?.allPassNoTrump) return { game, allPassed: true };
  } else {
    const seat = winning.seat;
    game.takeKitty(seat);
    const keep = bot.chooseDiscard(game, seat);
    const result = game.discard(seat, keep);
    assert.equal(result.success, true, `robot's discard was rejected: ${result.reason}`);
  }

  const tricks = [];
  let guard = 0;
  while (!game.isRoundDecided()) {
    const seat = game.currentSeat;
    const choice = bot.choosePlay(game, seat);
    assert.ok(choice, `no card offered by seat ${seat}`);
    const legal = game.legalPlays(seat);
    assert.ok(
      legal.some((card) => key(card) === key(choice.card)),
      `robot picked a card outside legalPlays: ${key(choice.card)}`
    );
    const played = game.playCard(seat, choice.card, choice.nominatedSuit);
    assert.equal(played.success, true, `robot's play was rejected: ${played.reason}`);

    if (game.trickIsComplete()) tricks.push(game.resolveTrick());
    else game.currentSeat = game.nextActiveSeat(seat);
    assert.ok(++guard < 60, "the hand never finished");
  }

  return { game, tricks, allPassed: false, contract: winning };
}

test("hand evaluation rates a big trump holding above a flat one", () => {
  const strong = [
    JOKER, c("J", "♠"), c("J", "♣"), c("A", "♠"), c("K", "♠"),
    c("10", "♠"), c("A", "♥"), c("5", "♦"), c("6", "♦"), c("7", "♣"),
  ];
  const weak = [
    c("5", "♠"), c("6", "♠"), c("7", "♥"), c("8", "♥"), c("9", "♦"),
    c("4", "♦"), c("5", "♣"), c("6", "♣"), c("7", "♣"), c("8", "♣"),
  ];
  assert.ok(bot.expectedTricks(strong, "♠") > 6);
  assert.ok(bot.expectedTricks(weak, "♠") < 2);
});

test("Misère risk is low on a hand of rubbish and high on one with honours", () => {
  const rubbish = [
    c("4", "♥"), c("5", "♥"), c("6", "♥"), c("4", "♦"), c("5", "♦"),
    c("6", "♦"), c("5", "♠"), c("6", "♠"), c("5", "♣"), c("6", "♣"),
  ];
  const honours = [
    JOKER, c("A", "♠"), c("K", "♠"), c("A", "♥"), c("K", "♥"),
    c("A", "♦"), c("K", "♦"), c("A", "♣"), c("K", "♣"), c("Q", "♣"),
  ];
  assert.ok(bot.misereRisk(rubbish) <= 3);
  assert.ok(bot.misereRisk(honours) > 10);
});

test("the robot passes on a bad hand and bids a good one", () => {
  const weak = table();
  weak.startAuction(0);
  weak.players[0].hand = [
    c("5", "♠"), c("6", "♠"), c("7", "♥"), c("8", "♥"), c("9", "♦"),
    c("4", "♦"), c("5", "♣"), c("6", "♣"), c("7", "♣"), c("8", "♣"),
  ];
  assert.equal(bot.chooseBid(weak, 0), "Pass");

  const strong = table();
  strong.startAuction(0);
  strong.players[0].hand = [
    JOKER, c("J", "♥"), c("J", "♦"), c("A", "♥"), c("K", "♥"),
    c("Q", "♥"), c("10", "♥"), c("A", "♠"), c("A", "♣"), c("4", "♦"),
  ];
  const call = bot.chooseBid(strong, 0);
  assert.notEqual(call, "Pass");
  assert.match(call, /♥/, `expected a hearts bid, got ${call}`);
});

test("the robot's bid always beats the standing one", () => {
  const game = table();
  game.startAuction(0);
  game.players[0].hand = [
    JOKER, c("J", "♥"), c("J", "♦"), c("A", "♥"), c("K", "♥"),
    c("Q", "♥"), c("10", "♥"), c("A", "♠"), c("A", "♣"), c("4", "♦"),
  ];
  game.bid(0, "Pass");
  game.bid(1, "8 ♥");
  game.bid(2, "Pass");
  game.bid(3, "Pass");
  // Seat 0 is out under standard rules, so it has nothing to say; with
  // bid-after-pass on it must either pass or clear 8♥.
  const loose = table({ bidAfterPass: true });
  loose.startAuction(0);
  loose.players[0].hand = game.players[0].hand;
  loose.bid(0, "Pass");
  loose.bid(1, "8 ♥");
  loose.bid(2, "Pass");
  loose.bid(3, "Pass");
  const call = bot.chooseBid(loose, 0);
  assert.equal(loose.bidLegality(0, call).ok, true);
});

test("a rubbish hand goes for Misère when it's available", () => {
  const game = table({ misereAnytime: true });
  game.startAuction(0);
  game.players[0].hand = [
    c("4", "♥"), c("5", "♥"), c("6", "♥"), c("4", "♦"), c("5", "♦"),
    c("6", "♦"), c("5", "♠"), c("6", "♠"), c("5", "♣"), c("6", "♣"),
  ];
  assert.equal(bot.chooseBid(game, 0), "Misere");
});

test("the discard keeps trumps and aces and voids a short suit", () => {
  const game = table();
  game.trumpSuit = "♠";
  game.currentBid = { seat: 0, player: "u0", bid: "8 ♠", points: 240 };
  game.players[0].hand = [
    JOKER, c("J", "♠"), c("A", "♠"), c("K", "♠"), c("10", "♠"),
    c("A", "♥"), c("4", "♥"), c("5", "♥"), c("6", "♦"), c("4", "♦"),
    c("5", "♣"), c("6", "♣"), c("7", "♣"),
  ];
  const keep = bot.chooseDiscard(game, 0);
  assert.equal(keep.length, 10);
  for (const card of [JOKER, c("J", "♠"), c("A", "♠"), c("A", "♥")]) {
    assert.ok(keep.some((k) => key(k) === key(card)), `should have kept ${key(card)}`);
  }
  // Diamonds were the shortest suit that wasn't trumps or an ace, so they go.
  assert.equal(keep.filter((k) => k.suit === "♦").length, 0);
});

test("a Misère discard throws the Joker and the honours", () => {
  const game = table();
  game.currentBid = { seat: 0, player: "u0", bid: "Misere", points: 250 };
  game.players[0].hand = [
    JOKER, c("A", "♠"), c("K", "♥"), c("4", "♥"), c("5", "♥"),
    c("6", "♦"), c("4", "♦"), c("5", "♣"), c("6", "♣"), c("7", "♣"),
    c("5", "♠"), c("6", "♠"), c("7", "♥"),
  ];
  const keep = bot.chooseDiscard(game, 0);
  assert.equal(keep.length, 10);
  assert.ok(!keep.some((k) => k.suit === "Joker"));
  assert.ok(!keep.some((k) => key(k) === key(c("A", "♠"))));
  assert.ok(!keep.some((k) => key(k) === key(c("K", "♥"))));
});

test("the robot covers the trick when it can and ducks under its partner", () => {
  const game = table();
  game.trumpSuit = "♠";
  game.currentBid = { seat: 3, player: "u3", bid: "7 ♠", points: 140 };
  game.players[1].hand = [c("A", "♥"), c("4", "♥"), c("5", "♠")];

  // Seat 0 (an opponent of seat 1) leads the king of hearts: take it.
  game.players[0].hand = [c("K", "♥")];
  game.playCard(0, c("K", "♥"));
  assert.equal(key(bot.choosePlay(game, 1).card), key(c("A", "♥")));

  // Seat 3 (seat 1's partner) is winning it instead: don't spend the ace.
  game.currentTrick = [];
  game.players[3].hand = [c("K", "♥")];
  game.playCard(3, c("K", "♥"));
  assert.equal(key(bot.choosePlay(game, 1).card), key(c("4", "♥")));
});

test("a Misère bidder ducks as high as it can without winning", () => {
  const game = table();
  game.currentBid = { seat: 1, player: "u1", bid: "Misere", points: 250 };
  game.players[3].folded = true;
  game.players[0].hand = [c("K", "♥")];
  game.players[1].hand = [c("A", "♥"), c("Q", "♥"), c("4", "♥")];

  game.playCard(0, c("K", "♥"));
  // The queen is the highest card that still loses to the king.
  assert.equal(key(bot.choosePlay(game, 1).card), key(c("Q", "♥")));
});

test("the declarer leads trumps from the top", () => {
  const game = table();
  game.trumpSuit = "♠";
  game.currentBid = { seat: 0, player: "u0", bid: "8 ♠", points: 240 };
  game.players[0].hand = [
    JOKER, c("J", "♠"), c("A", "♠"), c("K", "♠"), c("Q", "♠"), c("6", "♥"),
  ];
  const choice = bot.choosePlay(game, 0);
  assert.equal(choice.card.suit, "Joker", "the top trump of all is the Joker");
});

test("leading the Joker at no trumps always comes with a nomination", () => {
  const game = table();
  game.currentBid = { seat: 0, player: "u0", bid: "7 NT", points: 220 };
  game.players[0].hand = [JOKER, c("4", "♥"), c("5", "♥"), c("6", "♥")];
  // Whatever it decides to lead, a Joker lead has to carry a suit.
  for (let i = 0; i < 5; i++) {
    const choice = bot.choosePlay(game, 0);
    if (choice.card.suit === "Joker") {
      assert.ok(["♠", "♣", "♥", "♦"].includes(choice.nominatedSuit));
      assert.equal(game.playCard(0, choice.card, choice.nominatedSuit).success, true);
      break;
    }
    break;
  }
});

test("four robots play a legal hand out to the score, on any house rules", () => {
  const rulesets = [
    {},
    { misereAnytime: true, hiLo: true, doubleNullo: true, blindMisere: true },
    { j5: true, jokerLeadAnytime: false, splitTheColours: true },
    { allPassNoTrump: true, trickPoints: false, slamBonus: false, ralphing: true },
  ];

  for (const options of rulesets) {
    for (let round = 0; round < 25; round++) {
      const { game, allPassed } = playFullHand(options, round % 4);
      if (allPassed) continue;

      const played = game.players.reduce((sum, p) => sum + p.tricksWon, 0);
      const cardsLeft = game.players.reduce((sum, p) => sum + p.hand.length, 0);
      // Either every card went, or a no-tricks contract fell over early.
      if (cardsLeft === 0) {
        assert.equal(played, 10, `expected ten tricks, counted ${played}`);
      } else {
        assert.ok(
          game.noContract === false && isNoTricksBid(game.currentBid?.bid),
          "a hand only stops short when a no-tricks contract has already gone"
        );
      }

      const result = game.scoreRound();
      assert.ok(Number.isFinite(result.deltas[0]) && Number.isFinite(result.deltas[1]));
    }
  }
});

test("a robot never bids a contract this table doesn't allow", () => {
  const options = { openMisere: false, hiLo: false, doubleNullo: false };
  const allowed = new Set(availableBids(options).map((b) => b.bid));
  for (let round = 0; round < 40; round++) {
    const game = table(options);
    game.deal(round % 4);
    while (!game.auction.complete) {
      const seat = game.auction.turnSeat;
      const call = bot.chooseBid(game, seat);
      assert.ok(call === "Pass" || allowed.has(call), `robot called ${call}`);
      game.bid(seat, call);
    }
  }
});
