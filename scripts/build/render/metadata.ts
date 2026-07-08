/**
 * metadata.ts — ports metadata.xsl + the `f:frontmatter` header from tree.xsl:
 * the `<header>` (taxon-numbered `<h1>` with title / slug / graph + edit buttons)
 * and the `.metadata` list (date, authors, and the rendered `f:meta` entries).
 */
import { h } from "hastscript";
import type { Element, ElementContent } from "hast";
import type { FrMeta, FrTree, Frontmatter } from "./ast";
import type { RenderContext } from "./context";
import { renderContent, renderSourcePath } from "./content";
import { taxonWithNumber } from "./numbering";
import { shareButton } from "./shell";

const NBSP = "\u00A0";
const text = (value: string): ElementContent => ({ type: "text", value });
const space = (): ElementContent => text(" ");

const MONTHS: Readonly<Record<string, string>> = {
  "1": "January", "2": "February", "3": "March", "4": "April",
  "5": "May", "6": "June", "7": "July", "8": "August",
  "9": "September", "10": "October", "11": "November", "12": "December",
};

const metaByName = (fm: Frontmatter, name: string): FrMeta | undefined =>
  fm.metas.find((m) => m.name === name);

// --- date -------------------------------------------------------------------

const dateInner = (date: NonNullable<Frontmatter["date"]>): ElementContent[] => {
  const out: ElementContent[] = [];
  if (date.month) out.push(text(MONTHS[date.month] ?? date.month));
  if (date.day) out.push(text(`${NBSP}${date.day}`));
  if (date.month) out.push(text(`,${NBSP}`));
  if (date.year) out.push(text(date.year));
  return out;
};

const renderDate = (date: Frontmatter["date"]): ElementContent[] => {
  if (!date) return [];
  const inner = dateInner(date);
  return [
    h("li", { class: "meta-item" }, date.href
      ? [h("a", { class: "link local", href: date.href }, inner)]
      : inner),
  ];
};

// --- authors ----------------------------------------------------------------

const join = (items: readonly ElementContent[][], sep: string): ElementContent[] =>
  items.flatMap((item, i) => (i < items.length - 1 ? [...item, text(sep)] : item));

const renderAuthors = (fm: Frontmatter, ctx: RenderContext): ElementContent[] => {
  if (fm.authors.length === 0 && fm.contributors.length === 0) return [];
  const authors = join(fm.authors.map((a) => renderContent(a, ctx)), ", ");
  const inner: ElementContent[] = [...authors];
  if (fm.contributors.length > 0) {
    inner.push(text(" with contributions from "), ...join(fm.contributors.map((c) => renderContent(c, ctx)), ", "));
  }
  return [h("li", { class: "meta-item" }, [h("address", { class: "author" }, inner)])];
};

// --- meta entries -----------------------------------------------------------

const metaItem = (children: ElementContent[]): Element => h("li", { class: "meta-item" }, children);

const renderOneMeta = (name: string, m: FrMeta, ctx: RenderContext): Element => {
  switch (name) {
    case "doi": {
      return metaItem([h("a", { class: "doi link", href: `https://www.doi.org/${m.value}` }, [text(m.value)])]);
    }
    case "orcid": {
      return metaItem([h("a", { class: "orcid", href: `https://orcid.org/${m.value}` }, [text(m.value)])]);
    }
    case "external": {
      return metaItem([h("a", { class: "link external", href: m.value }, [text(m.value)])]);
    }
    case "slides": {
      return metaItem([h("a", { class: "link external", href: m.value }, [text("Slides")])]);
    }
    case "video": {
      return metaItem([h("a", { class: "link external", href: m.value }, [text("Video")])]);
    }
    default: { // venue | position | institution | source
      return metaItem(renderContent(m.children, ctx));
    }
  }
};

// `apply-templates select="f:meta[@name='X']"` matches *all* such metas.
const renderMeta = (fm: Frontmatter, name: string, ctx: RenderContext): ElementContent[] =>
  fm.metas.filter((m) => m.name === name).map((m) => renderOneMeta(name, m, ctx));

/** `f:meta[@name='bibtex']` → `<pre>` (rendered in the section body, not the list). */
export const renderBibtex = (fm: Frontmatter): Element[] => {
  const m = metaByName(fm, "bibtex");
  return m ? [h("pre", [text(m.value)])] : [];
};

// --- header -----------------------------------------------------------------

const slugOrSpace = (fm: Frontmatter): ElementContent[] => {
  if (fm.displayUri === undefined) return [];
  if (fm.route) {
    return [h("a", { class: "slug", href: fm.route }, [text(`[${fm.displayUri}]`)])];
  }
  return [text(" ")];
};

export const renderFrontmatterHeader = (tree: FrTree, ctx: RenderContext): Element => {
  const fm = tree.frontmatter;

  const h1: ElementContent[] = [
    h("span", { class: "taxon" }, [text(taxonWithNumber(tree, ctx.index, { suffix: `.${NBSP}` }))]),
    ...renderContent(fm.title, ctx),
    space(),
    ...slugOrSpace(fm),
  ];
  if (fm.displayUri !== undefined && fm.route) {
    h1.push(space(), shareButton(ctx.baseUrl, fm.displayUri));
  }
  h1.push(space());
  if (fm.sourcePath) h1.push(renderSourcePath(fm.sourcePath));

  const authorsEnabled = metaByName(fm, "author")?.value !== "false";
  const list: ElementContent[] = [
    ...renderDate(fm.date),
    ...(authorsEnabled ? renderAuthors(fm, ctx) : []),
    ...renderMeta(fm, "position", ctx),
    ...renderMeta(fm, "institution", ctx),
    ...renderMeta(fm, "venue", ctx),
    ...renderMeta(fm, "source", ctx),
    ...renderMeta(fm, "doi", ctx),
    ...renderMeta(fm, "orcid", ctx),
    ...renderMeta(fm, "external", ctx),
    ...renderMeta(fm, "slides", ctx),
    ...renderMeta(fm, "video", ctx),
  ];

  return h("header", [
    h("h1", h1),
    h("div", { class: "metadata" }, [h("ul", list)]),
  ]);
};
