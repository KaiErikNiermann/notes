# Forester dev workflow

This repository now ships with a small Node-based helper that rebuilds the forest whenever you save a tree, stylesheet, or asset and automatically refreshes the browser preview.

## Prerequisites

- Node.js 18+ (already available inside the dev container)
- `forester` CLI in your PATH (already required for normal builds)

## Commands

```bash
npm install        # only needed after cloning to pull dev dependencies
npm run build      # one-shot build with --dev metadata
npm run dev        # watch trees/theme/assets, rebuild, and live-reload preview
```

`npm run dev` spawns two processes:

1. **chokidar-cli watcher** — listens to `trees/**/*.tree`, `theme/**/*.{xsl,css}`, `theme/javascript-source/**/*.js`, `assets/**/*`, and `forest.toml`. Every time you save, it reruns `forester build forest.toml --dev`.
2. **browser-sync server** — serves the static `output/` directory on <http://localhost:1313> and live-reloads the page when the build outputs change. Inside Docker/dev containers the server is bound to `0.0.0.0`, so forwarding port `1313` to your host will expose the preview in your desktop browser. The server now treats `index.xml` as the default index and opens the browser directly at `/index.xml`, so hitting the root URL resolves to the main tree list.

Stop the dev server with `Ctrl+C`. The `.vscode/tasks.json` file registers this workflow as the default build task, so you can also run **Terminal → Run Build Task…** in VS Code to start it.
