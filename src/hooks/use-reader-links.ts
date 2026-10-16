import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useEffect, useRef } from "react";

import { useAuth } from "@/lib/auth";
import { documentIdFromLink, resolveAttachmentUrl } from "@/lib/outline/documents";

/**
 * What tapping a link or mention in the reader does: documents on the
 * server open in the app, files via signed URLs, the rest in a browser.
 */
export function useReaderLinks() {
  const { session } = useAuth();

  const openDocument = useCallback((documentId: string) => {
    router.push({ pathname: "/document/[id]", params: { id: documentId } });
  }, []);

  // Read at tap time, so the hourly token renewal doesn't give openLink a new
  // identity (which would redraw the whole document).
  const sessionRef = useRef(session);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const openLink = useCallback(
    async (href: string) => {
      const current = sessionRef.current;
      if (!current) {
        return;
      }
      const documentId = documentIdFromLink(href, current.server);
      if (documentId) {
        openDocument(documentId);
        return;
      }
      // Files on the Outline server need the token; open their signed URL instead.
      const url = await resolveAttachmentUrl(href, current.server, current.accessToken);
      await WebBrowser.openBrowserAsync(url);
    },
    [openDocument],
  );

  return { openLink, openDocument };
}
