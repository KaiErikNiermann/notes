# Forester RAG CLI

A lightweight RAG CLI for Forester `.tree` projects. It indexes trees and answers questions with citations.

## YAML Config

Create a YAML config file in the project root (any one of these names):

- `.forester-rag.yaml`
- `.forester-rag.yml`
- `forester-rag.yaml`
- `forester-rag.yml`

Example:

```yaml
# Prefer environment variables for secrets
openai_api_key: null
# optional
openai_base_url: "https://api.openai.com/v1"
```

You can also nest under `openai`:

```yaml
openai:
  api_key: null
  base_url: "https://api.openai.com/v1"
```

Use `OPENAI_API_KEY` in your shell or local untracked config. Do not commit real API keys.

## Generate Items

Generate flashcards, rubric cards, and code problems from notes using RAG. Output is written to `problems/` with a manifest under `problems/_manifests/`.

When using `--group-by tree` with `--root-tree`:

1. Organizer trees (trees with transcludes but no block content) are treated as containers and are not generated as standalone categories.
2. Group paths are flattened with a max depth of 2 under the collection root.
3. Generated items are written as `.../<random>.spec.json` files per group folder.

Example (deterministic plan from a root):

```bash
forester-rag generate --root trees/course --collection course-x
```

Example (syllabus-driven planning):

```bash
forester-rag generate --plan-mode llm --syllabus-file syllabus.txt --collection course-x
```

Common flags:

1. `--kinds flashcard --kinds rubric --kinds code`
2. `--count-flashcards 3 --count-rubrics 1 --count-code 1`
3. `--group-by tree|taxon|tag|directory`
4. `--root-tree <tree_id>` (use transclude closure as scope)
5. `--language-mode auto|fixed --language python`
6. `--verify / --no-verify`
7. `--dry-run`
8. `--source-base-url http://127.0.0.1:1313/notes`
9. `--code-model gpt-5-mini`
10. `--code-system-prompt "Use strict typing"` (repeatable)

Generated item specs now include:

1. `title` for flashcard, rubric, and code items
2. `sources` objects with `url`, `label`, and `comment` (`comment` defaults to `null`)

Additional generation/indexing behavior:

1. Retrieval is pluggable via `retrieval_backend: native|haystack` (native remains default).
2. Optional textbook manifests (`textbook_manifest_path`) support `.pdf` and `.md`/`.markdown`/`.txt`.
3. Notes and textbook chunks are merged with configurable weights (`notes_weight`, `textbook_weight`).
4. `authority_discrepancy_mode: warn` adds non-blocking warnings when note facts conflict with textbook evidence.
5. Code generation can run local verification/repair loops via `code_verify_command`, `code_verify_max_attempts`, and `code_verify_timeout_s`.
6. Manifest format details: `docs/textbook-manifest.md`.

Secrets:

1. Keep `openai.api_key` as `null` in tracked config.
2. Use `OPENAI_API_KEY` or a local untracked config override for credentials.
