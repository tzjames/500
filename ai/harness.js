#!/usr/bin/env node
// The training environment, spoken as line-delimited JSON over stdin/stdout.
//
// The rules of 500 live in JavaScript and the reinforcement-learning tooling
// lives in Python, and reimplementing the former in the latter is how a trainer
// ends up producing a bot that is excellent at a game nobody plays. So Python
// never learns the rules: it sends an action index and reads back a vector, a
// mask and a reward, and every question about legality is answered by the same
// engine that answers it for a real table.
//
// Requests, one JSON object per line:
//   {"cmd":"info"}                                  → the space's dimensions
//   {"cmd":"reset","options":{...},"dealer":0}       → first decision of a hand
//   {"cmd":"step","action":7}                        → next decision, or the score
//
// Replies, one per request:
//   {"done":false,"seat":2,"kind":"play","obs":[...],"mask":[...]}
//   {"done":true,"rewards":[0.48,-0.48,0.48,-0.48],"info":{...}}
//   {"error":"..."}                                  → never a crash; Python decides
const readline = require("node:readline");

const bot = require("../server/bot");
const { Episode } = require("../server/episode");
const {
  ACTION_COUNT,
  BID_ACTIONS,
  DECISION_KINDS,
  OBS_SIZE,
  OPTION_IDS,
  bidAction,
  cardActionOf,
  needsNomination,
  NOMINATE_OFFSET,
} = require("../server/obs");
const { REAL_SUITS } = require("../server/game4");

let episode = null;
let heuristicSeats = [];
let heuristicKinds = [];

const sameCard = (a, b) => a.suit === b.suit && a.value === b.value;

// The existing rule-of-thumb bot, expressed as an action index — which is what
// makes "is the trained policy actually better?" a question this harness can
// answer, rather than one requiring a second implementation of the heuristics
// in Python. Seats listed in `heuristicSeats` are played by server/bot.js, so a
// measured win rate is against the very code that is live today.
function heuristicAction(episode) {
  const { game } = episode;
  const { seat, kind } = episode.decision();

  if (kind === "bid") return bidAction(bot.chooseBid(game, seat));

  if (kind === "play") {
    const choice = bot.choosePlay(game, seat);
    if (needsNomination(game, choice.card)) {
      return NOMINATE_OFFSET + REAL_SUITS.indexOf(choice.nominatedSuit);
    }
    return cardActionOf(choice.card);
  }

  // The two sequential picks. Both heuristics decide all their cards at once,
  // and the hand isn't touched until the last pick lands, so each call returns
  // the same set — take the first card from it not already picked.
  let wanted;
  if (kind === "discard") {
    const keeping = bot.chooseDiscard(game, seat);
    wanted = game.players[seat].hand.filter(
      (card) => !keeping.some((keep) => sameCard(keep, card))
    );
  } else {
    wanted = bot.choosePass(game, seat);
  }
  const next = wanted.find(
    (card) => !episode.pick.chosen.some((chosen) => sameCard(chosen, card))
  );
  return cardActionOf(next);
}

// `heuristicKinds` hands one *sort* of decision to the heuristics for every
// seat, which is what makes a curriculum possible. Learning to bid and learning
// to play are entangled: a fresh policy bids badly, learns that bidding loses,
// passes on everything, and then never plays a card — so it can't learn to play,
// and bidding stays unattractive because it plays badly. Letting bot.js do the
// bidding breaks the loop. Contracts get bought, hands get played out, and the
// policy learns cards from full hands; bidding is unfrozen afterwards, by which
// point it has something worth bidding on.
const isHeuristicTurn = () => {
  const { seat, kind } = episode.decision();
  return heuristicSeats.includes(seat) || heuristicKinds.includes(kind);
};

// Plays out every consecutive decision the caller isn't responsible for, so it
// only ever sees the ones it is.
function runHeuristicSeats() {
  while (!episode.done && isHeuristicTurn()) {
    episode.step(heuristicAction(episode));
  }
}

// A finished hand reports every seat's reward at once. The env on the other side
// is turn-based — only one seat was asked anything at a time — so it needs all
// four to credit the seats that acted earlier in the hand.
const reply = () => {
  if (!episode) return { error: "no hand in progress; reset first" };
  if (episode.done) {
    return { done: true, rewards: episode.rewards, info: episode.info };
  }
  const view = episode.observation();
  return { done: false, seat: view.seat, kind: view.kind, obs: view.obs, mask: view.mask };
};

function handle(request) {
  switch (request.cmd) {
    case "info":
      return {
        obsSize: OBS_SIZE,
        actionCount: ACTION_COUNT,
        bids: BID_ACTIONS,
        kinds: DECISION_KINDS,
        options: OPTION_IDS,
      };

    case "reset":
      episode = new Episode(request.options || {}, request.dealer || 0, {
        passOutPenalty: request.passOutPenalty || 0,
        teamScores: request.teamScores || [0, 0],
        barredSeats: request.barredSeats || [],
      });
      heuristicSeats = request.heuristicSeats || [];
      heuristicKinds = request.heuristicKinds || [];
      runHeuristicSeats();
      return reply();

    case "step":
      if (!episode) return { error: "no hand in progress; reset first" };
      if (episode.done) return { error: "the hand is already over" };
      if (!Number.isInteger(request.action) || request.action < 0 || request.action >= ACTION_COUNT) {
        return { error: `action ${request.action} is outside the space` };
      }
      episode.step(request.action);
      runHeuristicSeats();
      return reply();

    default:
      return { error: `unknown command ${request.cmd}` };
  }
}

const out = readline.createInterface({ input: process.stdin, terminal: false });

out.on("line", (line) => {
  if (!line.trim()) return;
  let response;
  try {
    response = handle(JSON.parse(line));
  } catch (err) {
    // An illegal action or a malformed request is reported rather than thrown:
    // a training run that loses its environment mid-rollout should be told why,
    // not left reading from a closed pipe.
    response = { error: err.message };
  }
  process.stdout.write(`${JSON.stringify(response)}\n`);
});
