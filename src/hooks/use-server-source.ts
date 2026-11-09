import { useEffect, useMemo, useState } from "react";

import { resolveAttachmentUrl } from "@/lib/outline/documents";
import { headersFor, sameOrigin } from "@/lib/outline/server-access";

/** A source for expo-image or expo-video. */
export interface ServerSource {
  uri: string;
  headers?: Record<string, string>;
  /** Keeps a cached image under its link in the document, not the signed URL it led to. */
  cacheKey?: string;
}

/**
 * How to load an image or video from a document: files on the Outline server
 * get the bearer token, files elsewhere get no headers at all.
 *
 * The native loaders follow redirects with every header they were given. On a
 * server with extra headers (an access proxy's token), the redirects are
 * followed here first, so those headers never reach the storage host the
 * server redirects to. Returns null while that's in progress.
 */
export function useServerSource(src: string, server: string, accessToken: string): ServerSource | null {
  const uri = src.startsWith("/") ? `${server}${src}` : src;
  const own = sameOrigin(uri, server);
  const proxied = own && Object.keys(headersFor(uri)).length > 0;
  const [resolved, setResolved] = useState<{ uri: string; source: ServerSource } | null>(null);

  useEffect(() => {
    if (!proxied) {
      return;
    }
    let current = true;
    resolveAttachmentUrl(uri, server, accessToken)
      .then(
        (final): ServerSource =>
          sameOrigin(final, server)
            ? { uri: final, headers: { ...headersFor(final), Authorization: `Bearer ${accessToken}` }, cacheKey: uri }
            : { uri: final, cacheKey: uri },
        // Offline: a copy cached earlier still shows.
        (): ServerSource => ({ uri, cacheKey: uri }),
      )
      .then((source) => {
        if (current) {
          setResolved({ uri, source });
        }
      });
    return () => {
      current = false;
    };
  }, [proxied, uri, server, accessToken]);

  // The same object while nothing changes, so a video player isn't recreated.
  const direct = useMemo<ServerSource | null>(
    () => (!own ? { uri } : proxied ? null : { uri, headers: { Authorization: `Bearer ${accessToken}` } }),
    [own, proxied, uri, accessToken],
  );
  return direct ?? (resolved?.uri === uri ? resolved.source : null);
}
