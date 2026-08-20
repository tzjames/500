"""Python's end of the pipe to ai/harness.js.

Nothing in here knows how 500 is played. The rules, the legal moves, the
observation encoding and the score all come from the JavaScript engine the live
server uses; this file only moves JSON back and forth and decides which house
rules to deal next.
"""

from __future__ import annotations

import json
import random
import subprocess
from pathlib import Path

HARNESS = Path(__file__).with_name("harness.js")


class HarnessError(RuntimeError):
    """The engine refused something — an illegal action, or a bad request."""


class Harness:
    """One Node process playing one hand at a time."""

    def __init__(self, node: str = "node") -> None:
        self.proc = subprocess.Popen(
            [node, str(HARNESS)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
        info = self._rpc({"cmd": "info"})
        self.obs_size: int = info["obsSize"]
        self.action_count: int = info["actionCount"]
        self.bids: list[str] = info["bids"]
        self.kinds: list[str] = info["kinds"]
        self.option_ids: list[str] = info["options"]

    # send and recv are separate so a caller with several harnesses can post to
    # all of them before reading any: the processes then work at the same time
    # instead of taking it in turns, which is most of the collection rate when
    # there are a dozen of them.
    def send(self, request: dict) -> None:
        if self.proc.poll() is not None:
            raise HarnessError(f"the harness exited with code {self.proc.returncode}")
        self.proc.stdin.write(json.dumps(request) + "\n")
        self.proc.stdin.flush()

    def recv(self) -> dict:
        line = self.proc.stdout.readline()
        if not line:
            raise HarnessError("the harness closed its output")
        reply = json.loads(line)
        if "error" in reply:
            raise HarnessError(reply["error"])
        return reply

    def _rpc(self, request: dict) -> dict:
        self.send(request)
        return self.recv()

    def reset_request(
        self,
        options: dict,
        dealer: int = 0,
        heuristic_seats: tuple[int, ...] = (),
        pass_out_penalty: float = 0.0,
        team_scores: tuple[int, int] = (0, 0),
        barred_seats: tuple[int, ...] = (),
        heuristic_kinds: tuple[str, ...] = (),
    ) -> dict:
        return {
            "cmd": "reset",
            "options": options,
            "dealer": dealer,
            "heuristicSeats": list(heuristic_seats),
            "heuristicKinds": list(heuristic_kinds),
            "passOutPenalty": pass_out_penalty,
            "teamScores": list(team_scores),
            "barredSeats": list(barred_seats),
        }

    def reset(self, *args, **kwargs) -> dict:
        return self._rpc(self.reset_request(*args, **kwargs))

    def step(self, action: int) -> dict:
        return self._rpc({"cmd": "step", "action": int(action)})

    def close(self) -> None:
        try:
            self.proc.stdin.close()
        except (OSError, ValueError):
            pass
        try:
            self.proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.proc.kill()


# The toggles that change how a hand is bid or played. The rest of the house
# rules only decide when the *game* ends, which a single hand never sees, so
# there's nothing for a policy to learn from them.
PLAY_OPTIONS = [
    "misereAnytime",
    "bidAfterPass",
    "splitTheColours",
    "allPassNoTrump",
    "openMisere",
    "blindMisere",
    "hiLo",
    "doubleNullo",
    "jokerLeadAnytime",
    "j5",
    "trickPoints",
    "slamBonus",
    "ralphing",
]


def sample_options(rng: random.Random, mixed: bool = True) -> dict:
    """House rules for the next hand.

    Most tables play the defaults, so most hands are dealt on them — but the
    option set is part of the observation, and a bot that has only ever seen one
    ruleset will misplay the first table that turns Hi-Lo on. Mixing a minority
    of randomised rulesets in is what buys one model that can sit anywhere.
    """
    if not mixed or rng.random() < 0.6:
        return {}
    return {name: rng.random() < 0.5 for name in PLAY_OPTIONS}


def sample_table_state(rng: random.Random, options: dict) -> dict:
    """The game around the hand: the score so far, and anyone barred from bidding.

    Both reach the observation, and both are nearly always something other than
    nothing at a live table. Sampling them means the weights that read them are
    trained on the range they'll actually meet instead of on a constant.
    """
    if rng.random() < 0.3:
        scores = (0, 0)  # the opening hand of a game
    else:
        scores = tuple(10 * rng.randint(-20, 46) for _ in range(2))

    # Only the Ralphing rule bars anyone, and never more than the one seat that
    # went down badly — bar more and there'd be no auction to speak of.
    barred = (rng.randrange(4),) if options.get("ralphing") and rng.random() < 0.15 else ()
    return {"team_scores": scores, "barred_seats": barred}
