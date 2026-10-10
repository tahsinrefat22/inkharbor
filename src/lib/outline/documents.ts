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

export interface SearchResult {
  /** Plain-text snippet around the matches, with matches wrapped in <b>…</b>. */
  context: string;
  ranking: number;
  document: Pick<OutlineDocument, "id" | "title" | "icon" | "color" | "collectionId" | "updatedAt">;
}

/** One page of full-text search results across all documents the user can read. */
export function searchDocuments(
  request: Request,
  query: string,
  offset: number,
  limit: number,
): Promise<SearchResult[]> {
  return request<SearchResult[]>("documents.search", { query, offset, limit });
}

export interface SnippetPart {
  text: string;
  match: boolean;
}

const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" };

/**
 * Turns a search context into a short, single-line snippet centred on the
 * first match, split into matched and unmatched parts for highlighting.
 */
export function snippetParts(context: string, before = 50, after = 140): SnippetPart[] {
  const flat = context.replace(/\s+/g, " ").trim();
  const first = flat.indexOf("<b>");
  const start = Math.max(0, (first === -1 ? 0 : first) - before);
  // Extend the end to the next closing tag so a match is never cut in half.
  let end = Math.min(flat.length, start + before + after);
  const open = flat.lastIndexOf("<b>", end);
  if (open !== -1 && flat.indexOf("</b>", open) > end) {
    end = flat.indexOf("</b>", open) + 4;
  }
  let text = flat.slice(start, end);
  // Drop a tag cut in half at either edge.
  text = text.replace(/^[^<]*?>/, (cut) => (cut.startsWith("b>") || cut.startsWith("/b>") ? "" : cut));
  text = text.replace(/<\/?b?$/, "");

  const parts: SnippetPart[] = [];
  const decode = (s: string) => s.replace(/&(amp|lt|gt|quot|#39);/g, (_, e: string) => entities[e]);
  const regex = /<b>(.*?)<\/b>/g;
  let last = 0;
  for (let m = regex.exec(text); m; m = regex.exec(text)) {
    if (m.index > last) {
      parts.push({ text: decode(text.slice(last, m.index)), match: false });
    }
    parts.push({ text: decode(m[1]), match: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    parts.push({ text: decode(text.slice(last).replace(/<\/?b>/g, "")), match: false });
  }
  if (start > 0) {
    parts.unshift({ text: "…", match: false });
  }
  if (end < flat.length) {
    parts.push({ text: "…", match: false });
  }
  return parts;
}
