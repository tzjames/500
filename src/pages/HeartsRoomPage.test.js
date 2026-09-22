import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "../auth";
import HeartsRoomPage from "./HeartsRoomPage";

// The page draws whatever arrives in one hearts:state payload and sends actions
// back down the same socket, so the socket is the whole of its world — this
// stands in for it and lets a test push a position in and read the emits out.
const sent = [];
let push = () => {};

jest.mock("../socket", () => ({
  getSocket: () => ({
    connected: true,
    on(event, handler) {
      if (event === "hearts:state") push = handler;
    },
    off() {},
    emit: (event, payload) => sent.push({ event, payload }),
  }),
}));

const card = (value, suit) => ({ value, suit });

// A four-handed Black Lady table with you at seat 0, filled in enough for the
// page to draw a board from.
function state(overrides = {}, game = {}) {
  const hand = [card("2", "♣"), card("K", "♠"), card("Q", "♠"), card("4", "♥"), card("9", "♦")];
  return {
    gameId: "g1",
    gameType: "hearts",
    variant: "blackLady",
    title: "Black Lady",
    mode: 4,
    options: {},
    rules: [],
    phase: "passing",
    status: "active",
    visibility: "private",
    friendly: true,
    isHost: true,
    gameSettings: { location: "falls", deck: "classic", felt: "faded" },
    slots: [0, 1, 2, 3].map((seat) => ({ name: `Player ${seat}`, isBot: seat > 0, connected: true })),
    you: { seat: 0 },
    roundNumber: 1,
    winner: null,
    lastTrick: null,
    lastResult: null,
    history: [],
    readyUserIds: [],
    replaying: false,
    replayResult: null,
    proposal: null,
    review: null,
    suits: ["♠", "♥", "♦", "♣"],
    ...overrides,
    game: {
      players: [0, 1, 2, 3].map((seat) => ({
        seat,
        name: `Player ${seat}`,
        handSize: 5,
        score: seat * 10,
        tricksWon: 0,
        team: null,
        taken: 0,
        passedOn: false,
      })),
      target: 100,
      partnerships: false,
      cardsPerPlayer: 5,
      dealNumber: 1,
      dealerSeat: 3,
      passDirection: "left",
      passTo: 1,
      passFrom: 3,
      heartsBroken: false,
      trickNumber: 0,
      penaltySuit: null,
      currentSeat: 0,
      currentTrick: [],
      bidState: null,
      stockSize: 0,
      widowSize: 0,
      stripped: [],
      hand,
      passedCards: null,
      legalCards: [],
      penalties: [0, 0, 13, 1, 0],
      ...game,
    },
  };
}

const open = (payload) => {
  localStorage.setItem("authToken", "token");
  localStorage.setItem("authUser", JSON.stringify({ id: "u0", name: "Ada" }));
  const view = render(
    <AuthProvider>
      <MemoryRouter initialEntries={["/game/g1"]}>
        <Routes>
          <Route path="/game/:id" element={<HeartsRoomPage />} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>
  );
  act(() => push(payload));
  return view;
};

const handCards = () => [...document.querySelectorAll(".he-hand .pc")];
const cardLabelled = (label) => handCards().find((el) => el.getAttribute("aria-label") === label);

beforeEach(() => {
  sent.length = 0;
  push = () => {};
});
afterEach(() => localStorage.clear());

test("the board seats everybody and shows what each of them has taken", () => {
  open(state({ phase: "playing" }, { trickNumber: 2 }));
  const plates = [...document.querySelectorAll(".he-seat-plate")];
  expect(plates).toHaveLength(4);
  expect(plates[0]).toHaveTextContent("You");
  expect(plates[1]).toHaveTextContent("Player 1");
  expect(plates[1]).toHaveTextContent("0 this hand");
});

// A seat placed from `left:` is only as wide as the board it has left to its
// right, so the ones on the right half are placed from the right instead —
// otherwise a name like "Fermat (robot)" is squeezed out of its own plate.
test("a seat on the right of the board is placed from the right edge", () => {
  open(state({ phase: "playing" }));
  const seats = [...document.querySelectorAll(".he-seat")];
  const placed = seats.filter((el) => !el.classList.contains("he-seat-you"));
  expect(placed).toHaveLength(3);
  for (const el of placed) {
    const { left, right } = el.style;
    // One or the other, never both, and never the far side of the board.
    expect(Boolean(left) !== Boolean(right)).toBe(true);
    expect(parseFloat(left || right)).toBeLessThanOrEqual(50);
  }
  // At four seats that is one on the left, one at the top and one on the right.
  expect(placed.filter((el) => el.style.right).length).toBe(1);
});

// The stylesheet works the fan's overlap out from this, so that it fits between
// the name plate and the last trick rather than running under either. jsdom has
// no layout, so the count going out is what there is to hold on to.
test("the hand publishes how many cards it has to make room for", () => {
  const hand = Array.from({ length: 17 }, (_, i) => card(String(i + 2), "♥"));
  open(state({ phase: "playing" }, { hand, cardsPerPlayer: 17, penalties: hand.map(() => 1) }));
  expect(document.querySelector(".he-hand-wrap").style.getPropertyValue("--hand-count")).toBe("17");
});

// Half the rule sets here price the cards differently, so the board says what
// each one would cost rather than expecting anybody to remember.
test("a card that costs something carries what it costs", () => {
  open(state());
  expect(within(cardLabelled("Q ♠")).getByText("13")).toBeInTheDocument();
  expect(within(cardLabelled("4 ♥")).getByText("1")).toBeInTheDocument();
  expect(cardLabelled("2 ♣").querySelector(".pc-badge")).toBeNull();
});

test("passing takes exactly three, and sends them when it has them", () => {
  open(state());
  expect(screen.getByText(/Choose three cards to pass to your left — to Player 1/)).toBeInTheDocument();
  const pass = screen.getByRole("button", { name: /Pick 3 more/ });
  expect(pass).toBeDisabled();

  fireEvent.click(cardLabelled("Q ♠"));
  fireEvent.click(cardLabelled("K ♠"));
  expect(screen.getByRole("button", { name: /Pick 1 more/ })).toBeDisabled();

  fireEvent.click(cardLabelled("4 ♥"));
  // A fourth click can't get in, and clicking a chosen card takes it back out.
  fireEvent.click(cardLabelled("9 ♦"));
  fireEvent.click(screen.getByRole("button", { name: /Pass these three/ }));
  const emitted = sent.find((e) => e.event === "hearts:pass");
  expect(emitted.payload.cards).toHaveLength(3);
  expect(emitted.payload.cards.map((c) => `${c.value}${c.suit}`).sort()).toEqual(["4♥", "K♠", "Q♠"]);
});

test("once you have passed, the three you sent stay in front of you", () => {
  open(state({}, { passedCards: [card("Q", "♠"), card("K", "♠"), card("4", "♥")] }));
  expect(screen.getByText(/Passed\. Waiting for everybody else\./)).toBeInTheDocument();
  expect(screen.getByText(/You sent Q♠, K♠, 4♥ to Player 1/)).toBeInTheDocument();
});

test("playing offers only the cards the server called legal", () => {
  open(state({ phase: "playing" }, { legalCards: [card("2", "♣")] }));
  expect(screen.getByText("Your lead")).toBeInTheDocument();
  fireEvent.click(cardLabelled("2 ♣"));
  fireEvent.click(cardLabelled("Q ♠"));
  const plays = sent.filter((e) => e.event === "hearts:play");
  expect(plays).toHaveLength(1);
  expect(plays[0].payload.card).toEqual({ value: "2", suit: "♣" });
});

test("the state line says where the game stands without naming a trump", () => {
  open(state({ phase: "playing" }, { heartsBroken: false }));
  const bar = document.querySelector(".he-round-bar");
  expect(bar).toHaveTextContent("Hand 1");
  expect(bar).toHaveTextContent("Player 3 dealt");
  expect(bar).toHaveTextContent("game ends at 100");
  expect(bar).toHaveTextContent("passed to your left");
  expect(document.querySelector(".he-middle")).toHaveTextContent("hearts not broken");
});

// Lowest wins, which is the thing a player coming from any other game here will
// get wrong, so the end-of-hand screen has to be unambiguous about it.
test("the end of a hand reports who got away clean", () => {
  open(
    state({
      phase: "roundEnd",
      lastResult: {
        delta: [0, 13, 0, 13],
        points: [0, 13, 0, 13],
        scores: [0, 13, 0, 13],
        moon: null,
        tricksBySeat: [2, 5, 3, 3],
      },
    })
  );
  expect(screen.getByRole("heading", { name: "Hand over" })).toBeInTheDocument();
  expect(screen.getByText(/You, Player 2 got away clean/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Deal the next hand/ })).toBeInTheDocument();
});

test("a moon is reported as a moon, and says which way it went", () => {
  open(
    state({
      phase: "roundEnd",
      lastResult: {
        delta: [0, 26, 26, 26],
        points: [26, 0, 0, 0],
        scores: [0, 26, 26, 26],
        moon: { seats: [0], value: 26, mode: "add" },
        tricksBySeat: [13, 0, 0, 0],
      },
    })
  );
  expect(screen.getByRole("heading", { name: "You shot the moon" })).toBeInTheDocument();
  expect(screen.getByText("26 on everybody else.")).toBeInTheDocument();
});

test("a table waiting for players offers the link and the robots", () => {
  open({
    ...state(),
    game: null,
    phase: "waiting",
    slots: [{ name: "Ada", isBot: false, connected: true }, null, null, null],
  });
  expect(screen.getByRole("heading", { name: /Waiting for 3 more/ })).toBeInTheDocument();
  expect(screen.getByText(/lowest score when somebody hits 100/i)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Fill the empty seats with robots/ }));
  expect(sent.some((e) => e.event === "hearts:addBots")).toBe(true);
});
