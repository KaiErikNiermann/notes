/**
 * d3 figure runtime — the shared preamble that every figure imports.
 *
 * This module is bundled exactly once into output/notes/d3-assets/figures.js
 * (by the `d3-figures` build stage) alongside all sidecar figures. The browser
 * fetches that bundle lazily, only on pages that contain a `[data-d3]` /
 * `[data-d3-inline]` element (see initD3Figures in forester.ts), so non-figure
 * pages never pay for d3.
 *
 * Two authoring paths, one mount path:
 *   - sidecar:  figures/<name>.ts exporting `render`, referenced by \d3[name]
 *   - inline:   \d3inline[name]{...verbatim js...} → <script type="application/x-d3-inline">
 * Both end up calling a `FigureRender` against the same `FigureContext`.
 */
import * as d3 from "d3";



export type ThemeMode = "light" | "dark";

/** Theme-derived colors, read live from the site's CSS custom properties so a
 *  figure always matches the surrounding page (and re-renders on toggle). */
export type Palette = Readonly<{
  bg: string;
  text: string;
  muted: string;
  link: string;
  surface: string;
  /** Categorical ramp for series/categories. Stable order, theme-aware. */
  accents: readonly string[];
}>;

export type FigureTheme = Readonly<{
  mode: ThemeMode;
  palette: Palette;
  fontFamily: string;
  monoFamily: string;
}>;

export type FigureContext = Readonly<{
  /** The <figure> element to render into. Prior render output is already cleared. */
  el: HTMLElement;
  /** Inner width available (px), from the figure's clientWidth. */
  width: number;
  /** A sensible default height (0.6 * width). Figures may size themselves instead. */
  height: number;
  /** The full d3 namespace — `ctx.d3.scaleLinear()`, etc. */
  d3: typeof d3;
  /** Resolved palette + typography, re-derived on every (re)render. */
  theme: FigureTheme;
  /** `data-d3-*` attributes on the figure (minus the name marker), e.g. {bins:"20"}. */
  params: Readonly<Record<string, string>>;
}>;

/** A figure renders into `ctx.el`. For reactive/animated figures (e.g. a force
 *  simulation) it may return a teardown that stops timers/simulations; the
 *  runtime calls it before the next re-render (theme toggle, resize). */
export type FigureRender = (ctx: FigureContext) => void | (() => void);
export type FigureRegistry = Readonly<Record<string, FigureRender>>;

const readVar = (name: string, fallback: string): string => {
  const body = document.body;
  if (!body) return fallback;
  const value = getComputedStyle(body).getPropertyValue(name).trim();
  return value || fallback;
};

const currentMode = (): ThemeMode =>
  document.documentElement.dataset.theme === "light" ? "light" : "dark";

const readTheme = (): FigureTheme => ({
  mode: currentMode(),
  palette: {
    bg: readVar("--bg-color", "#0f1117"),
    text: readVar("--text-color", "#f4f6ff"),
    muted: readVar("--muted-color", "#c4cbdd"),
    link: readVar("--link-color", "#86c5ff"),
    surface: readVar("--surface-hover", "rgba(255,255,255,0.06)"),
    accents: [
      readVar("--link-color", "#86c5ff"),
      readVar("--code-function", "#6ed1ff"),
      readVar("--code-keyword", "#c3a6ff"),
      readVar("--code-string", "#ffb878"),
      readVar("--code-number", "#ff85b5"),
    ],
  },
  fontFamily: readVar("--body-font-stack", "'Inria Sans', system-ui, sans-serif"),
  monoFamily: readVar("--code-font-stack", "monospace"),
});

const PARAM_PREFIX = "data-d3-";
const PARAM_SKIP = new Set(["data-d3-inline", "data-d3-params", "data-d3-error"]);

/** Parse a `\d3p` param string — `key=value` (or `key: value`) entries
 *  separated by `;`, `,`, or newlines. Tolerant of whitespace and blanks. */
const parseParamString = (raw: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const entry of raw.split(/[;,\n]+/)) {
    const match = entry.trim().match(/^([\w-]+)\s*[:=]\s*(.*)$/);
    if (match) {
      const [, key, value] = match;
      out[key] = value.trim(); // both groups are required, so always present when `match` succeeds
    }
  }
  return out;
};

const readParams = (el: HTMLElement): Readonly<Record<string, string>> => {
  // 1) the `\d3p` bulk param string, then 2) explicit data-d3-* attributes,
  // which win on conflict (more specific than the bulk string).
  const params: Record<string, string> = {};
  const bulk = el.dataset.d3Params;
  if (bulk) Object.assign(params, parseParamString(bulk));
  for (const attr of el.attributes) {
    if (!attr.name.startsWith(PARAM_PREFIX) || PARAM_SKIP.has(attr.name)) continue;
    params[attr.name.slice(PARAM_PREFIX.length)] = attr.value;
  }
  return params;
};

// --- Graph framing helpers -------------------------------------------------
// Containment for node-link figures. Three composable pieces a figure opts into:
//   clamp        — keep a value (e.g. a dragged node) inside a box
//   fitTransform — translate+scale that fits a bbox into the viewport (no clip)
//   attachZoom   — pan/zoom interaction for exploring large graphs
// A figure picks its strategy; plain charts (histogram) ignore all of this.

export const clamp = (value: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, value));

export type Viewport = Readonly<{ width: number; height: number }>;
export type BBox = Readonly<{ x: number; y: number; width: number; height: number }>;
export type FitOptions = Readonly<{ padding?: number; maxScale?: number }>;
export type FitTransform = Readonly<{ x: number; y: number; k: number }>;

/** translate+scale mapping `box` to the centre of `viewport` with padding.
 *  `maxScale` (default 1) stops small graphs from being blown up past 1:1 —
 *  they just centre; large graphs scale down to fit. Returns null if degenerate. */
export const fitTransform = (box: BBox, viewport: Viewport, opts: FitOptions = {}): FitTransform | null => {
  if (box.width === 0 || box.height === 0) return null;
  const padding = opts.padding ?? 24;
  const maxScale = opts.maxScale ?? 1;
  const k = Math.min(
    maxScale,
    (viewport.width - 2 * padding) / box.width,
    (viewport.height - 2 * padding) / box.height,
  );
  return {
    x: (viewport.width - k * box.width) / 2 - k * box.x,
    y: (viewport.height - k * box.height) / 2 - k * box.y,
    k,
  };
};

/** Axis-aligned bounding box of points (each padded by `radius`). Cheaper than
 *  getBBox (no layout reflow), so safe to call every simulation tick. */
export const boundsOf = (
  points: ReadonlyArray<{ x?: number; y?: number }>,
  radius = 0,
): BBox | null => {
  if (points.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    const x = p.x ?? 0;
    const y = p.y ?? 0;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { x: minX - radius, y: minY - radius, width: maxX - minX + 2 * radius, height: maxY - minY + 2 * radius };
};

export type ZoomOptions = Readonly<{ min?: number; max?: number }>;

/** Attach pan/zoom to `svg`, driving `g`'s transform. Returns the behavior so
 *  the caller can set an initial framed transform via `svg.call(zoom.transform, …)`. */
export const attachZoom = (
  svg: d3.Selection<SVGSVGElement, unknown, null, undefined>,
  g: d3.Selection<SVGGElement, unknown, null, undefined>,
  opts: ZoomOptions = {},
): d3.ZoomBehavior<SVGSVGElement, unknown> => {
  const zoom = d3
    .zoom<SVGSVGElement, unknown>()
    .scaleExtent([opts.min ?? 0.2, opts.max ?? 8])
    .on("zoom", (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) =>
      g.attr("transform", event.transform.toString()),
    );
  svg.call(zoom);
  return zoom;
};

/** Append a small button overlaid on the figure (top-right). Useful for
 *  per-figure controls like "reset view". Removed automatically on the next
 *  re-render (runRender clears non-script/figcaption children). */
export const addOverlayButton = (
  el: HTMLElement,
  opts: { label: string; icon: string; onClick: () => void },
): HTMLButtonElement => {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "d3-overlay-btn";
  btn.title = opts.label;
  btn.setAttribute("aria-label", opts.label);
  btn.innerHTML = opts.icon;
  btn.addEventListener("click", opts.onClick);
  el.append(btn);
  return btn;
};

/** Teardown returned by the previous render of a given figure element. */
const teardowns = new WeakMap<HTMLElement, () => void>();

/** Render `render` into `el`, preserving the source <script> and <figcaption>.
 *  Any teardown from the prior render is invoked first so animated figures
 *  (force sims, transitions) don't leak across re-renders. */
const runRender = (render: FigureRender, el: HTMLElement, theme: FigureTheme): void => {
  const teardown = teardowns.get(el);
  if (teardown) {
    try {
      teardown();
    } catch (error) {
      console.error("[d3] figure teardown error", error);
    }
    teardowns.delete(el);
  }
  for (const child of el.children) {
    if (child.tagName === "SCRIPT" || child.tagName === "FIGCAPTION") continue;
    child.remove();
  }
  delete el.dataset.d3Error;
  const width = el.clientWidth || 640;
  try {
    const cleanup = render({ el, width, height: Math.round(width * 0.6), d3, theme, params: readParams(el) });
    if (typeof cleanup === "function") teardowns.set(el, cleanup);
  } catch (error) {
    console.error("[d3] figure render error", error);
    el.dataset.d3Error = "render";
  }
};

const mountSidecar = (registry: FigureRegistry, el: HTMLElement, theme: FigureTheme): void => {
  const name = el.dataset.d3;
  if (!name) return;
  const render = registry[name];
  if (!render) {
    console.error(`[d3] no figure registered for "${name}" — is figures/${name}.ts present?`);
    el.dataset.d3Error = "unknown-figure";
    return;
  }
  runRender(render, el, theme);
};

/** HTML `<script>` content is raw text — entities are NOT decoded by the parser,
 *  and the XSLT pass may have escaped `<`/`&` in the verbatim body. Round-trip
 *  through a textarea to recover the real source regardless of output method. */
const decodeEntities = (raw: string): string => {
  if (!/&[a-z#0-9]+;/i.test(raw)) return raw;
  const ta = document.createElement("textarea");
  ta.innerHTML = raw;
  return ta.value;
};

const inlineCache = new WeakMap<HTMLElement, FigureRender>();

const mountInline = (el: HTMLElement, theme: FigureTheme): void => {
  let render = inlineCache.get(el);
  if (!render) {
    const script = el.querySelector('script[type="application/x-d3-inline"]');
    const code = decodeEntities(script?.textContent ?? "").trim();
    if (!code) return;
    try {
      // Throwaway escape hatch: the body runs with the FigureContext fields in
      // scope. Needs `unsafe-eval` CSP (fine for this static/local site). For
      // anything beyond a few lines, graduate to a typed figures/<name>.ts.
      // eslint-disable-next-line @typescript-eslint/no-implied-eval, sonarjs/code-eval -- intentional: executes author-written figure code (build/render-time, trusted)
      const factory = new Function("ctx", `"use strict";\nconst { d3, el, theme, width, height, params } = ctx;\n${code}`);
      // Propagate the body's return value so inline figures can `return () => …`
      // a teardown (e.g. simulation.stop()) just like sidecar figures.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, sonarjs/code-eval -- calling the author's compiled figure factory
      render = (ctx) => factory(ctx) as void | (() => void);
    } catch (error) {
      console.error("[d3] inline figure compile error", error);
      el.dataset.d3Error = "compile";
      return;
    }
    inlineCache.set(el, render);
  }
  runRender(render, el, theme);
};

/**
 * Wire a figure registry to the page. Called by the generated bundle entry.
 * Idempotent across theme toggles and resizes — re-renders all figures.
 */
export const bootstrap = (registry: FigureRegistry): void => {
  const mountAll = (): void => {
    const theme = readTheme();
    for (const el of document
      .querySelectorAll<HTMLElement>("[data-d3]:not([data-d3-inline])")) mountSidecar(registry, el, theme);
    for (const el of document
      .querySelectorAll<HTMLElement>("[data-d3-inline]")) mountInline(el, theme);
  };

  const run = (): void => {
    mountAll();

    // The theme carrier lives on <html>; re-mount figures when it flips.
    let rafId = 0;
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(mountAll);
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    let resizeTimer = 0;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(mountAll, 150);
    });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }
};

export * as d3 from "d3";