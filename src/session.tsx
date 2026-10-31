import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import { api, ApiError, tokenStorage, validateSession } from "./lib/api";
import type { User } from "./lib/contracts";
import { SessionState } from "./lib/session-state";

type Session = {
  user: User | null;
  ready: boolean;
  error: string;
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
  refresh(): Promise<void>;
  setUser(user: User): void;
};
const Context = createContext<Session>(null!);
export function SessionProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<User | null>(null),
    [ready, setReady] = useState(false),
    [error, setError] = useState("");
  const state = useRef<SessionState | null>(null);
  async function clear() {
    await state.current!.clear();
  }
  async function refresh() {
    const token = api.token;
    try {
      const next = await validateSession();
      if (api.token === token) {
        setUser(next);
        setError("");
      }
    } catch (e) {
      if (
        api.token === token &&
        e instanceof ApiError &&
        [401, 403].includes(e.status)
      )
        await clear();
      throw e;
    }
  }
  useEffect(() => {
    let active = true;
    state.current = new SessionState(tokenStorage, (token, user) => {
      api.token = token;
      if (active) setUser(user);
    });
    api.onExpired = () => {
      void clear();
    };
    void (async () => {
      try {
        await state.current!.restore(async (token) => {
          api.token = token;
          return validateSession();
        });
      } catch (e) {
        if (active) setError((e as Error).message);
      } finally {
        if (active) setReady(true);
      }
    })();
    return () => {
      active = false;
      api.onExpired = () => {};
    };
  }, []);
  async function login(email: string, password: string) {
    const result = await api.request<{ token: string; user: User }>(
      "tokens",
      "POST",
      { email, password, device_name: "Relay native" },
    );
    if (result.user.status !== "active")
      throw new Error("This account is not active.");
    await state.current!.login(result.token, result.user);
    setError("");
  }
  async function logout() {
    await api.request("tokens/current", "DELETE");
    await clear();
  }
  return (
    <Context.Provider
      value={{ user, ready, error, login, logout, refresh, setUser }}
    >
      {children}
    </Context.Provider>
  );
}
export const useSession = () => useContext(Context);
