"use dom";

import { baseKeymap, lift, setBlockType, toggleMark, wrapIn } from "prosemirror-commands";
import { history, redo, undo } from "prosemirror-history";
import { inputRules, textblockTypeInputRule, wrappingInputRule } from "prosemirror-inputrules";
import { keymap } from "prosemirror-keymap";
import { Node, type NodeType, type Schema } from "prosemirror-model";
import { liftListItem, sinkListItem, splitListItem, wrapInList } from "prosemirror-schema-list";
import { EditorState, Plugin, TextSelection, type Command } from "prosemirror-state";
import { EditorView, type NodeView } from "prosemirror-view";
import { useEffect, useRef } from "react";

import { imageUrl, setImageUrls } from "@/lib/editor/render-html";
import { LOCKED_BLOCK, prepareDocument, unlock } from "@/lib/editor/schema";
import type { PMNode } from "@/lib/outline/documents";

// Outline's documents, edited with ProseMirror in a web view. It reads like
// a page until it's tapped: then the cursor goes where the tap was. Taps on
// links, mentions and cards open them instead while not editing.
//
// The native screen drives it with numbered requests passed as props
// (toolbar commands, saving, jumping to a heading, stopping editing): each
// new number is acted on once. Expo's imperative handles stay bound to the
// first web view they meet, so they break when the view is remade.

export type EditorCommand =
  | "bold"
  | "italic"
  | "strike"
  | "code"
  | "heading1"
  | "heading2"
  | "paragraph"
  | "bulletList"
  | "orderedList"
  | "checkList"
  | "quote"
  | "toggle"
  | "indent"
  | "outdent"
  | "undo"
  | "redo";

/** Requests from the native screen, each acted on once when its number changes. */
export interface EditorRequests {
  /** A toolbar command. */
  command: { name: EditorCommand; seq: number } | null;
  /** Send the document as it is now to onSave. */
  save: number;
  /** Scroll to a top-level block, e.g. a heading from the table of contents. */
  scrollTo: { block: number; seq: number } | null;
  /** Stop editing: the cursor and keyboard go away. */
  blur: number;
  /** Put in an uploaded image (at the cursor) or video (after the block with the cursor). */
  insert: { node: PMNode; seq: number } | null;
}

export interface EditorSelection {
  /** Marks and blocks at the cursor, e.g. "strong" or "heading1". */
  active: string[];
  canUndo: boolean;
  canRedo: boolean;
}

export interface EditorHeader {
  title: string;
  /** An emoji shown before the title. */
  icon: string | null;
  /** E.g. "Updated 3 Oct by Sam". */
  meta: string | null;
}

interface Colors {
  surface: string;
  text: string;
  muted: string;
  primary: string;
  border: string;
  background: string;
  codeBackground: string;
}

function listItemOf(schema: Schema, state: EditorState): NodeType | null {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const type = $from.node(depth).type;
    if (type === schema.nodes.list_item || type === schema.nodes.checkbox_item) {
      return type;
    }
  }
  return null;
}

/** Wraps in the list, or lifts out of it when the cursor is already in one. */
function toggleList(listType: NodeType, itemType: NodeType): Command {
  return (state, dispatch) => {
    const { $from } = state.selection;
    for (let depth = $from.depth; depth > 0; depth--) {
      if ($from.node(depth).type === listType) {
        return liftListItem(itemType)(state, dispatch);
      }
    }
    return wrapInList(listType)(state, dispatch);
  };
}

function commandsFor(schema: Schema): Record<EditorCommand, Command> {
  const { nodes, marks } = schema;
  const inList: Command = (state, dispatch) => {
    const item = listItemOf(schema, state);
    return item ? sinkListItem(item)(state, dispatch) : false;
  };
  const outList: Command = (state, dispatch) => {
    const item = listItemOf(schema, state);
    return item ? liftListItem(item)(state, dispatch) : lift(state, dispatch);
  };
  return {
    bold: toggleMark(marks.strong),
    italic: toggleMark(marks.em),
    strike: toggleMark(marks.strikethrough),
    code: toggleMark(marks.code_inline),
    heading1: setBlockType(nodes.heading, { level: 1 }),
    heading2: setBlockType(nodes.heading, { level: 2 }),
    paragraph: setBlockType(nodes.paragraph),
    bulletList: toggleList(nodes.bullet_list, nodes.list_item),
    orderedList: toggleList(nodes.ordered_list, nodes.list_item),
    checkList: toggleList(nodes.checkbox_list, nodes.checkbox_item),
    quote: wrapIn(nodes.blockquote),
    toggle: wrapIn(nodes.container_toggle),
    indent: inList,
    outdent: outList,
    undo,
    redo,
  };
}

function selectionOf(schema: Schema, state: EditorState): EditorSelection {
  const active = new Set<string>();
  const { $from, empty, from, to } = state.selection;
  const marks = empty ? (state.storedMarks ?? $from.marks()) : [];
  marks.forEach((mark) => active.add(mark.type.name));
  if (!empty) {
    for (const name of ["strong", "em", "strikethrough", "code_inline"]) {
      if (state.doc.rangeHasMark(from, to, schema.marks[name])) {
        active.add(name);
      }
    }
  }
  const parent = $from.parent;
  if (parent.type === schema.nodes.heading) {
    active.add(`heading${parent.attrs.level}`);
  }
  for (let depth = $from.depth; depth > 0; depth--) {
    active.add($from.node(depth).type.name);
  }
  return { active: [...active], canUndo: undo(state), canRedo: redo(state) };
}

/** Where the document's `index`th top-level block starts. */
function blockStart(doc: Node, index: number): number {
  let pos = 0;
  for (let i = 0; i < index; i++) {
    pos += doc.child(i).nodeSize;
  }
  return pos;
}

/**
 * While editing, a handle beside the block with the cursor in it. Dragging
 * it moves the block: a line shows where it will go, and the page scrolls
 * near the top and bottom edges.
 */
function blockHandle(): Plugin {
  return new Plugin({
    view(view) {
      const frame = view.dom.parentElement!;
      const handle = globalThis.document.createElement("div");
      handle.className = "block-handle";
      handle.textContent = "⠿";
      handle.setAttribute("aria-label", "Move block");
      const line = globalThis.document.createElement("div");
      line.className = "drop-line";
      frame.append(handle, line);

      let current = -1;
      let drag: { from: number; to: number; y: number } | null = null;
      let scrolling = 0;

      const place = () => {
        const index = view.state.selection.$from.index(0);
        const block = view.dom.children[index] as HTMLElement | undefined;
        if (!view.hasFocus() || !block || drag) {
          handle.style.display = drag ? "block" : "none";
          return;
        }
        current = index;
        handle.style.display = "block";
        handle.style.top = `${block.offsetTop}px`;
      };
      const target = (y: number) => {
        const blocks = [...view.dom.children] as HTMLElement[];
        for (let i = 0; i < blocks.length; i++) {
          const box = blocks[i].getBoundingClientRect();
          if (y < box.top + box.height / 2) {
            return i;
          }
        }
        return blocks.length;
      };
      const showLine = (to: number) => {
        const blocks = [...view.dom.children] as HTMLElement[];
        const top =
          to < blocks.length
            ? blocks[to].offsetTop - 4
            : (blocks.at(-1)?.offsetTop ?? 0) + (blocks.at(-1)?.offsetHeight ?? 0) + 2;
        line.style.top = `${top}px`;
        line.style.display = "block";
      };
      const scroll = () => {
        if (!drag) {
          return;
        }
        const edge = 72;
        const speed = drag.y < edge ? -8 : drag.y > globalThis.innerHeight - edge ? 8 : 0;
        if (speed) {
          globalThis.scrollBy(0, speed);
          drag.to = target(drag.y);
          showLine(drag.to);
        }
        scrolling = requestAnimationFrame(scroll);
      };

      handle.addEventListener(
        "touchstart",
        (event) => {
          // Keeps the cursor (and keyboard) and stops the page scrolling.
          event.preventDefault();
          drag = { from: current, to: current, y: event.touches[0].clientY };
          (view.dom.children[current] as HTMLElement | undefined)?.classList.add("dragging");
          showLine(current);
          scrolling = requestAnimationFrame(scroll);
        },
        { passive: false },
      );
      handle.addEventListener(
        "touchmove",
        (event) => {
          if (!drag) {
            return;
          }
          event.preventDefault();
          drag.y = event.touches[0].clientY;
          drag.to = target(drag.y);
          showLine(drag.to);
          handle.style.top = `${drag.y - frame.getBoundingClientRect().top - 12}px`;
        },
        { passive: false },
      );
      const drop = () => {
        if (!drag) {
          return;
        }
        const { from, to } = drag;
        drag = null;
        cancelAnimationFrame(scrolling);
        line.style.display = "none";
        (view.dom.children[from] as HTMLElement | undefined)?.classList.remove("dragging");
        if (to !== from && to !== from + 1) {
          const { doc } = view.state;
          const node = doc.child(from);
          const start = blockStart(doc, from);
          const at = blockStart(doc, to) - (to > from ? node.nodeSize : 0);
          const tr = view.state.tr.delete(start, start + node.nodeSize).insert(at, node);
          tr.setSelection(TextSelection.near(tr.doc.resolve(at + 1)));
          view.dispatch(tr.scrollIntoView());
        }
        place();
      };
      handle.addEventListener("touchend", drop);
      handle.addEventListener("touchcancel", drop);
      view.dom.addEventListener("focus", place);
      view.dom.addEventListener("blur", place);
      return {
        update: place,
        destroy() {
          cancelAnimationFrame(scrolling);
          handle.remove();
          line.remove();
          view.dom.removeEventListener("focus", place);
          view.dom.removeEventListener("blur", place);
        },
      };
    },
  });
}

/**
 * A toggle: the triangle folds everything after its first block away, and
 * its text is edited like any other. Toggles start folded, as in the
 * reader; ones made while editing start open.
 */
function toggleView(folded: boolean): NodeView {
  const dom = globalThis.document.createElement("div");
  dom.className = folded ? "toggle-block folded" : "toggle-block";
  const button = globalThis.document.createElement("button");
  button.className = "toggle-button";
  button.contentEditable = "false";
  button.setAttribute("aria-label", "Open or close");
  const content = globalThis.document.createElement("div");
  content.className = "toggle-content";
  dom.append(button, content);
  return {
    dom,
    contentDOM: content,
    update: (node) => node.type.name === "container_toggle",
    stopEvent: (event) => event.target === button,
    ignoreMutation: (mutation) => mutation.target === button || (mutation.type === "attributes" && mutation.target === dom),
  };
}

// The pull-to-refresh spinner's place: above the page, while refreshing,
// and how far the page is pulled (half the finger's travel) to refresh.
const PULL_HIDDEN = -48;
const PULL_RESTING = 20;
const PULL_TRIGGER = PULL_RESTING - PULL_HIDDEN;
const PULL_MAX = PULL_TRIGGER + 40;

function css(colors: Colors, fontSize: number): string {
  return `
    html, body { margin: 0; background: ${colors.background}; color: ${colors.text}; }
    body { font: ${fontSize}px/1.5 system-ui, sans-serif; -webkit-tap-highlight-color: transparent; overflow-wrap: anywhere; overflow-x: hidden; }
    /* Expo's root lays children out in a row; the page is one full-width column. */
    .page { display: block; width: 100%; min-width: 0; flex: 1 1 auto; }
    .doc-header { padding: 16px 20px 0; }
    .doc-title { font-size: 1.75em; font-weight: 700; line-height: 1.25; margin: 0 0 6px; }
    .doc-meta { color: ${colors.muted}; font-size: 0.8em; margin: 0 0 6px; }
    .ProseMirror { padding: 6px 20px 160px; outline: none; white-space: pre-wrap; word-wrap: break-word; min-height: 70vh; box-sizing: border-box; caret-color: ${colors.primary}; }
    .ProseMirror p { margin: 0 0 8px; }
    .ProseMirror h1, .ProseMirror h2, .ProseMirror h3, .ProseMirror h4, .ProseMirror h5, .ProseMirror h6 { margin: 16px 0 8px; line-height: 1.3; }
    .ProseMirror ul, .ProseMirror ol { padding-left: 24px; margin: 0 0 8px; }
    .ProseMirror li > p { margin: 0 0 4px; }
    .ProseMirror ul.checklist { list-style: none; padding-left: 4px; }
    .ProseMirror li.checkbox { position: relative; padding-left: 28px; }
    .ProseMirror li.checkbox::before { content: "☐"; position: absolute; left: 0; color: ${colors.primary}; font-size: 1.15em; line-height: 1.3; }
    .ProseMirror li.checkbox.checked::before { content: "☑"; }
    .ProseMirror li.checkbox.checked > p { text-decoration: line-through; color: ${colors.muted}; }
    .ProseMirror blockquote { margin: 0 0 8px; padding-left: 12px; border-left: 3px solid ${colors.border}; color: ${colors.muted}; }
    .ProseMirror pre { background: ${colors.codeBackground}; padding: 10px 12px; border-radius: 6px; overflow-x: auto; font-size: 0.9em; white-space: pre; }
    .ProseMirror code { font-family: ui-monospace, monospace; background: ${colors.codeBackground}; border-radius: 4px; padding: 0 3px; }
    .ProseMirror pre code { padding: 0; background: none; }
    .ProseMirror a { color: ${colors.primary}; }
    .ProseMirror mark { background: rgba(250, 204, 21, 0.4); color: inherit; }
    .ProseMirror .comment { background: rgba(250, 204, 21, 0.25); border-bottom: 2px solid rgba(250, 204, 21, 0.9); }
    .ProseMirror hr { border: none; border-top: 1px solid ${colors.border}; margin: 16px 0; }
    .ProseMirror .mention { color: ${colors.primary}; background: ${colors.codeBackground}; border-radius: 4px; padding: 0 4px; }
    .ProseMirror .image-wrap { display: inline-block; max-width: 100%; }
    .ProseMirror img.image { display: block; max-width: 100%; height: auto; border-radius: 6px; margin: 4px 0; background: ${colors.codeBackground}; min-height: 48px; min-width: 48px; }
    .ProseMirror .locked { margin: 0 0 8px; }
    .ProseMirror .table-scroll { overflow-x: auto; }
    .ProseMirror table { border-collapse: collapse; font-size: 0.95em; }
    .ProseMirror th, .ProseMirror td { border: 1px solid ${colors.border}; padding: 6px 8px; vertical-align: top; min-width: 60px; }
    .ProseMirror th { background: ${colors.codeBackground}; text-align: left; }
    .ProseMirror th p, .ProseMirror td p { margin: 0; }
    .ProseMirror .notice { border: 1px solid var(--tint); background: color-mix(in srgb, var(--tint) 13%, transparent); border-radius: 8px; padding: 10px 12px; }
    .ProseMirror .notice > :last-child { margin-bottom: 0; }
    .ProseMirror details.toggle { border-radius: 6px; padding: 2px 0; }
    .ProseMirror details.toggle > summary { cursor: pointer; font-weight: 600; }
    .ProseMirror details.toggle > summary p { display: inline; margin: 0; }
    .ProseMirror details.toggle[open] > :not(summary) { margin-left: 18px; }
    .ProseMirror .maths, .ProseMirror .maths-block { display: inline-block; }
    .ProseMirror .maths svg, .ProseMirror .maths-block svg { width: 100%; height: 100%; }
    .ProseMirror .maths-scroll { overflow-x: auto; text-align: center; padding: 4px 0; }
    .ProseMirror .card { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid ${colors.border}; border-radius: 8px; background: ${colors.surface}; color: ${colors.text}; text-decoration: none; }
    .ProseMirror .card-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ProseMirror .toggle-block { position: relative; padding-left: 26px; margin: 0 0 8px; }
    .ProseMirror .toggle-button { position: absolute; left: 0; top: 0; width: 24px; height: 1.6em; padding: 0; border: none; background: none; color: ${colors.muted}; font-size: 0.9em; }
    .ProseMirror .toggle-button::before { content: "▾"; }
    .ProseMirror .toggle-block.folded > .toggle-button::before { content: "▸"; }
    .ProseMirror .toggle-block.folded > .toggle-content > :not(:first-child) { display: none; }
    .ProseMirror .toggle-content > :first-child { font-weight: 600; }
    .editor-frame { position: relative; }
    .block-handle { display: none; position: absolute; left: 0; width: 24px; height: 28px; line-height: 28px; text-align: center; color: ${colors.muted}; font-size: 18px; touch-action: none; user-select: none; -webkit-user-select: none; z-index: 2; }
    .drop-line { display: none; position: absolute; left: 20px; right: 20px; height: 3px; border-radius: 2px; background: ${colors.primary}; z-index: 2; pointer-events: none; }
    .ProseMirror .dragging { opacity: 0.4; }
    .ProseMirror-selectednode { outline: 2px solid ${colors.primary}; border-radius: 4px; }
    .ProseMirror-hideselection *::selection { background: transparent; }
    html, body { overscroll-behavior-y: contain; }
    .pull { position: fixed; top: 0; left: 50%; width: 36px; height: 36px; margin-left: -18px; border-radius: 50%; background: ${colors.surface}; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3); display: flex; align-items: center; justify-content: center; transform: translateY(${PULL_HIDDEN}px); transition: transform 0.2s; z-index: 3; pointer-events: none; }
    .pull::after { content: ""; width: 16px; height: 16px; border: 2.5px solid ${colors.primary}; border-top-color: transparent; border-radius: 50%; }
    .pull.spinning::after { animation: pull-spin 0.8s linear infinite; }
    @keyframes pull-spin { to { transform: rotate(360deg); } }
  `;
}

export default function RichEditor({
  content,
  requests,
  header,
  images,
  colors,
  fontSize,
  onReady,
  onChange,
  onSave,
  onSelection,
  onFocusChange,
  onOpenLink,
  onOpenDocument,
  refreshing,
  onRefresh,
}: {
  /**
   * The document to edit, read when the editor is made; the screen stops
   * sending it once onReady is called, since every prop goes to the web view
   * again on each change.
   */
  content?: PMNode;
  requests: EditorRequests;
  header: EditorHeader;
  /** Image sources mapped to URLs the web view can load. */
  images: Record<string, string>;
  colors: Colors;
  fontSize: number;
  /** Whether the document comes out exactly as it went in, and what the editor can't edit. */
  onReady: (report: { roundTrip: boolean; error: string | null }) => Promise<void>;
  /** Called shortly after each change, with how many changes there have been. */
  onChange: (changes: number) => Promise<void>;
  /** The edited document, in Outline's JSON, and its change count, when the screen asks to save. */
  onSave: (document: PMNode, changes: number) => Promise<void>;
  onSelection: (selection: EditorSelection) => Promise<void>;
  /** Editing started (the cursor is in the document) or stopped. */
  onFocusChange: (focused: boolean) => Promise<void>;
  onOpenLink: (href: string) => Promise<void>;
  onOpenDocument: (documentId: string) => Promise<void>;
  /** The screen is refreshing; the spinner shows until it's done. */
  refreshing: boolean;
  /** The page was pulled down at the top while reading. */
  onRefresh: () => Promise<void>;
  dom?: import("expo/dom").DOMProps;
}) {
  const mount = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const commands = useRef<Record<EditorCommand, Command> | null>(null);
  const changes = useRef(0);

  // Images whose URL arrives after they were drawn get it now.
  useEffect(() => {
    setImageUrls(images);
    for (const image of view.current?.dom.querySelectorAll<HTMLImageElement>("img[data-src]") ?? []) {
      const url = imageUrl(image.dataset.src ?? "");
      if (url && image.getAttribute("src") !== url) {
        image.src = url;
      }
    }
  }, [images]);

  // The editor is made once; later `document` props are ignored, since the
  // editor now holds the document.
  useEffect(() => {
    if (!mount.current) {
      return;
    }
    let schema: Schema;
    let doc: Node;
    setImageUrls(images);
    if (!content) {
      return;
    }
    try {
      const prepared = prepareDocument(content);
      schema = prepared.schema;
      doc = Node.fromJSON(schema, prepared.doc);
      doc.check();
    } catch (err) {
      void onReady({ roundTrip: false, error: err instanceof Error ? err.message : String(err) });
      return;
    }
    commands.current = commandsFor(schema);
    const { nodes, marks } = schema;
    const state = EditorState.create({
      doc,
      plugins: [
        blockHandle(),
        history(),
        inputRules({
          rules: [
            textblockTypeInputRule(/^(#{1,3})\s$/, nodes.heading, (match) => ({ level: match[1].length })),
            wrappingInputRule(/^\s*([-+*])\s$/, nodes.bullet_list),
            wrappingInputRule(/^(\d+)\.\s$/, nodes.ordered_list, (match) => ({ order: Number(match[1]) })),
            wrappingInputRule(/^\[( |x)?\]\s$/, nodes.checkbox_list),
            wrappingInputRule(/^\s*>\s$/, nodes.blockquote),
            textblockTypeInputRule(/^```$/, nodes.code_fence),
          ],
        }),
        keymap({
          "Mod-z": undo,
          "Shift-Mod-z": redo,
          "Mod-b": toggleMark(marks.strong),
          "Mod-i": toggleMark(marks.em),
          Enter: (s, d) => splitListItem(nodes.checkbox_item, { checked: false })(s, d) || splitListItem(nodes.list_item)(s, d),
          Tab: (s, d) => commands.current!.indent(s, d),
          "Shift-Tab": (s, d) => commands.current!.outdent(s, d),
        }),
        keymap(baseKeymap),
      ],
    });

    let timer: ReturnType<typeof setTimeout> | undefined;
    // Toggles in the document as it opens start folded; new ones start open.
    let opening = true;
    const editor = new EditorView(mount.current, {
      state,
      nodeViews: { container_toggle: () => toggleView(opening) },
      dispatchTransaction(transaction) {
        const next = editor.state.apply(transaction);
        editor.updateState(next);
        void onSelection(selectionOf(schema, next));
        if (transaction.docChanged) {
          changes.current += 1;
          clearTimeout(timer);
          timer = setTimeout(() => void onChange(changes.current), 300);
        }
      },
      handleDOMEvents: {
        // While reading, taps on links, mentions, cards and toggles act on
        // them instead of starting to edit; preventing the press keeps the
        // cursor (and keyboard) away.
        mousedown(pressView, event) {
          const target = event.target instanceof Element ? event.target : null;
          const toggle = target?.closest(".toggle-button");
          if (toggle) {
            event.preventDefault();
            toggle.parentElement?.classList.toggle("folded");
            return true;
          }
          const summary = target?.closest("summary");
          if (summary) {
            event.preventDefault();
            const details = summary.parentElement as HTMLDetailsElement;
            details.open = !details.open;
            return true;
          }
          if (pressView.hasFocus() || !target) {
            return false;
          }
          const mention = target.closest<HTMLElement>(".mention");
          if (mention) {
            event.preventDefault();
            if (mention.dataset.type === "document" && mention.dataset.model) {
              void onOpenDocument(mention.dataset.model);
            } else if (mention.dataset.href) {
              void onOpenLink(mention.dataset.href);
            }
            return true;
          }
          const link = target.closest<HTMLAnchorElement>("a[href]");
          if (link) {
            event.preventDefault();
            void onOpenLink(link.getAttribute("href") ?? "");
            return true;
          }
          // A checkbox's box ticks it without starting to edit.
          const item = target.closest<HTMLElement>("li.checkbox");
          if (item && item === target && event.clientX - item.getBoundingClientRect().left <= 28) {
            event.preventDefault();
            const pos = pressView.posAtDOM(item, 0) - 1;
            const node = pressView.state.doc.nodeAt(pos);
            if (node?.type === nodes.checkbox_item) {
              pressView.dispatch(pressView.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: !node.attrs.checked }));
            }
            return true;
          }
          return false;
        },
        // Links don't navigate the web view itself.
        click(_clickView, event) {
          if (event.target instanceof Element && event.target.closest("a[href]")) {
            event.preventDefault();
          }
          return false;
        },
        focus() {
          void onFocusChange(true);
          return false;
        },
        blur() {
          void onFocusChange(false);
          return false;
        },
      },
      handleClickOn(clickView, _pos, node, nodePos, event) {
        // A tap on a checkbox's box ticks it.
        if (node.type !== nodes.checkbox_item || !(event.target instanceof HTMLElement)) {
          return false;
        }
        const box = event.target.getBoundingClientRect();
        if (event.target.tagName !== "LI" || event.clientX - box.left > 28) {
          return false;
        }
        clickView.dispatch(clickView.state.tr.setNodeMarkup(nodePos, undefined, { ...node.attrs, checked: !node.attrs.checked }));
        return true;
      },
    });
    view.current = editor;
    opening = false;
    void onReady({ roundTrip: sameDocument(unlock(doc.toJSON() as PMNode), content), error: null });
    void onSelection(selectionOf(schema, state));
    return () => {
      clearTimeout(timer);
      editor.destroy();
      view.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- made once, see above
  }, []);

  // Pull to refresh: dragging down at the top of the page while reading (not
  // while editing, where a drag selects text, nor from a block's handle).
  const pull = useRef<HTMLDivElement>(null);
  const onRefreshRef = useRef(onRefresh);
  const refreshingRef = useRef(refreshing);
  useEffect(() => {
    onRefreshRef.current = onRefresh;
    refreshingRef.current = refreshing;
    const indicator = pull.current;
    if (indicator) {
      indicator.classList.toggle("spinning", refreshing);
      indicator.style.transition = "";
      indicator.style.transform = `translateY(${refreshing ? PULL_RESTING : PULL_HIDDEN}px)`;
    }
  }, [onRefresh, refreshing]);
  useEffect(() => {
    const indicator = pull.current;
    if (!indicator) {
      return;
    }
    let startY: number | null = null;
    let distance = 0;
    const place = (y: number, animated: boolean) => {
      indicator.style.transition = animated ? "" : "none";
      indicator.style.transform = `translateY(${y}px) rotate(${y * 4}deg)`;
    };
    const start = (event: TouchEvent) => {
      const onHandle = event.target instanceof Element && event.target.closest(".block-handle");
      const reading = !view.current?.hasFocus();
      const canPull = reading && !onHandle && !refreshingRef.current && window.scrollY <= 0 && event.touches.length === 1;
      startY = canPull ? event.touches[0].clientY : null;
      distance = 0;
    };
    const move = (event: TouchEvent) => {
      if (startY === null) {
        return;
      }
      const travel = event.touches[0].clientY - startY;
      if (travel <= 0 || window.scrollY > 0) {
        // Scrolling the page instead.
        startY = null;
        if (distance > 0) {
          place(PULL_HIDDEN, true);
        }
        return;
      }
      distance = Math.min(travel / 2, PULL_MAX);
      place(PULL_HIDDEN + distance, false);
      if (event.cancelable) {
        event.preventDefault();
      }
    };
    const end = () => {
      if (startY === null) {
        return;
      }
      startY = null;
      if (distance >= PULL_TRIGGER) {
        indicator.classList.add("spinning");
        place(PULL_RESTING, true);
        void onRefreshRef.current();
        // Hidden again by the `refreshing` prop, or here if that never came.
        setTimeout(() => {
          if (!refreshingRef.current) {
            indicator.classList.remove("spinning");
            place(PULL_HIDDEN, true);
          }
        }, 1500);
      } else {
        place(PULL_HIDDEN, true);
      }
      distance = 0;
    };
    window.addEventListener("touchstart", start, { passive: true });
    window.addEventListener("touchmove", move, { passive: false });
    window.addEventListener("touchend", end);
    window.addEventListener("touchcancel", end);
    return () => {
      window.removeEventListener("touchstart", start);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", end);
      window.removeEventListener("touchcancel", end);
    };
  }, []);

  // Requests already there when the editor was made were meant for an earlier one.
  const handled = useRef({
    command: requests.command?.seq ?? 0,
    save: requests.save,
    scrollTo: requests.scrollTo?.seq ?? 0,
    blur: requests.blur,
    insert: requests.insert?.seq ?? 0,
  });
  useEffect(() => {
    const current = view.current;
    const done = handled.current;
    if (!current) {
      return;
    }
    if (requests.command && requests.command.seq !== done.command) {
      done.command = requests.command.seq;
      const command = commands.current?.[requests.command.name];
      if (command) {
        command(current.state, current.dispatch);
        current.focus();
      }
    }
    if (requests.save !== done.save) {
      done.save = requests.save;
      void onSave(unlock(current.state.doc.toJSON() as PMNode), changes.current);
    }
    if (requests.scrollTo && requests.scrollTo.seq !== done.scrollTo) {
      done.scrollTo = requests.scrollTo.seq;
      current.dom.children[requests.scrollTo.block]?.scrollIntoView({ block: "start" });
    }
    if (requests.blur !== done.blur) {
      done.blur = requests.blur;
      (current.dom as HTMLElement).blur();
    }
    if (requests.insert && requests.insert.seq !== done.insert) {
      done.insert = requests.insert.seq;
      const { state } = current;
      const { schema } = state;
      const inserted = requests.insert.node;
      if (inserted.type === "image") {
        current.dispatch(state.tr.replaceSelectionWith(schema.nodes.image.create(inserted.attrs)).scrollIntoView());
      } else {
        const after = blockStart(state.doc, state.selection.$from.index(0) + 1);
        const block = schema.nodes[LOCKED_BLOCK].create({ json: JSON.stringify(inserted) });
        current.dispatch(state.tr.insert(after, block).scrollIntoView());
      }
    }
  }, [requests, onSave]);

  return (
    <div className="page">
      <style>{css(colors, fontSize)}</style>
      <div ref={pull} className="pull" />
      <header className="doc-header">
        <h1 className="doc-title">
          {header.icon ? `${header.icon} ` : ""}
          {header.title || "Untitled"}
        </h1>
        {header.meta ? <p className="doc-meta">{header.meta}</p> : null}
      </header>
      <div ref={mount} className="editor-frame" />
    </div>
  );
}

/**
 * Whether two documents are the same apart from what doesn't matter:
 * attributes left empty, and the order marks are listed in.
 */
function sameDocument(a: PMNode, b: PMNode): boolean {
  const normal = (node: PMNode): unknown => ({
    type: node.type,
    text: node.text,
    attrs: Object.fromEntries(
      Object.entries(node.attrs ?? {})
        .filter(([, value]) => value !== null && value !== undefined)
        .sort(([x], [y]) => x.localeCompare(y)),
    ),
    marks: (node.marks ?? []).map((mark) => JSON.stringify(normal({ type: mark.type, attrs: mark.attrs }))).sort(),
    content: (node.content ?? []).map(normal),
  });
  return JSON.stringify(normal(a)) === JSON.stringify(normal(b));
}
