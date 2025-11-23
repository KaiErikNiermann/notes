# Deployment workflow

This project now relies on locally built Forester output instead of performing the OCaml/Forester build inside GitHub Actions. The `output/notes/` directory must therefore be up to date and committed before you push to `main`.

## Local pre-push hook

1. Point Git to the tracked hooks directory once per clone:

   ```bash
   git config core.hooksPath .githooks
   ```

2. The hook runs `npm run build` (which uses your locally patched Forester binary), verifies that `output/notes/index.html` exists, and blocks the push if `output/notes/` contains unstaged changes.

You can always run the same logic manually with `bash .githooks/pre-push`.

## Build instructions

- Use your custom Forester binary to generate the static site: `npm run build`.
- Stage and commit the updated `output/notes/` contents alongside your source changes.
- Push to `main`; CI will only upload the already-built `output/notes/` directory to GitHub Pages.

## GitHub Actions

The `.github/workflows/gh-pages.yml` workflow now simply checks for the presence of committed artifacts under `output/notes/` and uploads them. If the directory is missing or empty, the workflow fails with guidance to rerun the local build.
