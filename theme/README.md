# Theme Layout

The theme now keeps runtime artifacts (the files Forester copies into `output/`) at the top level, while the build tooling lives under `dev/`.

```text
theme/
├─ LICENSES/ … upstream acknowledgements
├─ dev/
│  ├─ package.json + lockfile
│  ├─ node_modules/
│  ├─ javascript-source/ … unbundled JS
│  └─ bundle-js.sh … esbuild entrypoint
├─ fonts/ … static font files consumed by style.css
├─ *.xsl … templates that Forester loads directly
├─ *.css … compiled stylesheet + KaTeX skin
├─ forester.js … bundled browser script
├─ *.png / *.ico … icon set served from the root
└─ bundle-js.sh … wrapper that invokes `dev/bundle-js.sh`
```

## Working on the theme

1. `cd theme` and run `./bundle-js.sh` to (re)build `forester.js`. This calls the script under `dev/` so existing workflows stay the same.
2. Modify source files inside `theme/dev/javascript-source/` and re-run the bundler when needed.
3. Runtime files (`*.xsl`, CSS, fonts, icons) stay untouched at the top level so Forester can pick them up without reconfiguration.

The separation keeps the editable sources and heavy dependencies contained in `dev/`, making the rest of the theme folder easier to browse.
