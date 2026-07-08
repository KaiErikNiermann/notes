/**
 * Typed forester AST — the validated, namespace-resolved representation of a
 * compiled `<fr:tree>` XML document. This is the boundary type the renderer
 * pattern-matches over; `parse.ts` maps raw xast into these discriminated
 * unions, failing fast on unexpected structural shapes.
 *
 * Mirrors the vocabulary the XSLT theme handles (theme/*.xsl). `html:*` elements
 * collapse into one generic `Html` node (namespace prefix stripped); the bespoke
 * `fr:*` elements get their own variants; everything the theme deliberately does
 * not render (e.g. fr:uri, unrendered fr:meta names) is dropped during parse.
 */

/** A run of character data (xast `text` and `cdata` both collapse to this). */
export interface Text {
  readonly type: "text";
  readonly value: string;
}

/** `<fr:tex display="inline|block">` — LaTeX, rendered to KaTeX delimiters. */
export interface Tex {
  readonly type: "tex";
  readonly display: "block" | "inline";
  readonly value: string;
}

/** `<fr:link>` — intra-forest / external hyperlink wrapper. */
export interface Link {
  readonly type: "link";
  readonly href?: string | undefined;
  readonly title?: string | undefined;
  readonly displayUri?: string | undefined;
  readonly linkType?: string | undefined;
  readonly children: readonly Content[];
}

/** `<fr:ref>` — typed cross-reference (resolves to on-page anchor or external). */
export interface Ref {
  readonly type: "ref";
  readonly uri?: string | undefined;
  readonly href?: string | undefined;
  readonly taxon?: string | undefined;
  readonly number?: string | undefined;
}

/** `<fr:contextual-number uri display-uri>` — bare resolved number of a ref. */
export interface ContextualNumber {
  readonly type: "contextual-number";
  readonly uri?: string | undefined;
  readonly displayUri?: string | undefined;
}

/** `<fr:footnote>` — inline marker; collected into per-tree endnotes. */
export interface Footnote {
  readonly type: "footnote";
  readonly children: readonly Content[];
}

/**
 * `\comment{anchored}{note}` (a `span.comment` wrapper) — a margin aside. The
 * `anchored` phrase renders underlined inline; the `note` is collected per-tree
 * into a `<aside class="comments">` and lifted into the right margin by JS.
 */
export interface Comment {
  readonly type: "comment";
  readonly anchored: readonly Content[];
  readonly note: readonly Content[];
}

/** `<fr:resource>` wrapping a `<fr:resource-content>` (LaTeX → rendered img). */
export interface Resource {
  readonly type: "resource";
  /** true when the resource has a `<fr:resource-source type="latex">`. */
  readonly isLatex: boolean;
  readonly content: readonly Content[];
}

/** `<fr:source-path>` — path to the source `.tree`, rendered as an edit link. */
export interface SourcePath {
  readonly type: "source-path";
  readonly value: string;
}

/** Generic `html:*` (and `mml:*`) passthrough — prefix stripped to `tag`. */
export interface Html {
  readonly type: "html";
  /** Local name, e.g. "p", "div", "table". */
  readonly tag: string;
  readonly attrs: Readonly<Record<string, string>>;
  readonly children: readonly Content[];
  /** Namespace for serialization: "html" (xhtml) or "mml" (MathML). */
  readonly ns: "html" | "mml";
}

/** Forester content element that maps 1:1 to an HTML tag (core.xsl). */
export type SimpleTag =
  | "p" | "code" | "pre" | "em" | "strong"
  | "ol" | "ul" | "li" | "blockquote"
  | "figure" | "figcaption";

export interface FrSimple {
  readonly type: "fr-simple";
  readonly tag: SimpleTag;
  readonly children: readonly Content[];
}

/** `<fr:img src>` — self-closing image. */
export interface FrImg {
  readonly type: "fr-img";
  readonly src: string;
}

/** `<fr:error>` / `<fr:info>` — diagnostic spans (e.g. transclusion loops). */
export interface FrNote {
  readonly type: "fr-note";
  readonly kind: "error" | "info";
  readonly children: readonly Content[];
}

/**
 * An element that reached a content-rendering position with no matching theme
 * rule. Reproduces XSLT's catch-all red `[name]` debugging marker.
 */
export interface Unknown {
  readonly type: "unknown";
  readonly name: string;
  readonly children: readonly Content[];
}

/** Any node that can appear in mainmatter/backmatter or inline content. */
export type Content =
  | Text
  | Tex
  | Link
  | Ref
  | ContextualNumber
  | Footnote
  | Comment
  | Resource
  | SourcePath
  | Html
  | FrSimple
  | FrImg
  | FrNote
  | FrTree
  | Unknown;

/** `<fr:date>` broken into parts (+ optional link). */
export interface FrDate {
  readonly year?: string | undefined;
  readonly month?: string | undefined;
  readonly day?: string | undefined;
  readonly href?: string | undefined;
}

/** A rendered `<fr:meta name="...">` entry (only theme-rendered names survive). */
export interface FrMeta {
  readonly name: string;
  readonly children: readonly Content[];
  /** Flattened text value (for href/value templates like doi/orcid/external). */
  readonly value: string;
}

export interface Frontmatter {
  /** Plain-text title from `@text` (used for <head><title>). */
  readonly titleText?: string | undefined;
  /** Rendered title children (text + inline tex etc.). */
  readonly title: readonly Content[];
  readonly taxon?: string | undefined;
  readonly uri?: string | undefined;
  readonly route?: string | undefined;
  readonly displayUri?: string | undefined;
  readonly number?: string | undefined;
  readonly date?: FrDate | undefined;
  /** Each author's inline content. */
  readonly authors: readonly (readonly Content[])[];
  readonly contributors: readonly (readonly Content[])[];
  readonly metas: readonly FrMeta[];
  readonly sourcePath?: string | undefined;
}

export interface FrTree {
  readonly type: "tree";
  readonly attrs: Readonly<Record<string, string>>;
  readonly frontmatter: Frontmatter;
  /** Mainmatter content — a mix of inline content and nested section trees. */
  readonly mainmatter: readonly Content[];
  /** Backmatter content (References/Context/Backlinks/Related section trees). */
  readonly backmatter: readonly Content[];
}

/** Attribute helpers (XSLT treats missing and any value distinctly). */
export const attr = (t: FrTree, name: string): string | undefined => t.attrs[name];
export const attrIs = (t: FrTree, name: string, value: string): boolean => t.attrs[name] === value;
