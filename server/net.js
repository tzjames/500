// The trained policy's forward pass, in plain JavaScript.
//
// It would be conventional to run this through onnxruntime-node, and for a big
// network that is the right answer. This one is four dense layers — about 690
// thousand multiply-adds for a decision, comfortably under a millisecond — and
// running it here instead buys three things that matter more than the speed:
//
//   * no native dependency, so the deploy image stays as it is;
//   * a synchronous call, so bot.js's interface and room4.js's turn handling
//     don't have to become asynchronous to accommodate a bot;
//   * nothing to install before the server can serve a model.
//
// The price is that this file has to agree with PyTorch exactly, so the export
// carries a handful of worked examples and net.test.js checks them.
const fs = require("node:fs");

// Matches ai/model.py. Big enough that a masked action never wins an argmax,
// small enough to stay finite in float32.
const MASK_FILL = -1.0e9;

const floats = (base64) => new Float32Array(new Uint8Array(Buffer.from(base64, "base64")).buffer);

// One dense layer, fused with its activation. weight is row-major [out][in],
// the layout torch.nn.Linear already stores.
function dense(layer, input) {
  const { weight, bias, inSize, outSize, relu } = layer;
  const output = new Float32Array(outSize);
  for (let o = 0; o < outSize; o++) {
    const row = o * inSize;
    let sum = bias[o];
    for (let i = 0; i < inSize; i++) sum += weight[row + i] * input[i];
    output[o] = relu && sum < 0 ? 0 : sum;
  }
  return output;
}

class Net {
  // `expected` is the shape the caller is going to feed this thing. Checking it
  // here is the difference between a bad deploy failing loudly at startup and
  // one that runs: a model built against an older server/obs.js reads past the
  // end of the observation, every logit comes out NaN, and the bots quietly
  // stop being able to choose a move at all.
  constructor(manifest, expected = {}) {
    if (manifest.format !== "500-bot-mlp-1") {
      throw new Error(`unknown model format ${manifest.format}`);
    }
    this.obsSize = manifest.obsSize;
    this.actionCount = manifest.actionCount;
    this.golden = manifest.golden || [];
    this.layers = manifest.layers.map((layer) => ({
      inSize: layer.in,
      outSize: layer.out,
      relu: layer.activation === "relu",
      weight: floats(layer.weight),
      bias: floats(layer.bias),
    }));

    if (this.layers.length === 0) throw new Error("the model has no layers");

    // Each layer's weights match its own declared shape, and its input matches
    // what the layer before it produces.
    let width = this.obsSize;
    this.layers.forEach((layer, i) => {
      if (layer.weight.length !== layer.inSize * layer.outSize || layer.bias.length !== layer.outSize) {
        throw new Error(`layer ${i} of the model is the wrong size`);
      }
      if (layer.inSize !== width) {
        throw new Error(`layer ${i} takes ${layer.inSize} inputs but is fed ${width}`);
      }
      width = layer.outSize;
    });
    if (width !== this.actionCount) {
      throw new Error(`the model ends in ${width} outputs, not ${this.actionCount} actions`);
    }

    if (expected.obsSize !== undefined && this.obsSize !== expected.obsSize) {
      throw new Error(
        `the model expects ${this.obsSize} inputs but this server encodes ${expected.obsSize} — re-export it`
      );
    }
    if (expected.actionCount !== undefined && this.actionCount !== expected.actionCount) {
      throw new Error(
        `the model has ${this.actionCount} actions but this server has ${expected.actionCount} — re-export it`
      );
    }
  }

  // Scores for every action, with the illegal ones flattened. Masking happens
  // here rather than in the caller so that no route to a move the rules forbid
  // exists at all.
  logits(obs, mask) {
    let activations = obs instanceof Float32Array ? obs : Float32Array.from(obs);
    for (const layer of this.layers) activations = dense(layer, activations);
    for (let a = 0; a < activations.length; a++) {
      if (!mask[a]) activations[a] = MASK_FILL;
    }
    return activations;
  }

  // The best legal action. Throws rather than returning a sentinel the caller
  // has to remember to test for — the engine always leaves at least one legal
  // move, so failing here means the mask or the model is wrong, and that should
  // surface as an error and not as a move nobody chose.
  best(obs, mask) {
    const scores = this.logits(obs, mask);
    let bestAction = -1;
    let bestScore = -Infinity;
    for (let a = 0; a < scores.length; a++) {
      if (mask[a] && scores[a] > bestScore) {
        bestScore = scores[a];
        bestAction = a;
      }
    }
    if (bestAction === -1) throw new Error("the model scored no legal action");
    return bestAction;
  }
}

// Returns null when there's no model to load, rather than throwing: a server
// with no trained policy yet is the normal case, and it should fall back to the
// heuristics rather than refuse to start. A model that is present but broken
// does throw, because that is a deploy that needs looking at.
function loadNet(path, expected = {}) {
  if (!path || !fs.existsSync(path)) return null;
  return new Net(JSON.parse(fs.readFileSync(path, "utf8")), expected);
}

module.exports = { Net, loadNet, MASK_FILL };
