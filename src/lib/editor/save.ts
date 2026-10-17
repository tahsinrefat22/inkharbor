import { Node, type Schema } from "prosemirror-model";

import { blockMarkdown, toMarkdown, UnsupportedContent } from "@/lib/editor/markdown";
import { lockDocument, prepareDocument } from "@/lib/editor/schema";
import type { RequestWithPolicies } from "@/lib/outline/collections";
import { getDocument, type OutlineDocument, type PMNode } from "@/lib/outline/documents";
import { patchDocument, serverMarkdown } from "@/lib/outline/edits";

// Saves what was changed in the editor. Outline only takes edits as
// Markdown, so each changed block becomes "replace this exact text in the
// document's Markdown with this" (documents.update in patch mode):
//
// - Blocks are compared with the version the editor started from, and each
//   run of changed blocks becomes one patch. If the document was changed
//   elsewhere meanwhile, the changes are put on top of that version, as
//   long as both didn't change the same blocks.
// - In a paragraph or heading, only the words that changed are replaced
//   when they're plain text, so comments on the rest of it stay.
// - Lists and quotes are patched in place: Outline merges them item by item
//   and keeps comments and colours on the items that didn't change. Plain
//   paragraphs are too, when that's safe. Anything else is rebuilt from
//   the Markdown, which keeps its content but drops its comment marks.
// - Every patch's old text must be found exactly where the block is, as its
//   first occurrence, or nothing is sent.
// - Patches go from the end of the document backwards, so each one leaves
//   the text before it, where the next one applies, as it was.

/** The edit can't be saved from the app; nothing was changed. */
export class CannotSave extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CannotSave";
  }
}

/** The document was changed elsewhere in the same place; nothing was changed. */
export class SaveConflict extends Error {
  constructor() {
    super(
      "Someone changed the same part of this document elsewhere since you started editing. Copy what you changed, then open the editor again.",
    );
    this.name = "SaveConflict";
  }
}

/** One documents.update call: find and replace, or replace everything. */
export type TextPatch = { findText: string; text: string } | { replaceAll: string };

/** A run of changed blocks: old blocks [oldFrom, oldTo) become new [newFrom, newTo). */
interface Change {
  oldFrom: number;
  oldTo: number;
  newFrom: number;
  newTo: number;
  /** Rebuild from Markdown, e.g. after widening to make the old text unique. */
  rebuild?: boolean;
}

/** Where a block's Markdown is in the document's Markdown. */
interface Located {
  start: number;
  end: number;
}

const CONTAINERS = new Set(["bullet_list", "ordered_list", "checkbox_list", "blockquote"]);

/**
 * A block as far as the Markdown is concerned: comment marks, attributes
 * left empty, the order marks are listed in and how text is split into
 * pieces don't change it.
 */
function blockKey(node: PMNode): string {
  const marksOf = (n: PMNode) =>
    (n.marks ?? [])
      .filter((mark) => mark.type !== "comment")
      .map((mark) => JSON.stringify([mark.type, mark.attrs ?? {}]))
      .sort()
      .join();
  const normal = (n: PMNode): unknown => {
    const content: PMNode[] = [];
    for (const child of n.content ?? []) {
      const last = content[content.length - 1];
      if (last?.text !== undefined && child.text !== undefined && marksOf(last) === marksOf(child)) {
        content[content.length - 1] = { ...last, text: last.text + child.text };
      } else {
        content.push(child);
      }
    }
    return {
      t: n.type,
      x: n.text,
      a: Object.entries(n.attrs ?? {})
        .filter(([, value]) => value !== null && value !== undefined)
        .sort(([a], [b]) => a.localeCompare(b)),
      m: marksOf(n),
      c: content.map(normal),
    };
  };
  return JSON.stringify(normal(node));
}

function hasComments(node: Node): boolean {
  let found = false;
  node.descendants((child) => {
    found ||= child.marks.some((mark) => mark.type.name === "comment");
    return !found;
  });
  return found;
}

/** The runs of blocks that differ, from the longest common sequence of blocks. */
function changes(before: string[], after: string[]): Change[] {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) {
    start++;
  }
  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore--;
    endAfter--;
  }
  const n = endBefore - start;
  const m = endAfter - start;
  if (n === 0 && m === 0) {
    return [];
  }
  if (n * m > 4_000_000) {
    return [{ oldFrom: start, oldTo: endBefore, newFrom: start, newTo: endAfter }];
  }
  // common[i][j]: the longest common sequence of before[start + i…] and after[start + j…].
  const width = m + 1;
  const common = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      common[i * width + j] =
        before[start + i] === after[start + j]
          ? common[(i + 1) * width + j + 1] + 1
          : Math.max(common[(i + 1) * width + j], common[i * width + j + 1]);
    }
  }
  const result: Change[] = [];
  let open: Change | null = null;
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && before[start + i] === after[start + j]) {
      if (open) {
        open.oldTo = start + i;
        open.newTo = start + j;
        result.push(open);
        open = null;
      }
      i++;
      j++;
      continue;
    }
    open ??= { oldFrom: start + i, oldTo: start + i, newFrom: start + j, newTo: start + j };
    if (j < m && (i === n || common[i * width + j + 1] >= common[(i + 1) * width + j])) {
      j++;
    } else {
      i++;
    }
  }
  if (open) {
    open.oldTo = start + n;
    open.newTo = start + m;
    result.push(open);
  }
  return result;
}

/** Finds each block's Markdown in order; null for blocks that can't be written or found. */
function locate(markdown: string, blocks: Node[]): (Located | null)[] {
  let cursor = 0;
  return blocks.map((block) => {
    let text: string;
    try {
      text = blockMarkdown(block);
    } catch (err) {
      if (err instanceof UnsupportedContent) {
        return null;
      }
      throw err;
    }
    // A whole block starts and ends a line; text inside a table cell doesn't.
    for (let at = markdown.indexOf(text, cursor); at !== -1; at = markdown.indexOf(text, at + 1)) {
      const end = at + text.length;
      if ((at === 0 || markdown[at - 1] === "\n") && (end === markdown.length || markdown[end] === "\n")) {
        cursor = end;
        return { start: at, end };
      }
    }
    return null;
  });
}

function hasFormatting(block: Node): boolean {
  let formatted = false;
  block.forEach((child) => {
    if (!child.isText || child.marks.some((mark) => mark.type.name !== "comment")) {
      formatted = true;
    }
  });
  return formatted;
}

/**
 * Whether Outline can patch the block in place, keeping comments where the
 * text didn't change. A list or quote is merged item by item with its new
 * version, the first block of its type in the replacement, so blocks added
 * next to it are fine. A plain paragraph is put back as raw text when the
 * new Markdown is plain too, so it must have nothing escaped in it; other
 * text blocks (headings, code) would keep their old type or settings.
 */
function patchableInPlace(before: Node, after: readonly Node[], markdown: string): boolean {
  if (CONTAINERS.has(before.type.name)) {
    return after.filter((block) => block.type === before.type).length === 1;
  }
  return (
    after.length === 1 &&
    before.type.name === "paragraph" &&
    after[0].type === before.type &&
    JSON.stringify(before.attrs) === JSON.stringify(after[0].attrs) &&
    (hasFormatting(after[0]) || markdown === after[0].textContent)
  );
}

interface Character {
  char: string;
  /** Its formatting, comments left out. */
  style: string;
  comment: boolean;
}

/** A text block's characters, or null if it has anything but text (mentions, emoji…). */
function charactersOf(block: Node): Character[] | null {
  const characters: Character[] = [];
  let textOnly = true;
  block.forEach((child) => {
    if (!child.isText || child.text === undefined) {
      textOnly = false;
      return;
    }
    const style = child.marks
      .filter((mark) => mark.type.name !== "comment")
      .map((mark) => JSON.stringify([mark.type.name, mark.attrs]))
      .join();
    const comment = child.marks.some((mark) => mark.type.name === "comment");
    for (let i = 0; i < child.text.length; i++) {
      characters.push({ char: child.text[i], style, comment });
    }
  });
  return textOnly ? characters : null;
}

/**
 * Text that's the same in Outline's Markdown and when Outline reads it back:
 * nothing Markdown escapes or gives a meaning, and no block syntax at the start.
 */
function isPlainText(text: string): boolean {
  return !/[`*\\~[\]_=<>|]/.test(text) && !/^\s*([#>+-]|\d+[.)])/.test(text);
}

function occurrences(text: string, part: string): number {
  let count = 0;
  for (let at = text.indexOf(part); at !== -1; at = text.indexOf(part, at + 1)) {
    count++;
  }
  return count;
}

const isSpace = (char: string) => /\s/.test(char);

/**
 * A patch that replaces only the changed words of a paragraph or heading,
 * so comments on the rest of it stay: Outline keeps everything around the
 * text it finds. The old words and the words around them must be plain
 * text, found once in the block and once in the document; the new ones may
 * have formatting. Null when that's not possible.
 */
function wordsPatch(
  schema: Schema,
  before: Node,
  after: Node,
  markdown: string,
): { start: number; end: number; patch: TextPatch } | null {
  if (
    !["paragraph", "heading"].includes(before.type.name) ||
    before.type !== after.type ||
    JSON.stringify(before.attrs) !== JSON.stringify(after.attrs)
  ) {
    return null;
  }
  const old = charactersOf(before);
  const next = charactersOf(after);
  if (!old || !next) {
    return null;
  }
  const same = (a: Character, b: Character) => a.char === b.char && a.style === b.style;
  let prefix = 0;
  while (prefix < old.length && prefix < next.length && same(old[prefix], next[prefix])) {
    prefix++;
  }
  let suffix = 0;
  while (
    suffix < old.length - prefix &&
    suffix < next.length - prefix &&
    same(old[old.length - 1 - suffix], next[next.length - 1 - suffix])
  ) {
    suffix++;
  }
  // Only the old words go, so they must be unformatted. Comments on them go
  // with them; that can't be helped.
  for (let i = prefix; i < old.length - suffix; i++) {
    if (old[i].style) {
      return null;
    }
  }
  const blockText = before.textContent;

  // Words around the change are taken in until the text is found only once.
  // First without commented words, whose comment would be cut short.
  for (const crossComments of [false, true]) {
    const usable = (i: number) => !old[i].style && (crossComments || !old[i].comment);
    let from = prefix;
    let to = old.length - suffix;
    const widen = () => {
      const was = [from, to];
      if (from > 0 && usable(from - 1)) {
        from--;
      }
      while (from > 0 && !isSpace(old[from - 1].char) && usable(from - 1)) {
        from--;
      }
      if (to < old.length && usable(to)) {
        to++;
      }
      while (to < old.length && !isSpace(old[to].char) && usable(to)) {
        to++;
      }
      return from !== was[0] || to !== was[1];
    };
    // Start from whole words.
    while (from > 0 && !isSpace(old[from - 1].char) && usable(from - 1)) {
      from--;
    }
    while (to < old.length && !isSpace(old[to].char) && usable(to)) {
      to++;
    }
    for (;;) {
      const find = blockText.slice(from, to);
      if (find && !isPlainText(find)) {
        break;
      }
      if (find && occurrences(blockText, find) === 1 && occurrences(markdown, find) === 1) {
        const newTo = next.length - (old.length - to);
        const slice = after.content.cut(from, newTo);
        const newText = slice.textBetween(0, slice.size);
        let text: string;
        if (next.slice(from, newTo).every((char) => !char.style)) {
          // Outline puts plain text in as it is.
          if (!isPlainText(newText)) {
            return null;
          }
          text = newText;
        } else {
          // Outline reads formatted text as Markdown, which trims spaces at the ends.
          if (/^\s|\s$/.test(newText)) {
            return null;
          }
          text = markdownOf(schema, [schema.node("paragraph", null, slice)]);
        }
        const start = markdown.indexOf(find);
        return { start, end: start + find.length, patch: { findText: find, text } };
      }
      if (!widen()) {
        break;
      }
    }
  }
  return null;
}

function markdownOf(schema: Schema, blocks: readonly Node[]): string {
  if (!blocks.length) {
    return "";
  }
  return toMarkdown(schema.node("doc", null, blocks)).replace(/^\n+|\n+$/g, "");
}

/** Where `at`'s preceding blank lines start. */
function separatorStart(markdown: string, at: number): number {
  let start = at;
  while (start > 0 && markdown[start - 1] === "\n") {
    start--;
  }
  return start;
}

/** Joins changes that touch the same blocks. */
function merged(list: Change[]): Change[] {
  const sorted = [...list].sort((a, b) => a.oldFrom - b.oldFrom);
  const result: Change[] = [];
  for (const change of sorted) {
    const last = result[result.length - 1];
    if (last && change.oldFrom < last.oldTo) {
      last.oldTo = Math.max(last.oldTo, change.oldTo);
      last.newTo = Math.max(last.newTo, change.newTo);
      last.newFrom = Math.min(last.newFrom, change.newFrom);
      last.rebuild = true;
    } else {
      result.push({ ...change });
    }
  }
  return result;
}

/**
 * The patches that turn `before` into `after`, given the document's current
 * Markdown, in the order to send them. Throws CannotSave when the change
 * can't be made safely.
 */
export function planPatches(before: PMNode, after: PMNode, markdown: string): TextPatch[] {
  const { schema } = prepareDocument({ type: "doc", content: [...(before.content ?? []), ...(after.content ?? [])] });
  const oldDoc = Node.fromJSON(schema, lockDocument(before));
  const newDoc = Node.fromJSON(schema, lockDocument(after));
  const oldBlocks: Node[] = [];
  const newBlocks: Node[] = [];
  oldDoc.forEach((block) => oldBlocks.push(block));
  newDoc.forEach((block) => newBlocks.push(block));
  const oldKeys = (before.content ?? []).map(blockKey);
  const newKeys = (after.content ?? []).map(blockKey);
  const located = locate(markdown, oldBlocks);

  const usable = (index: number) => index >= 0 && index < oldBlocks.length && located[index] !== null;

  // Single changed blocks are patched one by one. Inserted blocks ride on a
  // neighbour that didn't change, preferably a list (merged item by item).
  // Deleted ones take a neighbour in too: emptying a block's own text would
  // leave an empty paragraph.
  const runs: Change[] = [];
  for (const change of changes(oldKeys, newKeys)) {
    const oldCount = change.oldTo - change.oldFrom;
    const newCount = change.newTo - change.newFrom;
    if (newCount === 0) {
      if (usable(change.oldFrom - 1)) {
        runs.push({ ...change, oldFrom: change.oldFrom - 1, newFrom: change.newFrom - 1, rebuild: true });
      } else if (usable(change.oldTo)) {
        runs.push({ ...change, oldTo: change.oldTo + 1, newTo: change.newTo + 1, rebuild: true });
      } else {
        throw new CannotSave("A block was removed next to one the app can't edit, like a table. Remove it on the web.");
      }
    } else if (oldCount > 1 && oldCount === newCount) {
      for (let k = 0; k < oldCount; k++) {
        runs.push({ oldFrom: change.oldFrom + k, oldTo: change.oldFrom + k + 1, newFrom: change.newFrom + k, newTo: change.newFrom + k + 1 });
      }
    } else if (oldCount === 0) {
      // The neighbour that loses least: a list or quote is merged, other
      // blocks are rebuilt and lose their comments; and rebuilding the
      // document's first block also rebuilds the one after it.
      const previous = change.oldFrom - 1;
      const next = change.oldFrom;
      const cost = (index: number) =>
        CONTAINERS.has(oldBlocks[index].type.name) ? 0 : (hasComments(oldBlocks[index]) ? 2 : 1) + (index === 0 ? 1 : 0);
      const preferNext = usable(next) && (!usable(previous) || cost(next) < cost(previous));
      if (preferNext) {
        runs.push({ oldFrom: next, oldTo: next + 1, newFrom: change.newFrom, newTo: change.newTo + 1 });
      } else if (usable(previous)) {
        runs.push({ oldFrom: previous, oldTo: previous + 1, newFrom: change.newFrom - 1, newTo: change.newTo });
      } else {
        throw new CannotSave("A block was added next to one the app can't edit, like a table. Add it on the web.");
      }
    } else {
      runs.push(change);
    }
  }

  let pending = merged(runs);
  for (;;) {
    const planned: { start: number; end: number; patch: TextPatch }[] = [];
    let widened = false;
    for (const change of pending) {
      for (let k = change.oldFrom; k < change.oldTo; k++) {
        if (!located[k]) {
          throw new CannotSave(
            "A change touches something the app can't edit yet, like a table, an image or maths. Change it on the web.",
          );
        }
      }
      const first = located[change.oldFrom]!;
      const last = located[change.oldTo - 1]!;
      const replacement = newBlocks.slice(change.newFrom, change.newTo);
      let text: string;
      try {
        text = markdownOf(schema, replacement);
      } catch (err) {
        if (err instanceof UnsupportedContent) {
          throw new CannotSave("The new text has something the app can't save yet, like an image. Add it on the web.");
        }
        throw err;
      }

      let start: number;
      let end = last.end;
      let patch: TextPatch;
      const oneBlock = change.oldTo - change.oldFrom === 1;
      const words =
        oneBlock && replacement.length === 1 && !change.rebuild
          ? wordsPatch(schema, oldBlocks[change.oldFrom], replacement[0], markdown)
          : null;
      if (words) {
        planned.push(words);
        continue;
      }
      if (oneBlock && !change.rebuild && patchableInPlace(oldBlocks[change.oldFrom], replacement, text)) {
        start = first.start;
        patch = { findText: markdown.slice(start, end), text };
      } else if (first.start > 0) {
        // Taking in the blank lines before makes Outline rebuild the blocks
        // from the Markdown instead of patching text inside the first one.
        start = separatorStart(markdown, first.start);
        patch = { findText: markdown.slice(start, end), text: markdown.slice(start, first.start) + text };
      } else if (change.oldTo < oldBlocks.length && located[change.oldTo]) {
        // The document's first block: take in the blank lines after instead.
        start = 0;
        end = located[change.oldTo]!.start;
        patch = { findText: markdown.slice(0, end), text: text + markdown.slice(last.end, end) };
      } else {
        return [{ replaceAll: markdownOf(schema, newBlocks) }];
      }

      // Outline changes the first place the text appears; take in the block
      // before until that's this one.
      if ("findText" in patch && markdown.indexOf(patch.findText) !== start) {
        const previous = change.oldFrom - 1;
        if (previous < 0 || !located[previous]) {
          throw new CannotSave("The changed text also appears elsewhere in the document. Change it on the web.");
        }
        change.oldFrom = previous;
        change.newFrom -= 1;
        change.rebuild = true;
        widened = true;
        break;
      }
      planned.push({ start, end, patch });
    }
    if (widened) {
      pending = merged(pending);
      continue;
    }
    // Widened patches can run into each other; then they become one.
    const sorted = [...planned].sort((a, b) => a.start - b.start);
    const overlap = sorted.findIndex((item, i) => i > 0 && item.start < sorted[i - 1].end);
    if (overlap !== -1) {
      const byStart = [...pending].sort((a, b) => a.oldFrom - b.oldFrom);
      const a = byStart[overlap - 1];
      const b = byStart[overlap];
      pending = merged([
        ...byStart.filter((change) => change !== a && change !== b),
        { oldFrom: a.oldFrom, oldTo: b.oldTo, newFrom: a.newFrom, newTo: b.newTo, rebuild: true },
      ]);
      continue;
    }
    return sorted.reverse().map((item) => item.patch);
  }
}

/**
 * `theirs` with the changes from `base` to `mine` put on top. Both were made
 * from `base`; if they changed the same blocks, or added blocks at the same
 * place, that's a SaveConflict. A change made the same way on both counts once.
 */
function mergeEdits(base: PMNode, mine: PMNode, theirs: PMNode): PMNode {
  const baseKeys = (base.content ?? []).map(blockKey);
  const mineKeys = (mine.content ?? []).map(blockKey);
  const theirKeys = (theirs.content ?? []).map(blockKey);
  const ours = changes(baseKeys, mineKeys);
  const others = changes(baseKeys, theirKeys);
  const isInsert = (change: Change) => change.oldFrom === change.oldTo;
  const sizeChange = (change: Change) => change.newTo - change.newFrom - (change.oldTo - change.oldFrom);
  // Where a place between base blocks is in `theirs`. Blocks they added
  // right there come before a change starting there, after one ending there.
  const startIn = (at: number) => others.filter((o) => o.oldTo <= at).reduce((sum, o) => sum + sizeChange(o), 0) + at;
  const endIn = (at: number) =>
    others.filter((o) => o.oldTo < at || (o.oldTo === at && !isInsert(o))).reduce((sum, o) => sum + sizeChange(o), 0) + at;

  const splices: { from: number; to: number; blocks: PMNode[] }[] = [];
  for (const change of ours) {
    const blocks = (mine.content ?? []).slice(change.newFrom, change.newTo);
    const madeByBoth = others.some(
      (o) =>
        o.oldFrom === change.oldFrom &&
        o.oldTo === change.oldTo &&
        theirKeys.slice(o.newFrom, o.newTo).join("\n") === mineKeys.slice(change.newFrom, change.newTo).join("\n"),
    );
    if (madeByBoth) {
      continue;
    }
    const clashes = others.some(
      (o) =>
        (change.oldFrom < o.oldTo && o.oldFrom < change.oldTo) ||
        (isInsert(change) && isInsert(o) && change.oldFrom === o.oldFrom),
    );
    if (clashes) {
      throw new SaveConflict();
    }
    const from = startIn(change.oldFrom);
    splices.push({ from, to: isInsert(change) ? from : endIn(change.oldTo), blocks });
  }
  const content = [...(theirs.content ?? [])];
  for (const { from, to, blocks } of splices.sort((a, b) => b.from - a.from)) {
    content.splice(from, to - from, ...blocks);
  }
  return { ...theirs, content };
}

/** What saving did. */
export interface SaveResult {
  document: OutlineDocument;
  /** What the next save of this editor is compared with: the edit just saved. */
  base: PMNode;
  /** The document had been changed elsewhere; those changes were kept. */
  mergedChangesElsewhere: boolean;
  /** The saved document matches what was meant to be saved, apart from comment marks. */
  matches: boolean;
  /** Comments whose highlight was dropped because the text under it was rewritten. */
  lostComments: number;
}

function commentIds(node: PMNode, found = new Set<string>()): Set<string> {
  node.marks?.forEach((mark) => {
    if (mark.type === "comment" && typeof mark.attrs?.id === "string") {
      found.add(mark.attrs.id);
    }
  });
  node.content?.forEach((child) => commentIds(child, found));
  return found;
}

const contentKey = (doc: PMNode) => (doc.content ?? []).map(blockKey).join("\n");

/** Whether two documents have the same content, comments and other non-Markdown details aside. */
export function sameContent(a: PMNode, b: PMNode): boolean {
  return contentKey(a) === contentKey(b);
}

/** The document's current content and Markdown, from the same revision. */
async function currentVersion(request: RequestWithPolicies, id: string) {
  for (let attempt = 0; ; attempt++) {
    const [document, server] = await Promise.all([getDocument(request, id), serverMarkdown(request, id)]);
    if (document.revision === server.revision || attempt === 2) {
      return { document, markdown: server.text, revision: server.revision };
    }
  }
}

/**
 * Saves `edited`, made from `base` (the document when editing started, or
 * the edit saved last). Changes made elsewhere since are kept unless they're
 * in the same place (SaveConflict). CannotSave if the change can't be saved.
 */
export async function saveDocument(
  request: RequestWithPolicies,
  id: string,
  base: PMNode,
  edited: PMNode,
): Promise<SaveResult> {
  const current = await currentVersion(request, id);
  const theirs = current.document.data;
  // Outline counts its own background saves as revisions too (a few minutes
  // after an edit), so only different content means someone else edited.
  const changedElsewhere = contentKey(theirs) !== contentKey(base);
  const target = changedElsewhere ? mergeEdits(base, edited, theirs) : edited;
  const patches = planPatches(theirs, target, current.markdown);
  let document = current.document;
  let revision = current.revision;
  for (const patch of patches) {
    document = await patchDocument(
      request,
      id,
      "replaceAll" in patch
        ? { editMode: "replace", text: patch.replaceAll, lastRevision: revision }
        : { ...patch, lastRevision: revision },
    );
    revision = document.revision ?? revision;
  }
  const kept = commentIds(document.data);
  return {
    document,
    base: edited,
    mergedChangesElsewhere: changedElsewhere,
    matches: contentKey(document.data) === contentKey(target),
    lostComments: [...commentIds(target)].filter((comment) => !kept.has(comment)).length,
  };
}
