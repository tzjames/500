// A room's log split into the hands it actually dealt.
//
// The subtlety is the thrown-in hand. A hand nobody wants is redealt under the
// same hand number, so the log holds two `deal` entries for one round — and
// bucketing by round number alone merges them, which is how a panel ends up
// showing one deal's turn-up above the bidding that happened on another's.
// A deal starts a hand here, and the round number is only a label.
function handsFromLog(log = [], { keep, marks = ["throwIn", "redeal"] }) {
  const hands = [];
  for (const entry of log) {
    if (entry.type === "deal") {
      hands.push({ round: entry.round, deal: entry, calls: [], thrownIn: false });
      continue;
    }
    const hand = hands[hands.length - 1];
    if (!hand) continue;
    if (marks.includes(entry.type)) hand.thrownIn = true;
    if (keep(entry.type)) hand.calls.push(entry);
  }
  return hands;
}

// A round's result belongs to the last deal of it: the ones before were thrown
// in and never scored.
function attachResults(hands, resultFor) {
  hands.forEach((hand, i) => {
    const lastOfRound = i === hands.length - 1 || hands[i + 1].round !== hand.round;
    if (lastOfRound) hand.result = resultFor(hand.round) || null;
  });
  return hands;
}

// Newest first: the hand someone wants to check is almost always the last one.
const newestFirst = (hands) => [...hands].reverse();

module.exports = { handsFromLog, attachResults, newestFirst };
