import test from "node:test";
import assert from "node:assert/strict";

import { normalizeCodeWhitespace } from "../code-whitespace";

const fixture = (strings: string[]): string => strings.join("\n");

test("trims entirely blank blocks", () => {
  assert.equal(normalizeCodeWhitespace("\n\n\n"), "");
});

test("removes uniform leading indentation", () => {
  const input = fixture(["    function add(a, b) {", "      return a + b;", "    }", ""]);
  const expected = fixture(["function add(a, b) {", "  return a + b;", "}"]);
  assert.equal(normalizeCodeWhitespace(input), expected);
});

test("preserves mixed indentation deltas", () => {
  const input = fixture(["\t\tif (x) {", "\t\t    console.log(x);", "\t\t}", ""]);
  const expected = fixture(["if (x) {", "    console.log(x);", "}"]); // inner spaces remain
  assert.equal(normalizeCodeWhitespace(input), expected);
});

test("keeps intentional leading whitespace on first line", () => {
  const input = fixture(["    console.log('first line');", "      console.log('second');"]);
  const expected = fixture(["console.log('first line');", "  console.log('second');"]);
  assert.equal(normalizeCodeWhitespace(input), expected);
});

test("handles tabs and spaces mix", () => {
  const input = fixture(["\t  const value = 42;", "\t    return value;", "\t", "\t", ""]);
  const expected = fixture(["const value = 42;", "  return value;"]);
  assert.equal(normalizeCodeWhitespace(input), expected);
});
