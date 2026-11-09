import * as SecureStore from "expo-secure-store";

import { refreshTokens, type SignInResult } from "@/lib/outline/oauth";
import { originOf } from "@/lib/outline/server-access";

// Everything is kept in the platform keystore, so it survives app restarts
// and is wiped only when the user clears the app's data. SecureStore keys may
// only contain letters, digits, ".", "-" and "_", so values are JSON.
//
// Each server the user connected to is an account with its own session,
// stored under its own key (one key each keeps every value small), plus a
// list of the accounts and which one is open.
const ACCOUNTS_KEY = "accounts";
const ACTIVE_KEY = "active_account";
const sessionKey = (id: string) => `session.${id}`;
/** Where versions before 0.7 kept their only session. */
const LEGACY_SESSION_KEY = "session";
const LOCKED_KEY = "locked";
const LAST_SERVER_KEY = "last_server";
const KEPT_KEY = "kept_accounts";
/** How long edits are kept for an account whose authorization ended. */
const KEPT_FOR_MS = 30 * 24 * 60 * 60 * 1000;

/** The id given to the session kept from before 0.7; its offline copy keeps its old name too. */
export const FIRST_ACCOUNT_ID = "first";

/** Refresh this long before the access token actually expires. */
const REFRESH_MARGIN_MS = 60_000;

/** Who is signed in, kept so the lock screen can greet them offline. */
export interface Account {
  /** Missing for sessions saved before it was kept, until the app next reaches the server. */
  userId?: string;
  userName: string;
  userEmail: string;
  teamName: string;
  /** Profile photo; missing for users without one and for older sessions. */
  avatarUrl?: string | null;
  /** Colour Outline assigns the user, used behind their initials. */
  color?: string;
  role?: string;
}

export interface Session extends SignInResult {
  /** Stays the same for as long as the account is kept in the app. */
  id: string;
  account: Account;
}

export function newAccountId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

async function readJson<T>(key: string): Promise<T | null> {
  const raw = await SecureStore.getItemAsync(key);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function loadIds(): Promise<string[]> {
  const ids = await readJson<unknown>(ACCOUNTS_KEY);
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
}

function saveIds(ids: string[]): Promise<void> {
  return SecureStore.setItemAsync(ACCOUNTS_KEY, JSON.stringify(ids));
}

/** Moves the single session of versions before 0.7 into the account list. */
async function migrateLegacySession(): Promise<void> {
  const legacy = await readJson<Omit<Session, "id">>(LEGACY_SESSION_KEY);
  if (legacy) {
    await saveSession({ ...legacy, id: FIRST_ACCOUNT_ID });
    await setActiveAccount(FIRST_ACCOUNT_ID);
  }
  await SecureStore.deleteItemAsync(LEGACY_SESSION_KEY);
}

/** Every saved account, in the order they were added, and the open one's id. */
export async function loadSessions(): Promise<{ sessions: Session[]; activeId: string | null }> {
  if (await SecureStore.getItemAsync(LEGACY_SESSION_KEY)) {
    await migrateLegacySession();
  }
  const sessions: Session[] = [];
  for (const id of await loadIds()) {
    const saved = await readJson<Omit<Session, "account"> & Partial<Session>>(sessionKey(id));
    if (saved) {
      // Sessions saved before the account snapshot existed get blank details,
      // which are filled in the next time the app reaches the server.
      sessions.push({ account: { userName: "", userEmail: "", teamName: "" }, ...saved, id });
    }
  }
  const activeId = await SecureStore.getItemAsync(ACTIVE_KEY);
  return { sessions, activeId: sessions.some((s) => s.id === activeId) ? activeId : (sessions[0]?.id ?? null) };
}

/** Saves an account's session, adding it to the list if it's new. */
export async function saveSession(session: Session): Promise<void> {
  await SecureStore.setItemAsync(sessionKey(session.id), JSON.stringify(session));
  const ids = await loadIds();
  if (!ids.includes(session.id)) {
    await saveIds([...ids, session.id]);
  }
}

export async function removeSession(id: string): Promise<void> {
  await SecureStore.deleteItemAsync(sessionKey(id));
  await saveIds((await loadIds()).filter((other) => other !== id));
  if ((await SecureStore.getItemAsync(ACTIVE_KEY)) === id) {
    await SecureStore.deleteItemAsync(ACTIVE_KEY);
  }
}

export function setActiveAccount(id: string): Promise<void> {
  return SecureStore.setItemAsync(ACTIVE_KEY, id);
}

/**
 * "Signing out" locks the app but keeps the sessions, so signing back in is
 * a device unlock instead of a new authorization with the server.
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
  // Unless the account was removed while the tokens were being refreshed.
  if ((await loadIds()).includes(session.id)) {
    await SecureStore.setItemAsync(sessionKey(session.id), JSON.stringify(updated));
  }
  return updated;
}

/**
 * An account the server signed out while edits were waiting to be saved. Its
 * database is kept with only those edits, and handed to the same user on the
 * same server when they sign in again. Never to anyone else: the user is the
 * one the server confirms after that sign-in.
 */
interface KeptAccount {
  id: string;
  /** The server's origin. */
  server: string;
  userId: string;
  keptAt: number;
}

async function loadKept(): Promise<KeptAccount[]> {
  const kept = await readJson<unknown>(KEPT_KEY);
  return Array.isArray(kept) ? (kept as KeptAccount[]) : [];
}

function saveKept(kept: KeptAccount[]): Promise<void> {
  return SecureStore.setItemAsync(KEPT_KEY, JSON.stringify(kept));
}

/** Remembers an account whose edits are kept after its authorization ended. */
export async function keepAccount(id: string, server: string, userId: string): Promise<void> {
  const kept = (await loadKept()).filter((other) => other.id !== id);
  await saveKept([...kept, { id, server: originOf(server) ?? server, userId, keptAt: Date.now() }]);
}

/** Takes the kept accounts of this user on this server, oldest first. */
export async function takeKeptAccounts(server: string, userId: string | undefined): Promise<string[]> {
  const kept = await loadKept();
  const origin = originOf(server);
  const mine = kept.filter((other) => !!userId && other.userId === userId && other.server === origin);
  if (mine.length) {
    await saveKept(kept.filter((other) => !mine.includes(other)));
  }
  return mine.map((other) => other.id);
}

/** Takes the kept accounts nobody signed in to again in time, so their edits can be deleted. */
export async function takeExpiredKeptAccounts(): Promise<string[]> {
  const kept = await loadKept();
  const expired = kept.filter((other) => Date.now() - other.keptAt > KEPT_FOR_MS);
  if (expired.length) {
    await saveKept(kept.filter((other) => !expired.includes(other)));
  }
  return expired.map((other) => other.id);
}

/** The servers of the kept accounts. */
export async function keptServers(): Promise<string[]> {
  return (await loadKept()).map((other) => other.server);
}
