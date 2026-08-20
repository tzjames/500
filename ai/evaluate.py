"""Measure a trained policy against the bot that is live today.

Reward is how far a partnership got ahead over the hand, so the figures are
zero-sum: 0.00 is an even match and positive means the side under test gained.
The heuristic-vs-heuristic column is still reported, because it's the reference
that says whether the measurement itself is sound — with both sides identical and
the side under test alternating, it should come out at roughly zero, and a
baseline that doesn't is a sign the comparison is skewed rather than that the
heuristics are good.

    python ai/evaluate.py runs/latest/best.pt --hands 2000
"""

from __future__ import annotations

import argparse
import random
from pathlib import Path

import torch

from env import Harness
from model import Policy

# The rulesets worth reporting separately: the defaults most tables play, and
# then the options that change how a hand has to be bid or played.
RULESETS = {
    "defaults": {},
    "misere anytime": {"misereAnytime": True},
    "hi-lo + nullo": {"hiLo": True, "doubleNullo": True, "misereAnytime": True},
    "j5 no-trumps": {"j5": True},
    "strict joker": {"jokerLeadAnytime": False},
    "all-pass no trumps": {"allPassNoTrump": True},
}


@torch.no_grad()
def match(policy: Policy | None, harness: Harness, options: dict, hands: int, rng, device) -> dict:
    """Play `hands` hands with one partnership under test, alternating sides."""
    totals = {"reward": 0.0, "hands": 0, "passed_out": 0, "contracts": 0, "made": 0, "bid": 0}

    for hand in range(hands):
        team = hand % 2
        seats = {team, team + 2}
        heuristic = tuple(range(4)) if policy is None else tuple(s for s in range(4) if s not in seats)
        reply = harness.reset(options, dealer=rng.randrange(4), heuristic_seats=heuristic)

        while not reply["done"]:
            obs = torch.tensor([reply["obs"]], dtype=torch.float32, device=device)
            mask = torch.tensor([reply["mask"]], dtype=torch.float32, device=device)
            action, _, _ = policy.act(obs, mask, greedy=True)
            reply = harness.step(int(action[0]))

        info = reply["info"]
        totals["hands"] += 1
        totals["reward"] += reply["rewards"][team]
        if info.get("passedOut"):
            totals["passed_out"] += 1
            continue
        if info.get("made") is not None:
            totals["contracts"] += 1
            # Whether the side under test was the one that bought the contract.
            if info.get("biddingTeam") == team:
                totals["bid"] += 1
                if info["made"]:
                    totals["made"] += 1

    played = max(totals["hands"] - totals["passed_out"], 1)
    return {
        "per_hand": totals["reward"] / played,
        "passed_out": totals["passed_out"] / max(totals["hands"], 1),
        "bid_share": totals["bid"] / max(totals["contracts"], 1),
        "made_rate": totals["made"] / max(totals["bid"], 1),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("checkpoint", type=Path)
    parser.add_argument("--hands", type=int, default=1000, help="hands per ruleset, per side")
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--device", default="cpu")
    args = parser.parse_args()

    device = torch.device(args.device)
    harness = Harness()
    policy = Policy(harness.obs_size, harness.action_count).to(device)
    policy.load_state_dict(torch.load(args.checkpoint, map_location=device))
    policy.eval()

    print(f"{args.checkpoint}  ·  {args.hands} hands per ruleset\n")
    header = f"{'ruleset':<20}{'model':>10}{'heuristic':>12}{'edge':>10}{'made':>9}{'bid':>8}"
    print(header)
    print("-" * len(header))

    for name, options in RULESETS.items():
        # Same seed for both sides, so they meet the same deals.
        model = match(policy, harness, options, args.hands, random.Random(args.seed), device)
        base = match(None, harness, options, args.hands, random.Random(args.seed), device)
        print(
            f"{name:<20}{model['per_hand']:>+10.4f}{base['per_hand']:>+12.4f}"
            f"{model['per_hand'] - base['per_hand']:>+10.4f}"
            f"{model['made_rate']:>9.1%}{model['bid_share']:>8.1%}"
        )

    print(
        "\nper-hand figures are how far ahead the side under test finished, in units"
        "\nof 500, and are zero-sum: 0.00 is an even match. heuristic should sit near"
        "\nzero — it's the same bot on both sides — so a large value there means the"
        "\ncomparison is skewed, not that the heuristics are strong. made is how often"
        "\nthe model brought home a contract it bought; bid is how often it was the"
        "\nside that bid, and a bid share far below 50% means it is passing too much."
    )
    harness.close()


if __name__ == "__main__":
    main()
