import { savedUpdatedAt, setStarredDocuments, writeDocument } from "@/lib/cache";

import type { Request } from "./collections";
import { getDocument, toSummary, type DocumentSummary } from "./documents";

/** A star on a document or a collection. Exactly one of the two ids is set. */
export interface Star {
  id: string;
  documentId: string | null;
  collectionId: string | null;
}

/** What to star: a document or a collection. */
export type StarTarget = { documentId: string } | { collectionId: string };

/** The user's stars in their sidebar order, with the starred documents' details. */
export interface Starred {
  stars: Star[];
  documents: DocumentSummary[];
}

interface StarsPage {
  stars: Star[];
  documents: DocumentSummary[];
}

const PAGE_SIZE = 100;

export function isStarFor(star: Star, target: StarTarget): boolean {
  return "documentId" in target
    ? star.documentId === target.documentId
    : star.collectionId === target.collectionId;
}

/** All of the user's stars. Only the details the app shows are kept. */
export async function listStars(request: Request): Promise<Starred> {
  const stars: Star[] = [];
  const documents: DocumentSummary[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await request<StarsPage>("stars.list", { limit: PAGE_SIZE, offset });
    stars.push(
      ...page.stars.map(({ id, documentId, collectionId }) => ({ id, documentId, collectionId })),
    );
    documents.push(...page.documents.map(toSummary));
    if (page.stars.length < PAGE_SIZE) {
      return { stars, documents };
    }
  }
}

/** Stars a document or collection. Outline puts new stars at the top. */
export async function createStar(request: Request, target: StarTarget): Promise<Star> {
  const { id, documentId, collectionId } = await request<Star>("stars.create", target);
  return { id, documentId, collectionId };
}

export async function deleteStar(request: Request, id: string): Promise<void> {
  await request("stars.delete", { id });
}

/**
 * Saves every starred document on the device so it can be read offline, and
 * lets go of documents that are no longer starred. Only documents that
 * changed since they were last saved are downloaded.
 */
export async function saveStarredDocuments(request: Request, starred: Starred): Promise<void> {
  const updatedAt = new Map(starred.documents.map((document) => [document.id, document.updatedAt]));
  // Stars on documents the user can no longer read come without details; skip those.
  const ids = starred.stars.flatMap((star) =>
    star.documentId && updatedAt.has(star.documentId) ? [star.documentId] : [],
  );

  await setStarredDocuments(ids);
  const saved = await savedUpdatedAt(ids);
  for (const id of ids) {
    if (saved.get(id) !== updatedAt.get(id)) {
      await writeDocument(await getDocument(request, id), { starred: true });
    }
  }
}
