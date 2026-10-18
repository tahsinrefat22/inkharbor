import type { Mark, Node } from "prosemirror-model";

import { LOCKED_BLOCK } from "@/lib/editor/schema";
import type { PMNode } from "@/lib/outline/documents";

// Writes editor content as the Markdown Outline itself would write for it,
// character for character. Saving finds the old text of a changed block in
// Outline's Markdown and swaps in the new text (documents.update in patch
// mode), so the old text has to match exactly.
//
// The writer follows prosemirror-markdown's original serializer (MIT),
// which Outline's is a fork of, and Outline's rules for escaping and for
// each node and mark. Anything it doesn't know throws UnsupportedContent,
// and that block can't be saved from the app.

/** The content has something the app can't write as Outline's Markdown. */
export class UnsupportedContent extends Error {
  constructor(what: string) {
    super(`Can't write ${what} as Markdown`);
    this.name = "UnsupportedContent";
  }
}

type NodeWriter = (out: MarkdownWriter, node: Node, parent: Node, index: number) => void;
type MarkText = string | ((out: MarkdownWriter, mark: Mark, parent: Node, index: number) => string);

interface MarkWriter {
  open: MarkText;
  close: MarkText;
  /** The mark's syntax can be reordered with other mixable marks. */
  mixable?: boolean;
  /** Spaces at the edges of the marked text go outside the syntax. */
  expelEnclosingWhitespace?: boolean;
  /** The marked text is written as it is, e.g. inline code. */
  escape?: boolean;
}

class MarkdownWriter {
  out = "";
  delim = "";
  closed: Node | null = null;
  inList = false;
  inTightList = false;

  constructor(
    private readonly nodes: Record<string, NodeWriter>,
    private readonly marks: Record<string, MarkWriter>,
    /** Writing new text for Outline to read, rather than matching its own Markdown. */
    readonly newText = false,
  ) {}

  atBlank(): boolean {
    return this.out === "" || this.out.endsWith("\n");
  }

  ensureNewLine() {
    if (!this.atBlank()) {
      this.out += "\n";
    }
  }

  /** Ends a closed block with `size` new lines. */
  flushClose(size = 2) {
    if (!this.closed) {
      return;
    }
    if (!this.atBlank()) {
      this.out += "\n";
    }
    const delim = this.delim.replace(/\s+$/, "");
    for (let i = 1; i < size; i++) {
      this.out += `${delim}\n`;
    }
    this.closed = null;
  }

  /** Writes a block whose lines start with `delim`, the first with `firstDelim`. */
  wrapBlock(delim: string, firstDelim: string | null, node: Node, render: () => void) {
    const old = this.delim;
    this.write(firstDelim ?? delim);
    this.delim += delim;
    render();
    this.delim = old;
    this.closeBlock(node);
  }

  write(content?: string) {
    this.flushClose();
    if (this.delim && this.atBlank()) {
      this.out += this.delim;
    }
    if (content) {
      this.out += content;
    }
  }

  closeBlock(node: Node) {
    this.closed = node;
  }

  text(text: string, escape = true) {
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      const startOfLine = this.atBlank() || this.closed !== null;
      this.write();
      this.out += escape ? this.esc(line, startOfLine) : line;
      if (i !== lines.length - 1) {
        this.out += "\n";
      }
    });
  }

  render(node: Node, parent: Node, index: number) {
    const writer = this.nodes[node.type.name];
    if (!writer) {
      throw new UnsupportedContent(node.type.name);
    }
    writer(this, node, parent, index);
  }

  renderContent(parent: Node) {
    parent.forEach((node, _offset, index) => this.render(node, parent, index));
  }

  private mark(mark: Mark): MarkWriter {
    const writer = this.marks[mark.type.name];
    if (!writer) {
      throw new UnsupportedContent(`the ${mark.type.name} mark`);
    }
    return writer;
  }

  markString(mark: Mark, open: boolean, parent: Node, index: number): string {
    const writer = this.mark(mark);
    const value = open ? writer.open : writer.close;
    return typeof value === "string" ? value : value(this, mark, parent, index);
  }

  renderInline(parent: Node) {
    const active: Mark[] = [];
    let trailing = "";
    const progress = (child: Node | null, index: number) => {
      let node = child;
      let marks: readonly Mark[] = node ? node.marks : [];

      let leading = trailing;
      trailing = "";
      if (node?.isText && marks.some((mark) => this.mark(mark).expelEnclosingWhitespace)) {
        const [, lead, inner, trail] = /^(\s*)(.*?)(\s*)$/m.exec(node.text ?? "") ?? ["", "", "", ""];
        leading += lead;
        trailing = trail;
        if (lead || trail) {
          node = inner ? node.type.schema.text(inner, node.marks) : null;
          if (!node) {
            marks = active;
          }
        }
      }

      const inner = marks.length ? marks[marks.length - 1] : null;
      const noEscape = inner !== null && this.mark(inner).escape === false;
      const length = marks.length - (noEscape ? 1 : 0);

      // Mixable marks already open stay open, whatever order they're listed in.
      outer: for (let i = 0; i < length; i++) {
        const mark = marks[i];
        if (!this.mark(mark).mixable) {
          break;
        }
        for (let j = 0; j < active.length; j++) {
          const other = active[j];
          if (!this.mark(other).mixable) {
            break;
          }
          if (mark.eq(other)) {
            if (i > j) {
              marks = [...marks.slice(0, j), mark, ...marks.slice(j, i), ...marks.slice(i + 1, length)];
            } else if (j > i) {
              marks = [...marks.slice(0, i), ...marks.slice(i + 1, j), mark, ...marks.slice(j, length)];
            }
            continue outer;
          }
        }
      }

      let keep = 0;
      while (keep < Math.min(active.length, length) && marks[keep].eq(active[keep])) {
        keep++;
      }
      while (keep < active.length) {
        this.text(this.markString(active.pop()!, false, parent, index), false);
      }
      if (leading) {
        this.text(leading);
      }
      if (node) {
        while (active.length < length) {
          const add = marks[active.length];
          active.push(add);
          this.text(this.markString(add, true, parent, index), false);
        }
        if (noEscape && node.isText && inner) {
          this.text(
            this.markString(inner, true, parent, index) +
              (node.text ?? "") +
              this.markString(inner, false, parent, index + 1),
            false,
          );
        } else {
          this.render(node, parent, index);
        }
      }
    };
    parent.forEach((node, _offset, index) => progress(node, index));
    progress(null, parent.childCount);
  }

  renderList(node: Node, delim: string, firstDelim: (index: number) => string) {
    if (this.closed && this.closed.type === node.type) {
      this.flushClose(3);
    } else if (this.inTightList) {
      this.flushClose(1);
    }
    // Outline writes every list tight.
    const tight = node.attrs.tight ?? true;
    const wasTight = this.inTightList;
    const wasList = this.inList;
    this.inList = true;
    this.inTightList = tight;
    node.forEach((child, _offset, index) => {
      if (index && tight) {
        this.flushClose(1);
      }
      this.wrapBlock(delim, firstDelim(index), node, () => this.render(child, node, index));
    });
    this.inList = wasList;
    this.inTightList = wasTight;
  }

  /** Outline's escaping, which differs from prosemirror-markdown's. */
  esc(text: string, startOfLine = false): string {
    let result = text.replace(/[`*\\~]/g, "\\$&").replace(/\[(?=[^\n]*\]\()/g, "\\$&");
    if (startOfLine) {
      result = result
        .replace(/^[:#\-*+]/, "\\$&")
        .replace(/^(\d+)\./, "$1\\.")
        .replace(/^([a-z])\.(?=\s)/i, "$1\\.");
    }
    return result;
  }
}

function quote(text: string): string {
  const wrap = !text.includes('"') ? '""' : !text.includes("'") ? "''" : "()";
  return wrap[0] + text + wrap[1];
}

/** A link written as <url> when its text is its address. */
function isPlainUrl(link: Mark, parent: Node, index: number, side: -1 | 1): boolean {
  const href = String(link.attrs.href ?? "");
  if (link.attrs.title || !/^\w+:/.test(href)) {
    return false;
  }
  const content = parent.child(index + (side < 0 ? -1 : 0));
  if (!content.isText || content.text !== href || content.marks[content.marks.length - 1] !== link) {
    return false;
  }
  if (index === (side < 0 ? 1 : parent.childCount - 1)) {
    return true;
  }
  const next = parent.child(index + (side < 0 ? -2 : 1));
  return !link.isInSet(next.marks);
}

function backticksFor(node: Node, side: -1 | 1): string {
  let longest = 0;
  for (const match of node.isText ? (node.text ?? "").matchAll(/`+/g) : []) {
    longest = Math.max(longest, match[0].length);
  }
  let result = longest > 0 && side > 0 ? " `" : "`";
  result += "`".repeat(longest);
  if (longest > 0 && side < 0) {
    result += " ";
  }
  return result;
}

function codeBlock(out: MarkdownWriter, node: Node) {
  const content = node.textContent;
  const runs = content.match(/`{3,}/g);
  const fence = "`".repeat(runs ? Math.max(...runs.map((run) => run.length)) + 1 : 3);
  const language = String(node.attrs.language ?? "").replace(/`/g, "").trim().split(/\s/)[0];
  out.write(`${fence}${language}\n`);
  out.text(content, false);
  out.ensureNewLine();
  out.write(fence);
  out.closeBlock(node);
}

const HEADING_LEVELS = [1, 2, 3, 4, 5, 6];

/** How deep a node's tree goes: 0 for a leaf (text too). */
function height(node: Node): number {
  if (node.isLeaf) {
    return 0;
  }
  let deepest = 0;
  node.forEach((child) => {
    deepest = Math.max(deepest, height(child));
  });
  return 1 + deepest;
}

const NODES: Record<string, NodeWriter> = {
  paragraph(out, node) {
    // Outline keeps empty paragraphs as a backslash line.
    if (node.textContent.trim() === "" && node.childCount === 0) {
      if (out.newText) {
        // Outline reads "\" as an empty paragraph only when it's a paragraph
        // of its own; followed by a line of text, it's a line break.
        out.write("\\");
        out.closeBlock(node);
      } else {
        out.write("\\\n");
      }
    } else {
      out.renderInline(node);
      out.closeBlock(node);
    }
  },
  heading(out, node) {
    const level = HEADING_LEVELS.includes(Number(node.attrs.level)) ? Number(node.attrs.level) : 1;
    out.write(`${"#".repeat(level)} `);
    out.renderInline(node);
    out.closeBlock(node);
  },
  blockquote(out, node) {
    out.wrapBlock("> ", null, node, () => out.renderContent(node));
  },
  hr(out, node) {
    out.write(`\n${node.attrs.markup ?? "---"}`);
    out.closeBlock(node);
  },
  code_block: codeBlock,
  code_fence: codeBlock,
  bullet_list(out, node) {
    out.renderList(node, "  ", () => `${node.attrs.bullet || "*"} `);
  },
  ordered_list(out, node) {
    out.write("\n");
    const start = Number(node.attrs.order ?? 1);
    const style = node.attrs.listStyle;
    if (style === "lower-alpha" || style === "upper-alpha") {
      const first = style === "lower-alpha" ? 97 : 65;
      out.renderList(node, "    ", (index) => {
        let n = start + index - 1;
        let letters = "";
        do {
          letters = String.fromCharCode(first + (n % 26)) + letters;
          n = Math.floor(n / 26) - 1;
        } while (n >= 0);
        return `${letters}. `;
      });
    } else {
      const width = String(start + node.childCount - 1).length;
      out.renderList(node, " ".repeat(width + 2), (index) => {
        const number = String(start + index);
        return `${" ".repeat(width - number.length)}${number}. `;
      });
    }
  },
  list_item(out, node) {
    out.renderContent(node);
  },
  // Between fences of +, longer for deeper content so nested toggles nest.
  // Outline doesn't close the block, so what follows comes on the next line.
  container_toggle(out, node) {
    const fence = "+".repeat(3 + height(node));
    out.write(`${fence}\n`);
    out.renderContent(node);
    out.write(`${fence}\n`);
  },
  checkbox_list(out, node) {
    out.renderList(node, "  ", () => "- ");
  },
  checkbox_item(out, node) {
    out.out += node.attrs.checked ? "[x] " : "[ ] ";
    out.renderContent(node);
  },
  br(out) {
    out.write("\\n");
  },
  // Outline puts a space before an image, except at the start of a list
  // item, and its title, layout and size in the link title. Reading the
  // space back keeps it, so new text leaves it out after a space or new line.
  image(out, node) {
    const { alt, src, source, layoutClass, title, width, height } = node.attrs;
    let markdown = out.inList || (out.newText && /(^|\s)$/.test(out.out)) ? "" : " ";
    markdown += `![${out.esc(String(alt || "").replace("\n", ""))}](${out.esc(String(src || ""))}`;
    const titleParts: string[] = [];
    if (source) {
      titleParts.push(`source=${source}`);
    }
    if (layoutClass) {
      titleParts.push(String(layoutClass));
    } else if (title) {
      titleParts.push(String(title));
    }
    const size =
      width || height ? ` =${out.esc(width ? String(width) : "")}x${out.esc(height ? String(height) : "")}` : "";
    if (titleParts.length || size) {
      markdown += ` "${out.esc(titleParts.join(" "))}${size}"`;
    }
    out.write(`${markdown})`);
  },
  // Blocks the editor can't edit, written from the JSON they carry.
  [LOCKED_BLOCK](out, node) {
    const locked = JSON.parse(String(node.attrs.json)) as PMNode;
    const attrs = locked.attrs ?? {};
    if (locked.type !== "video") {
      throw new UnsupportedContent(locked.type);
    }
    out.ensureNewLine();
    out.write(`[${attrs.title} ${attrs.width ?? ""}x${attrs.height ?? ""}](${attrs.src})\n\n`);
    out.ensureNewLine();
  },
  text(out, node) {
    out.text(node.text ?? "");
  },
  emoji(out, node) {
    const name = node.attrs["data-name"];
    if (name) {
      out.write(`:${name}:`);
    }
  },
  mention(out, node) {
    const { id, type, modelId, label, anchorId } = node.attrs;
    if (type === "document") {
      out.write(`[${label}](/doc/${modelId}${anchorId ? `#${anchorId}` : ""})`);
    } else if (type === "collection") {
      out.write(`[${label}](/collection/${modelId})`);
    } else if (type === "date") {
      // Outline writes a label worked out from the date.
      throw new UnsupportedContent("a date mention");
    } else {
      out.write(`@[${label}](mention://${id}/${type}/${modelId})`);
    }
  },
};

const emphasis = (syntax: string): MarkWriter => ({
  open: syntax,
  close: syntax,
  mixable: true,
  expelEnclosingWhitespace: true,
});

const MARKS: Record<string, MarkWriter> = {
  // Comments aren't part of the Markdown.
  comment: emphasis(""),
  link: {
    open: (_out, mark, parent, index) => (isPlainUrl(mark, parent, index, 1) ? "<" : "["),
    close: (out, mark, parent, index) =>
      isPlainUrl(mark, parent, index, -1)
        ? ">"
        : `](${out.esc(String(mark.attrs.href ?? ""))}${mark.attrs.title ? ` ${quote(String(mark.attrs.title))}` : ""})`,
  },
  code_inline: {
    open: (_out, _mark, parent, index) => backticksFor(parent.child(index), -1),
    close: (_out, _mark, parent, index) => backticksFor(parent.child(index - 1), 1),
    escape: false,
  },
  strong: emphasis("**"),
  em: emphasis("*"),
  underline: emphasis("__"),
  strikethrough: emphasis("~~"),
  highlight: emphasis("=="),
};

/**
 * The Markdown Outline writes for the blocks in `node` (e.g. a whole
 * document). With `newText`, Markdown for Outline to read instead, which
 * avoids quirks that don't survive being read back.
 */
export function toMarkdown(node: Node, { newText = false }: { newText?: boolean } = {}): string {
  const out = new MarkdownWriter(NODES, MARKS, newText);
  out.renderContent(node);
  return out.out;
}

/**
 * The Markdown for one top-level block, as it appears in the document's
 * Markdown apart from the blank lines around it.
 */
export function blockMarkdown(block: Node): string {
  const out = new MarkdownWriter(NODES, MARKS);
  out.render(block, block, 0);
  return out.out.replace(/^\n+|\n+$/g, "");
}
