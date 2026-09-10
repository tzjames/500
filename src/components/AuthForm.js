import React, { useState } from "react";
import { useAuth } from "../auth";

// Logging in or signing up. The only place either happens: the game pages send
// anyone without a session to the chooser, which is where this lives.
function AuthForm() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState("login");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    try {
      if (mode === "login") await login(name.trim(), password);
      else await register(name.trim(), password);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="auth-form panel">
      <h2 className="serif">{mode === "login" ? "Log in" : "Create an account"}</h2>
      <form onSubmit={handleSubmit}>
        <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} required />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <button type="submit" className="btn-primary">
          {mode === "login" ? "Log in" : "Sign up"}
        </button>
      </form>
      {error && <p className="auth-error">{error}</p>}
      <button className="auth-toggle" onClick={() => setMode(mode === "login" ? "register" : "login")}>
        {mode === "login" ? "Need an account? Sign up" : "Already have an account? Log in"}
      </button>
    </div>
  );
}

export default AuthForm;
