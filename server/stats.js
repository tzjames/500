// The stats page's numbers. Everything here is derived from finished games and
// the per-round rows written as hands are scored — nothing is kept as a running
// tally, so a figure can't drift out of step with the games behind it.
const db = require("./db");
const { availableBids } = require("./game4");

// Every bid the four-player game can offer at all, with every optional contract
// switched on — the bid-by-bid chart wants a fixed set of columns whatever the
// tables this player happened to sit at were playing.
const ALL_FOUR_PLAYER_BIDS = availableBids({
  openMisere: true,
  blindMisere: true,
  hiLo: true,
  doubleNullo: true,
});

// The two-player game's own bid list, which has never had options.
const TWO_PLAYER_BIDS = [
  ...ALL_FOUR_PLAYER_BIDS.filter((b) => !b.special),
  { bid: "Misere", points: 250, special: true },
  { bid: "Open Misere", points: 500, special: true },
];

function won(game, userId) {
  if (!game.winner) return false;
  return game.winner.id === userId || (game.winner.playerIds || []).includes(userId);
}

// Who this player was sitting with and against. Two-player games have one
// opponent and no partner; four-player games read the pairing off the seat
// order, which is what the room persisted when the table was seated.
function tableFor(game, userId) {
  const slots = (game.playerSlots || []).filter(Boolean);
  if (game.mode !== 4) {
    const opponent = slots.find((s) => s.userId !== userId);
    return { partner: null, opponents: opponent ? [opponent] : [] };
  }
  const order = game.snapshot?.seatOrder;
  if (!order || order.length !== 4) {
    // A four-player game that never got as far as being seated has no pairing
    // to report; count it as a game but not as a partnership.
    return { partner: null, opponents: slots.filter((s) => s.userId !== userId) };
  }
  const byId = new Map(slots.map((s) => [s.userId, s]));
  const seat = order.indexOf(userId);
  if (seat === -1) return { partner: null, opponents: [] };
  return {
    partner: byId.get(order[(seat + 2) % 4]) || null,
    opponents: [byId.get(order[(seat + 1) % 4]), byId.get(order[(seat + 3) % 4])].filter(Boolean),
  };
}

// Tally helper: a bucket per key, created on first sight.
function tally(map, key, label, isWin) {
  if (!map.has(key)) map.set(key, { key, label, wins: 0, losses: 0 });
  const row = map.get(key);
  if (isWin) row.wins += 1;
  else row.losses += 1;
  return row;
}

const byPlayed = (a, b) => b.wins + b.losses - (a.wins + a.losses);

async function statsFor(userId, mode) {
  const [games, bidRounds, elo] = await Promise.all([
    db.finishedGamesForUser(userId, mode),
    db.roundsBidBy(userId, mode),
    db.eloForUser(userId),
  ]);

  let wins = 0;
  // Keyed by the whole table for four players — "with Ada against Bo and Cy" is
  // a different result from "with Bo against Ada and Cy" — and separately by
  // partner alone, which is the question people actually argue about.
  const tables = new Map();
  const partners = new Map();

  for (const game of games) {
    const isWin = won(game, userId);
    if (isWin) wins += 1;
    const { partner, opponents } = tableFor(game, userId);
    const opponentNames = opponents.map((o) => o.name).sort();

    if (mode === 4) {
      if (partner && opponents.length === 2) {
        const key = `${partner.userId}|${opponents.map((o) => o.userId).sort().join("|")}`;
        const row = tally(tables, key, null, isWin);
        row.partnerName = partner.name;
        row.opponentNames = opponentNames;
        row.label = `with ${partner.name} v ${opponentNames.join(" & ")}`;
      }
      if (partner) {
        const row = tally(partners, partner.userId, partner.name, isWin);
        row.label = partner.name;
      }
    } else if (opponents.length === 1) {
      const row = tally(tables, opponents[0].userId, opponents[0].name, isWin);
      row.label = opponents[0].name;
      row.opponentNames = opponentNames;
    }
  }

  // How close this player's own contracts came. Numeric bids only: "over by
  // one" has no meaning for a Misère, which is either clean or broken.
  const accuracy = new Map();
  const bids = new Map();
  let numericContracts = 0;
  let specialContracts = 0;
  let specialMade = 0;

  for (const round of bidRounds) {
    if (!bids.has(round.bid)) bids.set(round.bid, { bid: round.bid, attempts: 0, made: 0 });
    const bidRow = bids.get(round.bid);
    bidRow.attempts += 1;
    if (round.made) bidRow.made += 1;

    if (round.level) {
      numericContracts += 1;
      const diff = round.tricks - round.level;
      accuracy.set(diff, (accuracy.get(diff) || 0) + 1);
    } else {
      specialContracts += 1;
      if (round.made) specialMade += 1;
    }
  }

  const bidList = (mode === 4 ? ALL_FOUR_PLAYER_BIDS : TWO_PLAYER_BIDS).map((b) => {
    const row = bids.get(b.bid);
    return {
      bid: b.bid,
      points: b.points,
      special: Boolean(b.special),
      level: b.level ?? null,
      suit: b.suit ?? null,
      attempts: row?.attempts || 0,
      made: row?.made || 0,
    };
  });

  return {
    mode,
    elo: elo[mode],
    games: games.length,
    wins,
    losses: games.length - wins,
    contracts: {
      total: numericContracts + specialContracts,
      numeric: numericContracts,
      special: specialContracts,
      specialMade,
      made: bidRounds.filter((r) => r.made).length,
      // Sorted so the chart's bars read from "well short" to "well over".
      accuracy: [...accuracy.entries()]
        .map(([diff, count]) => ({ diff: Number(diff), count }))
        .sort((a, b) => a.diff - b.diff),
    },
    bids: bidList,
    tables: [...tables.values()].sort(byPlayed),
    partners: [...partners.values()].sort(byPlayed),
  };
}

module.exports = { statsFor };
