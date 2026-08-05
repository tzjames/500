import React from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./auth";
import HomePage from "./pages/HomePage";
import GameRoomPage from "./pages/GameRoomPage";
import "./App.css";

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/game/:id" element={<GameRoomPage />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
