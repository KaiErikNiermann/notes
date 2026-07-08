/**
 * Notes-site theme for the forest graph view. Maps the site's CSS variables
 * (--bg-color, --text-color, --code-keyword, etc.) into the renderer's
 * `Theme` contract. Loaded in /notes/graph/index.html as an ESM module via
 * `<script type="module">`.
 *
 * The renderer's `Theme` shape is documented in
 * vendor/graph-view/manifest.json + the artifact's README.
 *
 * `setTheme()` is called whenever the user toggles dark/light; the renderer
 * re-paints without rerunning the simulation.
 */

type Mode = "dark" | "light";

const taxaPalette: ReadonlyArray<readonly [number, number, number]> = [
  // soft, slightly desaturated picks that read well in both modes
  [110, 168, 254], // blue
  [255, 173, 96], // orange
  [126, 211, 33], // green
  [233, 130, 219], // pink
  [255, 215, 64], // yellow
  [134, 219, 199], // teal
  [196, 154, 235], // violet
  [255, 138, 128], // coral
];

const rgb = (r: number, g: number, b: number, a = 1): string =>
  a < 1 ? `rgba(${r},${g},${b},${a})` : `rgb(${r},${g},${b})`;

const taxaMap = (mode: Mode): Record<string, string> => {
  // Site uses CSS variables for taxon highlighting, but the renderer needs
  // concrete colors at theme-build time. We map a small curated set of
  // common taxa; the rest fall through to the renderer's deterministic
  // hash → palette mapping.
  const tint = mode === "dark" ? 0 : -20; // darken slightly for light mode
  const adj = (c: readonly [number, number, number]): string => {
    const [r, g, b] = c;
    const clamp = (v: number): number => Math.max(0, Math.min(255, v + tint));
    return rgb(clamp(r), clamp(g), clamp(b));
  };
  return {
    Definition: adj(taxaPalette[0]!),
    Example: adj(taxaPalette[1]!),
    Reference: adj(taxaPalette[2]!),
    Note: adj(taxaPalette[3]!),
    Blog: adj(taxaPalette[4]!),
    Test: adj(taxaPalette[5]!),
    Person: adj(taxaPalette[6]!),
    Theorem: adj(taxaPalette[7]!),
  };
};

export const buildNotesTheme = (mode: Mode) => ({
  palette: {
    background: mode === "dark" ? "#0f1117" : "#ffffff",
    foreground: mode === "dark" ? "#f4f6ff" : "#1b1b21",
    muted: mode === "dark" ? "#c4cbdd" : "#555555",
    taxa: taxaMap(mode),
    edges: {
      transclude: mode === "dark" ? "#86c5ff" : "#174d8b",
      import: "#7ed321",
      export: "#ffad60",
      ref: mode === "dark" ? "#c49aeb" : "#7a3dc4",
    },
    highlight: mode === "dark" ? "rgba(134,197,255,0.18)" : "rgba(23,77,139,0.10)",
    hover: mode === "dark" ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
  },
  typography: {
    fontFamily:
      "'Inria Sans', 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
    fontSize: 12,
    labelScale: 1,
  },
  dimensions: {
    nodeRadiusRange: [5, 24] as readonly [number, number],
    edgeStrokeWidth: 1.2,
    arrowSize: 6,
  },
});

export const detectMode = (): Mode =>
  document.body?.getAttribute("data-theme") === "light" ? "light" : "dark";
