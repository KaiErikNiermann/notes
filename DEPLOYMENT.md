# Deployment workflow

The forest is **built in CI**, not locally. GitHub Actions runs the whole build
inside the [`forester-ci`](https://github.com/KaiErikNiermann/forester) image
(forester binary + LaTeX toolchain + Node/pnpm) and publishes the result to
GitHub Pages. `output/` is generated in CI and is **not** committed to git.

## What you do

1. Edit trees / theme / build code.
2. Push to `main`.
3. `.github/workflows/gh-pages.yml` builds and deploys automatically.

That's it — no local Forester or LaTeX install is required to publish.

## Local authoring (optional)

For live preview while writing you still want a local Forester:

- `just new` — scaffold a note
- `just serve` — live-reloading dev server
- `just build` — full local build into `output/` (needs `forester` + a TeX
  distro with `latex` + `dvisvgm` on your PATH)

The pre-push hook (husky) runs `pnpm run check && pnpm run test:render`
(lint + typecheck + render tests) — it does **not** build the site, since that
is CI's job.

## The forester version

The image tag in `.github/workflows/gh-pages.yml`
(`ghcr.io/kaierikniermann/forester-ci:vX.Y.Z`) is the single source of truth for
the forester version. To upgrade:

1. Tag a release in `KaiErikNiermann/forester` (`git tag vX.Y.Z && git push --tags`);
   its `release.yml` builds and pushes the new image.
2. Bump the tag in `gh-pages.yml`.

## Lean / verso snippets

Lean is not in the CI image. The `verso` stage reuses the committed
`build/verso/*.html` fragments and `output/notes/verso-assets/*`. Regenerate
them locally (with `lake` installed) only when you change Lean snippets; commit
the updated fragments/assets alongside the source change.
