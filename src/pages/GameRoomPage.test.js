import React from "react";
import { render, act } from "@testing-library/react";

// react-router-dom 7 ships an exports map this jest can't resolve, and the page
// only wants the room id off it anyway.
jest.mock("react-router-dom", () => ({
  useParams: () => ({ id: "g1" }),
  useNavigate: () => () => {},
  useLocation: () => ({ pathname: "/game/g1", search: "" }),
  Link: ({ children }) => children,
}));

// The page is driven entirely by socket events, so the socket is replaced with
// a handler registry the tests fire into by hand.
jest.mock("../socket", () => {
  const handlers = new Map();
  return {
    handlers,
    getSocket: () => ({
      connected: true,
      on: (event, handler) => handlers.set(event, handler),
      off: () => {},
      emit: () => {},
    }),
  };
});

jest.mock("../auth", () => ({
  useAuth: () => ({ session: { token: "t", user: { id: "me", name: "Alice" } } }),
}));

const { handlers } = require("../socket");
const GameRoomPage = require("./GameRoomPage").default;

// Ten distinct cards, so no two hands in a test share one.
const hand = (suit) => Array.from({ length: 10 }, (_, i) => ({ suit, value: String(i + 4) }));

const fire = (event, ...args) =>
  act(() => {
    handlers.get(event)(...args);
  });

// What the deal looks like coming off the wire: your own cards, and nothing but
// a count for the other player's hand.
function renderRoom(bid = { player: "me", bid: "7 ♠", points: 140 }, trumpSuit = "♠") {
  handlers.clear();
  render(<GameRoomPage />);

  fire("gameStart", {
    players: [
      { id: "me", name: "Alice", hand: hand("♠"), isDealer: false, score: 0, tricksWon: 0 },
      { id: "them", name: "Bob", handSize: 10, isDealer: true, score: 0, tricksWon: 0 },
    ],
    currentBid: null,
    trumpSuit: null,
    dealerId: "them",
    currentBidder: "me",
    roundNumber: 1,
    scoreHistory: [],
  });
  fire("biddingComplete", bid, [], trumpSuit);
}

// The same again for the other player's dummy: their cards never arrive, only
// how many are left.
function dealDummies() {
  fire("kittyPhaseComplete", {
    winningBidder: "me",
    currentPlayer: "me",
    currentIsDummy: false,
    players: [
      { id: "me", dummyHand: hand("♥"), tricksWon: 0 },
      { id: "them", dummyHandSize: 10, tricksWon: 0 },
    ],
  });
}

// Cards drawn in the seat with this label, split by which way up they are.
function seatCards(label) {
  const seat = [...document.querySelectorAll(".seat")].find(
    (s) => s.querySelector(".seat-name")?.textContent === label
  );
  return {
    faceDown: seat.querySelectorAll(".pc-back").length,
    faceUp: seat.querySelectorAll(".pc-face").length,
  };
}

test("the opponent's hand is drawn from the count the server sends", () => {
  renderRoom();
  dealDummies();

  expect(seatCards("Bob")).toEqual({ faceDown: 10, faceUp: 0 });

  // Same as the dummy below: a play takes the fan down and a take-back puts it
  // back, because the count is all this client has to go on.
  const played = { suit: "♦", value: "4" };
  fire("cardPlayed", { playerId: "them", card: played, isDummy: false, seq: 1 });
  expect(seatCards("Bob").faceDown).toBe(9);

  fire("cardRetracted", { playerId: "them", card: played, isDummy: false, seq: 2 });
  expect(seatCards("Bob").faceDown).toBe(10);
});

test("an Open Misère bidder's hand goes face up when the server sends it", () => {
  renderRoom({ player: "them", bid: "Open Misere", points: 500 }, null);
  dealDummies();

  expect(seatCards("Bob")).toEqual({ faceDown: 10, faceUp: 0 });

  // The reveal waits on the bidder losing a trick, and the cards follow in
  // their own event — the deal only ever sent the count above.
  fire("trickResolved", {
    winner: "me",
    winnerIsDummy: false,
    newScores: [
      { id: "me", score: 0, tricksWon: 1 },
      { id: "them", score: 0, tricksWon: 0 },
    ],
  });
  fire("handsRevealed", { players: [{ id: "them", hand: hand("♣") }] });

  expect(seatCards("Bob")).toEqual({ faceDown: 0, faceUp: 10 });
});

test("the opponent's dummy is drawn from the count the server sends", () => {
  renderRoom();
  dealDummies();

  expect(seatCards("Bob's dummy")).toEqual({ faceDown: 10, faceUp: 0 });

  // A card played from that dummy takes the fan down with it, and a take-back
  // puts it back: the count is all this client has to go on.
  const played = { suit: "♦", value: "4" };
  fire("cardPlayed", { playerId: "them", card: played, isDummy: true, seq: 1 });
  expect(seatCards("Bob's dummy").faceDown).toBe(9);

  fire("cardRetracted", { playerId: "them", card: played, isDummy: true, seq: 2 });
  expect(seatCards("Bob's dummy").faceDown).toBe(10);
});

test("a claim turns the claimer's hand and dummy face up", () => {
  renderRoom();
  dealDummies();
  expect(seatCards("Bob").faceUp).toBe(0);
  expect(seatCards("Bob's dummy").faceUp).toBe(0);

  fire("claimReceived", {
    fromName: "Bob",
    claimerId: "them",
    claimerHand: hand("♣"),
    claimerDummyHand: hand("♦"),
  });
  expect(seatCards("Bob")).toEqual({ faceDown: 0, faceUp: 10 });
  expect(seatCards("Bob's dummy")).toEqual({ faceDown: 0, faceUp: 10 });
});
