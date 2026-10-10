import * as LocalAuthentication from "expo-local-authentication";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

import { apiRequest, getAuthInfo, OutlineApiError } from "@/lib/outline/api";
import { revokeTokens, signIn, SignInError } from "@/lib/outline/oauth";
import {
  clearSession,
  getAccessToken,
  getLastServer,
  isLocked,
  loadSession,
  saveSession,
  setLastServer,
  setLocked,
  type Session,
} from "@/lib/session";

// The app asks for a server and an authorization only once. After that:
// - "Sign out" locks the app and keeps the authorization;
// - "Sign in" unlocks it with the phone's fingerprint, face or PIN;
// - "Disconnect" (in settings) revokes the authorization for real.
// The server is needed again only after a disconnect, cleared app data, an
// authorization unused for 30 days, or an admin revoking access.

type Status = "loading" | "setup" | "locked" | "ready";

interface AuthState {
  status: Status;
  session: Session | null;
  /** Pre-fills the server field on the setup screen. */
  lastServer: string;
  /** Shown on the setup or lock screen after something went wrong. */
  message: string | null;
  /** True when the server couldn't be reached and cached details are shown. */
  offline: boolean;
}

interface AuthContextValue extends AuthState {
  /** Calls an Outline API method as the signed-in user. */
  request: <T>(method: string, body?: object) => Promise<T>;
  connect: (server: string) => Promise<void>;
  lock: () => Promise<void>;
  unlock: () => Promise<void>;
  disconnect: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const EXPIRED_MESSAGE =
  "Your authorization ended, so the server needs to confirm it's you again.";

function describeError(err: unknown): string {
  if (err instanceof SignInError || err instanceof OutlineApiError) {
    return err.message;
  }
  return "Something went wrong. Check the server address and your connection.";
}

/** True when the server rejected the stored authorization. */
function isAuthorizationGone(err: unknown): boolean {
  return err instanceof SignInError || (err instanceof OutlineApiError && err.isUnauthorized);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    status: "loading",
    session: null,
    lastServer: "",
    message: null,
    offline: false,
  });

  // The latest session for request(), without re-creating it on every change.
  const sessionRef = useRef<Session | null>(null);
  sessionRef.current = state.session;
  // Outline rotates refresh tokens, so concurrent requests must share one
  // refresh instead of each spending the same refresh token.
  const refreshRef = useRef<Promise<Session> | null>(null);

  /** Refreshes tokens and account details. Throws if the server says no. */
  const activate = useCallback(async (session: Session) => {
    const fresh = await getAccessToken(session);
    const info = await getAuthInfo(fresh.server, fresh.accessToken);
    const updated: Session = {
      ...fresh,
      account: {
        userName: info.user.name,
        userEmail: info.user.email,
        teamName: info.team.name,
        avatarUrl: info.user.avatarUrl,
        color: info.user.color,
        role: info.user.role,
      },
    };
    await saveSession(updated);
    return updated;
  }, []);

  /** Forgets the authorization but keeps the server and its registration. */
  const toSetup = useCallback(async (message: string | null) => {
    await clearSession();
    await setLocked(false);
    const lastServer =
      (await getLastServer()) ?? process.env.EXPO_PUBLIC_DEFAULT_SERVER_URL ?? "";
    setState({ status: "setup", session: null, lastServer, message, offline: false });
  }, []);

  /** Opens the app for a stored session, falling back to cached details offline. */
  const open = useCallback(
    async (session: Session) => {
      try {
        const updated = await activate(session);
        setState((s) => ({ ...s, status: "ready", session: updated, message: null, offline: false }));
      } catch (err) {
        if (isAuthorizationGone(err)) {
          await toSetup(EXPIRED_MESSAGE);
          return;
        }
        setState((s) => ({ ...s, status: "ready", session, message: null, offline: true }));
      }
    },
    [activate, toSetup],
  );

  const request = useCallback(
    async <T,>(method: string, body: object = {}): Promise<T> => {
      const session = sessionRef.current;
      if (!session) {
        throw new Error("Not signed in");
      }
      try {
        refreshRef.current ??= getAccessToken(session).finally(() => {
          refreshRef.current = null;
        });
        const fresh = await refreshRef.current;
        if (fresh !== session) {
          sessionRef.current = fresh;
          setState((s) => ({ ...s, session: fresh }));
        }
        return await apiRequest<T>(fresh.server, fresh.accessToken, method, body);
      } catch (err) {
        if (isAuthorizationGone(err)) {
          await toSetup(EXPIRED_MESSAGE);
        }
        throw err;
      }
    },
    [toSetup],
  );

  useEffect(() => {
    (async () => {
      const session = await loadSession();
      if (!session) {
        await toSetup(null);
        return;
      }
      if (await isLocked()) {
        setState((s) => ({ ...s, status: "locked", session }));
        return;
      }
      await open(session);
    })();
  }, [open, toSetup]);

  const connect = useCallback(
    async (server: string) => {
      try {
        const result = await signIn(server);
        if (!result) {
          return;
        }
        await setLastServer(result.server);
        const session = await activate({
          ...result,
          account: { userName: "", userEmail: "", teamName: "" },
        });
        await setLocked(false);
        setState({ status: "ready", session, lastServer: result.server, message: null, offline: false });
      } catch (err) {
        setState((s) => ({ ...s, message: describeError(err) }));
      }
    },
    [activate],
  );

  const lock = useCallback(async () => {
    await setLocked(true);
    setState((s) => ({ ...s, status: "locked", message: null }));
  }, []);

  const unlock = useCallback(async () => {
    const { session } = state;
    if (!session) {
      return;
    }
    const level = await LocalAuthentication.getEnrolledLevelAsync();
    if (level !== LocalAuthentication.SecurityLevel.NONE) {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: "Sign in to Inkharbor",
      });
      if (!result.success) {
        setState((s) => ({
          ...s,
          message: result.error === "user_cancel" || result.error === "system_cancel"
            ? null
            : "Couldn't confirm it's you. Please try again.",
        }));
        return;
      }
    }
    await setLocked(false);
    await open(session);
  }, [state, open]);

  const disconnect = useCallback(async () => {
    const { session } = state;
    if (session) {
      await revokeTokens(session.server, session.refreshToken);
    }
    await toSetup(null);
  }, [state, toSetup]);

  return (
    <AuthContext.Provider value={{ ...state, request, connect, lock, unlock, disconnect }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return value;
}
