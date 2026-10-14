import * as SQLite from "expo-sqlite";

import type { DocumentSummary, OutlineDocument } from "@/lib/outline/documents";

// An on-device copy of what the user has seen, so the app keeps working
// offline: the collection list, each collection's tree, and documents (the
// most recently opened ones plus every starred one). Cleared on disconnect
// and when the app's data is cleared.

const DATABASE_NAME = "inkharbor-cache.db";
const DATABASE_VERSION = 1;
/** Non-starred documents kept, most recently opened first. */
const RECENT_DOCUMENTS = 50;

export interface Cached<T> {
  value: T;
  /** Epoch milliseconds when this copy was saved. */
  savedAt: number;
}

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

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
  databasePromise ??= (async () => {
    const db = await SQLite.openDatabaseAsync(DATABASE_NAME);
    await migrate(db);
    return db;
  })();
  return databasePromise;
}

async function migrate(db: SQLite.SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>("PRAGMA user_version");
  if ((row?.user_version ?? 0) >= DATABASE_VERSION) {
    return;
  }
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
    PRAGMA user_version = ${DATABASE_VERSION};
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
    `DELETE FROM documents WHERE starred = 0 AND id NOT IN (
       SELECT id FROM documents WHERE starred = 0
       ORDER BY COALESCE(opened_at, 0) DESC, saved_at DESC LIMIT ?
     )`,
    RECENT_DOCUMENTS,
  );
}

/** Forgets everything saved, e.g. when the user disconnects. */
export async function clearCache(): Promise<void> {
  const db = await database();
  await db.execAsync("DELETE FROM entries; DELETE FROM documents;");
  documentsChanged();
}
