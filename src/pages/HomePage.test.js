import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "../auth";
import { GAMES } from "../games";
import GameSelectPage from "./GameSelectPage";
import HomePage from "./HomePage";

// A game page talks to the API for its games and record and to socket.io for
// the lobby. None of that is the point of these tests, so it is all stubbed.
// The chooser is routed alongside it because the two link to each other.
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
// A game's own page is the shop window for it, so it has to read to somebody
// who has not signed up — but nobody can deal a hand from there.
test("a game page renders signed out, with the log in form and no way to start", () => {
  open("/euchre");
  expect(screen.getByRole("heading", { name: "Euchre" })).toBeInTheDocument();
  expect(screen.getByText(/five-card hand/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /How to play Euchre/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Log in" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Start a new game/i })).not.toBeInTheDocument();
});

test("signed in, a game page offers a new game", () => {
  signedIn();
  open("/euchre");
  expect(screen.getByRole("button", { name: /Start a new game/i })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Log in" })).not.toBeInTheDocument();
});

test("the rules panel opens from a game page and knows the game", async () => {
  open("/500");
  screen.getByRole("button", { name: /How to play 500/i }).click();
  const panel = await screen.findByRole("dialog", { name: /how to play/i });
  expect(panel).toHaveTextContent(/right bower/i);
  expect(panel).toHaveTextContent(/Four players/);
});
