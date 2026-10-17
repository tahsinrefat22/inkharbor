import { useEffect } from "react";
import { AppState } from "react-native";

import { useAuth } from "@/lib/auth";
import { deletePendingEdit, pendingEdits, writeDocument } from "@/lib/cache";
import { saveDocument } from "@/lib/editor/save";
import { isNetworkError, OutlineApiError } from "@/lib/outline/api";

// Edits made without a connection are kept on the phone (lib/cache.ts) and
// saved once the server can be reached: when the app starts, when it comes
// back to the front, and every so often while any are waiting. Each is tried
// once; if Outline turns it down (it clashes with changes made elsewhere,
// or can't be saved from the app) it's dropped without a word, as Outline's
// copy wins. A document open in the editor is left to the editor, which
// saves it the same way.

const RETRY_MS = 30_000;

const openInEditor = new Set<string>();

/** Marks a document as open in the editor while it is; returns the undo. */
export function markOpenInEditor(documentId: string): () => void {
  openInEditor.add(documentId);
  return () => {
    openInEditor.delete(documentId);
  };
}

/** Not reaching the server, as opposed to the server refusing. */
export function isUnreachable(err: unknown): boolean {
  return isNetworkError(err) || (err instanceof OutlineApiError && err.isServerError);
}

/** Saves waiting edits for the open account; renders nothing. */
export function PendingEditsSync() {
  const { status, session, requestWithPolicies } = useAuth();
  const accountId = session?.id;

  useEffect(() => {
    if (status !== "ready" || !accountId) {
      return;
    }
    let cancelled = false;
    let running = false;
    const run = async () => {
      if (running) {
        return;
      }
      running = true;
      try {
        for (const edit of await pendingEdits()) {
          if (cancelled) {
            return;
          }
          if (openInEditor.has(edit.documentId)) {
            continue;
          }
          try {
            const result = await saveDocument(requestWithPolicies, edit.documentId, edit.base, edit.edited);
            await writeDocument(result.document, { opened: true });
            await deletePendingEdit(edit.documentId);
          } catch (err) {
            if (isUnreachable(err)) {
              // Still offline; everything waits for the next try.
              return;
            }
            await deletePendingEdit(edit.documentId);
          }
        }
      } catch {
        // The copy on the phone couldn't be read; try again later.
      } finally {
        running = false;
      }
    };
    void run();
    const timer = setInterval(() => void run(), RETRY_MS);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void run();
      }
    });
    return () => {
      cancelled = true;
      clearInterval(timer);
      subscription.remove();
    };
  }, [status, accountId, requestWithPolicies]);

  return null;
}
