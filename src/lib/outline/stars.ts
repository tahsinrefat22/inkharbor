import { savedUpdatedAt, setStarredDocuments, writeDocument } from "@/lib/cache";

import type { Request } from "./collections";
import { getDocument } from "./documents";

interface StarsPage {
  stars: { documentId: string | null }[];
  documents: { id: string; updatedAt: string }[];
}

const PAGE_SIZE = 100;

/**
 * Saves every starred document on the device so it can be read offline.
 * Only documents that changed since they were last saved are downloaded.
 */
export async function syncStarredDocuments(request: Request): Promise<void> {
  const ids: string[] = [];
  const updatedAt = new Map<string, string>();
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await request<StarsPage>("stars.list", { limit: PAGE_SIZE, offset });
    for (const star of page.stars) {
      if (star.documentId) {
        ids.push(star.documentId);
      }
    }
    for (const document of page.documents) {
      updatedAt.set(document.id, document.updatedAt);
    }
    if (page.stars.length < PAGE_SIZE) {
      break;
    }
  }

  await setStarredDocuments(ids);
  const saved = await savedUpdatedAt(ids);
  for (const id of ids) {
    if (saved.get(id) !== updatedAt.get(id)) {
      await writeDocument(await getDocument(request, id), { starred: true });
    }
  }
}
