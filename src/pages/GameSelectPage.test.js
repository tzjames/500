import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "../auth";
import { GAMES } from "../games";
import GameSelectPage from "./GameSelectPage";
import HomePage from "./HomePage";

// The chooser talks to the API for its per-game counts and to socket.io for the
// lobby. Neither is the point of these tests, so both are stubbed.
jest.mock("../api", () => ({
  getGameSummary: () => Promise.resolve({ active: { "500": 2 } }),
  listGames: () => Promise.resolve([]),
  getRecord: () => Promise.resolve([]),
  getGameDefaults: () => Promise.resolve({}),
}));

jest.mock("../socket", () => ({
  getSocket: () => ({ connected: false, on() {}, off() {}, emit() {} }),
}));

const signedIn = () => {
  localStorage.setItem("authToken", "token");
  localStorage.setItem("authUser", JSON.stringify({ id: "u0", name: "Ada" }));
};

const open = (initial = "/") =>
  render(
    <AuthProvider>
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route path="/" element={<GameSelectPage />} />
          {GAMES.map((game) => (
            <Route key={game.id} path={game.path} element={<HomePage gameType={game.id} />} />
          ))}
        </Routes>
      </MemoryRouter>
    </AuthProvider>
  );

afterEach(() => localStorage.clear());


test("every game in the registry gets a card, pointing at its own page", () => {
  signedIn();
  open();
  for (const game of GAMES) {
    const card = screen.getByRole("link", { name: new RegExp(game.name, "i") });
    expect(card).toHaveAttribute("href", game.path);
  }
});

test("a card says how many of that game you have on the go", async () => {
  signedIn();
  open();
  await waitFor(() =>
    expect(screen.getByRole("link", { name: /500/ })).toHaveTextContent(/2\s*on the go/i)
  );
});

test("signed out, the chooser is where you log in", () => {
  open();
  expect(screen.getByRole("button", { name: "Log in" })).toBeInTheDocument();
});
