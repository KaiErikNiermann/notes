new *args:
  #!/usr/bin/env sh
  python scripts/create_tree.py "$@"

# Generate reference trees from references.bib. Append-only by default; pass
# `--force` to re-sync existing trees, or `--add <doi|url|id>` to resolve and
# append a new entry (via citation.js) before generating. See `just refs --help`.
refs *args:
  #!/usr/bin/env sh
  pnpm exec tsx scripts/bib-to-tree.ts "$@"

# Sync this forest's generic file-set into the copier template repo at <dir>.
# Mirrors the build pipeline, theme, macros and config (see
# scripts/template-manifest.ts), parameterising personal values. Pass --dry-run
# to preview, e.g. `just sync-template ../forest-template --dry-run`.
sync-template dir *args:
  pnpm exec tsx scripts/sync-template.ts "{{ dir }}" {{ args }}

serve:
  pnpm run serve

build:
  pnpm run build

watch:
  pnpm run watch

# Use `pnpm run build -- --only <name>` for ad-hoc subsets; the verso/bundle/...
# targets are subsumed by the orchestrator's --only flag.
