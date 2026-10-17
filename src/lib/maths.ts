import { liteAdaptor } from "mathjax-full/js/adaptors/liteAdaptor.js";
import type { LiteElement } from "mathjax-full/js/adaptors/lite/Element.js";
import { RegisterHTMLHandler } from "mathjax-full/js/handlers/html.js";
import { TeX } from "mathjax-full/js/input/tex.js";
import "mathjax-full/js/input/tex/ams/AmsConfiguration.js";
import "mathjax-full/js/input/tex/base/BaseConfiguration.js";
import "mathjax-full/js/input/tex/boldsymbol/BoldsymbolConfiguration.js";
import "mathjax-full/js/input/tex/braket/BraketConfiguration.js";
import "mathjax-full/js/input/tex/cancel/CancelConfiguration.js";
import "mathjax-full/js/input/tex/color/ColorConfiguration.js";
import "mathjax-full/js/input/tex/mathtools/MathtoolsConfiguration.js";
import "mathjax-full/js/input/tex/newcommand/NewcommandConfiguration.js";
import { mathjax } from "mathjax-full/js/mathjax.js";
import { SVG } from "mathjax-full/js/output/svg.js";

// TeX to SVG with MathJax, all in JavaScript, so maths draws offline and
// inline with text. Outline's web app uses KaTeX, which only renders into
// HTML and CSS; these MathJax packages cover what KaTeX supports.

const PACKAGES = ["base", "ams", "newcommand", "boldsymbol", "braket", "cancel", "color", "mathtools"];

/** Maths drawn as SVG, measured in em of the surrounding text. */
export interface RenderedMaths {
  /** SVG markup; it draws in `currentColor`. */
  svg: string;
  width: number;
  height: number;
  /** How far it reaches below the text's baseline. */
  depth: number;
}

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);

function createDocument() {
  return mathjax.document("", {
    InputJax: new TeX({
      packages: PACKAGES,
      // Throw instead of drawing the error, so the source can be shown.
      formatError: (_jax: unknown, error: Error) => {
        throw error;
      },
    }),
    // Every glyph as its own path, so each SVG stands alone.
    OutputJax: new SVG({ fontCache: "none" }),
  });
}

// Built on first use; MathJax takes a moment to set up.
let document: ReturnType<typeof createDocument> | undefined;

const cache = new Map<string, RenderedMaths | null>();

function convert(tex: string, display: boolean): RenderedMaths | null {
  document ??= createDocument();
  const container = document.convert(tex, { display }) as LiteElement;
  const svgNode = adaptor.firstChild(container) as LiteElement;
  // In thousandths of an em, with the baseline at y = 0.
  const viewBox = adaptor.getAttribute(svgNode, "viewBox")?.split(" ").map((n: string) => Number(n) / 1000);
  if (viewBox?.length !== 4 || !viewBox.every(Number.isFinite) || !(viewBox[2] > 0)) {
    return null;
  }
  const [, top, width, height] = viewBox;
  // The component sizes it instead.
  adaptor.removeAttribute(svgNode, "width");
  adaptor.removeAttribute(svgNode, "height");
  adaptor.removeAttribute(svgNode, "style");
  return { svg: adaptor.outerHTML(svgNode), width, height, depth: Math.max(top + height, 0) };
}

/**
 * TeX drawn as SVG, or null if it can't be (a TeX error, or a command
 * MathJax doesn't know); then the source is shown instead.
 */
export function renderMaths(tex: string, display: boolean): RenderedMaths | null {
  const key = `${display ? "block" : "inline"}:${tex}`;
  if (!cache.has(key)) {
    let result: RenderedMaths | null = null;
    try {
      result = tex.trim() ? convert(tex, display) : null;
    } catch {
      result = null;
    }
    cache.set(key, result);
  }
  return cache.get(key) ?? null;
}
