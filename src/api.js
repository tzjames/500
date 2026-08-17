// On Render the server serves this same build, so API calls can just stay
// relative to whatever origin the page was loaded from. The localhost
// fallback only matters for local dev, where the API runs on a separate port.
const API_URL =
  process.env.REACT_APP_API_URL || (process.env.NODE_ENV === "production" ? "" : "http://localhost:5001");

async function request(path, { method = "GET", body, token } = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      // Bypasses ngrok's free-tier browser-warning interstitial, which
      // otherwise intercepts plain fetch() calls (not just page loads) when
      // API_URL points at an ngrok tunnel and bounces them back as HTML.
      "ngrok-skip-browser-warning": "true",
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

export const getRecord = (token) => request("/api/record", { token });

export const createGame = (token) => request("/api/games", { method: "POST", token });
