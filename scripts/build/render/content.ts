/**
 * content.ts — generic inline/block content rendering (ports core.xsl, links.xsl
 * and the fr:ref / fr:footnote / fr:resource rules from tree.xsl).
 *
 * `renderContent` walks a content list and dispatches per node with ts-pattern,
 * returning hast. `html:*` passes through with its prefix stripped; the bespoke
 * `fr:*` nodes get their hand-written rules. Section trees in the list delegate
 * to `renderSection` (render.ts) — a runtime-only cycle, safe under ESM.
 *
 * `link` threads the enclosing `fr:link`: every text DESCENDANT of a link is
 * wrapped in its own `<a>` (matches the `text()[ancestor::f:link]` template),
 * so links containing `<em>`/markup still anchor their text at any depth.
 */
import { h } from "hastscript";
import type { Element, ElementContent } from "hast";
import type { Content, Html, Link, Ref, Resource } from "./ast";
import type { RenderContext } from "./context";
import { extOf, extToLang } from "./artifacts";
import { serializeStyle, stableHash, type Align } from "./style";
import { validateFlags, type FlagField } from "./sig";
import { contextualNumber, NBSP, taxonWithNumber } from "./numbering";
import { renderSection } from "./render";

interface LinkCtx { readonly href: string; readonly title: string; }

const text = (value: string): ElementContent => ({ type: "text", value });
const anchor = (link: LinkCtx, value: string): Element => h("a", { href: link.href, title: link.title }, [text(value)]);

/** XSLT `value-of` equivalent — the concatenated text of all descendants. */
const nodeText = (n: Content): string => {
  switch (n.type) {
    case "text":
    case "tex":
    case "source-path": {
      return n.value;
    }
    case "link":
    case "html":
    case "fr-simple":
    case "fr-note":
    case "footnote":
    case "unknown": {
      return deepText(n.children);
    }
    case "comment": {
      return deepText(n.anchored);
    }
    case "resource": {
      return deepText(n.content);
    }
    default: {
      return "";
    }
  }
};

export const deepText = (nodes: readonly Content[]): string => nodes.map(nodeText).join("");

export const renderContent = (
  nodes: readonly Content[],
  ctx: RenderContext,
  link?: LinkCtx,
): ElementContent[] => nodes.flatMap((n) => renderNode(n, ctx, link));

// Hot path (one call per content node): a discriminant switch is markedly
// faster than ts-pattern's runtime matcher, with identical behaviour. TS still
// enforces exhaustiveness via the non-nullable return type.
const renderNode = (node: Content, ctx: RenderContext, link?: LinkCtx): ElementContent[] => {
  switch (node.type) {
    case "text": {
      return [link ? anchor(link, node.value) : text(node.value)];
    }
    case "tex": {
      return [text(node.display === "block" ? String.raw`\[${node.value}\]` : String.raw`\(${node.value}\)`)];
    }
    case "html": {
      return [renderHtml(node, ctx, link)];
    }
    case "fr-simple": {
      return [h(node.tag, renderContent(node.children, ctx, link))];
    }
    case "fr-img": {
      return [h("img", { src: node.src })];
    }
    case "fr-note": {
      return [h("span", { class: node.kind === "error" ? "error" : "info" }, renderContent(node.children, ctx, link))];
    }
    case "link": {
      return [renderLink(node, ctx)];
    }
    case "ref": {
      return [renderRef(node, ctx)];
    }
    case "contextual-number": {
      return [text(renderContextual(node, ctx))];
    }
    case "footnote": {
      return [renderFootnote(node, ctx)];
    }
    case "comment": {
      return [renderComment(node, ctx)];
    }
    case "resource": {
      return renderResource(node, ctx);
    }
    case "source-path": {
      return [renderSourcePath(node.value)];
    }
    case "tree": {
      return renderSection(node, ctx);
    }
    case "unknown": {
      return [h("span", { style: "background-color:red" }, [text(`[${node.name}]`), ...renderContent(node.children, ctx)])];
    }
  }
};

// --- artifact embeds (\embed → figure.artifact-embed) -----------------------
// Inline an attachment's CONTENT. Images render here directly; text (code/raw)
// emits a placeholder filled by the inline-assets build stage (the renderer is
// pure and can't read asset files). See artifacts.ts for extOf/extToLang.

interface EmbedOpts { readonly mode: string; readonly width?: string | undefined; readonly align?: Align | undefined; }

// Fallback `\embed` opts schema, used when no `%! sig` is threaded in (the pure
// `render.test.ts` callers). The real build passes the schema parsed from the
// `\embed` `%! sig` (sig.test.ts asserts this default matches it). The renderer's
// dispatch (mode branches, figureAlignStyle) intrinsically knows these values; the
// schema's job is to drive the build warning + the editor.
const DEFAULT_EMBED_FLAGS: readonly FlagField[] = [
  { name: "mode", optional: false, kind: { tag: "enum", values: ["image", "code", "raw"] } },
  { name: "width", optional: true, kind: { tag: "number" } },
  { name: "align", optional: true, kind: { tag: "enum", values: ["left", "center", "right"] } },
];

const isAlign = (s: string | undefined): s is Align => s === "left" || s === "center" || s === "right";

const parseEmbedOpts = (
  opts: string,
  flags: readonly FlagField[],
): { value: EmbedOpts; diagnostics: ReturnType<typeof validateFlags>["diagnostics"] } => {
  const { value, diagnostics } = validateFlags(flags, opts, String.raw`\embed`);
  const align = value["align"];
  return { value: { mode: value["mode"] ?? "image", width: value["width"], align: isAlign(align) ? align : undefined }, diagnostics };
};

const figureAlignStyle = (align?: Align): string | undefined => {
  switch (align) {
    case "left": { return "margin-right:auto;margin-left:0;";
    }
    case "right": { return "margin-left:auto;margin-right:0;";
    }
    case "center": { return "margin-inline:auto;";
    }
    default: { return undefined;
    }
  }
};

const errorMarker = (msg: string): Element =>
  h("span", { class: "error", style: "background-color:red" }, [text(msg)]);

const figcaptionChildren = (n: Html): readonly Content[] => {
  const cap = n.children.find((c): c is Html => c.type === "html" && c.tag === "figcaption");
  return cap ? cap.children : [];
};

// eslint-disable-next-line sonarjs/cognitive-complexity -- coherent dispatch over embed mode/width/align variants
const renderArtifactEmbed = (n: Html, ctx: RenderContext): Element => {
  const { value: { mode, width, align }, diagnostics } = parseEmbedOpts(n.attrs["data-opts"] ?? "", ctx.embedFlags ?? DEFAULT_EMBED_FLAGS);
  for (const d of diagnostics) ctx.onSigDiagnostic?.(d);
  const target = n.attrs["data-embed"] ?? "";

  // Resolve the target to a URL + extension (+ provenance for local artifacts).
  let url: string;
  let ext: string;
  let source: readonly Content[] = [];
  let styleId: string;
  const local = target.startsWith(ARTIFACT_HREF);
  if (local) {
    const key = target.slice(ARTIFACT_HREF.length);
    const a = ctx.index.artifactByKey(ctx.currentTree, key);
    if (!a) return errorMarker(`[embed?:${key}]`);
    url = a.downloadUrl;
    ext = extOf(a.filename) || extOf(url);
    source = a.source;
    styleId = key;
  } else if (target) {
    url = target;
    ext = extOf(target);
    styleId = `ext-${stableHash(target)}`;
  } else {
    return errorMarker("[embed: no target]");
  }

  // Caption = the figcaption body, plus the provenance citation when sourced.
  const caption: ElementContent[] = [
    ...renderContent(figcaptionChildren(n), ctx),
    ...(source.length > 0 ? [h("span", { class: "embed-source" }, renderContent(source, ctx))] : []),
  ];
  const figcaption = caption.length > 0 ? [h("figcaption", caption)] : [];

  if (mode === "image") {
    // Frontmatter style (the dev UI) overrides the inline \embed flags. A
    // bare-number width is a percentage (authors can't write "%" in .tree source
    // — it starts a comment); explicit units (px/em/vw) pass through inline-only.
    const override = ctx.index.styleFor(ctx.currentTree, styleId);
    const inlineWidthNum = width && /^\d+(\.\d+)?$/.test(width) ? Number(width) : undefined;
    const effAlign = override?.align ?? align;            // undefined → CSS default (centered)
    const effWidth = override?.width ?? inlineWidthNum;   // number (percent) | undefined
    const cssWidth = effWidth === undefined ? (width && override?.width === undefined ? width : undefined) : `${effWidth}%`;
    const dataStyle = serializeStyle({ align: effAlign, width: effWidth });
    // Width AND alignment both apply to the <img> (the figure spans the column,
    // so a margin on it can't move the image) — this is what actually positions
    // the image left / center / right within the figure.
    const imgCss = `${cssWidth ? `width:${cssWidth};` : ""}${effAlign ? figureAlignStyle(effAlign) ?? "" : ""}`;
    return h("figure", {
      class: "embed embed-image",
      "data-style-id": styleId,
      ...(dataStyle ? { "data-style": dataStyle } : {}),
    }, [
      h("img", { src: url, loading: "lazy", ...style(imgCss || undefined) }),
      ...figcaption,
    ]);
  }

  // code | raw — needs a readable local asset; the inline-assets stage fills it.
  if (!local) return errorMarker(`[embed ${mode}: needs a local #artifact: target]`);
  return h("figure", {
    class: "embed embed-text embed-pending",
    "data-embed-url": url,
    "data-embed-mode": mode,
    "data-embed-lang": extToLang(ext),
  }, figcaption);
};

const style = (value: string | undefined): Record<string, string> => (value ? { style: value } : {});

// --- styled tables (\table → table.data-table) ------------------------------
// A content-hashed id keys the table's `\meta{style:<id>}` (align/width/cols).
// Default: centered, content-width (set in CSS). cols → a <colgroup> + Notion-grow.

const htmlChildren = (n: Html): Html[] => n.children.filter((c): c is Html => c.type === "html");
const cellsOf = (row: Html): Html[] => htmlChildren(row).filter((c) => c.tag === "th" || c.tag === "td");
const rowsOf = (table: Html): Html[] =>
  htmlChildren(table).flatMap((c) =>
    c.tag === "tr" ? [c] : ((c.tag === "thead" || c.tag === "tbody") ? htmlChildren(c).filter((x) => x.tag === "tr") : []),
  );

const renderStyledTable = (n: Html, ctx: RenderContext): Element => {
  const rows = rowsOf(n);
  const header = rows[0] ? cellsOf(rows[0]) : [];
  const colCount = rows.reduce((m, r) => Math.max(m, cellsOf(r).length), 0);
  const id = `tbl-${stableHash(`${header.map((c) => deepText(c.children)).join("|")}#${colCount}x${rows.length}`)}`;

  const sp = ctx.index.styleFor(ctx.currentTree, id);
  const decls: string[] = [];
  if (sp?.align) decls.push(figureAlignStyle(sp.align) ?? "");
  if (sp?.cols && sp.cols.length > 0) {
    decls.push("table-layout:fixed;", `width:${sp.cols.reduce((a, b) => a + b, 0)}px;`);
  } else if (sp?.width !== undefined) {
    decls.push(`width:${sp.width}%;`);
  }
  const styleAttr = decls.filter(Boolean).join("");

  const colgroup: ElementContent[] = sp?.cols && sp.cols.length > 0
    ? [h("colgroup", sp.cols.map((w) => h("col", { style: `width:${w}px;` })))]
    : [];
  const dataStyle = sp ? serializeStyle(sp) : "";

  return h("table", {
    ...n.attrs,
    "data-style-id": id,
    ...(dataStyle ? { "data-style": dataStyle } : {}),
    ...style(styleAttr || undefined),
  }, [...colgroup, ...renderContent(n.children, ctx)]);
};

const renderHtml = (n: Html, ctx: RenderContext, link?: LinkCtx): Element => {
  if (n.ns === "html" && n.tag === "figure" && /(^|\s)artifact-embed(\s|$)/.test(n.attrs["class"] ?? "")) {
    return renderArtifactEmbed(n, ctx);
  }
  if (n.ns === "html" && n.tag === "table" && /(^|\s)data-table(\s|$)/.test(n.attrs["class"] ?? "")) {
    return renderStyledTable(n, ctx);
  }
  // html:pre renders only its element children (drops inter-tag whitespace).
  const kids = n.ns === "html" && n.tag === "pre"
    ? n.children.filter((c) => c.type !== "text")
    : n.children;
  return h(n.tag, n.attrs, renderContent(kids, ctx, link));
};

const ARTIFACT_HREF = "#artifact:";

/**
 * `\link{#artifact:<key>}{label}` → a numbered citation-style marker that jumps to
 * the artifact's row, mirroring footnote refs. The author's link label is ignored
 * (the marker is the artifact's sequence number). The marker emits its own `<a>`,
 * so it is unaffected by the surrounding link-text-wrapping path. Unknown keys
 * degrade to a visible marker, like the Unknown node.
 */
const renderArtifactRef = (key: string, ctx: RenderContext): Element => {
  const a = ctx.index.artifactByKey(ctx.currentTree, key);
  if (!a) return h("span", { class: "error", style: "background-color:red" }, [text(`[artifact?:${key}]`)]);
  const id = ctx.index.artifactId(a);
  const seq = ctx.index.artifactSeq(a);
  return h("sup", { class: "artifact-ref", id: `aref-${id}` }, [
    h("a", { href: `#${id}`, role: "doc-noteref", "aria-label": `Attachment ${seq}` }, [text(String(seq))]),
  ]);
};

const renderLink = (n: Link, ctx: RenderContext): Element => {
  if (n.href?.startsWith(ARTIFACT_HREF)) return renderArtifactRef(n.href.slice(ARTIFACT_HREF.length), ctx);
  const link: LinkCtx = {
    href: n.href ?? "",
    title: n.displayUri ? `${n.title ?? ""} [${n.displayUri}]` : (n.title ?? ""),
  };
  return h("span", { class: `link ${n.linkType ?? ""}`.trimEnd() }, renderContent(n.children, ctx, link));
};

const renderRef = (n: Ref, ctx: RenderContext): Element => {
  const fallbackNumber = `[${n.uri ?? ""}]`;
  const taxon = n.taxon ?? "§";
  const target = n.uri ? ctx.index.uriToTree.get(n.uri) : undefined;
  const href = target ? `#${ctx.index.idOf(target)}` : (n.href ?? "");
  const inner = target
    ? taxonWithNumber(target, ctx.index, {
        inBackmatter: ctx.inBackmatter,
        number: n.number ?? "",
        fallbackNumber,
        taxon,
      })
    : `${taxon}${NBSP}${n.number === undefined ? fallbackNumber : n.number}`;
  return h("a", { class: "link local", href }, [text(inner)]);
};

const renderContextual = (n: { uri?: string | undefined; displayUri?: string | undefined }, ctx: RenderContext): string => {
  const fallbackNumber = `[${n.displayUri ?? ""}]`;
  const target = n.uri ? ctx.index.uriToTree.get(n.uri) : undefined;
  return target
    ? contextualNumber(target, ctx.index, { inBackmatter: ctx.inBackmatter, fallbackNumber })
    : fallbackNumber;
};

const renderFootnote = (n: Extract<Content, { type: "footnote" }>, ctx: RenderContext): Element => {
  const id = ctx.index.idOf(n);
  const seq = ctx.index.footnoteSeq(n);
  return h("span", { class: "footnote" }, [
    h("sup", { class: "footnote-ref", id: `fnref-${id}` }, [
      h("a", { href: `#fn-${id}`, role: "doc-noteref", "aria-describedby": `fn-preview-${id}` }, [text(String(seq))]),
    ]),
    h("span", { class: "footnote-preview", id: `fn-preview-${id}`, role: "tooltip" }, renderContent(n.children, ctx)),
  ]);
};

/**
 * `\comment{anchored}{note}` → just the underlined anchored phrase inline; the
 * note is collected per-tree into the comments aside (render.ts) and lifted into
 * the right margin by margin-comments.ts. The id ties the anchor to its card.
 */
const renderComment = (n: Extract<Content, { type: "comment" }>, ctx: RenderContext): Element => {
  const id = ctx.index.commentId(n);
  return h("span", {
    class: "comment-anchor",
    id: `cmt-anchor-${id}`,
    "data-comment": id,
    tabindex: "0",
    role: "button",
    "aria-describedby": `cmt-${id}`,
  }, renderContent(n.anchored, ctx));
};

const renderResource = (n: Resource, ctx: RenderContext): ElementContent[] => {
  if (!n.isLatex) return renderContent(n.content, ctx);
  // LaTeX-sourced resource: its <img> gains a `tex-diagram` class.
  const tagged = n.content.map((c): Content =>
    c.type === "html" && c.tag === "img"
      ? { ...c, attrs: { ...c.attrs, class: [...(c.attrs["class"]?.split(/\s+/).filter(Boolean) ?? []), "tex-diagram"].join(" ") } }
      : c,
  );
  return renderContent(tagged, ctx);
};

const VSCODE_REMOTE =
  "vscode://vscode-remote/dev-container+2f776f726b7370616365732f756e692f72616e646f6d2f6e6f746573";

export const renderSourcePath = (value: string): Element =>
  h("a", { class: "edit-button", href: `${VSCODE_REMOTE}${value}` }, [text("[edit]")]);
