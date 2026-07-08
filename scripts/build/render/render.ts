/**
 * render.ts — ports tree.xsl: the page shell (`/` template), the section
 * template (`f:tree[...]`), the TOC, the per-tree footnotes section, and
 * backmatter handling. Entry point: {@link renderForesterXml}.
 */
import { h } from "hastscript";
import type { Element, ElementContent } from "hast";
import type { Content, FrTree } from "./ast";
import type { Artifact, ArtifactFolder } from "./artifacts";
import { buildArtifactFolders } from "./artifacts";
import { artifactIcon, folderIcon, DOWNLOAD_ICON } from "./icons";
import type { RenderContext } from "./context";
import { buildIndex } from "./index-pass";
import { parseTree } from "./parse";
import { serialize } from "./serialize";
import { deepText, renderContent } from "./content";
import { renderBibtex, renderFrontmatterHeader } from "./metadata";
import { taxonWithNumber } from "./numbering";
import { homeHeader, renderHead, pageControls } from "./shell";
import type { FlagField, SigDiagnostic } from "./sig";

const NBSP = "\u00A0";
const text = (value: string): ElementContent => ({ type: "text", value });

const childTrees = (nodes: readonly Content[]): FrTree[] =>
  nodes.filter((n): n is FrTree => n.type === "tree");

const hasElementChild = (nodes: readonly Content[]): boolean =>
  nodes.some((n) => n.type !== "text");

const metaValue = (tree: FrTree, name: string): string | undefined =>
  tree.frontmatter.metas.find((m) => m.name === name)?.value;

// --- margin comments (\comment) ---------------------------------------------
// The note cards, collected per tree. Without JS this is a readable end-of-tree
// list; margin-comments.ts lifts each card into the right margin beside its
// anchor. Order matches the inline anchors so the JS can pair by data-comment.

const renderCommentsAside = (tree: FrTree, ctx: RenderContext): ElementContent[] => {
  const comments = ctx.index.commentsOf(tree);
  if (comments.length === 0) return [];
  return [
    h("aside", { class: "comments", role: "complementary", "aria-label": "Margin comments" },
      comments.map((c) => {
        const id = ctx.index.commentId(c);
        return h("div", { class: "comment-card", id: `cmt-${id}`, "data-comment": id }, [
          ...renderContent(c.note, ctx),
          h("a", { class: "comment-backref", href: `#cmt-anchor-${id}`, "aria-label": "Back to the commented text" }, [text("↩")]),
        ]);
      }),
    ),
  ];
};

// --- footnotes section (render-footnotes) -----------------------------------

const renderFootnotesSection = (tree: FrTree, ctx: RenderContext): ElementContent[] => {
  const notes = ctx.index.footnotesOf(tree);
  if (notes.length === 0) return [];
  return [
    h("section", { class: "footnotes", role: "doc-endnotes", "aria-label": "Footnotes" }, [
      h("hr"),
      h("ol", notes.map((note) => {
        const id = ctx.index.idOf(note);
        return h("li", { id: `fn-${id}` }, [
          ...renderContent(note.children, ctx),
          h("a", { class: "footnote-backref", href: `#fnref-${id}`, "aria-label": "Back to content" }, [text("↩")]),
        ]);
      })),
    ]),
  ];
};

// --- artifacts (per-tree attachments: a subtle expandable file-tree) --------

const renderArtifactLeaf = (a: Artifact, ctx: RenderContext): ElementContent => {
  const id = ctx.index.artifactId(a);
  // Download + backref live in an absolutely-positioned cluster pinned to the row's
  // top line, OUTSIDE any <summary>, so the download link never toggles the note.
  const actions = h("span", { class: "artifact-actions" }, [
    h("a", {
      class: "artifact-download",
      href: a.downloadUrl,
      download: a.filename,
      "aria-label": `Download ${a.filename}`,
    }, [DOWNLOAD_ICON]),
    h("a", { class: "artifact-backref", href: `#aref-${id}`, "aria-label": "Back to reference" }, [text("↩")]),
  ]);

  const icon = h("span", { class: "artifact-icon", "aria-hidden": "true" }, [artifactIcon(a.filename)]);
  const name = h("span", { class: "artifact-name" }, [text(a.filename)]);

  // No note/source → a plain single-line row (icon + name + actions).
  if (a.note.length === 0 && a.source.length === 0) {
    return h("li", { class: "artifact-row", id }, [h("div", { class: "artifact-head" }, [icon, name]), actions]);
  }

  // With a note/source → tap-to-reveal: the head is a <summary>, and the note
  // expands into a blockquote-style region beneath it (its own space, so long
  // filenames and long notes don't fight over one line). Works with no JS.
  const body: ElementContent[] = [...renderContent(a.note, ctx)];
  // Provenance ("from <citation>"): the cite renders as span.citation, so the
  // client numberCitations() unifies it with inline cites + the bottom References.
  if (a.source.length > 0) {
    body.push(h("span", { class: "artifact-source" }, [text("from "), ...renderContent(a.source, ctx)]));
  }
  return h("li", { class: "artifact-row", id }, [
    h("details", { class: "artifact-entry" }, [
      h("summary", { class: "artifact-head" }, [icon, name, h("span", { class: "artifact-note-hint" }, [text("note")])]),
      h("div", { class: "artifact-note-body" }, body),
    ]),
    actions,
  ]);
};

const renderArtifactFolder = (folder: ArtifactFolder, ctx: RenderContext, isRoot: boolean): ElementContent[] => {
  const children: ElementContent[] = [
    ...folder.folders.map((sub) =>
      h("li", { class: "artifact-folder" }, [
        h("details", { class: "artifact-folder-group", open: true }, [
          h("summary", { class: "artifact-folder-head" }, [h("span", { class: "artifact-icon", "aria-hidden": "true" }, [folderIcon()]), h("span", { class: "artifact-folder-name" }, [text(sub.name)])]),
          ...renderArtifactFolder(sub, ctx, false),
        ]),
      ]),
    ),
    ...folder.leaves.map((leaf) => renderArtifactLeaf(leaf, ctx)),
  ];
  return [h("ul", { class: isRoot ? "artifact-tree" : "artifact-subtree" }, children)];
};

const renderArtifactsSection = (tree: FrTree, ctx: RenderContext): ElementContent[] => {
  const arts = ctx.index.artifactsOf(tree);
  if (arts.length === 0) return [];
  return [
    h("details", { class: "artifacts", role: "doc-appendix", "aria-label": "Attachments" }, [
      h("summary", { class: "artifacts-summary" }, [text(`Attachments (${arts.length})`)]),
      ...renderArtifactFolder(buildArtifactFolders(arts), ctx, true),
    ]),
  ];
};

// --- backmatter (footer only for the top-level, non-root tree) --------------

const renderBackmatter = (tree: FrTree, ctx: RenderContext): ElementContent[] => {
  if (!ctx.index.isRoot(tree) || tree.attrs["root"] === "true") return [];
  const back: RenderContext = { ...ctx, inBackmatter: true };
  return [h("footer", renderContent(tree.backmatter, back))];
};

// --- section (f:tree) -------------------------------------------------------

export const renderSection = (tree: FrTree, ctxIn: RenderContext): ElementContent[] => {
  // empty + hidden-when-empty → suppressed entirely (incl. backmatter)
  if (!hasElementChild(tree.mainmatter) && tree.attrs["hidden-when-empty"] === "true") return [];

  // Rebind the owning tree so inline artifact-refs in this tree's content resolve
  // against this tree's artifact index (mirrors how footnotes are per-tree).
  const ctx: RenderContext = { ...ctxIn, currentTree: tree };

  const lang = metaValue(tree, "lang") ?? "en";
  const cls = tree.attrs["show-metadata"] === "false" ? "block hide-metadata" : "block";
  const sectionProps: Record<string, string> = { lang, class: cls };
  if (tree.frontmatter.taxon) sectionProps["data-taxon"] = tree.frontmatter.taxon;

  const body: ElementContent[] =
    tree.attrs["show-heading"] === "false"
      ? [
          ...renderContent(tree.mainmatter, ctx),
          ...renderFootnotesSection(tree, ctx),
          ...renderArtifactsSection(tree, ctx),
          ...renderCommentsAside(tree, ctx),
        ]
      : [
          h(
            "details",
            { id: ctx.index.idOf(tree), ...(tree.attrs["expanded"] === "false" ? {} : { open: true }) },
            [
              h("summary", [renderFrontmatterHeader(tree, ctx)]),
              ...renderContent(tree.mainmatter, ctx),
              ...renderFootnotesSection(tree, ctx),
              ...renderArtifactsSection(tree, ctx),
              ...renderCommentsAside(tree, ctx),
              ...renderBibtex(tree.frontmatter),
            ],
          ),
        ];

  return [h("section", sectionProps, body), ...renderBackmatter(tree, ctx)];
};

// --- table of contents ------------------------------------------------------

const tocMainmatter = (nodes: readonly Content[], ctx: RenderContext): Element =>
  h("ul", { class: "block" }, childTrees(nodes).filter((t) => t.attrs["toc"] !== "false").map((t) => tocTree(t, ctx)));

const tocTree = (tree: FrTree, ctx: RenderContext): Element => {
  const fm = tree.frontmatter;
  const id = ctx.index.idOf(tree);
  const titleString = deepText(fm.title);

  const bullet =
    fm.displayUri !== undefined && fm.route
      ? h("a", { class: "bullet", href: fm.route, title: `${fm.titleText ?? ""}${NBSP}[${fm.displayUri}]` }, [text("■")])
      : h("a", { class: "bullet", href: `#${id}`, title: titleString }, [text("■")]);

  return h("li", [
    bullet,
    h("span", { class: "link local", "data-target": `#${id}` }, [
      h("span", { class: "taxon" }, [text(taxonWithNumber(tree, ctx.index, { suffix: `.${NBSP}` }))]),
      ...renderContent(fm.title, ctx),
    ]),
    tocMainmatter(tree.mainmatter, ctx),
  ]);
};

const showToc = (root: FrTree): boolean =>
  childTrees(root.mainmatter).some((t) => t.attrs["toc"] !== "false") && metaValue(root, "toc") !== "false";

// --- page shell -------------------------------------------------------------

const renderPage = (root: FrTree, ctx: RenderContext): Element => {
  const grid: ElementContent[] = [h("article", renderSection(root, ctx))];
  if (showToc(root)) {
    grid.push(
      h("nav", { id: "toc" }, [
        h("div", { class: "block" }, [h("h1", [text("Table of Contents")]), tocMainmatter(root.mainmatter, ctx)]),
      ]),
    );
  }

  const body: ElementContent[] = [
    h("ninja-keys", { placeholder: "Start typing a note title or ID" }),
    pageControls(),
  ];
  if (root.attrs["root"] !== "true") body.push(homeHeader(ctx.baseUrl));
  body.push(h("div", { id: "grid-wrapper" }, grid));

  return h("html", { xmlns: "http://www.w3.org/1999/xhtml", "data-base-url": ctx.baseUrl }, [
    renderHead(ctx.baseUrl, root.frontmatter.titleText ?? "", root.frontmatter.sourcePath),
    h("body", body),
  ]);
};

/** Build-threaded construct-signature inputs (optional; sig-less callers pass none). */
export interface RenderOptions {
  /** `\embed` opts flag schema parsed from the construct `%! sig`. */
  readonly embedFlags?: readonly FlagField[];
  /** Sink for construct-option validation diagnostics (build-time warnings). */
  readonly onSigDiagnostic?: (d: SigDiagnostic) => void;
}

/** Render a compiled forester XML document to an HTML string. */
export const renderForesterXml = (xml: string, opts: RenderOptions = {}): string => {
  const root = parseTree(xml);
  const index = buildIndex(root);
  const ctx: RenderContext = {
    baseUrl: root.attrs["base-url"] ?? "/",
    index,
    inBackmatter: false,
    currentTree: root,
    ...(opts.embedFlags ? { embedFlags: opts.embedFlags } : {}),
    ...(opts.onSigDiagnostic ? { onSigDiagnostic: opts.onSigDiagnostic } : {}),
  };
  return serialize(renderPage(root, ctx));
};
