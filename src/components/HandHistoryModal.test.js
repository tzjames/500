import { render, screen } from "@testing-library/react";
import HandHistoryModal from "./HandHistoryModal";
import { euchreHands } from "../euchreHistory";
import { fiveHundredHands } from "../fiveHundredHistory";

const slots = [
  { name: "Graham" },
  { name: "Boole (robot)" },
  { name: "Dijkstra (robot)" },
  { name: "Fermat (robot)" },
];

// Seats 0+2 against 1+3, the way a four-seat Euchre table pairs up.
const partnerships = [
  [0, 2],
  [1, 3],
];

const open = (history, sides = partnerships) =>
  render(
    <HandHistoryModal
      hands={euchreHands({ history, slots, sides, yourSeat: 0 })}
      title="How each hand was called"
      label="Calling history"
      onClose={() => {}}
    />
  );

const panel = () => screen.getByRole("dialog");

// The hand that prompted this panel: the ace of diamonds was turned up, every
// seat passed on it, and the dealer's partner then called spades in the second
// round — which is exactly the sequence a player can't see happen at robot
// speed, and couldn't reconstruct afterwards either.
const orderedDown = [
  {
    round: 1,
    dealerSeat: 0,
    upcard: { suit: "♦", value: "A" },
    calls: [
      { type: "pass", seat: 1, callRound: 1 },
      { type: "pass", seat: 2, callRound: 1 },
      { type: "pass", seat: 3, callRound: 1 },
      { type: "pass", seat: 0, callRound: 1 },
      { type: "call", seat: 2, suit: "♠", callRound: 2, alone: false },
    ],
  },
];

test("a turned-down hand shows the turn-up, every pass and the suit called instead", () => {
  open(orderedDown);
  expect(panel()).toHaveTextContent(/Hand 1 · You dealt · A♦ turned up/);
  expect(panel()).toHaveTextContent(/Boole \(robot\) passed on ♦/);
  expect(panel()).toHaveTextContent(/You passed on ♦/);
  expect(panel()).toHaveTextContent(/♦ was turned down/);
  expect(panel()).toHaveTextContent(/Dijkstra \(robot\) called ♠ instead/);
});

test("the turn-down is marked once, where the second round starts", () => {
  open(orderedDown);
  expect(screen.getAllByText(/was turned down/)).toHaveLength(1);
});

test("your own seat is named as you", () => {
  open(orderedDown);
  expect(panel()).not.toHaveTextContent("Graham");
});

test("a hand ordered up in the first round says so, and names a lone hand", () => {
  open([
    {
      round: 3,
      dealerSeat: 1,
      upcard: { suit: "♠", value: "9" },
      calls: [{ type: "call", seat: 2, suit: "♠", callRound: 1, alone: true }],
    },
  ]);
  expect(panel()).toHaveTextContent(/Dijkstra \(robot\) ordered up ♠ — alone/);
  expect(panel()).not.toHaveTextContent(/turned down/);
});

// The hand that was thrown in and the hand that replaced it share a hand
// number, and each has its own turn-up. Merging them showed one deal's turn-up
// above the other deal's calling.
test("a thrown-in hand and its redeal are listed apart, each with its own turn-up", () => {
  open([
    {
      round: 2,
      thrownIn: false,
      dealerSeat: 2,
      upcard: { suit: "♥", value: "K" },
      calls: [{ type: "pass", seat: 3, callRound: 1 }],
    },
    {
      round: 2,
      thrownIn: true,
      dealerSeat: 1,
      upcard: { suit: "♠", value: "Q" },
      calls: [
        { type: "pass", seat: 2, callRound: 1 },
        { type: "pass", seat: 2, callRound: 2 },
        { type: "throwIn" },
      ],
    },
  ]);
  const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
  expect(headings[0]).toMatch(/Hand 2 · Dijkstra \(robot\) dealt · K♥ turned up/);
  expect(headings[1]).toMatch(/Hand 2 · thrown in · Boole \(robot\) dealt · Q♠ turned up/);
  expect(panel()).toHaveTextContent(/the hand was thrown in/);
});

test("Bid Euchre shows the auction and what each seat bid", () => {
  open([
    {
      round: 1,
      dealerSeat: 0,
      upcard: null,
      calls: [
        { type: "bid", seat: 1, amount: 3 },
        { type: "bid", seat: 2, amount: 0 },
        { type: "bid", seat: 3, amount: 4 },
        { type: "bid", seat: 0, amount: 0 },
        { type: "call", seat: 3, suit: "♥", callRound: 1 },
      ],
    },
  ]);
  expect(panel()).toHaveTextContent(/Boole \(robot\) bid 3/);
  expect(panel()).toHaveTextContent(/Dijkstra \(robot\) passed/);
  expect(panel()).toHaveTextContent(/Fermat \(robot\) bid 4/);
});

// Partners share a score, so a partnership hand reports two numbers and not
// four — the engine mirrors the delta across a side, and listing all four seats
// reads as though they scored separately.
test("a finished partnership hand reports one score per side", () => {
  open([
    {
      round: 1,
      dealerSeat: 0,
      upcard: { suit: "♠", value: "9" },
      calls: [{ type: "call", seat: 2, suit: "♠", callRound: 1 }],
      result: { callerSeat: 2, tricks: 5, needed: 3, made: true, marched: true, scores: [2, 0, 2, 0] },
    },
  ]);
  expect(panel()).toHaveTextContent(/Dijkstra \(robot\) took 5 of the 3 needed — a march/);
  expect(panel()).toHaveTextContent(/You & Dijkstra \(robot\) 2 · Boole \(robot\) & Fermat \(robot\) 0/);
});

test("a game where everyone plays for themselves reports a score each", () => {
  open(
    [
      {
        round: 1,
        dealerSeat: 0,
        upcard: { suit: "♠", value: "9" },
        calls: [{ type: "call", seat: 2, suit: "♠", callRound: 1 }],
        result: { callerSeat: 2, tricks: 4, needed: 3, made: true, scores: [5, 4, 2, 5] },
      },
    ],
    [[0], [1], [2], [3]]
  );
  expect(panel()).toHaveTextContent(/You 5 · Boole \(robot\) 4 · Dijkstra \(robot\) 2 · Fermat \(robot\) 5/);
});

test("hands are listed newest first", () => {
  open([
    { round: 2, dealerSeat: 1, upcard: null, calls: [] },
    { round: 1, dealerSeat: 0, upcard: null, calls: [] },
  ]);
  const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
  expect(headings[0]).toMatch(/Hand 2/);
  expect(headings[1]).toMatch(/Hand 1/);
});

test("an empty game says so rather than showing nothing", () => {
  open([]);
  expect(panel()).toHaveTextContent(/Nothing dealt yet/);
});

// ---- 500 ----

// 500 logs by player id rather than by seat, and its two table sizes report
// their scores differently: by side at four, by person at two.
const nameFor = (userId) => ({ u0: "You", u1: "Ada", u2: "Bo", u3: "Cy" }[userId] || "Someone");

const openFiveHundred = (record, sides) =>
  render(
    <HandHistoryModal
      hands={fiveHundredHands({ record, nameFor, sides, options: {} })}
      title="How each hand was bid"
      label="Bidding history"
      onClose={() => {}}
    />
  );

test("500 shows every bid in order and who bought the contract", () => {
  openFiveHundred(
    [
      {
        round: 1,
        thrownIn: false,
        dealerId: "u0",
        calls: [
          { type: "bid", userId: "u1", bid: "6♠", points: 40 },
          { type: "bid", userId: "u2", bid: "Pass" },
          { type: "bid", userId: "u3", bid: "7♥", points: 200 },
          { type: "bid", userId: "u0", bid: "Pass" },
          { type: "bidWon", userId: "u3", bid: "7♥", points: 200, trumpSuit: "♥" },
        ],
      },
    ],
    ["You & Bo", "Ada & Cy"]
  );
  expect(panel()).toHaveTextContent(/Hand 1 · You dealt/);
  expect(panel()).toHaveTextContent(/Ada bid 6♠ — 40/);
  expect(panel()).toHaveTextContent(/Bo passed/);
  expect(panel()).toHaveTextContent(/Cy bought it for 7♥ — 200/);
  // 500 turns no card up: the kitty goes to whoever wins the auction.
  expect(panel()).not.toHaveTextContent(/turned up/);
});

test("a four-player hand reports the sides' scores in team order", () => {
  openFiveHundred(
    [
      {
        round: 1,
        thrownIn: false,
        dealerId: "u0",
        calls: [{ type: "bidWon", userId: "u3", bid: "7♥", points: 200 }],
        result: { bidderId: "u3", bidderMadeBid: false, scores: [0, -200] },
      },
    ],
    ["You & Bo", "Ada & Cy"]
  );
  expect(panel()).toHaveTextContent(/Cy went down/);
  expect(panel()).toHaveTextContent(/You & Bo 0 · Ada & Cy -200/);
});

test("a two-player hand reports a score each, since it scores by person", () => {
  openFiveHundred([
    {
      round: 2,
      thrownIn: false,
      dealerId: "u0",
      calls: [{ type: "bidWon", userId: "u0", bid: "8♦", points: 280 }],
      result: { bidderId: "u0", bidderMadeBid: true, scores: { u0: 280, u1: 40 } },
    },
  ]);
  expect(panel()).toHaveTextContent(/You made it/);
  expect(panel()).toHaveTextContent(/You 280 · Ada 40/);
});

test("500 marks a hand nobody bid on as thrown in", () => {
  openFiveHundred([
    {
      round: 3,
      thrownIn: true,
      dealerId: "u0",
      calls: [
        { type: "bid", userId: "u1", bid: "Pass" },
        { type: "redeal" },
      ],
    },
  ]);
  expect(screen.getByRole("heading", { level: 3 }).textContent).toMatch(/Hand 3 · thrown in/);
  expect(panel()).toHaveTextContent(/the hand was thrown in/);
});
