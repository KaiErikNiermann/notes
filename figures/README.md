# d3 figures

Force-directed, charts, diagrams — any [d3](https://d3js.org) visualization that
renders inline between prose on the notes site. Two ways to author one.

## Sidecar (default — use this)

1. Add `figures/<name>.ts` exporting `render(ctx)`:

   ```ts
   import { type FigureContext } from "@d3-runtime";

   export const render = ({ el, width, d3, theme, params }: FigureContext): void => {
     // append into `el`; size against `width`; color from `theme.palette`.
   };
   ```

2. Reference it from a tree at the point it should appear:

   ```
   \p{...prose...}
   \d3{name}
   \p{...prose...}
   ```

### Per-call params

`\d3{name}` takes no params. To tune a figure from the call site, use `\d3p`:

```
\d3p{histogram}{bins=40; n=1200}
```

The param string is `key=value` (or `key: value`) entries separated by `;`, `,`,
or newlines. They arrive as `ctx.params` (all string values — `Number(...)` them
in the figure). Hand-written `data-d3-<key>` attributes also land in `ctx.params`
and win over the bulk string on conflict. Inline figures have `\d3inlinep{name}{params}{body}`.

You get full d3 typings, your strict-TS config, linting, and real error
reporting. `ctx.d3` is the entire d3 namespace; `ctx.theme` is read live from the
site's CSS variables, so figures match dark/light and re-render on toggle.

## Inline (throwaway escape hatch)

For a genuine one-liner you don't want a file for. **No** highlighting or
type-checking — graduate to a sidecar the moment it grows past a few lines.

```
\d3inline{sketch}{\startverb
  d3.select(el).append("svg")
    .attr("width", width).attr("height", 80)
    .append("circle").attr("cx", 40).attr("cy", 40).attr("r", 30)
    .attr("fill", theme.palette.link);
\stopverb}
```

The body runs with `d3`, `el`, `theme`, `width`, `height`, `params` in scope.

## How it ships

The `d3-figures` build stage bundles this directory + the runtime
(`theme/dev/javascript-source/d3/runtime.ts`) into
`output/notes/d3-assets/figures.js` via esbuild. `forester.js` lazy-imports that
bundle **only on pages that contain a figure**, so d3 (~90 KB gzip) never loads
elsewhere. The site's graph view (`/graph`) ships its own bundled d3 in its
vendored artifact and is intentionally independent of this runtime.
