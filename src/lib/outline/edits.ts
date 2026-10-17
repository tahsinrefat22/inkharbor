import { OutlineApiError } from "./api";
import type { RequestWithPolicies } from "./collections";
import { withAbilities, type OutlineDocument, type PMNode } from "./documents";

// Small edits saved with documents.update in "patch" mode: the server turns
// the document into Markdown itself, finds `findText` and changes only the
// block it's in, so everything else (comments on other passages, highlight
// colours, image sizes) stays exactly as it was. `lastRevision` makes the
// server refuse the change if the document was edited in the meantime.

/** The document changed since it was shown, so the edit wasn't made. */
export class EditConflictError extends Error {
  constructor() {
    super("This document was changed elsewhere. It's been refreshed; try again.");
    this.name = "EditConflictError";
  }
}

/** Every checkbox item in the document, in order. */
export function checkboxItems(node: PMNode, found: PMNode[] = []): PMNode[] {
  if (node.type === "checkbox_item") {
    found.push(node);
  }
  for (const child of node.content ?? []) {
    checkboxItems(child, found);
  }
  return found;
}

/** The lines starting a checkbox item in Outline's Markdown, outside code blocks. */
function checkboxLines(lines: string[]): { line: number; checked: boolean }[] {
  const found: { line: number; checked: boolean }[] = [];
  let fence: string | null = null;
  lines.forEach((text, line) => {
    const opening = text.match(/^\s*(`{3,}|~{3,})/)?.[1];
    if (opening && (!fence || opening.startsWith(fence))) {
      fence = fence ? null : opening;
      return;
    }
    const match = !fence && text.match(/^(?:\s*>\s?)*\s*- \[([ xX])\] /);
    if (match) {
      found.push({ line, checked: match[1] !== " " });
    }
  });
  return found;
}

function occurrences(text: string, part: string): number {
  let count = 0;
  for (let at = text.indexOf(part); at !== -1; at = text.indexOf(part, at + 1)) {
    count += 1;
  }
  return count;
}

/** The server's Markdown for the document, with the revision it belongs to. */
async function serverMarkdown(request: RequestWithPolicies, id: string) {
  // Before API version 3, documents.info answers with Markdown.
  const { data } = await request<{ text: string; revision: number }>("documents.info", { id });
  return data;
}

async function patch(
  request: RequestWithPolicies,
  id: string,
  edit: { findText: string; text: string; lastRevision: number },
): Promise<OutlineDocument> {
  try {
    const { data, policies } = await request<OutlineDocument>(
      "documents.update",
      { id, editMode: "patch", ...edit },
      { "x-api-version": "3" },
    );
    return withAbilities(data, policies);
  } catch (err) {
    if (err instanceof OutlineApiError && err.status === 409) {
      throw new EditConflictError();
    }
    throw err;
  }
}

/**
 * Ticks or unticks the document's `index`th checkbox and returns the
 * document as saved. Its place among the checkboxes matches the server's
 * Markdown as long as nobody else changed the document; if anything doesn't
 * add up, EditConflictError is thrown instead.
 */
export async function setChecked(
  request: RequestWithPolicies,
  document: OutlineDocument,
  index: number,
  checked: boolean,
): Promise<OutlineDocument> {
  const items = checkboxItems(document.data);
  const item = items[index];
  if (!item) {
    throw new EditConflictError();
  }
  if ((item.attrs?.checked === true) === checked) {
    return document;
  }
  const server = await serverMarkdown(request, document.id);
  if (document.revision !== undefined && server.revision !== document.revision) {
    throw new EditConflictError();
  }

  const lines = server.text.split("\n");
  const found = checkboxLines(lines);
  const target = found[index];
  if (found.length !== items.length || !target || target.checked !== (item.attrs?.checked === true)) {
    throw new EditConflictError();
  }

  // The item's line, with the lines before it until it's the only match:
  // the server changes the first place the text appears.
  const edited = lines[target.line].replace(/- \[[ xX]\] /, checked ? "- [x] " : "- [ ] ");
  let from = target.line;
  const piece = (start: number, replaced?: string) =>
    [...lines.slice(start, target.line), replaced ?? lines[target.line]].join("\n") +
    (target.line < lines.length - 1 ? "\n" : "");
  while (occurrences(server.text, piece(from)) > 1 && from > 0) {
    from -= 1;
  }
  return patch(request, document.id, {
    findText: piece(from),
    text: piece(from, edited),
    lastRevision: server.revision,
  });
}

/** Outline's limit for document titles. */
export const MAX_TITLE_LENGTH = 100;

/** Gives the document a new title and returns it as saved. */
export async function renameDocument(
  request: RequestWithPolicies,
  id: string,
  title: string,
): Promise<OutlineDocument> {
  const { data, policies } = await request<OutlineDocument>(
    "documents.update",
    { id, title },
    { "x-api-version": "3" },
  );
  return withAbilities(data, policies);
}

/** Where a new document goes: a collection's top level, or under a document. */
export type NewDocumentPlace = { collectionId: string } | { parentDocumentId: string };

/** Creates and publishes a document from a title and Markdown text. */
export async function createDocument(
  request: RequestWithPolicies,
  place: NewDocumentPlace,
  title: string,
  text: string,
): Promise<OutlineDocument> {
  const { data, policies } = await request<OutlineDocument>(
    "documents.create",
    { ...place, title, text, publish: true },
    { "x-api-version": "3" },
  );
  return withAbilities(data, policies);
}
