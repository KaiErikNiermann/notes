/**
 * Tests for the `%! sig` macro-signature parser/validator (sig.ts). The GOLDEN
 * FIXTURE below is the cross-repo contract: the extension's mirror parser
 * (forester-lang-support/src/language/sig.ts) must produce byte-identical JSON
 * for the same input. Keep the two in step — change one, change both.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSigLine, parseMacroSigs, flagsOf, validateFlags, type Sig } from "../sig";

// ── golden fixture (frozen — mirrored in the extension) ──────────────────────
const GOLDEN_INPUT = String.raw`%! sig \embed(opts: flags{mode: image|code|raw, width?: number, align?: left|center|right}, target: @artifact-ref, caption?: content)`;

const GOLDEN_OUTPUT: Sig = {
  command: String.raw`\embed`,
  params: [
    {
      name: "opts", optional: false,
      kind: {
        tag: "flags",
        fields: [
          { name: "mode", optional: false, kind: { tag: "enum", values: ["image", "code", "raw"] } },
          { name: "width", optional: true, kind: { tag: "number" } },
          { name: "align", optional: true, kind: { tag: "enum", values: ["left", "center", "right"] } },
        ],
      },
    },
    { name: "target", optional: false, kind: { tag: "dynamic", source: "artifact-ref" } },
    { name: "caption", optional: true, kind: { tag: "content" } },
  ],
};

test(String.raw`golden fixture: the \embed sig parses to the frozen JSON (cross-repo contract)`, () => {
  assert.deepEqual(parseSigLine(GOLDEN_INPUT), GOLDEN_OUTPUT);
});

test("parseSigLine: dynamic / content / opaque kinds", () => {
  assert.deepEqual(parseSigLine(String.raw`%! sig \codeblock(lang: @language, body: content)`), {
    command: String.raw`\codeblock`,
    params: [
      { name: "lang", optional: false, kind: { tag: "dynamic", source: "language" } },
      { name: "body", optional: false, kind: { tag: "content" } },
    ],
  });
  assert.deepEqual(parseSigLine(String.raw`%! sig \d3p(name: @figure, params: opaque)`)?.params[1], {
    name: "params", optional: false, kind: { tag: "opaque" },
  });
});

test("parseSigLine: non-signature lines return null", () => {
  assert.equal(parseSigLine(String.raw`\def\embed[opts][target][caption]{…}`), null);
  assert.equal(parseSigLine("% just a comment"), null);
});

test("parseMacroSigs: collects every %! sig in a tree source, keyed by command", () => {
  const src = [
    String.raw`\title{Macros}`,
    String.raw`%! sig \comment(anchored: content, note: content)`,
    String.raw`\def\comment[anchored][note]{…}`,
    "",
    String.raw`%! sig \d3(name: @figure)`,
    String.raw`\def\d3[name]{…}`,
  ].join("\n");
  const m = parseMacroSigs(src);
  assert.deepEqual([...m.keys()].sort(), [String.raw`\comment`, String.raw`\d3`]);
  assert.equal(m.get(String.raw`\d3`)?.params[0]?.kind.tag, "dynamic");
});

// ── validateFlags ────────────────────────────────────────────────────────────
const EMBED_FLAGS = flagsOf(GOLDEN_OUTPUT, "opts")!;

test("validateFlags: valid opts → parsed values, no diagnostics", () => {
  const { value, diagnostics } = validateFlags(EMBED_FLAGS, "image width=70 align=center", String.raw`\embed`);
  assert.deepEqual(value, { mode: "image", width: "70", align: "center" });
  assert.equal(diagnostics.length, 0);
});

test("validateFlags: bad enum value + unknown flag + unknown mode → diagnostics", () => {
  const align = validateFlags(EMBED_FLAGS, "align=bogus", String.raw`\embed`);
  assert.equal(align.diagnostics.length, 1);
  assert.match(align.diagnostics[0]!.message, /align.*left\|center\|right.*bogus/);

  const unknownFlag = validateFlags(EMBED_FLAGS, "height=9", String.raw`\embed`);
  assert.match(unknownFlag.diagnostics[0]!.message, /unknown flag 'height'/);

  const badMode = validateFlags(EMBED_FLAGS, "video", String.raw`\embed`);
  assert.match(badMode.diagnostics[0]!.message, /unknown mode 'video'/);
});

test("validateFlags: number values pass through un-validated (width is permissive)", () => {
  const { value, diagnostics } = validateFlags(EMBED_FLAGS, "code width=70px", String.raw`\embed`);
  assert.deepEqual(value, { mode: "code", width: "70px" });
  assert.equal(diagnostics.length, 0);
});
