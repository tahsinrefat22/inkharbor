import { Schema, type MarkSpec, type NodeSpec } from "prosemirror-model";

import { emojiFor, imageHtml, toHtml } from "@/lib/editor/render-html";
import type { PMNode } from "@/lib/outline/documents";

// The editor's schema uses Outline's own node and mark names, so documents
// go in and come out as the same JSON the API sends. It's built per
// document: every attribute found in the document is declared, because
// ProseMirror quietly drops attributes its schema doesn't know. Node types
// the editor can't edit yet (tables, notices, maths…) are swapped for
// locked placeholders that carry the original JSON and are swapped back
// on the way out, so editing around them never changes them. They're
// still drawn as they look, just not editable.

/** A node type the editor can't edit yet, kept whole. */
export const LOCKED_BLOCK = "locked_block";
/** The same for inline nodes, e.g. inline maths. */
export const LOCKED_INLINE = "locked_inline";

const block = (spec: NodeSpec): NodeSpec => ({ group: "block", ...spec });

/** A display-only element with the given HTML inside, for toDOM. */
function locked(tag: string, className: string, html: string): HTMLElement {
  const element = globalThis.document.createElement(tag);
  element.className = className;
  element.contentEditable = "false";
  element.innerHTML = html;
  return element;
}

function lockedJson(json: unknown): PMNode {
  try {
    return JSON.parse(String(json)) as PMNode;
  } catch {
    return { type: "paragraph" };
  }
}
const inlineAtom = (spec: NodeSpec): NodeSpec => ({ group: "inline", inline: true, atom: true, ...spec });

/** What the editor can edit, by Outline's node names. */
const NODES: Record<string, NodeSpec> = {
  doc: { content: "block+" },
  paragraph: block({ content: "inline*", toDOM: () => ["p", 0], parseDOM: [{ tag: "p" }] }),
  heading: block({
    content: "inline*",
    defining: true,
    attrs: { level: { default: 1 } },
    toDOM: (node) => [`h${Math.min(Math.max(Number(node.attrs.level) || 1, 1), 6)}`, 0],
  }),
  blockquote: block({ content: "block+", defining: true, toDOM: () => ["blockquote", 0] }),
  hr: block({ toDOM: () => ["hr"] }),
  code_block: block({
    content: "text*",
    marks: "",
    code: true,
    defining: true,
    toDOM: () => ["pre", ["code", 0]],
  }),
  code_fence: block({
    content: "text*",
    marks: "",
    code: true,
    defining: true,
    toDOM: () => ["pre", ["code", 0]],
  }),
  bullet_list: block({ content: "list_item+", toDOM: () => ["ul", 0] }),
  ordered_list: block({
    content: "list_item+",
    attrs: { order: { default: 1 } },
    toDOM: (node) => ["ol", { start: String(node.attrs.order ?? 1) }, 0],
  }),
  list_item: { content: "paragraph block*", defining: true, toDOM: () => ["li", 0] },
  // The first block is the summary; the rest folds away (see rich-editor.tsx).
  container_toggle: block({
    content: "(paragraph | heading) block*",
    defining: true,
    attrs: { id: { default: null } },
    toDOM: () => ["div", { class: "toggle-block" }, 0],
  }),
  checkbox_list: block({ content: "checkbox_item+", toDOM: () => ["ul", { class: "checklist" }, 0] }),
  checkbox_item: {
    content: "paragraph block*",
    defining: true,
    attrs: { checked: { default: false } },
    toDOM: (node) => ["li", { class: node.attrs.checked ? "checkbox checked" : "checkbox" }, 0],
  },
  text: { group: "inline" },
  br: inlineAtom({ selectable: false, toDOM: () => ["br"] }),
  emoji: inlineAtom({ toDOM: (node) => ["span", { class: "emoji" }, emojiFor(node.attrs["data-name"])] }),
  mention: inlineAtom({
    toDOM: (node) => [
      "span",
      {
        class: "mention",
        "data-type": String(node.attrs.type ?? ""),
        "data-model": String(node.attrs.modelId ?? ""),
        "data-href": String(node.attrs.href ?? ""),
      },
      `@${node.attrs.label ?? ""}`,
    ],
  }),
  image: inlineAtom({
    attrs: {
      src: { default: null },
      alt: { default: null },
      title: { default: null },
      width: { default: null },
      height: { default: null },
      layoutClass: { default: null },
      source: { default: null },
    },
    toDOM: (node) => locked("span", "image-wrap", imageHtml({ type: "image", attrs: node.attrs })),
  }),
  [LOCKED_BLOCK]: block({
    atom: true,
    selectable: true,
    attrs: { json: { default: "{}" } },
    toDOM: (node) => locked("div", "locked", toHtml(lockedJson(node.attrs.json))),
  }),
  [LOCKED_INLINE]: inlineAtom({
    attrs: { json: { default: "{}" } },
    toDOM: (node) => locked("span", "locked-inline", toHtml(lockedJson(node.attrs.json))),
  }),
};

// In Outline's order, which decides how overlapping marks nest and are
// written as Markdown.
const MARKS: Record<string, MarkSpec> = {
  // Several comments can cover the same text, and typing next to one
  // doesn't extend it.
  comment: { inclusive: false, excludes: "", toDOM: () => ["span", { class: "comment" }, 0] },
  link: { inclusive: false, toDOM: (mark) => ["a", { href: String(mark.attrs.href ?? "") }, 0] },
  code_inline: { toDOM: () => ["code", 0] },
  strong: { toDOM: () => ["strong", 0] },
  em: { toDOM: () => ["em", 0] },
  underline: { toDOM: () => ["u", 0] },
  strikethrough: { toDOM: () => ["s", 0] },
  highlight: { toDOM: () => ["mark", 0] },
};

const INLINE_PARENTS = new Set(["paragraph", "heading"]);

/** The document with every node the editor can't edit swapped for a locked placeholder. */
function lockUnknown(node: PMNode, inline: boolean): PMNode {
  if (!(node.type in NODES)) {
    return { type: inline ? LOCKED_INLINE : LOCKED_BLOCK, attrs: { json: JSON.stringify(node) } };
  }
  if (!node.content) {
    return node;
  }
  const childrenInline = INLINE_PARENTS.has(node.type);
  return { ...node, content: node.content.map((child) => lockUnknown(child, childrenInline)) };
}

/** Undoes lockUnknown on the editor's output. */
export function unlock(node: PMNode): PMNode {
  if (node.type === LOCKED_BLOCK || node.type === LOCKED_INLINE) {
    return JSON.parse(String(node.attrs?.json)) as PMNode;
  }
  return node.content ? { ...node, content: node.content.map(unlock) } : node;
}

/** Every attribute name used per node or mark type. */
function attributesIn(node: PMNode, nodes: Map<string, Set<string>>, marks: Map<string, Set<string>>) {
  const add = (map: Map<string, Set<string>>, type: string, attrs: Record<string, unknown> | undefined) => {
    const names = map.get(type) ?? new Set<string>();
    Object.keys(attrs ?? {}).forEach((name) => names.add(name));
    map.set(type, names);
  };
  add(nodes, node.type, node.attrs);
  node.marks?.forEach((mark) => add(marks, mark.type, mark.attrs));
  node.content?.forEach((child) => attributesIn(child, nodes, marks));
}

export interface EditorDocument {
  schema: Schema;
  /** The document as the editor holds it. */
  doc: PMNode;
}

/** The document as the editor holds it, with locked placeholders (see above). */
export function lockDocument(document: PMNode): PMNode {
  return lockUnknown(document, false);
}

/** The schema for editing `document`, and the document ready for it. */
export function prepareDocument(document: PMNode): EditorDocument {
  const doc = lockUnknown(document, false);
  const nodeAttrs = new Map<string, Set<string>>();
  const markAttrs = new Map<string, Set<string>>();
  attributesIn(doc, nodeAttrs, markAttrs);

  const withAttrs = <T extends { attrs?: Record<string, { default?: unknown }> }>(spec: T, names?: Set<string>): T => {
    const attrs: Record<string, { default?: unknown }> = { ...spec.attrs };
    names?.forEach((name) => {
      attrs[name] ??= { default: null };
    });
    return { ...spec, attrs };
  };

  const nodes = Object.fromEntries(
    Object.entries(NODES).map(([name, spec]) => [name, withAttrs(spec, nodeAttrs.get(name)) as NodeSpec]),
  );
  // Marks the editor doesn't know are kept as they are, without styling.
  const marks: Record<string, MarkSpec> = { ...MARKS };
  markAttrs.forEach((_names, name) => {
    marks[name] ??= {};
  });
  return {
    schema: new Schema({
      nodes,
      marks: Object.fromEntries(Object.entries(marks).map(([name, spec]) => [name, withAttrs(spec, markAttrs.get(name))])),
    }),
    doc,
  };
}
