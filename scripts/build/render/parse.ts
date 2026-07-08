/**
 * parse.ts — raw forester XML → typed {@link FrTree} (ast.ts).
 *
 * Parses with `saxes` (see buildTree) into a generic element tree, then maps it
 * into the validated forester AST at this single boundary: namespace prefixes
 * resolved,
 * frontmatter fields pulled into a structured record, content children mapped
 * to discriminated-union nodes. Structural surprises fail fast; unexpected
 * *content* elements degrade to an `Unknown` node (rendered as XSLT's red marker).
 */
import { SaxesParser } from "saxes";
import { match } from "ts-pattern";
import type {
  Content,
  FrDate,
  FrMeta,
  FrTree,
  Frontmatter,
  SimpleTag,
} from "./ast";

// --- minimal structural element tree (built from saxes events) --------------

interface XElement {
  readonly type: "element";
  readonly name: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly children: XNode[];
}
interface XText { readonly type: "text"; value: string; }
type XNode = XElement | XText;

const isElement = (n: XNode): n is XElement => n.type === "element";

/** Split a qualified name "fr:tree" → { prefix: "fr", local: "tree" }. */
const qname = (name: string): { prefix: string; local: string } => {
  const i = name.indexOf(":");
  return i === -1 ? { prefix: "", local: name } : { prefix: name.slice(0, i), local: name.slice(i + 1) };
};

const attrs = (el: XElement): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(el.attributes)) {
    if (v != null && !k.startsWith("xmlns")) out[k] = v;
  }
  return out;
};

const elementChildren = (el: XElement): readonly XElement[] => el.children.filter(isElement);

const classTokens = (el: XElement): Set<string> =>
  new Set((el.attributes["class"] ?? "").split(/\s+/).filter(Boolean));

/** Flatten all descendant character data into a string. */
const textOf = (n: XNode): string =>
  n.type === "text" ? n.value : n.children.map(textOf).join("");

const childText = (el: XElement): string => el.children.map(textOf).join("");

const SIMPLE_TAGS = new Set([
  "p", "code", "pre", "em", "strong", "ol", "ul", "li", "blockquote", "figure", "figcaption",
]);

// --- content mapping --------------------------------------------------------

const parseContentNodes = (nodes: readonly XNode[]): Content[] =>
  nodes.map((n) => (n.type === "text" ? { type: "text", value: n.value } : parseContentElement(n)));

const parseContentElement = (el: XElement): Content => {
  const { prefix, local } = qname(el.name);

  if (prefix === "html") {
    // \comment{anchored}{note} → span.comment > span.comment-anchored + span.comment-note
    if (local === "span" && classTokens(el).has("comment")) return parseComment(el);
    return { type: "html", ns: "html", tag: local, attrs: attrs(el), children: parseContentNodes(el.children) };
  }
  if (prefix === "mml") {
    return { type: "html", ns: "mml", tag: local, attrs: attrs(el), children: parseContentNodes(el.children) };
  }

  // forester namespace (or default) content elements
  return match(local)
    .with("tex", (): Content => ({
      type: "tex",
      display: el.attributes["display"] === "block" ? "block" : "inline",
      value: childText(el),
    }))
    .with("link", (): Content => ({
      type: "link",
      href: el.attributes["href"] ?? undefined,
      title: el.attributes["title"] ?? undefined,
      displayUri: el.attributes["display-uri"] ?? undefined,
      linkType: el.attributes["type"] ?? undefined,
      children: parseContentNodes(el.children),
    }))
    .with("ref", (): Content => ({
      type: "ref",
      uri: el.attributes["uri"] ?? undefined,
      href: el.attributes["href"] ?? undefined,
      taxon: el.attributes["taxon"] ?? undefined,
      number: el.attributes["number"] ?? undefined,
    }))
    .with("contextual-number", (): Content => ({
      type: "contextual-number",
      uri: el.attributes["uri"] ?? undefined,
      displayUri: el.attributes["display-uri"] ?? undefined,
    }))
    .with("footnote", (): Content => ({ type: "footnote", children: parseContentNodes(el.children) }))
    .with("resource", (): Content => parseResource(el))
    .with("source-path", (): Content => ({ type: "source-path", value: childText(el) }))
    .with("img", (): Content => ({ type: "fr-img", src: el.attributes["src"] ?? "" }))
    .with("error", (): Content => ({ type: "fr-note", kind: "error", children: parseContentNodes(el.children) }))
    .with("info", (): Content => ({ type: "fr-note", kind: "info", children: parseContentNodes(el.children) }))
    .with("tree", (): Content => parseTreeElement(el))
    .when(
      (l) => SIMPLE_TAGS.has(l),
      (l): Content => ({ type: "fr-simple", tag: l as SimpleTag, children: parseContentNodes(el.children) }),
    )
    .otherwise((): Content => ({ type: "unknown", name: el.name, children: parseContentNodes(el.children) }));
};

const parseComment = (el: XElement): Content => {
  const kids = elementChildren(el);
  const anchored = kids.find((c) => classTokens(c).has("comment-anchored"));
  const note = kids.find((c) => classTokens(c).has("comment-note"));
  return {
    type: "comment",
    anchored: anchored ? parseContentNodes(anchored.children) : [],
    note: note ? parseContentNodes(note.children) : [],
  };
};

const parseResource = (el: XElement): Content => {
  const content = elementChildren(el).find((c) => qname(c.name).local === "resource-content");
  const isLatex = elementChildren(el).some(
    (c) => qname(c.name).local === "resource-source" && c.attributes["type"] === "latex",
  );
  return {
    type: "resource",
    isLatex,
    content: content ? parseContentNodes(content.children) : [],
  };
};

// --- frontmatter ------------------------------------------------------------

const parseFrontmatter = (fm: XElement): Frontmatter => {
  let titleText: string | undefined;
  let title: readonly Content[] = [];
  let taxon: string | undefined;
  let uri: string | undefined;
  let route: string | undefined;
  let displayUri: string | undefined;
  let number: string | undefined;
  let date: FrDate | undefined;
  let sourcePath: string | undefined;
  const authors: Content[][] = [];
  const contributors: Content[][] = [];
  const metas: FrMeta[] = [];

  for (const child of elementChildren(fm)) {
    const local = qname(child.name).local;
    switch (local) {
      case "title": {
        titleText = child.attributes["text"] ?? undefined;
        title = parseContentNodes(child.children);
        break;
      }
      case "taxon": { taxon = childText(child); break;
      }
      case "uri": { uri = childText(child); break;
      }
      case "route": { route = childText(child); break;
      }
      case "display-uri": { displayUri = childText(child); break;
      }
      case "number": { number = childText(child); break;
      }
      case "source-path": { sourcePath = childText(child); break;
      }
      case "date": { date = parseDate(child); break;
      }
      case "authors": {
        for (const a of elementChildren(child)) {
          const l = qname(a.name).local;
          if (l === "author") authors.push(parseContentNodes(a.children));
          else if (l === "contributor") contributors.push(parseContentNodes(a.children));
        }
        break;
      }
      case "meta": {
        const name = child.attributes["name"];
        if (name) metas.push({ name, children: parseContentNodes(child.children), value: childText(child) });
        break;
      }
      // fr:uri/route/etc already handled; anything else is intentionally ignored
      default: { break;
      }
    }
  }

  return { titleText, title, taxon, uri, route, displayUri, number, date, authors, contributors, metas, sourcePath };
};

const parseDate = (el: XElement): FrDate => {
  const part = (name: string): string | undefined => {
    const c = elementChildren(el).find((e) => qname(e.name).local === name);
    return c ? childText(c) : undefined;
  };
  return {
    year: part("year"),
    month: part("month"),
    day: part("day"),
    href: el.attributes["href"] ?? undefined,
  };
};

// --- tree -------------------------------------------------------------------

const parseTreeElement = (el: XElement): FrTree => {
  const kids = elementChildren(el);
  const fm = kids.find((c) => qname(c.name).local === "frontmatter");
  const mm = kids.find((c) => qname(c.name).local === "mainmatter");
  const bm = kids.find((c) => qname(c.name).local === "backmatter");
  return {
    type: "tree",
    attrs: attrs(el),
    frontmatter: fm
      ? parseFrontmatter(fm)
      : { title: [], authors: [], contributors: [], metas: [] },
    mainmatter: mm ? parseContentNodes(mm.children) : [],
    backmatter: bm ? parseContentNodes(bm.children) : [],
  };
};

/**
 * Build the generic element tree from saxes events. saxes (pure JS, ~230 MB/s)
 * replaced xast-util-from-xml (~4.6 MB/s) — XML parsing was 82% of render time.
 * CDATA is folded into text; adjacent text runs are merged.
 */
const buildTree = (xml: string): XElement => {
  const root: XElement = { type: "element", name: "#root", attributes: {}, children: [] };
  const stack: XElement[] = [root];
  let error: Error | null = null;

  const parser = new SaxesParser({ xmlns: false });
  parser.on("error", (e) => { error ??= e instanceof Error ? e : new Error(String(e)); });
  parser.on("opentag", (tag) => {
    const el: XElement = { type: "element", name: tag.name, attributes: tag.attributes, children: [] };
    stack.at(-1)!.children.push(el);
    stack.push(el);
  });
  parser.on("closetag", () => { stack.pop(); });

  const pushText = (value: string): void => {
    const kids = stack.at(-1)!.children;
    const last = kids.at(-1);
    if (last && last.type === "text") last.value += value;
    else kids.push({ type: "text", value });
  };
  parser.on("text", pushText);
  parser.on("cdata", pushText);

  parser.write(xml).close();
  // `error` is built as a real Error in the handler above and is non-null here;
  // the rule mis-types it because it's a closure-mutated `let`.
  // eslint-disable-next-line @typescript-eslint/only-throw-error
  if (error) throw error;
  return root;
};

/** Parse a full forester XML document into the root {@link FrTree}. */
export const parseTree = (xml: string): FrTree => {
  const treeEl = buildTree(xml).children.find(
    (n): n is XElement => isElement(n) && qname(n.name).local === "tree",
  );
  if (!treeEl) throw new Error("forester XML has no <fr:tree> root element");
  return parseTreeElement(treeEl);
};
