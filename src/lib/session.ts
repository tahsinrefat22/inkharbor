import * as SecureStore from "expo-secure-store";

import { refreshTokens, type SignInResult } from "@/lib/outline/oauth";

// One signed-in account, kept in the platform keystore. SecureStore keys may
// only contain letters, digits, ".", "-" and "_", so everything lives under a
// single key as JSON.
const SESSION_KEY = "session";

/** Refresh this long before the access token actually expires. */
const REFRESH_MARGIN_MS = 60_000;

export type Session = SignInResult;

export async function loadSession(): Promise<Session | null> {
  const raw = await SecureStore.getItemAsync(SESSION_KEY);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as Session;
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
