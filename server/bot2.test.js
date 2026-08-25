const test = require("node:test");
const assert = require("node:assert/strict");

const Game500 = require("./gameLogic");
const { availableBids, bidInfo, bidLegality } = require("./gameLogic");
const bot2 = require("./bot2");

const c = (value, suit) => ({ value, suit });
const JOKER = { suit: "Joker", value: "Joker" };
const key = (card) => `${card.value}${card.suit}`;
const other = (id) => (id === 1 ? 2 : 1);
// Ten low hearts, for filling a hand to a given size without adding any strength.
const VALUES_LOW = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J"];

// ---- the auction table ----

// Pinned against src/components/BiddingInterface.js, which draws the same table
// for the human. The two are separate copies, so if one moves without the other
// this fails rather than letting a robot call something the interface can't show.
test("the bid table matches the one the bidding interface draws", () => {
  assert.equal(bidInfo("6 ♠").points, 40);
  assert.equal(bidInfo("6 ♣").points, 60);
  assert.equal(bidInfo("6 ♦").points, 80);
  assert.equal(bidInfo("6 ♥").points, 100);
  assert.equal(bidInfo("6 NT").points, 120);
  assert.equal(bidInfo("10 NT").points, 520);
  assert.equal(bidInfo("Misere").points, 250);
  assert.equal(bidInfo("Open Misere").points, 500);

  // Five levels of five suits, plus the two Misères.
  const bids = availableBids();
  assert.equal(bids.length, 27);
  // Sorted by value, which in this game is also the auction order.
  for (let i = 1; i < bids.length; i++) assert.ok(bids[i].points >= bids[i - 1].points);

  assert.equal(bidInfo("Pass"), null);
  assert.equal(bidInfo("11 ♠"), null);
  assert.equal(bidInfo("nonsense"), null);
});

test("a call has to be worth more than the standing bid", () => {
  assert.equal(bidLegality("Pass", 520).ok, true);
  assert.equal(bidLegality("8 ♣", 240).ok, true);
  assert.equal(bidLegality("8 ♠", 240).ok, false);
  // Misère sits between 8♠ and 8♣ because this auction ranks purely by points.
  assert.equal(bidLegality("Misere", 240).ok, true);
  assert.equal(bidLegality("Misere", 260).ok, false);
  // Open Misère and 10♥ are both worth 500, so neither can beat the other.
  assert.equal(bidLegality("Open Misere", 500).ok, false);
  assert.equal(bidLegality("10 ♥", 500).ok, false);
});

// ---- legal plays ----

test("legalPlays makes you follow suit, and lets you off when you can't", () => {
  const game = new Game500();
  game.trumpSuit = "♠";
  game.players[0].hand = [c("A", "♥"), c("4", "♥"), c("5", "♠")];
  game.players[1].hand = [c("K", "♥"), c("2", "♣")];
  game.players[1].dummyHand = [c("3", "♣"), c("4", "♣")];

  // Nothing led yet: everything in that hand is available.
  assert.equal(game.legalPlays(1, false).length, 3);

  game.playCard(2, c("K", "♥"), false);
  // Holding hearts, only hearts will do.
  assert.deepEqual(
    game.legalPlays(1, false).map(key).sort(),
    [key(c("A", "♥")), key(c("4", "♥"))].sort()
  );
  // The dummy is void in hearts, so it may play anything it holds.
  assert.equal(game.legalPlays(2, true).length, 2);
});

test("a Misère hand void in the led suit has to let the Joker go", () => {
  const game = new Game500();
  game.currentBid = { player: 1, bid: "Misere", points: 250 };
  game.trumpSuit = null;
  game.players[0].hand = [JOKER, c("2", "♣")];
  game.players[1].hand = [c("K", "♥")];

  game.playCard(2, c("K", "♥"), false);
  // Void in hearts and holding the Joker: it's the only legal card.
  assert.deepEqual(game.legalPlays(1, false).map(key), [key(JOKER)]);
  assert.equal(game.playCard(1, JOKER, false).success, true);
});

test("legalPlays and playCard agree about the Joker at no trumps", () => {
  const game = new Game500();
  game.currentBid = { player: 1, bid: "7 NT", points: 220 };
  game.trumpSuit = null;
  game.players[0].hand = [JOKER, c("4", "♥")];
  // Leading, the Joker is available — it just has to name a suit.
  assert.equal(game.legalPlays(1, false).length, 2);
  assert.equal(game.playCard(1, JOKER, false).success, false, "no nomination, no play");
  assert.equal(game.playCard(1, JOKER, false, "♥").success, true);
});

// ---- a whole hand ----

// Plays a hand out with the robot on both sides, mirroring the order room.js
// walks: auction, kitty, dummies, then the four-seat rotation. Asserts along the
// way that every call and every card was one the rules allowed.
function playFullHand() {
  const game = new Game500();
  game.startGame();
  const first = game.players.find((p) => !p.isDealer).id;

  const history = [];
  let bidder = first;
  let floor = 0;
  let winning = null;
  let guard = 0;

  for (;;) {
    const call = bot2.chooseBid(game, bidder, floor);
    assert.equal(bidLegality(call, floor).ok, true, `robot made an illegal call ${call}`);
    const points = call === "Pass" ? 0 : bidInfo(call).points;
    history.push({ player: bidder, bid: call, points });

    if (call === "Pass") {
      const standing = history.filter((b) => b.bid !== "Pass").pop();
      if (standing) {
        winning = standing;
        break;
      }
      if (history.length < 2) {
        bidder = other(bidder);
      } else {
        return { game, allPassed: true };
      }
    } else {
      const opponentPassed = history.some((b) => b.player === other(bidder) && b.bid === "Pass");
      floor = points;
      if (opponentPassed) {
        winning = history[history.length - 1];
        break;
      }
      game.currentBid = history[history.length - 1];
      bidder = other(bidder);
    }
    assert.ok(++guard < 30, "the auction never ended");
  }

  game.currentBid = winning;
  const suit = winning.bid.split(" ")[1];
  game.trumpSuit = ["♠", "♣", "♦", "♥"].includes(suit) ? suit : null;
  game.dealKitty();

  const keep = bot2.chooseDiscard(game, winning.player);
  assert.equal(keep.length, 10, "the bidder keeps ten");
  game.players.find((p) => p.id === winning.player).hand = keep;

  const isMisere = winning.bid.includes("Misere");
  game.dealDummyHands(isMisere ? [other(winning.player)] : undefined);
  game.setupSeats(winning.player, isMisere);

  guard = 0;
  while (!game.isRoundDecided()) {
    const seat = game.getCurrentSeat();
    const choice = bot2.choosePlay(game, seat.playerId, seat.isDummy);
    assert.ok(choice, `no card offered by ${seat.playerId}${seat.isDummy ? " (dummy)" : ""}`);
    const legal = game.legalPlays(seat.playerId, seat.isDummy);
    assert.ok(
      legal.some((card) => key(card) === key(choice.card)),
      `robot picked a card outside legalPlays: ${key(choice.card)}`
    );
    const played = game.playCard(seat.playerId, choice.card, seat.isDummy, choice.nominatedSuit);
    assert.equal(played.success, true, `robot's play was rejected: ${played.reason}`);

    if (game.currentTrick.length === game.seats.length) game.resolveTrick();
    else game.advanceSeat();
    assert.ok(++guard < 80, "the hand never finished");
  }

  return { game, allPassed: false, winning, isMisere };
}

test("two robots play a legal hand out to the score", () => {
  let played = 0;
  let passedOut = 0;

  for (let round = 0; round < 60; round++) {
    const { game, allPassed, winning, isMisere } = playFullHand();
    if (allPassed) {
      passedOut += 1;
      continue;
    }
    played += 1;

    const tricks = game.players.reduce((sum, p) => sum + p.tricksWon, 0);
    const left = game.players.reduce((sum, p) => sum + p.hand.length + p.dummyHand.length, 0);
    if (left === 0) {
      assert.equal(tricks, 10, `expected ten tricks, counted ${tricks}`);
    } else {
      // A hand only stops short when a Misère has already been broken.
      assert.ok(isMisere, "a hand only stops short on a Misère");
    }

    const result = game.scoreRound();
    assert.ok(Number.isFinite(result.bidderDelta) && Number.isFinite(result.otherDelta));
    assert.equal(result.bidderId, winning.player);
  }

  assert.ok(played > 20, `only ${played} of 60 hands were bid — the robot barely bids`);
  assert.ok(passedOut < 40, `${passedOut} of 60 hands passed out`);
});

// ---- judgement ----

test("the robot passes a middling hand and bids a strong one", () => {
  const game = new Game500();
  // The hand that passes isn't the worst one — it's the *middling* one. Twos and
  // threes are a Misère, and unlike the four-player game no misereAnytime rule
  // holds that call back, so it's always on offer. What has nothing to say is a
  // hand with a few honours and no length: too much in it to duck out of tricks,
  // not enough in it to take any.
  game.players[0].hand = [
    c("Q", "♠"), c("9", "♠"), c("J", "♥"), c("8", "♥"), c("Q", "♦"),
    c("7", "♦"), c("J", "♣"), c("6", "♣"), c("5", "♣"), c("4", "♣"),
  ];
  assert.ok(bot2.misereRisk(game.players[0].hand) > 3, "too many honours to duck");
  assert.equal(bot2.chooseBid(game, 1, 0), "Pass");

  game.players[0].hand = [
    JOKER, c("J", "♥"), c("J", "♦"), c("A", "♥"), c("K", "♥"),
    c("Q", "♥"), c("10", "♥"), c("A", "♠"), c("A", "♣"), c("4", "♦"),
  ];
  const call = bot2.chooseBid(game, 1, 0);
  assert.notEqual(call, "Pass");
  assert.match(call, /♥/, `expected a hearts bid, got ${call}`);
});

test("a hand of rubbish goes for a Misère", () => {
  const game = new Game500();
  game.players[0].hand = [
    c("2", "♥"), c("3", "♥"), c("4", "♥"), c("2", "♦"), c("3", "♦"),
    c("4", "♦"), c("2", "♠"), c("3", "♠"), c("2", "♣"), c("3", "♣"),
  ];
  assert.equal(bot2.chooseBid(game, 1, 0), "Misere");
});

test("the robot never bids under the standing call", () => {
  for (let round = 0; round < 40; round++) {
    const game = new Game500();
    game.startGame();
    for (const floor of [0, 140, 250, 340, 520]) {
      const call = bot2.chooseBid(game, 1, floor);
      assert.equal(bidLegality(call, floor).ok, true, `called ${call} over ${floor}`);
    }
  }
});

test("the discard keeps trumps and aces and voids a short suit", () => {
  const game = new Game500();
  game.trumpSuit = "♠";
  game.currentBid = { player: 1, bid: "8 ♠", points: 240 };
  game.players[0].hand = [
    JOKER, c("J", "♠"), c("A", "♠"), c("K", "♠"), c("10", "♠"),
    c("A", "♥"), c("4", "♥"), c("5", "♥"), c("6", "♦"), c("4", "♦"),
  ];
  game.kitty = [c("5", "♣"), c("6", "♣"), c("7", "♣")];

  const keep = bot2.chooseDiscard(game, 1);
  assert.equal(keep.length, 10);
  for (const card of [JOKER, c("J", "♠"), c("A", "♠"), c("A", "♥")]) {
    assert.ok(keep.some((k) => key(k) === key(card)), `should have kept ${key(card)}`);
  }
  // Diamonds were the shortest suit holding neither a trump nor an ace.
  assert.equal(keep.filter((k) => k.suit === "♦").length, 0);
});

// The two-seat wrinkle: your dummy is not an opponent, so don't spend a card
// beating it — the four-player robot's "cover your partner" rule, except here
// the partner is your own other hand.
test("the robot doesn't overtake its own dummy", () => {
  const game = new Game500();
  game.trumpSuit = "♠";
  game.currentBid = { player: 2, bid: "7 ♠", points: 140 };
  game.setupSeats(2, false);
  game.players[0].hand = [c("A", "♥"), c("4", "♥")];
  game.players[0].dummyHand = [c("K", "♥")];
  game.players[1].hand = [c("Q", "♥")];

  // Player 1's own dummy leads the king and is winning the trick.
  game.playCard(1, c("K", "♥"), true);
  assert.equal(key(bot2.choosePlay(game, 1, false).card), key(c("4", "♥")), "should duck under itself");

  // With the opponent winning instead, the ace comes out.
  game.currentTrick = [];
  game.players[0].hand = [c("A", "♥"), c("4", "♥")];
  assert.equal(game.playCard(2, c("Q", "♥"), false).success, true);
  assert.equal(key(bot2.choosePlay(game, 1, false).card), key(c("A", "♥")), "should take the trick");
});

// A trick where a trump was led and both of player 2's hands threw hearts on it.
// Each hand at the table shows out separately, so it takes both of them before
// the opponent is known to be out of trumps altogether.
function opponentOutOfTrumps(game) {
  game.playedCards = [
    { playerId: 1, isDummy: false, card: c("A", "♠") },
    { playerId: 2, isDummy: false, card: c("5", "♥") },
    { playerId: 1, isDummy: true, card: c("6", "♠") },
    { playerId: 2, isDummy: true, card: c("7", "♥") },
  ];
}

test("the declarer stops drawing trumps once the opponent has shown out of them", () => {
  const game = new Game500();
  game.trumpSuit = "♠";
  game.currentBid = { player: 1, bid: "8 ♠", points: 240 };
  game.setupSeats(1, false);
  opponentOutOfTrumps(game);
  game.players[0].hand = [
    c("K", "♠"), c("Q", "♠"), c("10", "♠"), c("9", "♠"), c("4", "♥"), c("3", "♥"),
  ];

  const choice = bot2.choosePlay(game, 1, false);
  assert.ok(
    !["♠", "Joker"].includes(choice.card.suit),
    `led ${key(choice.card)} with no trumps left against it`
  );
});

test("a trump still gets drawn while one of the opponent's hands might hold one", () => {
  const game = new Game500();
  game.trumpSuit = "♠";
  game.currentBid = { player: 1, bid: "8 ♠", points: 240 };
  game.setupSeats(1, false);
  opponentOutOfTrumps(game);
  // Their dummy followed the trump lead instead of discarding, so that hand
  // could still be holding one and the draw is still worth it.
  game.playedCards[3] = { playerId: 2, isDummy: true, card: c("8", "♠") };
  game.players[0].hand = [
    c("K", "♠"), c("Q", "♠"), c("10", "♠"), c("9", "♠"), c("4", "♥"), c("3", "♥"),
  ];

  assert.equal(bot2.choosePlay(game, 1, false).card.suit, "♠");
});

test("a side winner is cashed ahead of a trump when nothing can ruff", () => {
  const game = new Game500();
  game.trumpSuit = "♠";
  game.currentBid = { player: 1, bid: "8 ♠", points: 240 };
  game.setupSeats(1, false);
  opponentOutOfTrumps(game);
  // The Joker led that trick and is gone, so the right bower is the best trump
  // left and takes the trick for certain — but so does the ace of diamonds, and
  // nothing can take the bower off you later.
  game.playedCards[0] = { playerId: 1, isDummy: false, card: JOKER };
  game.players[0].hand = [c("J", "♠"), c("A", "♦"), c("3", "♥")];

  assert.equal(key(bot2.choosePlay(game, 1, false).card), key(c("A", "♦")));
});

test("trumps are run first when only one odd card is left beside them", () => {
  const game = new Game500();
  game.trumpSuit = "♠";
  game.currentBid = { player: 1, bid: "8 ♠", points: 240 };
  game.setupSeats(1, false);
  opponentOutOfTrumps(game);
  game.players[0].hand = [c("9", "♠"), c("8", "♠"), c("3", "♥")];

  assert.equal(bot2.choosePlay(game, 1, false).card.suit, "♠");
});

test("a Misère bidder ducks as high as it can without winning", () => {
  const game = new Game500();
  game.currentBid = { player: 1, bid: "Misere", points: 250 };
  game.trumpSuit = null;
  game.setupSeats(1, true);
  game.players[0].hand = [c("A", "♥"), c("Q", "♥"), c("4", "♥")];
  game.players[1].hand = [c("K", "♥")];

  game.playCard(2, c("K", "♥"), false);
  // The queen is the highest card that still loses to the king.
  assert.equal(key(bot2.choosePlay(game, 1, false).card), key(c("Q", "♥")));
});

// The robot gets exactly what a human gets. The opponent's dummy is never shown
// — only its size — so moving a card into or out of it must not change the
// robot's view of the world by one bit. Reading it out of the engine would be
// easy and would make the robot play better, and it would be cheating.
test("the robot can't see the opponent's dummy", () => {
  const setUp = (opponentDummy) => {
    const game = new Game500();
    game.trumpSuit = null;
    game.currentBid = { player: 1, bid: "7 NT", points: 220 };
    game.players[0].hand = [c("K", "♠"), c("4", "♥"), c("5", "♥")];
    game.players[0].dummyHand = [c("2", "♣")];
    game.players[1].dummyHand = opponentDummy;
    return game;
  };

  const withAce = bot2.liveAgainstMe(setUp([c("A", "♠")]), 1).map(key).sort();
  const withoutAce = bot2.liveAgainstMe(setUp([]), 1).map(key).sort();
  assert.deepEqual(withAce, withoutAce, "the opponent's dummy leaked into the robot's view");

  // The ace is still treated as live either way — not because the robot saw it,
  // but because it is one of the cards the robot cannot place.
  assert.ok(withAce.includes(key(c("A", "♠"))));
  assert.equal(bot2.isTopRemaining(setUp([c("A", "♠")]), 1, c("K", "♠")), false);
});

// You don't see your own dummy until you've played your first card, so the robot
// can't use it to choose that card.
test("the robot can't see its own dummy until it has played a card", () => {
  const build = (handSize) => {
    const game = new Game500();
    game.trumpSuit = null;
    game.currentBid = { player: 1, bid: "7 NT", points: 220 };
    // A full ten means nothing has been played from it yet.
    game.players[0].hand = Array.from({ length: handSize }, (_, i) => c(VALUES_LOW[i], "♥"));
    game.players[0].dummyHand = [c("A", "♠"), c("K", "♠")];
    return game;
  };

  // Ten cards in hand: the dummy hasn't been looked at, so its two spades are
  // still among the cards that might be played against this player.
  const before = bot2.liveAgainstMe(build(10), 1).map(key);
  assert.ok(before.includes(key(c("A", "♠"))), "own dummy shouldn't be known yet");

  // One card gone: the dummy is face up to its owner and no longer a threat.
  const after = bot2.liveAgainstMe(build(9), 1).map(key);
  assert.ok(!after.includes(key(c("A", "♠"))), "own dummy should be known now");
  assert.ok(!after.includes(key(c("K", "♠"))));
});
