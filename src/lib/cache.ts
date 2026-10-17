import * as SQLite from "expo-sqlite";

import type { DocumentSummary, OutlineDocument, PMNode } from "@/lib/outline/documents";
import { FIRST_ACCOUNT_ID } from "@/lib/session";

// An on-device copy of what the user has seen, so the app keeps working
// offline: the collection list, each collection's tree, and documents (the
// most recently opened ones plus every starred one). Each account has its
// own database, deleted when the account is removed and when the app's data
// is cleared. Edits made without a connection wait here too, until they can
// be saved (see lib/pending-edits.tsx).

const DATABASE_VERSION = 2;
/** Non-starred documents kept, most recently opened first. */
const RECENT_DOCUMENTS = 50;

export interface Cached<T> {
  value: T;
  /** Epoch milliseconds when this copy was saved. */
  savedAt: number;
}

/** The copy from before 0.7, kept as the first account's. */
const FIRST_DATABASE_NAME = "inkharbor-cache.db";

function databaseName(accountId: string): string {
  return accountId === FIRST_ACCOUNT_ID ? FIRST_DATABASE_NAME : `inkharbor-cache-${accountId}.db`;
}

const databases = new Map<string, Promise<SQLite.SQLiteDatabase>>();
let currentAccount = FIRST_ACCOUNT_ID;

/** Called whenever documents are saved or removed, e.g. to update offline markers. */
const documentListeners = new Set<() => void>();

export function subscribeToSavedDocuments(listener: () => void): () => void {
  documentListeners.add(listener);
  return () => {
    documentListeners.delete(listener);
  };
}

function documentsChanged(): void {
  for (const listener of documentListeners) {
    listener();
  }
}

function database(): Promise<SQLite.SQLiteDatabase> {
  const name = databaseName(currentAccount);
  let promise = databases.get(name);
  if (!promise) {
    promise = (async () => {
      const db = await SQLite.openDatabaseAsync(name);
      await migrate(db);
      return db;
    })();
    // A failed open is tried again next time.
    promise.catch(() => databases.delete(name));
    databases.set(name, promise);
  }
  return promise;
}

/** Points everything saved and read from now on at this account's copy. */
export function switchCacheTo(accountId: string): void {
  if (accountId !== currentAccount) {
    currentAccount = accountId;
    documentsChanged();
  }
}

/** Deletes an account's copy, e.g. when it's removed from the app. */
export async function deleteCacheOf(accountId: string): Promise<void> {
  const name = databaseName(accountId);
  const open = databases.get(name);
  databases.delete(name);
  try {
    await (await open)?.closeAsync();
  } catch {
    // Never opened, or already closed.
  }
  try {
    await SQLite.deleteDatabaseAsync(name);
  } catch {
    // Nothing was saved for it.
  }
}

async function migrate(db: SQLite.SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>("PRAGMA user_version");
  const version = row?.user_version ?? 0;
  if (version >= DATABASE_VERSION) {
    return;
  }
  if (version < 1) {
    await createTables(db);
  }
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS pending_edits (
      document_id TEXT PRIMARY KEY NOT NULL,
      base TEXT NOT NULL,
      edited TEXT NOT NULL,
      saved_at INTEGER NOT NULL
    );
    PRAGMA user_version = ${DATABASE_VERSION};
  `);
}

async function createTables(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS entries (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL,
      saved_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY NOT NULL,
      url_id TEXT,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      saved_at INTEGER NOT NULL,
      opened_at INTEGER,
      starred INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS documents_url_id ON documents (url_id);
  `);
}

/** Reads a saved value such as "collections" or "tree:<id>". */
export async function readEntry<T>(key: string): Promise<Cached<T> | null> {
  const db = await database();
  const row = await db.getFirstAsync<{ value: string; saved_at: number }>(
    "SELECT value, saved_at FROM entries WHERE key = ?",
    key,
  );
  return row ? { value: JSON.parse(row.value) as T, savedAt: row.saved_at } : null;
}

export async function writeEntry(key: string, value: unknown): Promise<void> {
  const db = await database();
  await db.runAsync(
    "INSERT OR REPLACE INTO entries (key, value, saved_at) VALUES (?, ?, ?)",
    key,
    JSON.stringify(value),
    Date.now(),
  );
}

/** The urlId is the last part of a document's url, e.g. /doc/title-WWQrEySkiz. */
function urlIdOf(document: OutlineDocument): string | null {
  return document.url.match(/-?([A-Za-z0-9]{10})$/)?.[1] ?? null;
}

/** Reads a saved document by its id or by the urlId used in links. */
export async function readDocument(idOrUrlId: string): Promise<Cached<OutlineDocument> | null> {
  const db = await database();
  const row = await db.getFirstAsync<{ value: string; saved_at: number }>(
    "SELECT value, saved_at FROM documents WHERE id = ? OR url_id = ?",
    idOrUrlId,
    idOrUrlId,
  );
  return row ? { value: JSON.parse(row.value) as OutlineDocument, savedAt: row.saved_at } : null;
}

/**
 * Saves a document. `opened` records it as recently read; starred documents
 * are kept regardless of how long ago they were opened.
 */
export async function writeDocument(
  document: OutlineDocument,
  { opened = false, starred }: { opened?: boolean; starred?: boolean } = {},
): Promise<void> {
  const db = await database();
  const now = Date.now();
  await db.runAsync(
    `INSERT INTO documents (id, url_id, value, updated_at, saved_at, opened_at, starred)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       url_id = excluded.url_id,
       value = excluded.value,
       updated_at = excluded.updated_at,
       saved_at = excluded.saved_at,
       opened_at = COALESCE(excluded.opened_at, documents.opened_at),
       starred = CASE WHEN ? IS NULL THEN documents.starred ELSE excluded.starred END`,
    document.id,
    urlIdOf(document),
    JSON.stringify(document),
    document.updatedAt,
    now,
    opened ? now : null,
    starred ? 1 : 0,
    starred === undefined ? null : 1,
  );
  await pruneDocuments(db);
  documentsChanged();
}

/** A document opened in this app, with when it was last opened. */
export interface OpenedDocument extends DocumentSummary {
  /** Epoch milliseconds. */
  openedAt: number;
}

/** The documents most recently opened in this app, newest first. */
export async function recentlyOpened(limit: number): Promise<OpenedDocument[]> {
  const db = await database();
  // Only the details for a list row, not the whole saved body.
  const rows = await db.getAllAsync<{
    id: string;
    title: string | null;
    icon: string | null;
    color: string | null;
    collection_id: string | null;
    updated_at: string;
    opened_at: number;
  }>(
    `SELECT id,
       json_extract(value, '$.title') AS title,
       json_extract(value, '$.icon') AS icon,
       json_extract(value, '$.color') AS color,
       json_extract(value, '$.collectionId') AS collection_id,
       updated_at, opened_at
     FROM documents WHERE opened_at IS NOT NULL
     ORDER BY opened_at DESC LIMIT ?`,
    limit,
  );
  return rows.map((row) => ({
    id: row.id,
    title: row.title ?? "",
    icon: row.icon,
    color: row.color,
    collectionId: row.collection_id,
    updatedAt: row.updated_at,
    openedAt: row.opened_at,
  }));
}

/** The ids of all documents saved on the device. */
export async function savedDocumentIds(): Promise<Set<string>> {
  const db = await database();
  const rows = await db.getAllAsync<{ id: string }>("SELECT id FROM documents");
  return new Set(rows.map((row) => row.id));
}

/** When each saved document was last updated on the server, by id. */
export async function savedUpdatedAt(ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) {
    return new Map();
  }
  const db = await database();
  const rows = await db.getAllAsync<{ id: string; updated_at: string }>(
    `SELECT id, updated_at FROM documents WHERE id IN (${ids.map(() => "?").join(", ")})`,
    ...ids,
  );
  return new Map(rows.map((row) => [row.id, row.updated_at]));
}

/** Marks exactly these documents as starred, unmarking the rest. */
export async function setStarredDocuments(ids: string[]): Promise<void> {
  const db = await database();
  await db.withTransactionAsync(async () => {
    await db.runAsync("UPDATE documents SET starred = 0");
    for (const id of ids) {
      await db.runAsync("UPDATE documents SET starred = 1 WHERE id = ?", id);
    }
  });
  await pruneDocuments(db);
  documentsChanged();
}

/** Keeps starred documents and the most recently opened others. */
async function pruneDocuments(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.runAsync(
    // Documents with edits waiting to be saved stay too.
    `DELETE FROM documents WHERE starred = 0 AND id NOT IN (
       SELECT id FROM documents WHERE starred = 0
       ORDER BY COALESCE(opened_at, 0) DESC, saved_at DESC LIMIT ?
     ) AND id NOT IN (SELECT document_id FROM pending_edits)`,
    RECENT_DOCUMENTS,
  );
}

/** An edit made without a connection: the document as edited, and what it was made from. */
export interface PendingEdit {
  documentId: string;
  base: PMNode;
  edited: PMNode;
  savedAt: number;
}

interface PendingEditRow {
  document_id: string;
  base: string;
  edited: string;
  saved_at: number;
}

const toPendingEdit = (row: PendingEditRow): PendingEdit => ({
  documentId: row.document_id,
  base: JSON.parse(row.base) as PMNode,
  edited: JSON.parse(row.edited) as PMNode,
  savedAt: row.saved_at,
});

export async function readPendingEdit(documentId: string): Promise<PendingEdit | null> {
  const db = await database();
  const row = await db.getFirstAsync<PendingEditRow>("SELECT * FROM pending_edits WHERE document_id = ?", documentId);
  return row ? toPendingEdit(row) : null;
}

/** Every edit waiting to be saved, oldest first. */
export async function pendingEdits(): Promise<PendingEdit[]> {
  const db = await database();
  const rows = await db.getAllAsync<PendingEditRow>("SELECT * FROM pending_edits ORDER BY saved_at");
  return rows.map(toPendingEdit);
}

/** Keeps an edit until it can be saved; a later one for the same document replaces it. */
export async function writePendingEdit(documentId: string, base: PMNode, edited: PMNode): Promise<void> {
  const db = await database();
  await db.runAsync(
    "INSERT OR REPLACE INTO pending_edits (document_id, base, edited, saved_at) VALUES (?, ?, ?, ?)",
    documentId,
    JSON.stringify(base),
    JSON.stringify(edited),
    Date.now(),
  );
}

export async function deletePendingEdit(documentId: string): Promise<void> {
  const db = await database();
  await db.runAsync("DELETE FROM pending_edits WHERE document_id = ?", documentId);
}
