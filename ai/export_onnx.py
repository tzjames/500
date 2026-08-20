"""Turn a trained checkpoint into the ONNX file the server loads.

    python ai/export_onnx.py runs/latest/best.pt -o ../server/models/bot.onnx

The graph takes a batch of observations and their legal-action masks and returns
masked logits: illegal actions come back at MASK_FILL, so whatever the server
does with the output it cannot pick a move the rules forbid.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import torch

from env import Harness
from model import GreedyPolicy, Policy


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("checkpoint", type=Path)
    parser.add_argument("-o", "--out", type=Path, default=Path(__file__).parents[1] / "server" / "models" / "bot.onnx")
    parser.add_argument("--opset", type=int, default=17)
    args = parser.parse_args()

    # The dimensions come from the engine rather than being restated here, so an
    # export can't quietly disagree with the encoder the server will feed it.
    harness = Harness()
    obs_size, action_count = harness.obs_size, harness.action_count
    harness.close()

    policy = Policy(obs_size, action_count)
    policy.load_state_dict(torch.load(args.checkpoint, map_location="cpu"))
    policy.eval()

    args.out.parent.mkdir(parents=True, exist_ok=True)
    torch.onnx.export(
        GreedyPolicy(policy),
        (torch.zeros(1, obs_size), torch.ones(1, action_count)),
        str(args.out),
        input_names=["obs", "mask"],
        output_names=["logits"],
        dynamic_axes={"obs": {0: "batch"}, "mask": {0: "batch"}, "logits": {0: "batch"}},
        opset_version=args.opset,
    )
    print(f"wrote {args.out} ({args.out.stat().st_size / 1e6:.1f} MB)")

    # Checked here rather than discovered in production: the exported graph has
    # to agree with the PyTorch one, and it has to honour the mask.
    try:
        import numpy
        import onnxruntime
    except ImportError:
        print("install onnxruntime to have this export checked automatically")
        return

    session = onnxruntime.InferenceSession(str(args.out), providers=["CPUExecutionProvider"])
    obs = torch.randn(4, obs_size)
    mask = (torch.rand(4, action_count) > 0.5).float()
    mask[:, 0] = 1.0  # never leave a row with nothing legal

    expected = GreedyPolicy(policy)(obs, mask).detach().numpy()
    actual = session.run(["logits"], {"obs": obs.numpy(), "mask": mask.numpy()})[0]
    drift = float(numpy.abs(expected - actual).max())
    print(f"matches PyTorch to {drift:.2e}")
    assert drift < 1e-4, "the exported graph disagrees with the checkpoint"

    illegal = actual[mask.numpy() == 0]
    assert illegal.max() < -1e8, "the exported graph is not masking illegal actions"
    print("illegal actions are masked; the export is good")


if __name__ == "__main__":
    main()
