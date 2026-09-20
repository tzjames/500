import React from "react";
import { render, screen } from "@testing-library/react";

// Whose session the page thinks it is rendering for. Set before each render.
let mockName = "Graham";

jest.mock("react-router-dom", () => ({
  useParams: () => ({ id: "g1" }),
  useNavigate: () => () => {},
  useLocation: () => ({ pathname: "/game/g1", search: "" }),
  Link: ({ children }) => children,
}));

jest.mock("../socket", () => ({
  getSocket: () => ({ connected: true, on: () => {}, off: () => {}, emit: () => {} }),
}));

jest.mock("../auth", () => ({
  useAuth: () => ({ session: { token: "t", user: { id: "me", name: mockName } } }),
}));

const GameRoomPage = require("./GameRoomPage").default;

// No gameStart fired, so the page sits on the waiting screen — the state the
// server's player list hasn't reached yet, and the one an owner opening a table
// sees first.
const renderWaitingRoom = (name) => {
  mockName = name;
  render(<GameRoomPage />);
};

test("an owner waiting alone is still offered their private table", () => {
  renderWaitingRoom("Graham");
  expect(screen.getByRole("option", { name: "Mzumbe Road" })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: "Travelers" })).toBeInTheDocument();
});

test("and it holds however they capitalised their name", () => {
  renderWaitingRoom("graham");
  expect(screen.getByRole("option", { name: "Uluguru Ridge" })).toBeInTheDocument();
});

test("somebody else waiting alone is offered neither", () => {
  renderWaitingRoom("Bob");
  expect(screen.queryByRole("option", { name: "Mzumbe Road" })).not.toBeInTheDocument();
  expect(screen.queryByRole("option", { name: "Travelers" })).not.toBeInTheDocument();
  expect(screen.getByRole("option", { name: "Victoria Falls" })).toBeInTheDocument();
});
