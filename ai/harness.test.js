// Drives the harness the way Python will: spawn it, write JSON lines, read
// JSON lines. Everything the protocol promises is checked from the outside,
// because the Python side has no other contract to hold it to.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const readline = require("node:readline");
const { spawn } = require("node:child_process");

const HARNESS = path.join(__dirname, "harness.js");

// A queue of pending replies, so a test can await each request in order.
function connect() {
  const child = spawn(process.execPath, [HARNESS], { stdio: ["pipe", "pipe", "pipe"] });
  const lines = readline.createInterface({ input: child.stdout, terminal: false });
  const waiting = [];
  const buffered = [];

  lines.on("line", (line) => {
    const parsed = JSON.parse(line);
    if (waiting.length > 0) waiting.shift()(parsed);
    else buffered.push(parsed);
  });

  return {
    send(request) {
      child.stdin.write(`${JSON.stringify(request)}\n`);
      if (buffered.length > 0) return Promise.resolve(buffered.shift());
      return new Promise((resolve) => waiting.push(resolve));
    },
    close: () => child.kill(),
  };
}

const legalActions = (mask) => mask.reduce((out, m, i) => (m ? [...out, i] : out), []);

test("the harness reports the shape of the space it expects", async () => {
  const io = connect();
  try {
    const info = await io.send({ cmd: "info" });
    assert.equal(info.obsSize, require("../server/obs").OBS_SIZE);
    assert.equal(info.actionCount, require("../server/obs").ACTION_COUNT);
    assert.deepEqual(info.kinds, ["bid", "discard", "pass", "play"]);
    assert.ok(info.bids.includes("Pass"));
    assert.ok(info.options.length > 0);
  } finally {
    io.close();
  }
});

test("a hand plays from reset to a score over the wire", async () => {
  const io = connect();
  try {
    const info = await io.send({ cmd: "info" });
    let hands = 0;

    for (let round = 0; round < 20; round++) {
      let reply = await io.send({
        cmd: "reset",
        options: { doubleNullo: true, hiLo: true, misereAnytime: true },
        dealer: round % 4,
      });

      let steps = 0;
      while (!reply.done) {
        assert.ok(!reply.error, `harness errored: ${reply.error}`);
        assert.equal(reply.obs.length, info.obsSize);
        assert.equal(reply.mask.length, info.actionCount);
        assert.ok(reply.seat >= 0 && reply.seat < 4);
        assert.ok(info.kinds.includes(reply.kind));

        const legal = legalActions(reply.mask);
        assert.ok(legal.length > 0, "the harness offered nothing legal");
        reply = await io.send({
          cmd: "step",
          action: legal[Math.floor(Math.random() * legal.length)],
        });
        assert.ok(++steps < 200, "the hand never finished");
      }

      assert.equal(reply.rewards.length, 4);
      assert.ok(reply.rewards.every((r) => Number.isFinite(r)));
      // Partners share a score, so a policy can't learn to beat its own partner.
      assert.equal(reply.rewards[0], reply.rewards[2]);
      assert.equal(reply.rewards[1], reply.rewards[3]);
      hands += 1;
    }
    assert.equal(hands, 20);
  } finally {
    io.close();
  }
});

// The heuristic bot's choices have to survive the round trip through the action
// space: every card it names must be an index the engine then accepts. Handing
// all four seats to it plays whole hands down that path.
test("the existing bot can play every seat through the action space", async () => {
  const io = connect();
  try {
    for (let round = 0; round < 20; round++) {
      const reply = await io.send({
        cmd: "reset",
        options: { doubleNullo: true, hiLo: true, misereAnytime: true, openMisere: true },
        dealer: round % 4,
        heuristicSeats: [0, 1, 2, 3],
      });
      assert.ok(!reply.error, `harness errored: ${reply.error}`);
      assert.equal(reply.done, true, "with every seat a robot the hand plays itself out");
      assert.ok(reply.rewards.every((r) => Number.isFinite(r)));
    }
  } finally {
    io.close();
  }
});

test("only the seats it owns are handed back to the caller", async () => {
  const io = connect();
  try {
    let asked = 0;
    for (let round = 0; round < 10; round++) {
      let reply = await io.send({
        cmd: "reset",
        options: {},
        dealer: round % 4,
        heuristicSeats: [1, 3],
      });
      while (!reply.done) {
        assert.ok([0, 2].includes(reply.seat), `asked about seat ${reply.seat}, a robot's`);
        asked += 1;
        const legal = legalActions(reply.mask);
        reply = await io.send({
          cmd: "step",
          action: legal[Math.floor(Math.random() * legal.length)],
        });
      }
    }
    assert.ok(asked > 30, `only asked ${asked} times`);
  } finally {
    io.close();
  }
});

// The curriculum lever: bot.js answers the auction for every seat, so contracts
// get bought and the caller is only asked about the cards.
test("handing one kind of decision to the heuristics leaves the rest to the caller", async () => {
  const io = connect();
  try {
    let contracts = 0;
    let asked = 0;

    for (let round = 0; round < 15; round++) {
      let reply = await io.send({
        cmd: "reset",
        options: {},
        dealer: round % 4,
        heuristicKinds: ["bid"],
      });
      while (!reply.done) {
        assert.notEqual(reply.kind, "bid", "bidding was meant to be left to bot.js");
        asked += 1;
        const legal = legalActions(reply.mask);
        reply = await io.send({
          cmd: "step",
          action: legal[Math.floor(Math.random() * legal.length)],
        });
      }
      if (!reply.info.passedOut) contracts += 1;
    }

    // The whole point: the heuristics bid, so most hands reach a contract and
    // there are cards to learn from rather than an auction that dies.
    assert.ok(contracts >= 10, `only ${contracts} of 15 hands were bid`);
    assert.ok(asked > 200, `only asked ${asked} times, so few hands were played out`);
  } finally {
    io.close();
  }
});

test("a bad request is answered with an error, not a dead pipe", async () => {
  const io = connect();
  try {
    assert.match((await io.send({ cmd: "step", action: 0 })).error, /reset/);
    assert.match((await io.send({ cmd: "nonsense" })).error, /unknown command/);

    await io.send({ cmd: "reset", options: {} });
    assert.match((await io.send({ cmd: "step", action: 9999 })).error, /outside the space/);

    // An action the mask didn't offer: the auction is on, so a card is illegal.
    const cardAction = require("../server/obs").CARD_OFFSET;
    assert.ok((await io.send({ cmd: "step", action: cardAction })).error);

    // And the harness is still alive and usable afterwards.
    const info = await io.send({ cmd: "info" });
    assert.ok(info.obsSize > 0);
  } finally {
    io.close();
  }
});
