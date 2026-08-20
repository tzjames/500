# Training a 500 bot

The robots in `server/bot.js` play by rules of thumb, and rules of thumb run out
— they'll lead a trump into a table that's void in trumps, because no rule was
written for it. This trains a policy by self-play instead, and deploys it as a
drop-in replacement for those four functions.

## How the pieces fit

The rules of 500 stay in JavaScript. Reimplementing them in Python is how you
end up with a bot that is excellent at a game nobody plays, so Python never
learns the rules at all — it sends an action index down a pipe and reads back a
vector, a legal-action mask and a reward.

```
server/game4.js      the engine — rules, legal moves, scoring (unchanged)
server/obs.js        state → 503 floats; the 80-action space; the legality mask
server/episode.js    one hand, walked a decision at a time
ai/harness.js        the above, spoken as JSON over stdin/stdout
   │
   ├── ai/env.py     Python's end of the pipe
   ├── ai/model.py   the network: 503 → 512 → 512 → 256 → 80
   ├── ai/train.py   PPO, self-play, league
   └── ai/evaluate.py   trained policy vs the bot that's live today
          │
          └── ai/export_weights.py → server/models/bot.json
                                          │
server/net.js        the forward pass, in plain JS
server/botPolicy.js  the model if there is one, bot.js if there isn't
```

Two properties hold this together, and both are tested:

- **One encoder.** `server/obs.js` is used by the trainer *and* by the live
  server, so a policy is fed the same numbers in production as in training.
- **One forward pass, checked twice.** `ai/export_weights.py` records worked
  examples from PyTorch; `server/net.test.js` replays them in JavaScript. If the
  two ever disagree, that's a failing test rather than a bot that plays subtly
  differently once deployed.

## Why not RLlib, and why not ONNX

**RLlib** is the obvious choice and was the first plan. It was dropped because
action masking is the most version-fragile corner of Ray's API — it has moved
between `ModelV2` and `RLModule` and will move again — and masking is
non-negotiable here. A masked PPO for a network this small is a couple of
hundred lines that will still run in three years. RLlib earns its keep at
distributed scale, which a game with a 45-card deck doesn't need.

**ONNX** was the first plan for deployment. `onnxruntime-node` is a large native
binary, and its `run()` is asynchronous while `room4.js` asks for a move
synchronously — so it would have meant a heavier deploy image *and* making the
bot interface async. The network is four dense layers; running it in JavaScript
is well under a millisecond and needs nothing installed. `ai/export_onnx.py` is
still here for the other shape of deployment: if inference ever moves into the
browser, ONNX plus `onnxruntime-web` is the way to do it.

## The training setup

**Reward** is the partnership's point swing for the hand, in units of the 500 it
takes to win a game — a made 8♠ is +0.48 to both its partners and −0.48 to both
defenders. Partners always score identically, so there's no way to learn to
profit at your partner's expense. One hand is one episode.

With reward arriving only at the end and no discounting, the advantage is just
`return − value`; there's nothing for GAE to do that a plain baseline doesn't.

**Observations are relative to the acting seat** — slot 0 is me, 1 is my left,
2 is my partner, 3 is my right — so one set of weights plays all four seats.
They contain only what that seat could see at a real table; `server/obs.test.js`
checks that by swapping the two hands it can't see and asserting its view of the
world doesn't move.

**Three kinds of hand** get dealt, and the mix is what keeps it honest:

| hand type | who plays | why |
| --- | --- | --- |
| self-play | learner takes all four seats | four seats of data per hand; the only source that improves as it does |
| league | learner vs a frozen older snapshot | stops it cycling into something that only beats its current self |
| heuristic | learner vs `server/bot.js` | a fixed, known opponent to measure against |

**House rules are sampled per hand** — mostly the defaults, sometimes a random
set. The option flags are in the observation, so this gives one model that can
sit at any table rather than one per ruleset.

## Running it

```bash
pip install -r ai/requirements.txt
```

Check the environment first — this needs no Python and should pass today:

```bash
node --test "server/*.test.js" "ai/*.test.js"
```

Train. It prints one JSON line per iteration and writes `best.pt` whenever it
improves on its best score against the heuristic bot:

```bash
python ai/train.py --iterations 2000 --envs 16
```

The line to watch is `edge` — the model's points per hand minus the heuristic
bot's on the same deals. A hand of 500 isn't zero-sum (defenders take ten a
trick as well as the bidders scoring), so `edge` is the number that means
"better", not the raw score. It's reported every `--eval-every` iterations.

Expect `reward` to move first, `made` (how often it brings home a contract it
bought) to follow, and bidding to be the slowest thing to settle — it's the
decision furthest from the reward.

If the table collapses into passing every hand out, `--pass-out-penalty 0.05`
is the lever: passing costs a real table nothing, so the default is 0.

Measure a checkpoint properly, broken down by ruleset:

```bash
python ai/evaluate.py ai/runs/latest/best.pt --hands 2000
```

Then deploy — this is the whole deployment step:

```bash
python ai/export_weights.py ai/runs/latest/best.pt
node --test server/net.test.js
```

That writes `server/models/bot.json` and verifies the JavaScript forward pass
agrees with PyTorch. Commit the file and push; `server/botPolicy.js` picks it up
at startup and logs which policy it's using. No new service, no new dependency,
no change to the Render setup.

To roll back, remove the file — the bots fall straight back to the heuristics.
`BOT_MODEL_PATH` overrides where it's loaded from.

**If you change `server/obs.js`, re-export.** A model is built for one exact
observation width, and the old file would otherwise be read against the new
encoding. `botPolicy.js` checks the model's dimensions against this server's
`OBS_SIZE`/`ACTION_COUNT` at startup and refuses one that disagrees, logging why
and falling back to the heuristics — so the failure is a line in the log rather
than bots that can't choose a move. Anything the model throws mid-hand is caught
the same way, because `room4.js` has already cleared the timer that would ask
again and a bot that throws would otherwise leave the hand with nobody to play.

## Things worth knowing

- **The score and any barred seat are sampled per hand.** Both are in the
  observation and both are real at a live table — a game reaches 460–390, and
  Ralphing bars a seat that went down badly. An episode is a single hand, so
  neither can affect its reward; they're varied anyway (`sample_table_state` in
  `env.py`) so the weights reading them are trained on the range they'll meet
  rather than on a constant zero.
- **Blind Misère never comes up in training.** It has to be declared before the
  deal, and nothing in the trainer declares it, so it stays masked off. A model
  will never bid it; the heuristics never did either.
- **Open Misère's exposed hand isn't modelled.** Defenders see the bidder's
  cards at a real table after the first trick; the observation doesn't include
  them, so the policy defends it as though it were an ordinary Misère.
- **Inference is greedy.** Four bots at a table share one policy but hold
  different cards, so they don't play alike. If they ever feel too predictable,
  sampling with a temperature is the knob to add in `server/botPolicy.js`.
- **`acceptsClaim` stays heuristic.** Whether to believe an opponent who claims
  the rest is a question of fact — do I hold a card nothing out there can beat —
  and a policy could only get it wrong.
