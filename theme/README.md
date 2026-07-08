# Theme Layout

Runtime artifacts (the files Forester copies into `output/`) live at the top level; build tooling lives under `dev/`.

```text
theme/
├─ LICENSES/ … upstream acknowledgements
├─ dev/
│  ├─ package.json + lockfile
│  ├─ node_modules/
│  └─ javascript-source/ … unbundled JS
├─ fonts/ … static font files consumed by style.css
├─ *.css … compiled stylesheet + KaTeX skin
├─ forester.js … bundled browser script
└─ *.png / *.ico … icon set served from the root
```

**Presentation (HTML rendering)** is the typed TS renderer under
`scripts/build/render/` — it transforms Forester's compiled `<fr:tree>` XML into
HTML, replacing the former XSLT 1.0 stylesheets. Edit the renderer modules
there (with `__tests__/` for the numbering/date/ref logic); the `xslt` build
stage runs it over every `output/notes/<id>/index.xml`.

## Working on the theme

1. **Markup/layout:** edit `scripts/build/render/*.ts`. The full forest is
   re-rendered on `pnpm run build`; unit tests run via
   `pnpm exec tsx --test scripts/build/render/__tests__/`.
2. **Client JS:** run `pnpm run bundle` from the repo root to (re)build
   `forester.js` (the `bundle-js` stage drives esbuild over
   `theme/dev/javascript-source/forester.ts`). Edit sources under
   `theme/dev/javascript-source/`.
3. **CSS / fonts / icons** stay at the top level so Forester copies them into
   `output/` without reconfiguration.
