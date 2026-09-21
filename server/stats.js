// The stats page's numbers. Everything here is derived from finished games and
// the per-round rows written as hands are scored — nothing is kept as a running
// tally, so a figure can't drift out of step with the games behind it.
const db = require("./db");
const { availableBids } = require("./game4");
const { isFriendlyGame } = require("./friendly");

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
  // Every game but 500 persists its seating in the snapshot, with a team field
  // where it has partnerships at all — so one branch covers all of them, and
  // 500 stays the special case because it predates both.
  if (game.gameType && game.gameType !== "500") {
    const seats = game.snapshot?.game?.players || [];
    const mySeat = seats.find((seat) => game.playerSlots?.[seat.seat]?.userId === userId);
    // Some rule sets have partnerships at a four-seat table and some don't; a
    // seat with no team is one where everybody else is an opponent.
    if (mySeat && mySeat.team !== null && mySeat.team !== undefined) {
      const partnerSeat = seats.find((seat) => seat.team === mySeat.team && seat.seat !== mySeat.seat);
      const partner = partnerSeat ? game.playerSlots?.[partnerSeat.seat] || null : null;
      const opponents = seats
        .filter((seat) => seat.team !== mySeat.team)
        .map((seat) => game.playerSlots?.[seat.seat])
        .filter(Boolean);
      return { partner, opponents };
    }
    return { partner: null, opponents: slots.filter((slot) => slot.userId !== userId) };
  }
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

// A robot is minted with a fresh id every time one is seated, so keying a
// record by that id files every game against Ada under a heading of its own.
// Their name is the only identity a robot has, and the only one worth keeping.
const identityOf = (slot) =>
  slot.isBot || slot.userId?.startsWith("bot:") ? `bot:${slot.name}` : slot.userId;

// Tally helper: a bucket per key, created on first sight.
function tally(map, key, label, isWin) {
  if (!map.has(key)) map.set(key, { key, label, wins: 0, losses: 0 });
  const row = map.get(key);
  if (isWin) row.wins += 1;
  else row.losses += 1;
  return row;
}

const byPlayed = (a, b) => b.wins + b.losses - (a.wins + a.losses);

// A round recorded before this feature existed only has the old `withBots`
// flag; a friendly one recorded since has `friendly` instead (which covers
// both a marked-friendly game and a robot one). Either says the same thing.
const isFriendlyRound = (round) => Boolean(round.friendly ?? round.withBots);

async function statsFor(userId, mode, includeFriendly = false, gameType = "500") {
  const [allGames, allRounds, elo] = await Promise.all([
    db.finishedGamesForUser(userId, mode, gameType),
    db.roundsBidBy(userId, mode, gameType),
    db.eloForUser(userId, gameType),
  ]);

  // A friendly game — marked that way, or with a robot at the table — is
  // practice by default: a win rate padded by beating robots, or by games that
  // were never meant to count, says nothing about how you actually do. Kept out
  // of the record unless asked for, and counted separately either way so the
  // page can say what it left out.
  const friendlyGames = allGames.filter(isFriendlyGame);
  const friendlyRounds = allRounds.filter(isFriendlyRound);
  const games = includeFriendly ? allGames : allGames.filter((game) => !isFriendlyGame(game));
  const bidRounds = includeFriendly ? allRounds : allRounds.filter((round) => !isFriendlyRound(round));
  const practiceGames = friendlyGames.length;
  const practiceRounds = friendlyRounds.length;

  let wins = 0;
  // Keyed by the whole table for four players — "with Ada against Bo and Cy" is
  // a different result from "with Bo against Ada and Cy" — and separately by
  // partner alone, which is the question people actually argue about.
  const tables = new Map();
  const partners = new Map();
  // Euchre and Hearts keep a record per rule set as well: winning at Set-Back
  // says nothing much about how you do at the standard game.
  const variants = new Map();

  for (const game of games) {
    const isWin = won(game, userId);
    if (isWin) wins += 1;
    const { partner, opponents } = tableFor(game, userId);
    const opponentNames = opponents.map((o) => o.name).sort();

    if (gameType !== "500") {
      tally(variants, game.variant || "northAmerican", game.variant || "northAmerican", isWin);
      if (opponents.length) {
        const opponentIds = opponents.map(identityOf).sort();
        const key = `${partner ? identityOf(partner) : "solo"}|${opponentIds.join("|")}`;
        const row = tally(tables, key, null, isWin);
        row.opponentNames = opponentNames;
        row.partnerName = partner?.name || null;
        row.label = partner
          ? `with ${partner.name} v ${opponentNames.join(" & ")}`
          : `v ${opponentNames.join(" & ")}`;
      }
      if (partner) tally(partners, identityOf(partner), partner.name, isWin).label = partner.name;
    } else if (mode === 4) {
      if (partner && opponents.length === 2) {
        const key = `${identityOf(partner)}|${opponents.map(identityOf).sort().join("|")}`;
        const row = tally(tables, key, null, isWin);
        row.partnerName = partner.name;
        row.opponentNames = opponentNames;
        row.label = `with ${partner.name} v ${opponentNames.join(" & ")}`;
      }
      if (partner) {
        const row = tally(partners, identityOf(partner), partner.name, isWin);
        row.label = partner.name;
      }
    } else if (opponents.length === 1) {
      const row = tally(tables, identityOf(opponents[0]), opponents[0].name, isWin);
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

  const bidList = (gameType === "500" ? (mode === 4 ? ALL_FOUR_PLAYER_BIDS : TWO_PLAYER_BIDS) : []).map((b) => {
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

  // Hearts has no contract at all — every seat plays every deal — so its rows
  // are one per player per deal and the figures are about how your own deals
  // went rather than about anything you bought.
  const mean = (rows, field) =>
    rows.length ? Math.round((rows.reduce((sum, r) => sum + (r[field] || 0), 0) / rows.length) * 10) / 10 : 0;
  const hearts =
    gameType !== "hearts"
      ? null
      : {
          deals: bidRounds.length,
          clean: bidRounds.filter((r) => r.clean).length,
          averageTaken: mean(bidRounds, "taken"),
          worst: bidRounds.reduce((most, r) => Math.max(most, r.taken || 0), 0),
          moons: bidRounds.filter((r) => r.moon).length,
          moonsAgainst: bidRounds.filter((r) => r.moonAgainst).length,
          variants: [...variants.values()].sort(byPlayed),
        };

  // Euchre has no bid ladder to chart, so its own figures stand in: how often
  // the hands you called came home, and how the lone ones went.
  const euchre =
    gameType !== "euchre"
      ? null
      : {
          called: bidRounds.length,
          made: bidRounds.filter((r) => r.made).length,
          marches: bidRounds.filter((r) => r.marched).length,
          alone: bidRounds.filter((r) => r.alone).length,
          aloneMade: bidRounds.filter((r) => r.alone && r.made).length,
          variants: [...variants.values()].sort(byPlayed),
        };

  return {
    mode,
    gameType,
    euchre,
    hearts,
    elo: elo[mode],
    includeFriendly,
    games: games.length,
    wins,
    losses: games.length - wins,
    practiceGames,
    practiceRounds,
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
