/**
 * artifacts.ts — the per-tree "attachment" model, derived from frontmatter metas.
 *
 * An artifact is supplementary material (a handwriting/Krita export, a file, …)
 * attached to a single tree and shown in a compact expandable file-tree section.
 * It is NOT an XML-shaped node (so it doesn't belong in ast.ts) — it's a derived
 * view computed from `\meta` entries, exactly as footnote *sequencing* is derived
 * in index-pass.ts rather than baked into the parsed AST.
 *
 * Declaration contract (authored in frontmatter; the path lives in the meta KEY
 * because `\route-asset` discards the original filename, emitting only the hashed
 * content-addressed URL as the meta value):
 *
 *   \meta{artifact-file:drafts/section1/p1.png}{\route-asset{drafts/section1/p1.png}}
 *   \meta{artifact-note:drafts/section1/p1.png}{Pen sketch before formalization.}  % optional
 */
import type { Content, FrMeta } from "./ast";

/** One attached artifact, derived from an `artifact-file:<path>` meta (+ optional note). */
export interface Artifact {
  /** Display path from the meta-name suffix, e.g. "drafts/section1/p1.png". The identity key. */
  readonly key: string;
  /** Resolved content-addressed download URL (the `artifact-file` meta's flattened value). */
  readonly downloadUrl: string;
  /** basename(key) — leaf filename shown in the row and used as the `download` attr. */
  readonly filename: string;
  /** dirname(key) split on "/", e.g. ["drafts","section1"] (empty = root-level file). */
  readonly folderSegments: readonly string[];
  /** Rich note content from a matching `artifact-note:<path>` meta, or []. */
  readonly note: readonly Content[];
  /** Provenance from a matching `artifact-source:<path>` meta (typically a `\cite`), or []. */
  readonly source: readonly Content[];
}

/** A node in the rendered folder tree (built from all artifacts of one tree). */
export interface ArtifactFolder {
  /** "" for the synthetic root; otherwise the folder segment name. */
  readonly name: string;
  /** Child folders, in first-seen order. */
  readonly folders: readonly ArtifactFolder[];
  /** Files directly in this folder, in declaration order. */
  readonly leaves: readonly Artifact[];
}

const FILE_PREFIX = "artifact-file:";
const NOTE_PREFIX = "artifact-note:";
const SOURCE_PREFIX = "artifact-source:";

/**
 * Build the ordered artifact list for ONE tree from its frontmatter metas.
 *
 * Order = declaration order of the `artifact-file` metas (so inline-ref sequence
 * numbers are stable and author-predictable). Notes are matched by key. Duplicate
 * `artifact-file` keys: first wins. An `artifact-note` with no matching
 * `artifact-file` is ignored (no orphan rows).
 */
export const collectArtifacts = (metas: readonly FrMeta[]): Artifact[] => {
  const noteByKey = new Map<string, readonly Content[]>();
  const sourceByKey = new Map<string, readonly Content[]>();
  for (const m of metas) {
    if (m.name.startsWith(NOTE_PREFIX)) noteByKey.set(m.name.slice(NOTE_PREFIX.length), m.children);
    else if (m.name.startsWith(SOURCE_PREFIX)) sourceByKey.set(m.name.slice(SOURCE_PREFIX.length), m.children);
  }

  const seen = new Set<string>();
  const out: Artifact[] = [];
  for (const m of metas) {
    if (!m.name.startsWith(FILE_PREFIX)) continue;
    const key = m.name.slice(FILE_PREFIX.length);
    if (seen.has(key)) continue;
    seen.add(key);
    const segs = key.split("/");
    out.push({
      key,
      downloadUrl: m.value,
      filename: segs.at(-1) ?? key,
      folderSegments: segs.slice(0, -1),
      note: noteByKey.get(key) ?? [],
      source: sourceByKey.get(key) ?? [],
    });
  }
  return out;
};

// Mutable builder mirror of ArtifactFolder, narrowed to the readonly shape on return.
interface FolderBuilder {
  name: string;
  readonly folders: FolderBuilder[];
  readonly leaves: Artifact[];
}

/** Group an ordered artifact list into a first-seen-ordered folder tree (root name=""). */
export const buildArtifactFolders = (artifacts: readonly Artifact[]): ArtifactFolder => {
  const root: FolderBuilder = { name: "", folders: [], leaves: [] };
  for (const a of artifacts) {
    let cursor = root;
    for (const segment of a.folderSegments) {
      let child = cursor.folders.find((f) => f.name === segment);
      if (!child) {
        child = { name: segment, folders: [], leaves: [] };
        cursor.folders.push(child);
      }
      cursor = child;
    }
    cursor.leaves.push(a);
  }
  return root;
};

/** Lowercase file extension of a path/filename/url ("" if none). */
export const extOf = (nameOrUrl: string): string => {
  const base = nameOrUrl.split(/[?#]/)[0] ?? nameOrUrl; // drop any query/fragment
  const dot = base.lastIndexOf(".");
  const slash = Math.max(base.lastIndexOf("/"), base.lastIndexOf("\\"));
  return dot > slash ? base.slice(dot + 1).toLowerCase() : "";
};

const IMAGE_EXTS: ReadonlySet<string> = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp", "ico"]);

/** Whether an extension names a browser-renderable raster/vector image. */
export const isImageExt = (ext: string): boolean => IMAGE_EXTS.has(ext);

// Extension → highlight.js language class (used by code embeds; shared with the
// inline-assets build stage). Unknown extensions fall back to "plaintext".
const EXT_TO_LANG: Readonly<Record<string, string>> = {
  py: "python", ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
  rs: "rust", go: "go", c: "c", h: "c", cpp: "cpp", cc: "cpp", hpp: "cpp", cs: "csharp",
  java: "java", kt: "kotlin", swift: "swift", rb: "ruby", php: "php", lua: "lua",
  hs: "haskell", ml: "ocaml", mli: "ocaml", ex: "elixir", erl: "erlang", clj: "clojure",
  scala: "scala", jl: "julia", r: "r", sh: "bash", bash: "bash", zsh: "bash", fish: "bash",
  ps1: "powershell", sql: "sql", json: "json", yaml: "yaml", yml: "yaml", toml: "toml",
  xml: "xml", html: "xml", css: "css", scss: "scss", md: "markdown", tex: "latex",
  dockerfile: "dockerfile", make: "makefile", lean: "lean", txt: "plaintext", text: "plaintext",
};

/** Map a file extension to a highlight.js language token (default "plaintext"). */
export const extToLang = (ext: string): string => EXT_TO_LANG[ext] ?? "plaintext";
