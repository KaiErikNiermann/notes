/**
 * style.ts — per-block visual style (alignment / width / column widths) declared
 * in frontmatter as `\meta{style:<id>}{align=center width=70 cols=30,40,30}` and
 * applied by the renderer to the block whose `data-style-id` matches `<id>`.
 *
 * The dev-only styling UI (server.ts DEV_SCRIPT + /__dev/style) writes these
 * metas; nothing here touches body markup. Ids: figures use their artifact key,
 * tables a content hash (see `stableHash`). The grammar uses bare numbers (no
 * "%", which would start a forester comment).
 */
import type { FrMeta } from "./ast";

export type Align = "left" | "center" | "right";

export interface StyleSpec {
  readonly align?: Align | undefined;
  /** Block width as a percentage of the text column. */
  readonly width?: number | undefined;
  /** Per-column widths in px (tables only); Notion-grow → table width = their sum. */
  readonly cols?: readonly number[] | undefined;
}

const STYLE_PREFIX = "style:";
const ALIGNS: ReadonlySet<string> = new Set(["left", "center", "right"]);

/** Parse a `style` meta value, e.g. "align=center width=70 cols=30,40,30". */
export const parseStyle = (value: string): StyleSpec => {
  const spec: { align?: Align; width?: number; cols?: number[] } = {};
  for (const tok of value.trim().split(/\s+/).filter(Boolean)) {
    const eq = tok.indexOf("=");
    if (eq === -1) continue;
    const key = tok.slice(0, eq);
    const val = tok.slice(eq + 1);
    switch (key) {
    case "align": {
      if (ALIGNS.has(val)) spec.align = val as Align;
    
    break;
    }
    case "width": {
      const n = Number(val);
      if (Number.isFinite(n) && n > 0) spec.width = n;
    
    break;
    }
    case "cols": {
      const cols = val.split(",").map(Number).filter((n) => Number.isFinite(n) && n > 0);
      if (cols.length > 0) spec.cols = cols;
    
    break;
    }
    // No default
    }
  }
  return spec;
};

/** Serialize a StyleSpec back to the meta-value grammar (for `data-style`). */
export const serializeStyle = (s: StyleSpec): string =>
  [
    s.align ? `align=${s.align}` : "",
    s.width === undefined ? "" : `width=${s.width}`,
    s.cols && s.cols.length > 0 ? `cols=${s.cols.join(",")}` : "",
  ].filter(Boolean).join(" ");

/** Collect `style:<id>` metas off a tree's frontmatter into an id → StyleSpec map. */
export const collectStyles = (metas: readonly FrMeta[]): Map<string, StyleSpec> => {
  const out = new Map<string, StyleSpec>();
  for (const m of metas) {
    if (m.name.startsWith(STYLE_PREFIX)) out.set(m.name.slice(STYLE_PREFIX.length), parseStyle(m.value));
  }
  return out;
};

/** FNV-1a (32-bit) → base36; deterministic, dependency-free, stable per input. */
export const stableHash = (input: string): string => {
  let h = 0x81_1C_9D_C5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01_00_01_93);
  }
  return (h >>> 0).toString(36);
};
