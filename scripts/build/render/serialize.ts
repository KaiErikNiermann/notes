/**
 * serialize.ts — hast → HTML string, with a leading `<!doctype html>`.
 *
 * `hast-util-to-html` gives spec-correct HTML5 serialization (void elements,
 * minimal entity escaping, raw script/style text) — the same serializer family
 * (parse5/hast) we validated against in Rec 1.
 */
import { toHtml } from "hast-util-to-html";
import type { ElementContent, Root } from "hast";

export const serialize = (html: ElementContent): string => {
  const root: Root = { type: "root", children: [{ type: "doctype" }, html] };
  return toHtml(root, {
    // forester output is HTML, not XHTML; keep void elements + bare booleans.
    closeSelfClosing: false,
    tightSelfClosing: false,
  });
};
