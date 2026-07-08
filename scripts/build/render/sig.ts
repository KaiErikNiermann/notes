/**
 * sig.ts — the `%! sig` macro-signature layer (the single source of truth for
 * custom-construct parameter constraints; see trees/base-macros.tree).
 *
 * A signature is a comment line above a `\def`:
 *
 *   %! sig \embed(opts: flags{mode: image|code|raw, width?: number, align?: left|center|right}, target: @artifact-ref, caption?: content)
 *
 * The notes build parses these and validates construct options against them
 * (warning instead of silently dropping); the VS Code extension parses the same
 * grammar to drive completion/hover/diagnostics. The grammar is intentionally
 * tiny and FROZEN — a golden fixture keeps the two parsers in step.
 *
 * `kind` ∈
 *   a|b|c            enum (a pipe-separated literal set)
 *   number           a numeric/length value
 *   content          forester content (no scalar constraint)
 *   opaque           an un-typed blob (e.g. figure-specific params) — no checks
 *   @source          a dynamic value set resolved per-environment
 *                    (@language @figure @taxon @tree-id @artifact-ref @bib-ref)
 *   flags{ k: kind, k2?: kind }   a whitespace-separated flag mini-language; the
 *                    FIRST field is the bareword positional (e.g. `mode`), the
 *                    rest are `key=value`.
 */

export type ParamKind =
  | { readonly tag: "enum"; readonly values: readonly string[] }
  | { readonly tag: "number" }
  | { readonly tag: "content" }
  | { readonly tag: "opaque" }
  | { readonly tag: "dynamic"; readonly source: string }
  | { readonly tag: "flags"; readonly fields: readonly FlagField[] };

export interface FlagField {
  readonly name: string;
  readonly optional: boolean;
  readonly kind: ParamKind;
}

export interface Param {
  readonly name: string;
  readonly optional: boolean;
  readonly kind: ParamKind;
}

export interface Sig {
  readonly command: string; // with leading backslash, e.g. "\\embed"
  readonly params: readonly Param[];
}

/** One construct-option violation (build warning / editor diagnostic). */
export interface SigDiagnostic {
  readonly construct: string; // e.g. "\\embed"
  readonly param: string; // the offending flag/param name
  readonly message: string;
}

// ── parsing ────────────────────────────────────────────────────────────────

// Split on top-level commas, respecting `{…}` nesting (so flags bodies stay intact).
const splitTopLevel = (s: string): string[] => {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === "," && depth === 0) { out.push(s.slice(start, i)); start = i + 1; }
  }
  const tail = s.slice(start).trim();
  if (tail) out.push(tail);
  return out.map((x) => x.trim()).filter(Boolean);
};

const parseKind = (raw: string): ParamKind => {
  const s = raw.trim();
  if (s.startsWith("flags{") && s.endsWith("}")) {
    return { tag: "flags", fields: splitTopLevel(s.slice("flags{".length, -1)).map(parseField) };
  }
  if (s.startsWith("@")) return { tag: "dynamic", source: s.slice(1) };
  if (s === "number") return { tag: "number" };
  if (s === "content") return { tag: "content" };
  if (s === "opaque") return { tag: "opaque" };
  // anything else is an enum literal set (pipe-separated; a single value is fine)
  return { tag: "enum", values: s.split("|").map((v) => v.trim()).filter(Boolean) };
};

// `name[?]: kind`
const FIELD_RE = /^(\w+)(\?)?\s*:\s*(.+)$/s;
const parseField = (raw: string): FlagField => {
  const m = FIELD_RE.exec(raw.trim());
  if (!m) throw new Error(`bad sig field: ${JSON.stringify(raw)}`);
  return { name: m[1]!, optional: m[2] === "?", kind: parseKind(m[3]!) };
};

const SIG_RE = /^\s*%!\s*sig\s+\\(\S+?)\s*\((.*)\)\s*$/;

/** Parse a single `%! sig …` line, or null if the line isn't a signature. */
export const parseSigLine = (line: string): Sig | null => {
  const m = SIG_RE.exec(line);
  if (!m) return null;
  const params = splitTopLevel(m[2]!).map((spec): Param => {
    const f = parseField(spec);
    return { name: f.name, optional: f.optional, kind: f.kind };
  });
  return { command: `\\${m[1]}`, params };
};

/** Collect every `%! sig` in a `.tree` source, keyed by command (with backslash). */
export const parseMacroSigs = (source: string): Map<string, Sig> => {
  const out = new Map<string, Sig>();
  for (const line of source.split("\n")) {
    if (!line.includes("%! sig")) continue;
    const sig = parseSigLine(line);
    if (sig) out.set(sig.command, sig);
  }
  return out;
};

/** The flag fields of a `flags{…}` param of `sig` named `param`, else undefined. */
export const flagsOf = (sig: Sig, param: string): readonly FlagField[] | undefined => {
  const p = sig.params.find((x) => x.name === param);
  return p && p.kind.tag === "flags" ? p.kind.fields : undefined;
};

// ── validation ───────────────────────────────────────────────────────────────

/**
 * Validate a whitespace-separated flag string against a `flags{…}` schema. The
 * first field is the bareword positional (e.g. `mode`); the rest are `key=value`.
 * Returns the parsed values plus diagnostics for unknown flags / bad enum values.
 * `number` values are accepted as-is (the renderer treats width permissively).
 */
export const validateFlags = (
  fields: readonly FlagField[],
  raw: string,
  construct = "",
): { value: Record<string, string>; diagnostics: SigDiagnostic[] } => {
  const value: Record<string, string> = {};
  const diagnostics: SigDiagnostic[] = [];
  const positional = fields[0];
  for (const tok of raw.trim().split(/\s+/).filter(Boolean)) {
    const eq = tok.indexOf("=");
    if (eq === -1) {
      // bareword → the positional field (an enum, e.g. mode)
      if (positional && positional.kind.tag === "enum") {
        if (positional.kind.values.includes(tok)) value[positional.name] = tok;
        else diagnostics.push({ construct, param: positional.name, message: `unknown ${positional.name} '${tok}' (expected ${positional.kind.values.join("|")})` });
      } else {
        diagnostics.push({ construct, param: "", message: `unexpected token '${tok}'` });
      }
      continue;
    }
    const key = tok.slice(0, eq);
    const v = tok.slice(eq + 1);
    const field = fields.find((f) => f.name === key);
    if (!field) { diagnostics.push({ construct, param: key, message: `unknown flag '${key}'` }); continue; }
    if (field.kind.tag === "enum" && !field.kind.values.includes(v)) {
      diagnostics.push({ construct, param: key, message: `'${key}' expects ${field.kind.values.join("|")}, got '${v}'` });
      continue;
    }
    value[key] = v;
  }
  return { value, diagnostics };
};
