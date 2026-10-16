import { MarkdownSerializer, type MarkdownSerializerState } from "prosemirror-markdown";
import { Node, Schema, type Mark } from "prosemirror-model";

import type { PMNode } from "./documents";

// Turns Outline's rich text (ProseMirror JSON) back into the Markdown a
// person would type, so it can be edited in a plain text box and saved
// through the API, which parses Markdown with Outline's own rules. The
// syntax follows each node's and mark's toMarkdown in Outline's
// shared/editor; mentions use Outline's mention:// form, which its parser
// turns back into a live mention.
//
// Only what's described here is supported. Anything else makes
// toEditableMarkdown return null, so nothing is silently lost by an edit.

const inline = { inline: true, group: "inline" };
const atom = { ...inline, atom: true };
const attrs = (...names: string[]) => Object.fromEntries(names.map((name) => [name, { default: null }]));

/** The nodes and marks of Outline's comment editor. */
const commentSchema = new Schema({
  nodes: {
    doc: { content: "block*" },
    paragraph: { content: "inline*", group: "block" },
    text: inline,
    br: atom,
    emoji: { ...atom, attrs: attrs("data-name") },
    mention: { ...atom, attrs: attrs("id", "type", "modelId", "label", "href", "actorId") },
    image: { ...atom, attrs: attrs("src", "alt", "width", "height", "layoutClass", "title", "marks") },
    bullet_list: { content: "block*", group: "block" },
    ordered_list: { content: "block*", group: "block", attrs: attrs("order", "listStyle") },
    checkbox_list: { content: "block*", group: "block" },
    list_item: { content: "block*", group: "block" },
    checkbox_item: { content: "block*", group: "block", attrs: { checked: { default: false } } },
    code_block: { content: "inline*", group: "block", attrs: attrs("language") },
    code_fence: { content: "inline*", group: "block", attrs: attrs("language", "wrap") },
  },
  marks: {
    strong: {},
    em: {},
    code_inline: {},
    strikethrough: {},
    underline: {},
    highlight: { attrs: attrs("color") },
    link: { attrs: attrs("href", "title") },
  },
});

/** The longest run of backticks in a node, so inline code can be fenced with more. */
function backticksFor(node: Node | null, side: number): string {
  let length = 0;
  for (const match of node?.text?.matchAll(/`+/g) ?? []) {
    length = Math.max(length, match[0].length);
  }
  let result = length > 0 && side > 0 ? " `" : "`";
  result += "`".repeat(length);
  if (length > 0 && side < 0) {
    result += " ";
  }
  return result;
}

function codeBlock(state: MarkdownSerializerState, node: Node) {
  const longest = node.textContent.match(/`{3,}/g)?.sort().pop();
  const fence = longest ? `${longest}\`` : "```";
  state.write(`${fence}${node.attrs.language ?? ""}\n`);
  state.text(node.textContent, false);
  state.write("\n");
  state.write(fence);
  state.closeBlock(node);
}

const serializer = new MarkdownSerializer(
  {
    paragraph(state, node) {
      state.renderInline(node);
      state.closeBlock(node);
    },
    text(state, node) {
      state.text(node.text ?? "");
    },
    // A plain new line here; withHardBreaks makes it a real one on saving.
    br(state) {
      state.write("\n");
    },
    emoji(state, node) {
      state.write(`:${node.attrs["data-name"] ?? ""}:`);
    },
    mention(state, node) {
      const { id, type, modelId, label } = node.attrs;
      state.write(`@[${label ?? ""}](mention://${id}/${type}/${modelId})`);
    },
    image(state, node) {
      const alt = state.esc(String(node.attrs.alt ?? "").replace(/\n/g, ""));
      state.write(`![${alt}](${String(node.attrs.src ?? "").replace(/[()]/g, "\\$&")})`);
    },
    bullet_list(state, node) {
      state.renderList(node, "  ", () => "- ");
    },
    checkbox_list(state, node) {
      state.renderList(node, "  ", () => "- ");
    },
    ordered_list(state, node) {
      const start = Number(node.attrs.order) || 1;
      const width = String(start + node.childCount - 1).length;
      state.renderList(node, " ".repeat(width + 2), (i) => {
        const number = String(start + i);
        return `${" ".repeat(width - number.length)}${number}. `;
      });
    },
    list_item(state, node) {
      state.renderContent(node);
    },
    checkbox_item(state, node) {
      state.write(node.attrs.checked ? "[x] " : "[ ] ");
      state.renderContent(node);
    },
    code_block: codeBlock,
    code_fence: codeBlock,
  },
  {
    strong: { open: "**", close: "**", mixable: true, expelEnclosingWhitespace: true },
    em: { open: "*", close: "*", mixable: true, expelEnclosingWhitespace: true },
    strikethrough: { open: "~~", close: "~~", mixable: true, expelEnclosingWhitespace: true },
    underline: { open: "__", close: "__", mixable: true, expelEnclosingWhitespace: true },
    highlight: { open: "==", close: "==", mixable: true, expelEnclosingWhitespace: true },
    link: {
      open: "[",
      close: (_state: MarkdownSerializerState, mark: Mark) =>
        `](${String(mark.attrs.href ?? "").replace(/[()"]/g, "\\$&")})`,
      mixable: true,
    },
    code_inline: {
      open: (_state: MarkdownSerializerState, _mark: Mark, parent: Node, index: number) =>
        backticksFor(parent.child(index), -1),
      close: (_state: MarkdownSerializerState, _mark: Mark, parent: Node, index: number) =>
        backticksFor(parent.child(index - 1), 1),
      escape: false,
    },
  },
  // "==" is highlight in Outline, so a typed one is escaped.
  { escapeExtraCharacters: /=(?==)/g, hardBreakNodeName: "br" },
);

/** True if every node and mark in `node` is one the serializer knows. */
function isSupported(node: PMNode): boolean {
  if (!(node.type in commentSchema.nodes)) {
    return false;
  }
  if (node.marks?.some((mark) => !(mark.type in commentSchema.marks))) {
    return false;
  }
  return (node.content ?? []).every(isSupported);
}

/**
 * A comment's text as Markdown for editing, or null if it has something the
 * app can't write back as Markdown (then it can only be edited on the web).
 */
export function toEditableMarkdown(data: PMNode): string | null {
  if (data.type !== "doc" || !isSupported(data)) {
    return null;
  }
  try {
    const doc = Node.fromJSON(commentSchema, data);
    return serializer.serialize(doc, { tightLists: true }).trim();
  } catch {
    return null;
  }
}

/**
 * Makes every single new line a line break. In Markdown a single new line
 * only joins the two lines into one, but in a text box on a phone a new
 * line is meant to stay. Code blocks are left as they are.
 */
export function withHardBreaks(text: string): string {
  const lines = text.split("\n");
  let inCode = false;
  return lines
    .map((line, i) => {
      if (/^\s*(```|~~~)/.test(line)) {
        inCode = !inCode;
        return line;
      }
      const next = lines[i + 1];
      const joinsNext = next !== undefined && next.trim() !== "" && line.trim() !== "";
      return !inCode && joinsNext && !line.endsWith("  ") ? `${line}  ` : line;
    })
    .join("\n");
}
