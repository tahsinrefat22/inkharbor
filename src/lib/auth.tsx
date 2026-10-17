import * as LocalAuthentication from "expo-local-authentication";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

import { deleteCacheOf, switchCacheTo } from "@/lib/cache";
import { apiRequest, getAuthInfo, OutlineApiError } from "@/lib/outline/api";
import { revokeTokens, signIn, SignInError } from "@/lib/outline/oauth";
import {
  getAccessToken,
  getLastServer,
  isLocked,
  loadSessions,
  newAccountId,
  removeSession,
  saveSession,
  setActiveAccount,
  setLastServer,
  setLocked,
  type Session,
} from "@/lib/session";

// The app asks for a server and an authorization only once per server. After that:
// - "Sign out" locks the app and keeps every authorization;
// - "Sign in" unlocks it with the phone's fingerprint, face or PIN;
// - "Disconnect" (in settings) revokes the open account's authorization for real.
// A server is needed again only after a disconnect, cleared app data, an
// authorization unused for 30 days, or an admin revoking access.
//
// Several servers (accounts) can be kept, one open at a time, each with its
// own offline copy. Switching shows the other account's saved copy at once.

type Status = "loading" | "setup" | "locked" | "ready";

interface AuthState {
  status: Status;
  /** The open account. */
  session: Session | null;
  /** Every saved account, the open one included, in the order they were added. */
  sessions: Session[];
  /** Pre-fills the server field on the setup screen. */
  lastServer: string;
  /** Shown on the setup or lock screen after something went wrong. */
  message: string | null;
  /** True when the server couldn't be reached and cached details are shown. */
  offline: boolean;
}

export type ConnectResult = { connected: true } | { connected: false; error?: string };

interface AuthContextValue extends AuthState {
  /** Calls an Outline API method as the signed-in user of the open account. */
  request: <T>(method: string, body?: object, headers?: Record<string, string>) => Promise<T>;
  /** Adds a server (or signs in to one again) and opens it. */
  connect: (server: string) => Promise<ConnectResult>;
  switchAccount: (id: string) => Promise<void>;
  /** From the setup screen, back to a saved account. */
  cancelSetup: () => Promise<void>;
  lock: () => Promise<void>;
  unlock: () => Promise<void>;
  /** Removes the open account and opens the next one, if any. */
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

/** The list with this session added or replaced. */
function withSession(sessions: Session[], session: Session): Session[] {
  return sessions.some((s) => s.id === session.id)
    ? sessions.map((s) => (s.id === session.id ? session : s))
    : [...sessions, session];
}

const BLANK_ACCOUNT = { userName: "", userEmail: "", teamName: "" };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    status: "loading",
    session: null,
    sessions: [],
    lastServer: "",
    message: null,
    offline: false,
  });

  // The latest state for callbacks, without re-creating them on every change.
  // Set as soon as the open account changes, before the next render.
  const sessionRef = useRef<Session | null>(null);
  const sessionsRef = useRef<Session[]>([]);
  useEffect(() => {
    sessionRef.current = state.session;
    sessionsRef.current = state.sessions;
  }, [state.session, state.sessions]);
  // Outline rotates refresh tokens, so concurrent requests must share one
  // refresh instead of each spending the same refresh token.
  const refreshRef = useRef<{ id: string; promise: Promise<Session> } | null>(null);

  /** Updates a saved account's session, e.g. after its tokens were refreshed. */
  const update = useCallback((session: Session) => {
    if (sessionRef.current?.id === session.id) {
      sessionRef.current = session;
    }
    sessionsRef.current = withSession(sessionsRef.current, session);
    setState((s) => ({
      ...s,
      session: s.session?.id === session.id ? session : s.session,
      sessions: withSession(s.sessions, session),
    }));
  }, []);

  /** Opens an account: its offline copy and its details right away. */
  const show = useCallback((session: Session, offline: boolean) => {
    switchCacheTo(session.id);
    sessionRef.current = session;
    sessionsRef.current = withSession(sessionsRef.current, session);
    setState((s) => ({
      ...s,
      status: "ready",
      session,
      sessions: withSession(s.sessions, session),
      message: null,
      offline,
    }));
  }, []);

  /** Refreshed tokens and account details. Throws if the server says no. */
  const withAccount = useCallback(async (session: Session): Promise<Session> => {
    const fresh = await getAccessToken(session);
    const info = await getAuthInfo(fresh.server, fresh.accessToken);
    return {
      ...fresh,
      account: {
        userId: info.user.id,
        userName: info.user.name,
        userEmail: info.user.email,
        teamName: info.team.name,
        avatarUrl: info.user.avatarUrl,
        color: info.user.color,
        role: info.user.role,
      },
    };
  }, []);

  const toSetup = useCallback(async (message: string | null, server?: string) => {
    const lastServer =
      server ?? (await getLastServer()) ?? process.env.EXPO_PUBLIC_DEFAULT_SERVER_URL ?? "";
    sessionRef.current = null;
    setState((s) => ({ ...s, status: "setup", session: null, lastServer, message, offline: false }));
  }, []);

  // Declared before use by the callbacks below; assigned once they exist.
  const openRef = useRef<(session: Session) => Promise<void>>(async () => {});

  /**
   * Forgets an account: its authorization and its offline copy (the server
   * address and the app's registration with it are kept). With a message,
   * the server asked for a new sign-in, so the setup screen offers it.
   */
  const removeAccount = useCallback(
    async (session: Session, message: string | null) => {
      await removeSession(session.id);
      await deleteCacheOf(session.id);
      const remaining = sessionsRef.current.filter((s) => s.id !== session.id);
      sessionsRef.current = remaining;
      setState((s) => ({ ...s, sessions: s.sessions.filter((other) => other.id !== session.id) }));
      if (message || !remaining.length) {
        await toSetup(message, session.server);
        return;
      }
      await setActiveAccount(remaining[0].id);
      await openRef.current(remaining[0]);
    },
    [toSetup],
  );

  /** Checks an open account with its server in the background. */
  const refresh = useCallback(
    async (session: Session) => {
      try {
        const updated = await withAccount(session);
        await saveSession(updated);
        update(updated);
        if (sessionRef.current?.id === session.id) {
          setState((s) => ({ ...s, offline: false }));
        }
      } catch (err) {
        if (sessionRef.current?.id !== session.id) {
          return;
        }
        if (isAuthorizationGone(err)) {
          await removeAccount(session, EXPIRED_MESSAGE);
          return;
        }
        setState((s) => ({ ...s, offline: true }));
      }
    },
    [withAccount, update, removeAccount],
  );

  /** Opens an account with its saved details, then checks it with the server. */
  const open = useCallback(
    async (session: Session) => {
      show(session, false);
      await refresh(session);
    },
    [show, refresh],
  );
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  const request = useCallback(
    async <T,>(method: string, body: object = {}, headers: Record<string, string> = {}): Promise<T> => {
      const session = sessionRef.current;
      if (!session) {
        throw new Error("Not signed in");
      }
      // An answer meant for an account that's no longer open is dropped, so
      // it can't be shown or saved as the new account's.
      const stillOpen = () => {
        if (sessionRef.current?.id !== session.id) {
          throw new Error("Switched to another account");
        }
      };
      try {
        if (refreshRef.current?.id !== session.id) {
          const promise = getAccessToken(session).finally(() => {
            if (refreshRef.current?.promise === promise) {
              refreshRef.current = null;
            }
          });
          refreshRef.current = { id: session.id, promise };
        }
        const fresh = await refreshRef.current.promise;
        stillOpen();
        if (fresh.accessToken !== session.accessToken) {
          update(fresh);
        }
        const result = await apiRequest<T>(fresh.server, fresh.accessToken, method, body, headers);
        stillOpen();
        return result;
      } catch (err) {
        if (isAuthorizationGone(err) && sessionRef.current?.id === session.id) {
          await removeAccount(session, EXPIRED_MESSAGE);
        }
        throw err;
      }
    },
    [update, removeAccount],
  );

  useEffect(() => {
    (async () => {
      const { sessions, activeId } = await loadSessions();
      sessionsRef.current = sessions;
      setState((s) => ({ ...s, sessions }));
      const session = sessions.find((s) => s.id === activeId);
      if (!session) {
        await toSetup(null);
        return;
      }
      switchCacheTo(session.id);
      if (await isLocked()) {
        sessionRef.current = session;
        setState((s) => ({ ...s, status: "locked", session }));
        return;
      }
      // On opening the app, wait for the server's answer (or its absence)
      // before showing the account, so tokens are fresh for the first loads.
      try {
        const updated = await withAccount(session);
        await saveSession(updated);
        show(updated, false);
      } catch (err) {
        if (isAuthorizationGone(err)) {
          await removeAccount(session, EXPIRED_MESSAGE);
          return;
        }
        show(session, true);
      }
    })();
  }, [toSetup, withAccount, show, removeAccount]);

  const connect = useCallback(
    async (server: string): Promise<ConnectResult> => {
      try {
        const result = await signIn(server);
        if (!result) {
          return { connected: false };
        }
        await setLastServer(result.server);
        let session = await withAccount({ ...result, id: newAccountId(), account: BLANK_ACCOUNT });
        // The same person on the same server again: keep the account and
        // its offline copy, with the new authorization.
        const existing = sessionsRef.current.find(
          (s) => s.server === session.server && s.account.userId === session.account.userId,
        );
        if (existing) {
          session = { ...session, id: existing.id };
          await revokeTokens(existing.server, existing.refreshToken);
        }
        await saveSession(session);
        await setActiveAccount(session.id);
        await setLocked(false);
        show(session, false);
        return { connected: true };
      } catch (err) {
        return { connected: false, error: describeError(err) };
      }
    },
    [withAccount, show],
  );

  const switchAccount = useCallback(
    async (id: string) => {
      const session = sessionsRef.current.find((s) => s.id === id);
      if (!session || sessionRef.current?.id === id) {
        return;
      }
      await setActiveAccount(id);
      await open(session);
    },
    [open],
  );

  const cancelSetup = useCallback(async () => {
    const [first] = sessionsRef.current;
    if (first) {
      await setActiveAccount(first.id);
      await open(first);
    }
  }, [open]);

  const lock = useCallback(async () => {
    await setLocked(true);
    setState((s) => ({ ...s, status: "locked", message: null }));
  }, []);

  const unlock = useCallback(async () => {
    const session = sessionRef.current;
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
  }, [open]);

  const disconnect = useCallback(async () => {
    const session = sessionRef.current;
    if (!session) {
      return;
    }
    await revokeTokens(session.server, session.refreshToken);
    await removeAccount(session, null);
  }, [removeAccount]);

  return (
    <AuthContext.Provider
      value={{ ...state, request, connect, switchAccount, cancelSetup, lock, unlock, disconnect }}
    >
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
