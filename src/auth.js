import React, { createContext, useContext, useState, useCallback } from "react";
import * as api from "./api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(() => {
    const token = localStorage.getItem("authToken");
    const userJson = localStorage.getItem("authUser");
    return token && userJson ? { token, user: JSON.parse(userJson) } : null;
  });

  const applySession = useCallback(({ token, user }) => {
    localStorage.setItem("authToken", token);
    localStorage.setItem("authUser", JSON.stringify(user));
    setSession({ token, user });
  }, []);

  const login = useCallback((name, password) => api.login(name, password).then(applySession), [applySession]);
  const register = useCallback(
    (name, password) => api.register(name, password).then(applySession),
    [applySession]
  );
  const logout = useCallback(() => {
    localStorage.removeItem("authToken");
    localStorage.removeItem("authUser");
    setSession(null);
  }, []);

  return (
    <AuthContext.Provider value={{ session, login, register, logout }}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
