import emojiNames from "@/lib/emoji-names.json";
import { renderMaths } from "@/lib/maths";
import type { PMNode } from "@/lib/outline/documents";

// HTML for what the editor shows but can't edit yet (tables, notices,
// toggles, maths, attachments…), drawn from Outline's JSON. Runs in the
// editor's web view.

/** Image sources (attachment links) mapped to URLs a web view can load. */
let imageUrls: Record<string, string> = {};

export function setImageUrls(urls: Record<string, string>) {
  imageUrls = urls;
}

/** The URL to load an image from, once it's known. */
export function imageUrl(src: string): string | undefined {
  return imageUrls[src] ?? (/^https?:\/\//.test(src) && !src.includes("/api/attachments.redirect") ? src : undefined);
}

const NOTICE_COLORS: Record<string, string> = {
  info: "#3b82f6",
  warning: "#f59e0b",
  tip: "#8b5cf6",
  success: "#22c55e",
};

export function noticeColor(style: unknown): string {
  return NOTICE_COLORS[String(style ?? "info")] ?? NOTICE_COLORS.info;
}

/** Maths size relative to the text around it, as in the reader. */
const MATHS_SCALE = 1.2;

function escape(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

const attr = (node: PMNode, name: string) => (node.attrs?.[name] ?? null) as string | number | boolean | null;
const textOf = (node: PMNode): string => node.text ?? (node.content ?? []).map(textOf).join("");

/** The emoji for a shortcode, or the shortcode when it's a workspace's own emoji. */
export function emojiFor(name: unknown): string {
  return (emojiNames as Record<string, string>)[String(name)] ?? `:${String(name)}:`;
}

/** Maths as SVG markup sized in em, or its TeX source if it can't be drawn. */
export function mathsHtml(tex: string, display: boolean): string {
  const maths = renderMaths(tex, display);
  if (!maths) {
    return `<code>${escape(tex)}</code>`;
  }
  const style = [
    `width:${maths.width * MATHS_SCALE}em`,
    `height:${maths.height * MATHS_SCALE}em`,
    display ? "" : `vertical-align:${-maths.depth * MATHS_SCALE}em`,
  ].join(";");
  return `<span class="${display ? "maths-block" : "maths"}" style="${style}">${maths.svg}</span>`;
}

function marked(node: PMNode, inner: string): string {
  let html = inner;
  for (const mark of node.marks ?? []) {
    switch (mark.type) {
      case "strong":
        html = `<strong>${html}</strong>`;
        break;
      case "em":
        html = `<em>${html}</em>`;
        break;
      case "underline":
        html = `<u>${html}</u>`;
        break;
      case "strikethrough":
        html = `<s>${html}</s>`;
        break;
      case "code_inline":
        html = `<code>${html}</code>`;
        break;
      case "highlight":
        html = `<mark>${html}</mark>`;
        break;
      case "comment":
        html = `<span class="comment">${html}</span>`;
        break;
      case "link":
        html = `<a href="${escape(String(mark.attrs?.href ?? ""))}">${html}</a>`;
        break;
    }
  }
  return html;
}

function children(node: PMNode): string {
  return (node.content ?? []).map(toHtml).join("");
}

/** An image that shows once its URL is resolved (see setImageUrls). */
export function imageHtml(node: PMNode): string {
  const src = String(attr(node, "src") ?? "");
  const url = imageUrl(src);
  return `<img class="image" data-src="${escape(src)}"${url ? ` src="${escape(url)}"` : ""} alt="${escape(String(attr(node, "alt") ?? ""))}">`;
}

/** A tappable card for things that open elsewhere (files, videos, embeds). */
function card(icon: string, title: string, href: string | null): string {
  const inner = `<span class="card-icon">${icon}</span><span class="card-title">${escape(title)}</span>`;
  return href ? `<a class="card" href="${escape(href)}">${inner}</a>` : `<span class="card">${inner}</span>`;
}

function hostOf(href: string | null): string | null {
  try {
    return href ? new URL(href).host : null;
  } catch {
    return null;
  }
}

/** Outline JSON as HTML, for display only. */
export function toHtml(node: PMNode): string {
  switch (node.type) {
    case "text":
      return marked(node, escape(node.text ?? ""));
    case "paragraph":
      return `<p>${children(node) || "<br>"}</p>`;
    case "heading": {
      const level = Math.min(Math.max(Number(attr(node, "level")) || 1, 1), 6);
      return `<h${level}>${children(node)}</h${level}>`;
    }
    case "blockquote":
      return `<blockquote>${children(node)}</blockquote>`;
    case "bullet_list":
      return `<ul>${children(node)}</ul>`;
    case "ordered_list":
      return `<ol start="${Number(attr(node, "order") ?? 1)}">${children(node)}</ol>`;
    case "list_item":
      return `<li>${children(node)}</li>`;
    case "checkbox_list":
      return `<ul class="checklist">${children(node)}</ul>`;
    case "checkbox_item":
      return `<li class="checkbox${attr(node, "checked") ? " checked" : ""}">${children(node)}</li>`;
    case "code_block":
    case "code_fence":
      return `<pre><code>${escape(textOf(node))}</code></pre>`;
    case "hr":
      return "<hr>";
    case "br":
      return "<br>";
    case "emoji":
      return marked(node, escape(emojiFor(attr(node, "data-name"))));
    case "mention":
      return `<span class="mention">@${escape(String(attr(node, "label") ?? ""))}</span>`;
    case "image":
      return imageHtml(node);
    case "math_inline":
      return mathsHtml(textOf(node), false);
    case "math_block":
      return `<div class="maths-scroll">${mathsHtml(textOf(node), true)}</div>`;
    case "table":
      return `<div class="table-scroll"><table>${children(node)}</table></div>`;
    case "tr":
      return `<tr>${children(node)}</tr>`;
    case "th":
    case "td": {
      const span = (name: string) => {
        const value = Number(attr(node, name) ?? 1);
        return value > 1 ? ` ${name}="${value}"` : "";
      };
      return `<${node.type}${span("colspan")}${span("rowspan")}>${children(node)}</${node.type}>`;
    }
    case "container_notice":
      return `<div class="notice" style="--tint:${noticeColor(attr(node, "style"))}">${children(node)}</div>`;
    case "container_toggle": {
      const [summary, ...rest] = node.content ?? [];
      return `<details class="toggle"><summary>${summary ? children(summary) : ""}</summary>${rest.map(toHtml).join("")}</details>`;
    }
    case "attachment":
      return card("📎", String(attr(node, "title") ?? "Attachment"), String(attr(node, "href") ?? "") || null);
    case "video":
      return card("🎬", String(attr(node, "title") ?? "Video"), String(attr(node, "src") ?? "") || null);
    case "embed": {
      const href = String(attr(node, "href") ?? "") || null;
      return card("🔗", hostOf(href) ?? "Embedded content", href);
    }
    default:
      return children(node);
  }
}

/** Every image source in a document, including those inside tables and notices. */
export function imageSources(node: PMNode, found = new Set<string>()): Set<string> {
  if (node.type === "image" && typeof node.attrs?.src === "string") {
    found.add(node.attrs.src);
  }
  node.content?.forEach((child) => imageSources(child, found));
  return found;
}
