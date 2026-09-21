import React, { Fragment } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./auth";
import DocumentTitle from "./DocumentTitle";
import GameSelectPage from "./pages/GameSelectPage";
import HomePage from "./pages/HomePage";
import GamePage from "./pages/GamePage";
import StatsPage from "./pages/StatsPage";
import { GAMES } from "./games";
import "./App.css";

// `/` is the chooser and each game has its own page under it. The game routes
// are built from the list in games.js so adding a game needs nothing here.
function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <DocumentTitle />
        <Routes>
          <Route path="/" element={<GameSelectPage />} />
          {GAMES.map((game) => (
            <Fragment key={game.id}>
              <Route path={game.path} element={<HomePage gameType={game.id} />} />
              <Route path={game.statsPath} element={<StatsPage gameType={game.id} />} />
            </Fragment>
          ))}
          <Route path="/game/:id" element={<GamePage />} />
          {/* 500 was the whole site once, so its old addresses still work. */}
          <Route path="/stats" element={<Navigate to="/500/stats" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
