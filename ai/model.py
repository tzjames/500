"""The network: one shared policy for all four seats.

Seats are encoded relative to whoever is acting (see server/obs.js), so a single
set of weights plays every seat and doesn't have to learn the same partnership
four times over.

The illegal-action mask is applied *inside* the module rather than by the caller.
That way the exported ONNX graph masks too, and the live server can't forget to
— the only way to reach an illegal move would be to hand the network a wrong
mask, and that mask is built by the engine itself.
"""

from __future__ import annotations

import torch
from torch import nn

# Large enough to make a masked action's probability vanish, small enough to
# leave the softmax finite in float32 (-inf would give NaNs the moment every
# logit in a row is masked).
MASK_FILL = -1.0e9


class Policy(nn.Module):
    def __init__(self, obs_size: int, action_count: int, hidden: tuple[int, ...] = (512, 512, 256)):
        super().__init__()
        self.obs_size = obs_size
        self.action_count = action_count

        layers: list[nn.Module] = []
        width = obs_size
        for size in hidden:
            layers += [nn.Linear(width, size), nn.ReLU()]
            width = size
        self.trunk = nn.Sequential(*layers)
        self.policy_head = nn.Linear(width, action_count)
        self.value_head = nn.Linear(width, 1)

        # A small last layer keeps the opening policy close to uniform over the
        # legal moves, which matters here: the first thing a fresh network has to
        # avoid is committing to one bid before it has seen a hand played out.
        nn.init.orthogonal_(self.policy_head.weight, gain=0.01)
        nn.init.zeros_(self.policy_head.bias)

    def forward(self, obs: torch.Tensor, mask: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        features = self.trunk(obs)
        logits = self.policy_head(features)
        logits = torch.where(mask > 0, logits, torch.full_like(logits, MASK_FILL))
        return logits, self.value_head(features).squeeze(-1)

    @torch.no_grad()
    def act(self, obs: torch.Tensor, mask: torch.Tensor, greedy: bool = False):
        """Pick an action per row, with its log-probability and value estimate."""
        logits, value = self(obs, mask)
        distribution = torch.distributions.Categorical(logits=logits)
        action = logits.argmax(dim=-1) if greedy else distribution.sample()
        return action, distribution.log_prob(action), value

    def evaluate(self, obs: torch.Tensor, mask: torch.Tensor, action: torch.Tensor):
        """Log-probability, entropy and value for actions already taken."""
        logits, value = self(obs, mask)
        distribution = torch.distributions.Categorical(logits=logits)
        return distribution.log_prob(action), distribution.entropy(), value


class GreedyPolicy(nn.Module):
    """Inference-only wrapper, so the exported graph is a plain obs+mask → logits.

    ONNX has no use for the sampling or the value head, and the server only ever
    asks for the best legal move.
    """

    def __init__(self, policy: Policy):
        super().__init__()
        self.policy = policy

    def forward(self, obs: torch.Tensor, mask: torch.Tensor) -> torch.Tensor:
        logits, _ = self.policy(obs, mask)
        return logits
