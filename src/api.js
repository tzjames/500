const API_URL = process.env.REACT_APP_API_URL || "http://localhost:5001";

async function request(path, { method = "GET", body, token } = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

export const register = (name, password) =>
  request("/api/register", { method: "POST", body: { name, password } });

export const login = (name, password) =>
  request("/api/login", { method: "POST", body: { name, password } });

export const listGames = (token) => request("/api/games", { token });

export const createGame = (token) => request("/api/games", { method: "POST", token });
