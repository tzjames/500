const test = require("node:test");
const assert = require("node:assert/strict");

const {
  Game500Four,
  bidInfo,
  availableBids,
  getCardRank,
  getEffectiveSuit,
} = require("./game4");

// A game with named seats and no dealing, so a test can put exactly the cards
// it cares about into each hand.
function table(options) {
  const game = new Game500Four(options);
  ["North", "East", "South", "West"].forEach((name, seat) => {
    game.players[seat].id = `u${seat}`;
    game.players[seat].name = name;
  });
  return game;
}

const c = (value, suit) => ({ value, suit });
const JOKER = { suit: "Joker", value: "Joker" };

// Runs an auction from seat 0 as a list of [seat, bid] calls, asserting each is
// accepted, and returns the last result.
function runAuction(game, calls) {
  let result;
  for (const [seat, bid] of calls) {
    result = game.bid(seat, bid);
    assert.equal(result.ok, true, `${bid} from seat ${seat} was rejected: ${result.reason}`);
  }
  return result;
}

test("the deck is the 43-card 500 pack", () => {
  const game = table();
  const deck = game.createDeck();
  assert.equal(deck.length, 43);
  assert.equal(deck.filter((card) => card.suit === "Joker").length, 1);
  // Hearts and diamonds keep their 4; the black 4s come out.
  for (const suit of ["♥", "♦"]) {
    assert.equal(deck.filter((card) => card.suit === suit).length, 11);
    assert.ok(deck.some((card) => card.suit === suit && card.value === "4"));
  }
  for (const suit of ["♠", "♣"]) {
    assert.equal(deck.filter((card) => card.suit === suit).length, 10);
    assert.ok(!deck.some((card) => card.suit === suit && card.value === "4"));
  }
  // No 2s or 3s anywhere.
  assert.ok(!deck.some((card) => ["2", "3"].includes(card.value)));
  // And every card is distinct.
  const keys = new Set(deck.map((card) => `${card.value}${card.suit}`));
  assert.equal(keys.size, 43);
});

test("dealing gives ten each and a three-card kitty, using every card once", () => {
  const game = table();
  game.deal(2);
  assert.deepEqual(
    game.players.map((p) => p.hand.length),
    [10, 10, 10, 10]
  );
  assert.equal(game.kitty.length, 3);
  assert.equal(game.deck.length, 0);
  const all = [...game.players.flatMap((p) => p.hand), ...game.kitty];
  assert.equal(new Set(all.map((card) => `${card.value}${card.suit}`)).size, 43);
  // The auction opens on the dealer's left.
  assert.equal(game.auction.turnSeat, 3);
});

test("bid values follow the Avondale schedule", () => {
  assert.equal(bidInfo("6 ♠").points, 40);
  assert.equal(bidInfo("6 NT").points, 120);
  assert.equal(bidInfo("7 ♠").points, 140);
  assert.equal(bidInfo("8 ♦").points, 280);
  assert.equal(bidInfo("10 ♥").points, 500);
  assert.equal(bidInfo("10 NT").points, 520);
  assert.equal(bidInfo("Misere").points, 250);
  assert.equal(bidInfo("Open Misere").points, 500);
});

test("Misère sits between 8♠ and 8♣, Open Misère between 10♦ and 10♥", () => {
  const rank = (bid) => bidInfo(bid).rank;
  assert.ok(rank("8 ♠") < rank("Misere") && rank("Misere") < rank("8 ♣"));
  assert.ok(rank("10 ♦") < rank("Open Misere") && rank("Open Misere") < rank("10 ♥"));
});

test("split the colours moves the special bids down to the black suits", () => {
  const opts = { splitTheColours: true };
  const rank = (bid) => bidInfo(bid, opts).rank;
  assert.ok(rank("7 ♣") < rank("Misere") && rank("Misere") < rank("7 ♦"));
  assert.ok(rank("8 ♣") < rank("Open Misere") && rank("Open Misere") < rank("8 ♦"));
  assert.ok(rank("9 ♣") < rank("Hi-Lo") && rank("Hi-Lo") < rank("9 ♦"));
});

test("only the enabled contracts are on offer", () => {
  const plain = availableBids({}).map((b) => b.bid);
  assert.ok(plain.includes("Misere"));
  assert.ok(plain.includes("Open Misere"));
  assert.ok(!plain.includes("Hi-Lo"));
  assert.ok(!plain.includes("Double Nullo"));
  assert.ok(!plain.includes("Blind Misere"));

  const loaded = availableBids({ hiLo: true, doubleNullo: true, blindMisere: true }).map(
    (b) => b.bid
  );
  assert.ok(loaded.includes("Hi-Lo"));
  assert.ok(loaded.includes("Double Nullo"));
  assert.ok(loaded.includes("Blind Misere"));

  const noOpen = availableBids({ openMisere: false }).map((b) => b.bid);
  assert.ok(!noOpen.includes("Open Misere"));
});

test("an auction ends when everyone but the high bidder has passed", () => {
  const game = table();
  game.startAuction(0);
  const result = runAuction(game, [
    [0, "6 ♠"],
    [1, "Pass"],
    [2, "7 ♥"],
    [3, "Pass"],
    [0, "Pass"],
  ]);
  assert.equal(result.complete, true);
  assert.equal(result.allPassed, false);
  assert.equal(game.auction.highBid.bid, "7 ♥");
  assert.equal(game.auction.highBid.seat, 2);
});

test("four passes is a dead hand", () => {
  const game = table();
  game.startAuction(0);
  const result = runAuction(game, [
    [0, "Pass"],
    [1, "Pass"],
    [2, "Pass"],
    [3, "Pass"],
  ]);
  assert.equal(result.complete, true);
  assert.equal(result.allPassed, true);
});

test("a pass is final by default, but bid-after-pass lets you back in", () => {
  const strict = table();
  strict.startAuction(0);
  runAuction(strict, [
    [0, "Pass"],
    [1, "6 ♠"],
  ]);
  assert.equal(strict.auction.turnSeat, 2);
  assert.equal(strict.bidLegality(0, "7 ♠").ok, false);

  const loose = table({ bidAfterPass: true });
  loose.startAuction(0);
  runAuction(loose, [
    [0, "Pass"],
    [1, "6 ♠"],
    [2, "Pass"],
    [3, "Pass"],
  ]);
  // Seat 0 gets another turn now there's been an intervening bid.
  assert.equal(loose.auction.turnSeat, 0);
  assert.equal(loose.bidLegality(0, "7 ♠").ok, true);
});

test("a bid has to beat the standing one", () => {
  const game = table();
  game.startAuction(0);
  runAuction(game, [[0, "8 ♦"]]);
  assert.equal(game.bidLegality(1, "8 ♠").ok, false);
  assert.equal(game.bidLegality(1, "Misere").ok, false, "Misère is below 8♦");
  assert.equal(game.bidLegality(1, "8 ♥").ok, true);
});

test("Misère waits for the seven level unless the table says otherwise", () => {
  const game = table();
  game.startAuction(0);
  assert.equal(game.bidLegality(0, "Misere").ok, false);
  runAuction(game, [
    [0, "6 ♠"],
    [1, "Pass"],
  ]);
  assert.equal(game.bidLegality(2, "Misere").ok, false, "still no seven bid");
  runAuction(game, [[2, "7 ♠"]]);
  assert.equal(game.bidLegality(3, "Misere").ok, true);

  const anytime = table({ misereAnytime: true });
  anytime.startAuction(0);
  assert.equal(anytime.bidLegality(0, "Misere").ok, true);
});

test("Blind Misère is an opening call only", () => {
  const game = table({ blindMisere: true });
  game.startAuction(0);
  assert.equal(game.bidLegality(0, "Blind Misere").ok, true);
  runAuction(game, [
    [0, "6 ♠"],
    [1, "Pass"],
    [2, "Pass"],
    [3, "Pass"],
  ]);
  // Seat 0 has already spoken, so the blind bid has gone for them.
  const again = table({ blindMisere: true, bidAfterPass: true });
  again.startAuction(0);
  runAuction(again, [
    [0, "Pass"],
    [1, "6 ♠"],
    [2, "Pass"],
    [3, "Pass"],
  ]);
  assert.equal(again.auction.turnSeat, 0);
  assert.equal(again.bidLegality(0, "Blind Misere").ok, false);
});

test("the Ralphing bar keeps a seat out of the next auction", () => {
  const game = table({ ralphing: true });
  game.startAuction(0);
  game.barFromBidding([0]);
  assert.equal(game.auction.turnSeat, 1);
  assert.equal(game.bidLegality(0, "6 ♠").ok, false);
});

test("a solo contract folds the bidder's partner", () => {
  const game = table();
  game.startAuction(0);
  runAuction(game, [
    [0, "7 ♠"],
    [1, "Misere"],
    [2, "Pass"],
    [3, "Pass"],
    [0, "Pass"],
  ]);
  game.completeBidding();
  assert.equal(game.currentBid.bid, "Misere");
  assert.equal(game.players[3].folded, true, "seat 1's partner is seat 3");
  assert.deepEqual(game.activeSeats(), [0, 1, 2]);
  assert.equal(game.trumpSuit, null);
});

test("Double Nullo keeps both partners in", () => {
  const game = table({ doubleNullo: true });
  game.startAuction(0);
  runAuction(game, [
    [0, "Double Nullo"],
    [1, "Pass"],
    [2, "Pass"],
    [3, "Pass"],
  ]);
  game.completeBidding();
  assert.deepEqual(game.activeSeats(), [0, 1, 2, 3]);
});

test("the kitty joins the bidder's hand and three come back out", () => {
  const game = table();
  game.players[0].hand = [
    c("A", "♠"), c("K", "♠"), c("Q", "♠"), c("J", "♠"), c("10", "♠"),
    c("A", "♥"), c("K", "♥"), c("Q", "♥"), c("4", "♦"), c("5", "♦"),
  ];
  game.kitty = [c("A", "♦"), c("K", "♦"), c("5", "♣")];
  game.takeKitty(0);
  assert.equal(game.players[0].hand.length, 13);

  const bad = game.discard(0, game.players[0].hand.slice(0, 9));
  assert.equal(bad.success, false);

  const keep = game.players[0].hand.filter(
    (card) => !(card.suit === "♦" && ["4", "5"].includes(card.value)) && card.value !== "5"
  );
  const result = game.discard(0, keep);
  assert.equal(result.success, true);
  assert.equal(game.players[0].hand.length, 10);
  assert.equal(result.discarded.length, 3);
});

test("card ranking: Joker, then the bowers, then the trump suit", () => {
  const trump = "♠";
  const rank = (card) => getCardRank(card, trump, "♠");
  assert.ok(rank(JOKER) > rank(c("J", "♠")));
  assert.ok(rank(c("J", "♠")) > rank(c("J", "♣")), "right bower beats left");
  assert.ok(rank(c("J", "♣")) > rank(c("A", "♠")), "left bower beats the ace of trumps");
  assert.ok(rank(c("A", "♠")) > rank(c("K", "♠")));
  // An off-suit card that isn't trump can't win anything.
  assert.equal(getCardRank(c("A", "♥"), trump, "♠"), -1);
});

test("the left bower counts as trump when following suit", () => {
  assert.equal(getEffectiveSuit(c("J", "♣"), "♠"), "♠");
  assert.equal(getEffectiveSuit(JOKER, "♠"), "♠");
  assert.equal(getEffectiveSuit(c("J", "♠"), "♥"), "♠");
});

test("J5 puts the jacks above the aces at no trumps", () => {
  const plain = { j5: false };
  const j5 = { j5: true };
  assert.ok(getCardRank(c("A", "♥"), null, "♥", plain) > getCardRank(c("J", "♥"), null, "♥", plain));
  assert.ok(getCardRank(c("J", "♥"), null, "♥", j5) > getCardRank(c("A", "♥"), null, "♥", j5));
  // With a trump suit the jacks are bowers and J5 doesn't come into it.
  assert.ok(getCardRank(c("A", "♥"), "♠", "♥", j5) > getCardRank(c("J", "♥"), "♠", "♥", j5));
});

test("you must follow suit when you can", () => {
  const game = table();
  game.trumpSuit = "♠";
  game.currentBid = { seat: 0, player: "u0", bid: "7 ♠", points: 140 };
  game.players[0].hand = [c("A", "♥")];
  game.players[1].hand = [c("K", "♥"), c("5", "♠")];

  assert.equal(game.playCard(0, c("A", "♥")).success, true);
  const revoke = game.playCard(1, c("5", "♠"));
  assert.equal(revoke.success, false);
  assert.match(revoke.reason, /follow suit/);
  assert.equal(game.playCard(1, c("K", "♥")).success, true);
});

test("a card you don't hold is refused", () => {
  const game = table();
  game.players[0].hand = [c("A", "♥")];
  assert.equal(game.playCard(0, c("A", "♠")).success, false);
});

test("leading the Joker at no trumps needs a nominated suit", () => {
  const game = table();
  game.currentBid = { seat: 0, player: "u0", bid: "7 NT", points: 220 };
  game.players[0].hand = [JOKER, c("A", "♥")];

  assert.equal(game.playCard(0, JOKER).success, false);
  const led = game.playCard(0, JOKER, "♣");
  assert.equal(led.success, true);
  assert.equal(game.currentTrick[0].nominatedSuit, "♣");
  assert.equal(game.getLeadSuit(game.currentTrick[0]), "♣");
});

test("the strict Joker rule keeps it out of the lead", () => {
  const game = table({ jokerLeadAnytime: false });
  game.currentBid = { seat: 0, player: "u0", bid: "7 NT", points: 220 };
  game.players[0].hand = [JOKER, c("A", "♥")];
  assert.equal(game.playCard(0, JOKER, "♣").success, false);

  // Unless it's the only card left, when there's nothing else to lead.
  game.players[0].hand = [JOKER];
  assert.equal(game.playCard(0, JOKER, "♣").success, true);
});

test("a Misère hand can't sit on the Joker", () => {
  const game = table();
  game.currentBid = { seat: 1, player: "u1", bid: "Misere", points: 250 };
  game.players[3].folded = true;
  game.players[0].hand = [c("A", "♥")];
  game.players[1].hand = [JOKER, c("4", "♦")];

  game.playCard(0, c("A", "♥"));
  const held = game.playCard(1, c("4", "♦"));
  assert.equal(held.success, false);
  assert.match(held.reason, /must play the Joker/);
  assert.equal(game.playCard(1, JOKER).success, true);
});

test("the highest trump takes the trick and leads the next one", () => {
  const game = table();
  game.trumpSuit = "♠";
  game.currentBid = { seat: 0, player: "u0", bid: "7 ♠", points: 140 };
  game.players[0].hand = [c("A", "♥")];
  game.players[1].hand = [c("K", "♥")];
  game.players[2].hand = [c("5", "♠")];
  game.players[3].hand = [c("4", "♥")];

  game.playCard(0, c("A", "♥"));
  game.playCard(1, c("K", "♥"));
  game.playCard(2, c("5", "♠"));
  game.playCard(3, c("4", "♥"));
  assert.equal(game.trickIsComplete(), true);

  const trick = game.resolveTrick();
  assert.equal(trick.seat, 2);
  assert.equal(game.players[2].tricksWon, 1);
  assert.equal(game.currentSeat, 2);
  assert.equal(game.currentTrick.length, 0);
});

test("a trick is three cards when a partner has folded", () => {
  const game = table();
  game.currentBid = { seat: 0, player: "u0", bid: "Misere", points: 250 };
  game.players[2].folded = true;
  [0, 1, 3].forEach((seat) => {
    game.players[seat].hand = [c("A", "♥")];
  });
  game.playCard(0, c("A", "♥"));
  game.playCard(1, c("A", "♥"));
  assert.equal(game.trickIsComplete(), false);
  game.playCard(3, c("A", "♥"));
  assert.equal(game.trickIsComplete(), true);
});

// ---- scoring ----

function scoredHand({ options, bid, seat = 0, tricks }) {
  const game = table(options);
  game.currentBid = { seat, player: `u${seat}`, bid, points: bidInfo(bid, game.options).points };
  const spec = game.contractSpec();
  if (spec?.solo) game.players[game.partnerOf(seat)].folded = true;
  tricks.forEach((won, s) => {
    game.players[s].tricksWon = won;
  });
  return { game, result: game.scoreRound() };
}

test("a made contract scores its value and the defenders take ten a trick", () => {
  const { game, result } = scoredHand({ bid: "7 ♠", tricks: [4, 1, 3, 2] });
  assert.equal(result.made, true);
  assert.deepEqual(result.deltas, [140, 30]);
  assert.deepEqual(game.teamScores, [140, 30]);
});

test("a missed contract loses its value, and the defenders still score", () => {
  const { result } = scoredHand({ bid: "8 ♥", tricks: [3, 3, 2, 2] });
  assert.equal(result.made, false);
  assert.deepEqual(result.deltas, [-300, 50]);
});

test("trick points can be switched off", () => {
  const { result } = scoredHand({
    options: { trickPoints: false },
    bid: "7 ♠",
    tricks: [4, 1, 3, 2],
  });
  assert.deepEqual(result.deltas, [140, 0]);
});

test("all ten tricks on a cheap contract pays the 250 slam", () => {
  const { result } = scoredHand({ bid: "6 ♠", tricks: [6, 0, 4, 0] });
  assert.equal(result.made, true);
  assert.equal(result.slam, true);
  assert.deepEqual(result.deltas, [250, 0]);

  const noBonus = scoredHand({
    options: { slamBonus: false },
    bid: "6 ♠",
    tricks: [6, 0, 4, 0],
  });
  assert.deepEqual(noBonus.result.deltas, [40, 0]);

  // A contract already worth more than 250 isn't dragged down to it.
  const rich = scoredHand({ bid: "9 ♥", tricks: [6, 0, 4, 0] });
  assert.deepEqual(rich.result.deltas, [400, 0]);
});

test("Misère is made on nothing and pays nobody for tricks", () => {
  const clean = scoredHand({ bid: "Misere", tricks: [0, 5, 0, 0] });
  assert.equal(clean.result.made, true);
  assert.deepEqual(clean.result.deltas, [250, 0]);

  const broken = scoredHand({ bid: "Misere", tricks: [1, 5, 0, 0] });
  assert.equal(broken.result.made, false);
  assert.deepEqual(broken.result.deltas, [-250, 0]);
});

test("Hi-Lo wants exactly five", () => {
  const opts = { hiLo: true };
  assert.equal(scoredHand({ options: opts, bid: "Hi-Lo", tricks: [5, 3, 0, 2] }).result.made, true);
  assert.equal(scoredHand({ options: opts, bid: "Hi-Lo", tricks: [6, 2, 0, 2] }).result.made, false);
  assert.equal(scoredHand({ options: opts, bid: "Hi-Lo", tricks: [4, 3, 0, 3] }).result.made, false);
  assert.deepEqual(
    scoredHand({ options: opts, bid: "Hi-Lo", tricks: [5, 3, 0, 2] }).result.deltas,
    [350, 0]
  );
});

test("Double Nullo needs both partners clean", () => {
  const opts = { doubleNullo: true };
  assert.equal(
    scoredHand({ options: opts, bid: "Double Nullo", tricks: [0, 6, 0, 4] }).result.made,
    true
  );
  assert.equal(
    scoredHand({ options: opts, bid: "Double Nullo", tricks: [0, 6, 1, 3] }).result.made,
    false,
    "the partner took one"
  );
});

test("Ralphing catches a bidder more than three tricks short", () => {
  const opts = { ralphing: true };
  // 9♥ with only five tricks is four short.
  assert.equal(
    scoredHand({ options: opts, bid: "9 ♥", tricks: [3, 3, 2, 2] }).result.ralphedSeat,
    0
  );
  // Three short is a set but not a Ralphing.
  assert.equal(
    scoredHand({ options: opts, bid: "9 ♥", tricks: [4, 2, 2, 2] }).result.ralphedSeat,
    null
  );
  // And nothing happens at a table that doesn't play it.
  assert.equal(scoredHand({ bid: "9 ♥", tricks: [3, 3, 2, 2] }).result.ralphedSeat, null);
});

test("an all-pass hand played at no trumps is worth ten a trick", () => {
  const game = table({ allPassNoTrump: true });
  game.startAuction(0);
  runAuction(game, [
    [0, "Pass"],
    [1, "Pass"],
    [2, "Pass"],
    [3, "Pass"],
  ]);
  assert.equal(game.completeBidding(), null);
  assert.equal(game.noContract, true);
  game.players[0].tricksWon = 4;
  game.players[1].tricksWon = 3;
  game.players[2].tricksWon = 2;
  game.players[3].tricksWon = 1;
  const result = game.scoreRound();
  assert.equal(result.noContract, true);
  assert.deepEqual(result.deltas, [60, 40]);
});

// ---- winning ----

test("500 wins, and the team that made its bid takes a shared finish", () => {
  const game = table();
  game.teamScores = [520, 210];
  assert.deepEqual(game.checkGameOver(0), { team: 0, reason: "target" });

  game.teamScores = [510, 500];
  assert.equal(game.checkGameOver(1).team, 1, "the bidding team wins a tie-break");
});

test("must-bid-to-win holds back a team that got there on tricks", () => {
  const game = table({ mustBidToWin: true });
  game.teamScores = [140, 520];
  assert.equal(game.checkGameOver(0), null, "team 1 got there on trick points");
  assert.equal(game.checkGameOver(1).team, 1);
});

test("−500 goes out the back door", () => {
  const game = table();
  game.teamScores = [-500, 120];
  assert.deepEqual(game.checkGameOver(1), { team: 1, reason: "backDoor" });

  const off = table({ backDoor: false });
  off.teamScores = [-620, 120];
  assert.equal(off.checkGameOver(1), null);
});

test("the point-spread rule ends a runaway game", () => {
  const game = table({ pointSpread: true });
  game.teamScores = [400, -150];
  assert.deepEqual(game.checkGameOver(0), { team: 0, reason: "pointSpread" });
  // Both positive is just a big lead, not a finish.
  game.teamScores = [480, 20];
  assert.equal(game.checkGameOver(0), null);
});

test("a broken Misère is decided before the cards run out", () => {
  const game = table();
  game.currentBid = { seat: 0, player: "u0", bid: "Misere", points: 250 };
  game.players[2].folded = true;
  [0, 1, 3].forEach((seat) => {
    game.players[seat].hand = [c("A", "♥"), c("K", "♥")];
  });
  assert.equal(game.isRoundDecided(), false);
  game.players[0].tricksWon = 1;
  assert.equal(game.isRoundDecided(), true);
});

test("a Hi-Lo that can no longer reach five is decided early", () => {
  const game = table({ hiLo: true });
  game.currentBid = { seat: 0, player: "u0", bid: "Hi-Lo", points: 350 };
  game.players[2].folded = true;
  [0, 1, 3].forEach((seat) => {
    game.players[seat].hand = [c("A", "♥"), c("K", "♥")];
  });
  game.players[0].tricksWon = 2;
  assert.equal(game.isRoundDecided(), true, "two won plus two left can't make five");
  game.players[0].tricksWon = 6;
  assert.equal(game.isRoundDecided(), true, "already past five");
  game.players[0].tricksWon = 4;
  assert.equal(game.isRoundDecided(), false);
});
