/**
 * icons.ts — the single source of inline SVG icons for the rendered chrome.
 *
 * Every glyph on the page is a minimalist single-color line icon from lucide.dev
 * (stroke="currentColor"), so the whole UI shares one monochrome family that
 * tracks the surrounding text/muted color (the gray/blue forester scheme) — page
 * chrome (sun / share / eye), and the attachment file-tree (file / image / code /
 * doc / folder / download). Literals are parsed once via `hast-util-from-html` so
 * foreign-content attribute casing (e.g. `viewBox`) is preserved.
 *
 * Icon element objects are module constants reused across a page (a page can hold
 * many image rows, many share buttons); hast serialization only ever reads them,
 * so sharing one node in several places is safe — same pattern as the prior
 * SUN/SHARE constants.
 */
import { fromHtml } from "hast-util-from-html";
import type { Element } from "hast";
import { extOf, isImageExt, extToLang } from "./artifacts";

/** Parse a single inline SVG literal into a hast element. */
export const svg = (markup: string): Element => {
  const node = fromHtml(markup, { fragment: true }).children.find((c) => c.type === "element");
  if (!node || node.type !== "element") throw new Error("icons: failed to parse SVG literal");
  return node;
};

// A lucide line icon at `size` px from its inner-path markup. `extra` adds a class.
const lucide = (size: number, inner: string, extra = ""): Element =>
  svg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" ` +
      `fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ` +
      `class="lucide${extra ? ` ${extra}` : ""}">${inner}</svg>`,
  );

// --- page chrome (18px, matches the existing sun toggle) --------------------
export const SUN_ICON = lucide(
  18,
  '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/>' +
    '<path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/>' +
    '<path d="m19.07 4.93-1.41 1.41"/>',
  "lucide-sun",
);
export const MOON_ICON = lucide(18, '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>', "lucide-moon");
export const SHARE_ICON = lucide(
  14,
  '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>' +
    '<line x1="8.59" x2="15.42" y1="13.51" y2="17.49"/><line x1="15.41" x2="8.59" y1="6.51" y2="10.49"/>',
  "lucide-share-2",
);
export const EYE_ICON = lucide(
  18,
  '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/>' +
    '<circle cx="12" cy="12" r="3"/>',
  "lucide-eye",
);
export const EYE_OFF_ICON = lucide(
  18,
  '<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/>' +
    '<path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/>' +
    '<path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/>' +
    '<path d="m2 2 20 20"/>',
  "lucide-eye-off",
);

// --- attachment file-tree (15px, sits beside row text) ----------------------
const FILE_ICON = lucide(
  15,
  '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
  "lucide-file",
);
const FILE_TEXT_ICON = lucide(
  15,
  '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>' +
    '<path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  "lucide-file-text",
);
const FILE_CODE_ICON = lucide(
  15,
  '<path d="M10 12.5 8 15l2 2.5"/><path d="m14 12.5 2 2.5-2 2.5"/>' +
    '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
  "lucide-file-code",
);
const IMAGE_ICON = lucide(
  15,
  '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/>' +
    '<path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  "lucide-image",
);
const FOLDER_ICON = lucide(
  15,
  '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  "lucide-folder",
);
export const DOWNLOAD_ICON = lucide(
  15,
  '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
  "lucide-download",
);

// Doc-like extensions render as the lined "text" page rather than a code page.
const DOC_EXTS: ReadonlySet<string> = new Set(["pdf", "md", "markdown", "txt", "text", "rst", "org"]);

/** The file-tree icon for an attachment, by extension (image / doc / code / generic). */
export const artifactIcon = (filename: string): Element => {
  const ext = extOf(filename);
  if (isImageExt(ext)) return IMAGE_ICON;
  if (DOC_EXTS.has(ext)) return FILE_TEXT_ICON;
  if (extToLang(ext) !== "plaintext") return FILE_CODE_ICON; // any highlightable source
  return FILE_ICON;
};

/** The folder glyph for a non-leaf node in the attachment tree. */
export const folderIcon = (): Element => FOLDER_ICON;
