import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { api, assertOk } from "@/lib/api";

interface User {
  id: string;
  email: string;
  name: string;
  role: string | null;
}

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  login: (email: string, password: string, rememberMe: boolean) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    api
      .get("/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: User | null) => setUser(data))
      .catch(() => setUser(null)) // network error → treat as unauthenticated
      .finally(() => setIsLoading(false));
  }, []);

  const login = async (email: string, password: string, rememberMe: boolean): Promise<void> => {
    const res = await api.post("/auth/login", { email, password, remember_me: rememberMe });
    await assertOk(res); // throws ApiError with a user-friendly message
    const data: User = await res.json();
    setUser(data);
  };

  const logout = async (): Promise<void> => {
    await api.post("/auth/logout").catch(() => null); // best-effort
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};
