/**
 * End-to-end renderer tests for the fidelity-critical logic (section numbering,
 * should-number gating, date formatting, ref resolution, footnotes). The full
 * cross-check against xsltproc lives in validate.ts; these guard the subtle
 * rules against regressions. Run: `pnpm exec tsx --test scripts/build/render/__tests__/`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderForesterXml } from "../render";

const FR = 'xmlns:fr="http://www.forester-notes.org" xmlns:html="http://www.w3.org/1999/xhtml"';
const doc = (frontmatter: string, mainmatter: string, attrs = 'root="false" base-url="/notes/"'): string =>
  `<?xml version="1.0"?><fr:tree ${FR} ${attrs}><fr:frontmatter>${frontmatter}</fr:frontmatter><fr:mainmatter>${mainmatter}</fr:mainmatter></fr:tree>`;

const section = (title: string, taxon: string, body: string, attrs = ""): string =>
  `<fr:tree ${attrs}><fr:frontmatter><fr:title text="${title}">${title}</fr:title><fr:taxon>${taxon}</fr:taxon></fr:frontmatter><fr:mainmatter>${body}</fr:mainmatter></fr:tree>`;

test("date renders as 'Month DD, YYYY' with non-breaking spaces", () => {
  const html = renderForesterXml(doc(
    '<fr:date><fr:year>2025</fr:year><fr:month>11</fr:month><fr:day>25</fr:day></fr:date><fr:title text="T">T</fr:title>',
    "<html:p>hi</html:p>",
  ));
  assert.match(html, /November 25, 2025/);
});

test("two numbered sibling sections number 1. and 2.", () => {
  const html = renderForesterXml(doc(
    '<fr:title text="Root">Root</fr:title>',
    section("Alpha", "Section", "<html:p>a</html:p>") + section("Beta", "Section", "<html:p>b</html:p>"),
  ));
  // taxon spans carry "Section 1." / "Section 2." (nbsp between taxon and number).
  assert.match(html, /Section 1\. <\/span>Alpha/);
  assert.match(html, /Section 2\. <\/span>Beta/);
});

test("a lone subsection is implicitly unnumbered", () => {
  const html = renderForesterXml(doc(
    '<fr:title text="Root">Root</fr:title>',
    section("Only", "Lemma", "<html:p>x</html:p>"),
  ));
  // taxon present but no number (no nbsp-number after taxon), suffix ". " applied.
  assert.match(html, /<span class="taxon">Lemma\. <\/span>Only/);
  assert.doesNotMatch(html, /Lemma 1/);
});

test("ref resolves to an on-page anchor when the uri is transcluded", () => {
  const target = `<fr:tree><fr:frontmatter><fr:title text="Tgt">Tgt</fr:title><fr:taxon>Def</fr:taxon><fr:uri>U1</fr:uri></fr:frontmatter><fr:mainmatter><html:p>def</html:p></fr:mainmatter></fr:tree>`;
  const html = renderForesterXml(doc(
    '<fr:title text="Root">Root</fr:title>',
    `${target}<html:p>see <fr:ref uri="U1" taxon="Def" href="/notes/x/">x</fr:ref></html:p>`,
  ));
  // on-page ref → href="#<id>", and it shows the target's taxon.
  assert.match(html, /<a class="link local" href="#n\d+">Def/);
});

test("ref falls back to external href when the uri is not on the page", () => {
  const html = renderForesterXml(doc(
    '<fr:title text="Root">Root</fr:title>',
    '<html:p><fr:ref uri="U9" taxon="Def" href="/notes/elsewhere/">x</fr:ref></html:p>',
  ));
  assert.match(html, /<a class="link local" href="\/notes\/elsewhere\/">/);
});

test("footnote emits an inline marker and a backmatter-less endnote in its tree", () => {
  const html = renderForesterXml(doc(
    '<fr:title text="Root">Root</fr:title>',
    '<html:p>text<fr:footnote><html:p>the note</html:p></fr:footnote></html:p>',
  ));
  assert.match(html, /class="footnote-ref"/);
  assert.match(html, /class="footnotes"/);
  assert.match(html, /the note/);
});

// --- margin comments (\comment) ---------------------------------------------

const comment = (anchored: string, note: string): string =>
  `<html:span class="comment"><html:span class="comment-anchored">${anchored}</html:span><html:span class="comment-note">${note}</html:span></html:span>`;

test(String.raw`a \comment renders an inline underlined anchor and collects the note into the aside`, () => {
  const html = renderForesterXml(doc(
    '<fr:title text="R">R</fr:title>',
    `<html:p>The claim ${comment("holds", "only for odd primes")} here.</html:p>`,
  ));
  assert.match(html, /<span class="comment-anchor" id="cmt-anchor-n\d+" data-comment="n\d+"[^>]*>holds<\/span>/);
  assert.match(html, /<aside class="comments"[^>]*><div class="comment-card" id="cmt-n\d+" data-comment="n\d+">only for odd primes/);
});

test("the comment note is NOT rendered inline in the prose", () => {
  const html = renderForesterXml(doc(
    '<fr:title text="R">R</fr:title>',
    `<html:p>X ${comment("anchored", "SECRETNOTE")} Y</html:p>`,
  ));
  const prose = html.slice(0, html.indexOf('<aside class="comments"'));
  assert.doesNotMatch(prose, /SECRETNOTE/);
});

test("comments attach to the tree that declares them (child, not parent)", () => {
  const child =
    '<fr:tree><fr:frontmatter><fr:title text="C">C</fr:title></fr:frontmatter>' +
    `<fr:mainmatter><html:p>${comment("a", "childnote")}</html:p></fr:mainmatter></fr:tree>`;
  const html = renderForesterXml(doc('<fr:title text="Root">Root</fr:title>', child + "<html:p>root</html:p>"));
  assert.equal((html.match(/class="comments"/g) ?? []).length, 1); // only the child's aside
});

test(String.raw`inline tex becomes \(..\) and block tex becomes \[..\]`, () => {
  const html = renderForesterXml(doc(
    '<fr:title text="T">T</fr:title>',
    '<html:p><fr:tex display="inline"><![CDATA[x]]></fr:tex></html:p><fr:tex display="block"><![CDATA[y]]></fr:tex>',
  ));
  assert.match(html, /\\\(x\\\)/);
  assert.match(html, /\\\[y\\\]/);
});

test("links wrap nested text descendants in anchors", () => {
  const html = renderForesterXml(doc(
    '<fr:title text="T">T</fr:title>',
    '<html:p><fr:link href="/n/" title="N" type="local"><html:em>word</html:em></fr:link></html:p>',
  ));
  assert.match(html, /<span class="link local"><em><a href="\/n\/"[^>]*>word<\/a><\/em><\/span>/);
});

// --- artifacts --------------------------------------------------------------
// `\route-asset` isn't available in fixtures; its flattened meta value is just the
// resolved URL, so write the URL directly as the artifact-file meta body.

test("artifact section renders a download row from an artifact-file meta", () => {
  const html = renderForesterXml(doc(
    '<fr:title text="Root">Root</fr:title>' +
    '<fr:meta name="artifact-file:p1.png">/notes/abc123.png</fr:meta>',
    "<html:p>body</html:p>",
  ));
  assert.match(html, /class="artifacts"/);
  assert.match(html, /class="artifact-row"/);
  assert.match(html, /<a class="artifact-download" href="\/notes\/abc123\.png" download="p1\.png"/);
  assert.match(html, />p1\.png</);
});

test("artifacts group into folders by their key path", () => {
  const html = renderForesterXml(doc(
    '<fr:title text="Root">Root</fr:title>' +
    '<fr:meta name="artifact-file:drafts/s1/p1.png">/a/x.png</fr:meta>' +
    '<fr:meta name="artifact-file:drafts/s1/p2.png">/a/y.png</fr:meta>',
    "<html:p>b</html:p>",
  ));
  assert.match(html, /class="artifact-folder-group"/);
  assert.match(html, />drafts</);
  assert.match(html, />s1</);
  assert.match(html, />p1\.png</);
  assert.match(html, />p2\.png</);
});

test("artifact-note becomes a tap-to-reveal note body beneath the file row", () => {
  const html = renderForesterXml(doc(
    '<fr:title text="Root">Root</fr:title>' +
    '<fr:meta name="artifact-file:p1.png">/a/x.png</fr:meta>' +
    '<fr:meta name="artifact-note:p1.png">Pen sketch of the argument.</fr:meta>',
    "<html:p>b</html:p>",
  ));
  // The file becomes a <details> with a "note" disclosure in its head and the
  // note text in the revealed body (its own space, not inline on the row).
  assert.match(html, /<details class="artifact-entry">/);
  assert.match(html, /<span class="artifact-note-hint">note<\/span>/);
  assert.match(html, /class="artifact-note-body">Pen sketch of the argument\./);
});

test("an attachment with no note stays a plain single-line row (no details)", () => {
  const html = renderForesterXml(doc(
    '<fr:title text="Root">Root</fr:title>' +
    '<fr:meta name="artifact-file:p1.png">/a/x.png</fr:meta>',
    "<html:p>b</html:p>",
  ));
  assert.match(html, /<div class="artifact-head"><span class="artifact-icon"/);
  assert.doesNotMatch(html, /artifact-entry|artifact-note-hint|artifact-note-body/);
});

test("inline artifact ref resolves to a numbered marker linking the artifact anchor", () => {
  const html = renderForesterXml(doc(
    '<fr:title text="Root">Root</fr:title>' +
    '<fr:meta name="artifact-file:p1.png">/a/x.png</fr:meta>',
    '<html:p>see <fr:link href="#artifact:p1.png">↗</fr:link></html:p>',
  ));
  assert.match(html, /<sup class="artifact-ref"[^>]*><a href="#n\d+"[^>]*>1<\/a><\/sup>/);
  assert.match(html, /<li class="artifact-row" id="n\d+"/);
});

test("unknown artifact key renders an error marker; normal #fragment links pass through", () => {
  const html = renderForesterXml(doc(
    '<fr:title text="Root">Root</fr:title>',
    '<html:p><fr:link href="#artifact:missing.png">x</fr:link>' +
    ' and <fr:link href="#elsewhere">y</fr:link></html:p>',
  ));
  assert.match(html, /\[artifact\?:missing\.png\]/);
  assert.match(html, /href="#elsewhere"[^>]*>y</);
});

test("artifacts attach to the tree that declares them (child, not parent)", () => {
  const child =
    '<fr:tree><fr:frontmatter><fr:title text="C">C</fr:title>' +
    '<fr:meta name="artifact-file:c.png">/a/c.png</fr:meta></fr:frontmatter>' +
    '<fr:mainmatter><html:p>c</html:p></fr:mainmatter></fr:tree>';
  const html = renderForesterXml(doc('<fr:title text="Root">Root</fr:title>', child + "<html:p>root</html:p>"));
  assert.equal((html.match(/class="artifacts"/g) ?? []).length, 1);
});

// --- artifact embeds (\embed → figure.artifact-embed) -----------------------

const embed = (opts: string, target: string, caption = ""): string =>
  `<html:figure class="artifact-embed" data-embed="${target}" data-opts="${opts}"><html:figcaption>${caption}</html:figcaption></html:figure>`;

test("local image embed renders a figure+img with the resolved url and caption", () => {
  const html = renderForesterXml(doc(
    '<fr:title text="R">R</fr:title><fr:meta name="artifact-file:fig.png">/notes/abc.png</fr:meta>',
    embed("image", "#artifact:fig.png", "A square."),
  ));
  assert.match(html, /<figure class="embed embed-image" data-style-id="fig\.png"/);
  assert.match(html, /<img src="\/notes\/abc\.png"/);
  assert.match(html, /<figcaption>A square\.<\/figcaption>/);
});

test("image embed flags set img width and figure align", () => {
  const html = renderForesterXml(doc(
    '<fr:title text="R">R</fr:title><fr:meta name="artifact-file:fig.png">/notes/abc.png</fr:meta>',
    embed("image width=60% align=center", "#artifact:fig.png"),
  ));
  assert.doesNotMatch(html, /<figure[^>]* style=/);                                             // no inline style on the figure
  assert.match(html, /<img src="\/notes\/abc\.png"[^>]*style="width:60%;margin-inline:auto;"/); // width + align on the img
});

test("external-url image embed renders without needing an attachment", () => {
  const html = renderForesterXml(doc(
    '<fr:title text="R">R</fr:title>',
    embed("image", "https://ex.org/d.svg"),
  ));
  assert.match(html, /<img src="https:\/\/ex\.org\/d\.svg"/);
  assert.doesNotMatch(html, /class="artifacts"/); // external is not an attachment
});

test("code embed emits a pending placeholder with url, mode and language from extension", () => {
  const html = renderForesterXml(doc(
    '<fr:title text="R">R</fr:title><fr:meta name="artifact-file:main.py">/notes/def.py</fr:meta>',
    embed("code", "#artifact:main.py"),
  ));
  assert.match(html, /<figure class="embed embed-text embed-pending" data-embed-url="\/notes\/def\.py" data-embed-mode="code" data-embed-lang="python">/);
});

test("raw embed emits a pending placeholder in raw mode", () => {
  const html = renderForesterXml(doc(
    '<fr:title text="R">R</fr:title><fr:meta name="artifact-file:log.txt">/notes/ghi.txt</fr:meta>',
    embed("raw", "#artifact:log.txt"),
  ));
  assert.match(html, /data-embed-mode="raw" data-embed-lang="plaintext"/);
});

test("sourced attachment shows its source in the embed caption and the panel row", () => {
  const html = renderForesterXml(doc(
    '<fr:title text="R">R</fr:title>' +
    '<fr:meta name="artifact-file:fig.png">/notes/abc.png</fr:meta>' +
    '<fr:meta name="artifact-source:fig.png">Smith 2020</fr:meta>',
    embed("image", "#artifact:fig.png", "Lifted figure."),
  ));
  assert.match(html, /<span class="embed-source">Smith 2020<\/span>/);          // in the caption
  assert.match(html, /<span class="artifact-source">from Smith 2020<\/span>/);  // in the attachments row
});

test("unknown embed key and external text embed render error markers", () => {
  const html = renderForesterXml(doc(
    '<fr:title text="R">R</fr:title>',
    embed("image", "#artifact:missing.png") + embed("code", "https://ex.org/x.py"),
  ));
  assert.match(html, /\[embed\?:missing\.png\]/);
  assert.match(html, /\[embed code: needs a local #artifact: target\]/);
});

// --- styled tables & figures (\meta{style:<id>}) ----------------------------

const table = (rows: string): string => `<html:table class="data-table">${rows}</html:table>`;
const TBL =
  '<html:tr><html:th>A</html:th><html:th>B</html:th></html:tr>' +
  '<html:tr><html:td>1</html:td><html:td>2</html:td></html:tr>';

test("an un-styled data-table gets a stable content-hash data-style-id", () => {
  const a = renderForesterXml(doc('<fr:title text="R">R</fr:title>', table(TBL)));
  const b = renderForesterXml(doc('<fr:title text="R2">R2</fr:title>', table(TBL)));
  const idA = a.match(/<table class="data-table" data-style-id="(tbl-[a-z0-9]+)"/)?.[1];
  const idB = b.match(/data-style-id="(tbl-[a-z0-9]+)"/)?.[1];
  assert.ok(idA, "table has a tbl- id");
  assert.equal(idA, idB, "same content → same id");
  // different shape → different id
  const c = renderForesterXml(doc('<fr:title text="R">R</fr:title>',
    table('<html:tr><html:th>A</html:th></html:tr><html:tr><html:td>1</html:td></html:tr>')));
  assert.notEqual(idA, c.match(/data-style-id="(tbl-[a-z0-9]+)"/)?.[1]);
});

test("a style meta applies align + width + a colgroup to its table", () => {
  // derive the id first, then style it
  const probe = renderForesterXml(doc('<fr:title text="R">R</fr:title>', table(TBL)));
  const id = probe.match(/data-style-id="(tbl-[a-z0-9]+)"/)![1]!;
  const html = renderForesterXml(doc(
    `<fr:title text="R">R</fr:title><fr:meta name="style:${id}">align=left cols=120,80</fr:meta>`,
    table(TBL),
  ));
  assert.match(html, /<table[^>]*style="margin-right:auto;margin-left:0;table-layout:fixed;width:200px;"/);
  assert.match(html, /<colgroup><col style="width:120px;"><col style="width:80px;"><\/colgroup>/);
});

test("a style meta on a figure overrides its inline embed flags", () => {
  const html = renderForesterXml(doc(
    '<fr:title text="R">R</fr:title>' +
    '<fr:meta name="artifact-file:fig.png">/notes/abc.png</fr:meta>' +
    '<fr:meta name="style:fig.png">align=right width=40</fr:meta>',
    embed("image width=90 align=center", "#artifact:fig.png"),
  ));
  // align=right + width=40 both win, both on the img
  assert.match(html, /<img src="\/notes\/abc\.png"[^>]*style="width:40%;margin-left:auto;margin-right:0;"/);
});
