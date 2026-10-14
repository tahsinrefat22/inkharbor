import { useEffect, useState } from "react";

import { savedDocumentIds, subscribeToSavedDocuments } from "@/lib/cache";

/**
 * The ids of the documents saved on the device, kept up to date as
 * documents are opened, starred, downloaded in the background or let go.
 */
export function useSavedDocuments(): Set<string> {
  const [saved, setSaved] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    let current = true;
    const read = () => {
      savedDocumentIds()
        .then((ids) => {
          if (current) {
            setSaved(ids);
          }
        })
        .catch(() => {
          // Storage unavailable; no markers is the honest answer.
        });
    };
    read();
    const unsubscribe = subscribeToSavedDocuments(read);
    return () => {
      current = false;
      unsubscribe();
    };
  }, []);

  return saved;
}
