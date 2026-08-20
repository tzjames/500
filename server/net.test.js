const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { Net, loadNet, MASK_FILL } = require("./net");

const b64 = (numbers) => Buffer.from(new Float32Array(numbers).buffer).toString("base64");

// A hand-worked two-layer net, so the arithmetic, the activation, the masking
// and the argmax are all checked without needing a trained model to hand.
//
//   input  [2, 3]
//   layer0 W = [[1,0],[0,1],[-1,-1]] b = [0,0,0]  → [2, 3, -5] → relu → [2, 3, 0]
//   layer1 W = [[1,1,1],[2,0,0]]     b = [0,0]    → [5, 4]
const TOY = {
  format: "500-bot-mlp-1",
  obsSize: 2,
  actionCount: 2,
  layers: [
    { in: 2, out: 3, activation: "relu", weight: b64([1, 0, 0, 1, -1, -1]), bias: b64([0, 0, 0]) },
    { in: 3, out: 2, activation: "none", weight: b64([1, 1, 1, 2, 0, 0]), bias: b64([0, 0]) },
  ],
};

test("the forward pass computes what the weights say it should", () => {
  const net = new Net(TOY);
  const logits = net.logits([2, 3], [1, 1]);
  assert.equal(logits[0], 5);
  assert.equal(logits[1], 4);
  assert.equal(net.best([2, 3], [1, 1]), 0);
});

test("a masked action is flattened and can never win", () => {
  const net = new Net(TOY);
  const logits = net.logits([2, 3], [0, 1]);
  assert.equal(logits[0], MASK_FILL);
  assert.equal(logits[1], 4);
  // Even though it scored higher, action 0 wasn't legal.
  assert.equal(net.best([2, 3], [0, 1]), 1);
});

test("a model of the wrong shape or vintage is refused", () => {
  assert.throws(() => new Net({ ...TOY, format: "something-else" }), /unknown model format/);
  const broken = { ...TOY, layers: [{ ...TOY.layers[0], out: 4 }, TOY.layers[1]] };
  assert.throws(() => new Net(broken), /wrong size/);
  assert.throws(() => new Net({ ...TOY, layers: [] }), /no layers/);
});

// The failure this is really guarding against: obs.js gains an input and the
// model isn't re-exported. Without the check the extra weights read past the end
// of the observation, every logit comes back NaN, and the bots stop being able
// to pick a move at all — with nothing in the log to say why.
test("a model built for a different observation is refused, not run on NaNs", () => {
  // Declared shapes that don't chain: 2 inputs in, but the layer wants 3.
  const mismatched = {
    ...TOY,
    obsSize: 3,
    layers: [{ ...TOY.layers[0], in: 2 }, TOY.layers[1]],
  };
  assert.throws(() => new Net(mismatched), /takes 2 inputs but is fed 3/);

  // Ends in the wrong number of actions.
  assert.throws(() => new Net({ ...TOY, actionCount: 7 }), /not 7 actions/);

  // Internally consistent, but not what this server encodes.
  assert.throws(
    () => new Net(TOY, { obsSize: 503 }),
    /expects 2 inputs but this server encodes 503 — re-export it/
  );
  assert.throws(() => new Net(TOY, { actionCount: 80 }), /has 2 actions but this server has 80/);

  // And the matching case still loads.
  assert.ok(new Net(TOY, { obsSize: 2, actionCount: 2 }));
});

test("scoring no legal action is an error rather than a silent non-move", () => {
  const net = new Net(TOY);
  assert.throws(() => net.best([2, 3], [0, 0]), /no legal action/);
});

test("a missing model file loads as nothing rather than throwing", () => {
  assert.equal(loadNet(path.join(__dirname, "models", "definitely-not-here.json")), null);
  assert.equal(loadNet(null), null);
});

// Replays the worked examples ai/export_weights.py recorded from PyTorch. This
// is the test that stops the two implementations of the forward pass from
// drifting; it only runs once a model has actually been exported.
test("the exported model agrees with the PyTorch it came from", (t) => {
  const modelPath = process.env.BOT_MODEL_PATH || path.join(__dirname, "models", "bot.json");
  if (!fs.existsSync(modelPath)) {
    t.skip("no model exported yet — run ai/export_weights.py");
    return;
  }

  const net = loadNet(modelPath);
  assert.ok(net.golden.length > 0, "the export carried no worked examples");

  for (const [i, example] of net.golden.entries()) {
    const logits = net.logits(example.obs, example.mask);
    assert.equal(logits.length, example.logits.length);
    for (let a = 0; a < logits.length; a++) {
      // float32 summed in a different order either side, so a relative
      // tolerance; the masked entries are a shared constant and match exactly.
      const allowed = 1e-3 * Math.max(1, Math.abs(example.logits[a]));
      assert.ok(
        Math.abs(logits[a] - example.logits[a]) <= allowed,
        `example ${i} (${example.kind}) action ${a}: ${logits[a]} vs ${example.logits[a]}`
      );
    }
  }
});
