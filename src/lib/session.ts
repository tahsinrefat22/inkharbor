import * as SecureStore from "expo-secure-store";

import { refreshTokens, type SignInResult } from "@/lib/outline/oauth";

// Everything is kept in the platform keystore, so it survives app restarts
// and is wiped only when the user clears the app's data. SecureStore keys may
// only contain letters, digits, ".", "-" and "_", so values are JSON.
const SESSION_KEY = "session";
const LOCKED_KEY = "locked";
const LAST_SERVER_KEY = "last_server";

/** Refresh this long before the access token actually expires. */
const REFRESH_MARGIN_MS = 60_000;

/** Who is signed in, kept so the lock screen can greet them offline. */
export interface Account {
  userName: string;
  userEmail: string;
  teamName: string;
}

export interface Session extends SignInResult {
  account: Account;
}

export async function loadSession(): Promise<Session | null> {
  const raw = await SecureStore.getItemAsync(SESSION_KEY);
  if (!raw) {
    return null;
  }
  try {
    // Sessions saved before the account snapshot existed get blank details,
    // which are filled in the next time the app reaches the server.
    return { account: { userName: "", userEmail: "", teamName: "" }, ...JSON.parse(raw) };
  } catch {
    await clearSession();
    return null;
  }
}

export function saveSession(session: Session): Promise<void> {
  return SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session));
}

export function clearSession(): Promise<void> {
  return SecureStore.deleteItemAsync(SESSION_KEY);
}

/**
 * "Signing out" locks the app but keeps the session, so signing back in is a
 * device unlock instead of a new authorization with the server.
 */
export async function isLocked(): Promise<boolean> {
  return (await SecureStore.getItemAsync(LOCKED_KEY)) === "1";
}

export function setLocked(locked: boolean): Promise<void> {
  return locked
    ? SecureStore.setItemAsync(LOCKED_KEY, "1")
    : SecureStore.deleteItemAsync(LOCKED_KEY);
}

/** The last server the user connected to, remembered across disconnects. */
export function getLastServer(): Promise<string | null> {
  return SecureStore.getItemAsync(LAST_SERVER_KEY);
}

export function setLastServer(server: string): Promise<void> {
  return SecureStore.setItemAsync(LAST_SERVER_KEY, server);
}

/**
 * Returns a usable access token, refreshing and saving new tokens first if the
 * current one is about to expire. Outline rotates refresh tokens, so the new
 * refresh token must be stored every time.
 */
export async function getAccessToken(session: Session): Promise<Session> {
  if (session.expiresAt - Date.now() > REFRESH_MARGIN_MS) {
    return session;
  }
  const tokens = await refreshTokens(
    session.tokenEndpoint,
    session.clientId,
    session.refreshToken,
  );
  const updated = { ...session, ...tokens };
  await saveSession(updated);
  return updated;
}
