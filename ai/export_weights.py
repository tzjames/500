"""Write a trained checkpoint out as the model file the server loads.

    python ai/export_weights.py runs/latest/best.pt

This is the export that gets deployed. server/net.js runs the forward pass
directly, so there is no runtime to install and no native dependency to build —
the model is one file that either sits next to the server or doesn't.

Because that means two implementations of the same arithmetic, the file carries
a handful of worked examples taken from real positions. server/net.test.js
replays them, so any disagreement between PyTorch and JavaScript is a failing
test rather than a bot that plays subtly differently in production.

(ai/export_onnx.py is still there for the other deployment shape — if inference
ever moves into the browser, ONNX plus onnxruntime-web is the way to do it.)
"""

from __future__ import annotations

import argparse
import base64
import json
from pathlib import Path

import torch
from torch import nn

from env import Harness
from model import Policy

GOLDEN_CASES = 8


def encode(tensor: torch.Tensor) -> str:
    """Little-endian float32, base64'd — what Float32Array reads natively."""
    return base64.b64encode(tensor.detach().cpu().numpy().astype("<f4").tobytes()).decode()


def layer_of(module: nn.Linear, activation: str) -> dict:
    return {
        "in": module.in_features,
        "out": module.out_features,
        "activation": activation,
        # torch stores Linear.weight as [out, in], which is the row-major layout
        # server/net.js walks, so it goes across unchanged.
        "weight": encode(module.weight),
        "bias": encode(module.bias),
    }


@torch.no_grad()
def golden_cases(policy: Policy, harness: Harness, count: int) -> list[dict]:
    """Worked examples from real positions, masks and all."""
    cases = []
    reply = harness.reset({}, dealer=0)
    while len(cases) < count:
        if reply["done"]:
            reply = harness.reset({"hiLo": True, "doubleNullo": True}, dealer=len(cases) % 4)
            continue
        obs = torch.tensor([reply["obs"]], dtype=torch.float32)
        mask = torch.tensor([reply["mask"]], dtype=torch.float32)
        logits, _ = policy(obs, mask)
        cases.append(
            {
                "kind": reply["kind"],
                "obs": reply["obs"],
                "mask": reply["mask"],
                "logits": [round(x, 6) for x in logits[0].tolist()],
            }
        )
        reply = harness.step(int(logits[0].argmax()))
    return cases


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("checkpoint", type=Path)
    parser.add_argument(
        "-o",
        "--out",
        type=Path,
        default=Path(__file__).parents[1] / "server" / "models" / "bot.json",
    )
    args = parser.parse_args()

    # Dimensions come from the engine rather than being restated, so an export
    # can't disagree with the encoder that will feed it.
    harness = Harness()
    policy = Policy(harness.obs_size, harness.action_count)
    policy.load_state_dict(torch.load(args.checkpoint, map_location="cpu"))
    policy.eval()

    layers = [
        layer_of(module, "relu") for module in policy.trunk if isinstance(module, nn.Linear)
    ]
    layers.append(layer_of(policy.policy_head, "none"))

    manifest = {
        "format": "500-bot-mlp-1",
        "obsSize": harness.obs_size,
        "actionCount": harness.action_count,
        "checkpoint": str(args.checkpoint),
        "layers": layers,
        "golden": golden_cases(policy, harness, GOLDEN_CASES),
    }
    harness.close()

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(manifest))
    parameters = sum(layer["in"] * layer["out"] + layer["out"] for layer in layers)
    print(f"wrote {args.out} — {parameters:,} parameters, {args.out.stat().st_size / 1e6:.1f} MB")
    print("check it with:  node --test server/net.test.js")


if __name__ == "__main__":
    main()
