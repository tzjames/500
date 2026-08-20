"""Self-play training for a 500 bot.

Reward arrives once per hand — how far your partnership got ahead, your points
less theirs, in units of the 500 it takes to win. Crediting every decision in the
hand with that same number is what the first run did, and over thirty-odd
decisions it is mostly noise: a card played well in a hand that was lost anyway
scores exactly as badly as the blunder that lost it. Each seat's decisions are
now walked backwards through GAE instead (--gae-lambda), which leaves the optimal
policy alone where a hand-rolled per-trick bonus would not.

Bidding and card play are entangled, and training both from scratch at once
doesn't work: a fresh policy bids badly, learns that bidding loses points,
passes on everything, and then never plays a card — so it can't learn to play,
and bidding stays unattractive because it plays badly. Hence `--heuristic-kinds
bid`, which leaves the auction to server/bot.js so that contracts get bought and
hands get played out. Train that first, then resume with bidding unfrozen:

    python train.py --heuristic-kinds bid --iterations 1500 --out runs/cards
    python train.py --resume runs/cards/last.pt --iterations 2500 --out runs/full

Three kinds of hand get dealt, and the mix is what keeps training honest:

  * self-play — the learner takes all four seats. Four seats' worth of data per
    hand, and the only source that improves with the learner.
  * league    — the learner takes one partnership, a frozen older snapshot of
    itself takes the other. Stops the policy from cycling into something that
    only beats its current self.
  * heuristic — the other partnership is server/bot.js, the bot that is live
    today. An anchor: whatever self-play wanders off into, this hand type keeps
    measuring against a fixed, known opponent.

Only the learner's own seats are ever trained on.
"""

from __future__ import annotations

import argparse
import copy
import json
import random
import time
from pathlib import Path

import torch
import torch.nn.functional as F

from env import Harness, sample_options, sample_table_state
from model import Policy


class Table:
    """One harness, plus the bookkeeping for the hand it is playing."""

    def __init__(self, harness: Harness):
        self.harness = harness
        self.reply: dict | None = None
        self.active = True
        self.learner_seats: set[int] = set()
        self.opponent: int | None = None
        self.kind = "self"
        self.records: list[tuple] = []
        self.chosen: int | None = None

    def start_hand(self, rng: random.Random, league: list[Policy], cfg) -> None:
        roll = rng.random()
        if league and roll < cfg.league_frac:
            team = rng.randrange(2)
            self.learner_seats = {team, team + 2}
            self.opponent = rng.randrange(len(league))
            self.kind = "league"
            heuristic_seats: tuple[int, ...] = ()
        elif roll < cfg.league_frac + cfg.heuristic_frac:
            team = rng.randrange(2)
            self.learner_seats = {team, team + 2}
            self.opponent = None
            self.kind = "heuristic"
            heuristic_seats = tuple(s for s in range(4) if s not in self.learner_seats)
        else:
            self.learner_seats = {0, 1, 2, 3}
            self.opponent = None
            self.kind = "self"
            heuristic_seats = ()

        self.records = []
        options = sample_options(rng, cfg.mixed_rules)
        self.reply = self.harness.reset(
            options,
            dealer=rng.randrange(4),
            heuristic_seats=heuristic_seats,
            heuristic_kinds=cfg.heuristic_kinds,
            pass_out_penalty=cfg.pass_out_penalty,
            **sample_table_state(rng, options),
        )

    def owner(self, seat: int):
        return "learner" if seat in self.learner_seats else self.opponent

    def flush(self, batch: dict, stats: dict, lam: float = 0.95) -> None:
        """Bank the hand, crediting each decision for its share of the outcome.

        The reward lands once, at the end. Handing every decision in the hand the
        same number — as the first version did — means a well-played card in a
        hand that was lost anyway looks exactly as bad as the blunder that lost
        it, and with thirty-odd decisions a hand the gradient is mostly noise.

        So each seat's own decisions are walked backwards through GAE. With no
        intermediate rewards and no discounting, that blends "what actually
        happened" with "what the value head expected from here", and lambda says
        how far down the hand a decision is held responsible for. Unlike handing
        out per-trick rewards it cannot change which policy is optimal, which
        matters here: on a Misère winning a trick is a disaster, so a shaping
        term that paid for tricks would have to know the contract to get the sign
        right, and would quietly teach the wrong thing wherever it didn't.
        """
        rewards = self.reply["rewards"]

        # A seat's decisions in the order it made them. Other seats acted in
        # between, but with one reward at the end and no discounting, a seat's
        # own next decision is the successor state that matters to it.
        by_seat: dict = {}
        for record in self.records:
            by_seat.setdefault(record[5], []).append(record)

        for seat, steps in by_seat.items():
            advantage = 0.0
            # Nothing follows the hand, so the value beyond the last decision is
            # zero and the whole reward arrives there.
            next_value = 0.0
            for i in range(len(steps) - 1, -1, -1):
                obs, mask, action, logp, value, _ = steps[i]
                reward = rewards[seat] if i == len(steps) - 1 else 0.0
                delta = reward + next_value - value
                advantage = delta + lam * advantage
                next_value = value

                batch["obs"].append(obs)
                batch["mask"].append(mask)
                batch["action"].append(action)
                batch["logp"].append(logp)
                batch["adv"].append(advantage)
                batch["ret"].append(advantage + value)
        self.records = []

        info = self.reply["info"]
        stats["hands"] += 1
        stats[f"hands_{self.kind}"] = stats.get(f"hands_{self.kind}", 0) + 1
        if info.get("passedOut"):
            stats["passed_out"] += 1
            return
        # Measured from a seat the learner actually held, so it means something.
        seat = min(self.learner_seats)
        stats["reward"] += rewards[seat]
        if info.get("made") is not None:
            stats["contracts"] += 1
            if info["made"]:
                stats["made"] += 1


def collect(learner: Policy, league: list[Policy], tables: list[Table], cfg, rng, device):
    """Play hands until the batch is full, one batched forward pass per round."""
    batch = {k: [] for k in ("obs", "mask", "action", "logp", "adv", "ret")}
    stats = {"hands": 0, "passed_out": 0, "reward": 0.0, "contracts": 0, "made": 0}

    for table in tables:
        table.active = True
        table.start_hand(rng, league, cfg)

    while stats["hands"] < cfg.hands_per_batch:
        pending = []
        for table in tables:
            # A hand can finish the moment it starts — everyone passing it out —
            # so this loops rather than testing once.
            while table.active and table.reply["done"]:
                table.flush(batch, stats, cfg.gae_lambda)
                if stats["hands"] >= cfg.hands_per_batch:
                    table.active = False
                else:
                    table.start_hand(rng, league, cfg)
            if table.active:
                pending.append(table)

        if not pending:
            break

        by_owner: dict = {}
        for table in pending:
            by_owner.setdefault(table.owner(table.reply["seat"]), []).append(table)

        # One batched forward pass per policy that owns a seat this round...
        for owner, group in by_owner.items():
            obs = torch.tensor([t.reply["obs"] for t in group], dtype=torch.float32, device=device)
            mask = torch.tensor([t.reply["mask"] for t in group], dtype=torch.float32, device=device)
            net = learner if owner == "learner" else league[owner]
            action, logp, value = net.act(obs, mask)
            for i, table in enumerate(group):
                table.chosen = int(action[i])
                if owner == "learner":
                    table.records.append(
                        (
                            table.reply["obs"],
                            table.reply["mask"],
                            table.chosen,
                            float(logp[i]),
                            float(value[i]),
                            table.reply["seat"],
                        )
                    )

        # ...then every harness is given its move before any reply is read, so
        # they all think at once rather than one after another.
        for table in pending:
            table.harness.send({"cmd": "step", "action": table.chosen})
        for table in pending:
            table.reply = table.harness.recv()

    return batch, stats


def ppo_update(learner: Policy, optimiser, batch: dict, cfg, device) -> dict:
    obs = torch.tensor(batch["obs"], dtype=torch.float32, device=device)
    mask = torch.tensor(batch["mask"], dtype=torch.float32, device=device)
    action = torch.tensor(batch["action"], dtype=torch.long, device=device)
    logp_old = torch.tensor(batch["logp"], dtype=torch.float32, device=device)
    returns = torch.tensor(batch["ret"], dtype=torch.float32, device=device)

    # Already credited per decision by GAE in Table.flush; only the scale is
    # left to fix, so a big hand doesn't dominate a batch of ordinary ones.
    advantage = torch.tensor(batch["adv"], dtype=torch.float32, device=device)
    advantage = (advantage - advantage.mean()) / (advantage.std() + 1e-8)

    total = obs.shape[0]
    losses = {"policy": 0.0, "value": 0.0, "entropy": 0.0}
    updates = 0

    for _ in range(cfg.epochs):
        order = torch.randperm(total, device=device)
        for start in range(0, total, cfg.minibatch):
            index = order[start : start + cfg.minibatch]
            logp, entropy, value = learner.evaluate(obs[index], mask[index], action[index])

            ratio = (logp - logp_old[index]).exp()
            clipped = ratio.clamp(1 - cfg.clip, 1 + cfg.clip)
            policy_loss = -torch.min(ratio * advantage[index], clipped * advantage[index]).mean()
            value_loss = F.mse_loss(value, returns[index])
            entropy_loss = entropy.mean()

            loss = policy_loss + cfg.vf_coef * value_loss - cfg.ent_coef * entropy_loss
            optimiser.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(learner.parameters(), cfg.max_grad_norm)
            optimiser.step()

            losses["policy"] += policy_loss.item()
            losses["value"] += value_loss.item()
            losses["entropy"] += entropy_loss.item()
            updates += 1

    return {k: v / max(updates, 1) for k, v in losses.items()}


@torch.no_grad()
def play_against_heuristic(
    learner: Policy | None, harness: Harness, hands: int, rng, device, heuristic_kinds=()
):
    """How far ahead one partnership finishes per hand against server/bot.js.

    Zero-sum, so 0.00 is an even match. With `learner` None both partnerships are
    the heuristic bot, which should come out near zero and is the check that the
    comparison itself isn't skewed.

    `heuristic_kinds` has to match what training is using: while bidding is being
    left to the heuristics, measuring a model on its own untrained bidding would
    say nothing about the card play that is actually being learnt.
    """
    total = 0.0
    for hand in range(hands):
        # Alternate which partnership is under test, so neither the deal nor the
        # advantage of bidding first favours one side of the comparison.
        team = hand % 2
        seats = {team, team + 2}
        heuristic_seats = tuple(range(4)) if learner is None else tuple(s for s in range(4) if s not in seats)
        reply = harness.reset(
            {},
            dealer=rng.randrange(4),
            heuristic_seats=heuristic_seats,
            heuristic_kinds=heuristic_kinds,
        )
        while not reply["done"]:
            obs = torch.tensor([reply["obs"]], dtype=torch.float32, device=device)
            mask = torch.tensor([reply["mask"]], dtype=torch.float32, device=device)
            action, _, _ = learner.act(obs, mask, greedy=True)
            reply = harness.step(int(action[0]))
        total += reply["rewards"][team]
    return total / max(hands, 1)


def snapshot(learner: Policy) -> Policy:
    frozen = copy.deepcopy(learner)
    frozen.eval()
    for parameter in frozen.parameters():
        parameter.requires_grad_(False)
    return frozen


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--iterations", type=int, default=2000)
    parser.add_argument("--envs", type=int, default=16, help="parallel Node harnesses")
    parser.add_argument("--hands-per-batch", type=int, default=256)
    parser.add_argument("--epochs", type=int, default=4)
    parser.add_argument("--minibatch", type=int, default=1024)
    parser.add_argument("--lr", type=float, default=3e-4)
    parser.add_argument("--clip", type=float, default=0.2)
    parser.add_argument("--vf-coef", type=float, default=0.5)
    parser.add_argument("--ent-coef", type=float, default=0.01)
    parser.add_argument("--max-grad-norm", type=float, default=0.5)
    parser.add_argument(
        "--gae-lambda",
        type=float,
        default=0.95,
        help="how far down the hand a decision is held responsible for its outcome. "
        "1.0 credits every decision with the whole result, which is what the first "
        "run did and is almost all noise over thirty-odd decisions.",
    )
    parser.add_argument("--league-frac", type=float, default=0.25)
    parser.add_argument("--heuristic-frac", type=float, default=0.15)
    parser.add_argument("--league-every", type=int, default=50, help="iterations between snapshots")
    parser.add_argument("--league-size", type=int, default=8)
    parser.add_argument("--pass-out-penalty", type=float, default=0.0)
    parser.add_argument(
        "--heuristic-kinds",
        default="",
        type=lambda s: tuple(k for k in s.split(",") if k),
        help="decision kinds server/bot.js answers for every seat, e.g. 'bid'. "
        "Training the card play with the heuristics bidding, then resuming with "
        "bidding unfrozen, avoids the policy learning to pass on everything and "
        "so never playing a card.",
    )
    parser.add_argument("--mixed-rules", action="store_true", default=True)
    parser.add_argument("--single-ruleset", dest="mixed_rules", action="store_false")
    parser.add_argument("--eval-every", type=int, default=25)
    parser.add_argument("--eval-hands", type=int, default=200)
    parser.add_argument("--out", type=Path, default=Path(__file__).parent / "runs" / "latest")
    parser.add_argument("--resume", type=Path, default=None)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    cfg = parser.parse_args()

    rng = random.Random(cfg.seed)
    torch.manual_seed(cfg.seed)
    device = torch.device(cfg.device)
    cfg.out.mkdir(parents=True, exist_ok=True)

    harnesses = [Harness() for _ in range(cfg.envs)]
    evaluator = Harness()
    tables = [Table(h) for h in harnesses]
    obs_size, action_count = harnesses[0].obs_size, harnesses[0].action_count
    print(f"observation {obs_size} · actions {action_count} · {cfg.envs} harnesses · {device}")

    learner = Policy(obs_size, action_count).to(device)
    if cfg.resume:
        learner.load_state_dict(torch.load(cfg.resume, map_location=device))
        print(f"resumed from {cfg.resume}")
    optimiser = torch.optim.Adam(learner.parameters(), lr=cfg.lr)
    league: list[Policy] = []

    baseline = play_against_heuristic(
        None, evaluator, cfg.eval_hands, rng, device, cfg.heuristic_kinds
    )
    print(f"heuristic vs heuristic baseline: {baseline:+.4f} per hand")

    log_path = cfg.out / "log.jsonl"
    best = float("-inf")
    started = time.time()

    try:
        for iteration in range(1, cfg.iterations + 1):
            batch, stats = collect(learner, league, tables, cfg, rng, device)
            losses = ppo_update(learner, optimiser, batch, cfg, device)

            row = {
                "iteration": iteration,
                "elapsed": round(time.time() - started, 1),
                "decisions": len(batch["obs"]),
                "hands": stats["hands"],
                "reward": round(stats["reward"] / max(stats["hands"] - stats["passed_out"], 1), 4),
                "passed_out": round(stats["passed_out"] / max(stats["hands"], 1), 3),
                "made": round(stats["made"] / max(stats["contracts"], 1), 3),
                "league": len(league),
                **{k: round(v, 4) for k, v in losses.items()},
            }

            if iteration % cfg.eval_every == 0:
                score = play_against_heuristic(
                    learner, evaluator, cfg.eval_hands, rng, device, cfg.heuristic_kinds
                )
                row["vs_heuristic"] = round(score, 4)
                row["edge"] = round(score - baseline, 4)
                if score > best:
                    best = score
                    torch.save(learner.state_dict(), cfg.out / "best.pt")
                    row["saved"] = "best"
                torch.save(learner.state_dict(), cfg.out / "last.pt")

            if iteration % cfg.league_every == 0:
                league.append(snapshot(learner))
                if len(league) > cfg.league_size:
                    league.pop(0)

            print(json.dumps(row))
            with log_path.open("a") as log:
                log.write(json.dumps(row) + "\n")
    finally:
        torch.save(learner.state_dict(), cfg.out / "last.pt")
        for harness in harnesses:
            harness.close()
        evaluator.close()
        print(f"saved to {cfg.out}")


if __name__ == "__main__":
    main()
