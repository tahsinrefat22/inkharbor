import type { Request } from "./collections";

/** A node of Outline's ProseMirror document JSON. */
export interface PMNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PMNode[];
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  text?: string;
}

export interface OutlineDocument {
  id: string;
  title: string;
  icon: string | null;
  color: string | null;
  url: string;
  collectionId: string | null;
  updatedAt: string;
  updatedBy: { name: string } | null;
  /** The document body as ProseMirror JSON. */
  data: PMNode;
}

/**
 * Fetches a document with its body as ProseMirror JSON. API version 3 returns
 * `data` instead of Markdown, and from version 2 the response is wrapped as
 * { document }. `id` can be the UUID or the urlId from a document's link.
 */
export async function getDocument(request: Request, id: string): Promise<OutlineDocument> {
  const result = await request<{ document: OutlineDocument }>(
    "documents.info",
    { id },
    { "x-api-version": "3" },
  );
  return result.document;
}

/**
 * Returns the urlId if the link points at an Outline document on this server,
 * e.g. /doc/deployment-checklist-WWQrEySkiz or https://server/doc/…, so the
 * app can open it itself instead of in a browser.
 */
export function documentIdFromLink(href: string, server: string): string | null {
  let path = href;
  if (href.startsWith(server)) {
    path = href.slice(server.length);
  } else if (!href.startsWith("/")) {
    return null;
  }
  const match = path.match(/^\/doc\/(?:[^/?#]*-)?([A-Za-z0-9]{10})(?:[/?#]|$)/);
  return match ? match[1] : null;
}

/**
 * Attachment links (/api/attachments.redirect?id=…) need the bearer token, which
 * a browser can't send. Fetch them with the token and return the signed file
 * URL they redirect to; that one works without auth for a short while.
 */
export async function resolveAttachmentUrl(
  href: string,
  server: string,
  accessToken: string,
): Promise<string> {
  const url = href.startsWith("/") ? `${server}${href}` : href;
  if (!url.startsWith(server)) {
    return url;
  }
  // HEAD follows the redirects without downloading the file. On S3-backed
  // servers the final HEAD can be refused (S3 signs links per method), but the
  // URL it reached is still the signed GET link we want.
  const res = await fetch(url, {
    method: "HEAD",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return res.redirected ? res.url : url;
}
