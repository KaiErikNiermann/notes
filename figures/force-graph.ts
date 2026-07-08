/**
 * Reactive force-directed graph rendered inline via `\d3{force-graph}` (or
 * `\d3p{force-graph}{...}` for params). Demonstrates animated + interactive
 * figures and the three containment strategies from the runtime:
 *
 *   mode=contain (default) — hard box walls; dragged nodes can't escape view.
 *                            Best for small/medium graphs that fit naturally.
 *   mode=fit               — let the layout spread, continuously scale the whole
 *                            scene so it always frames in view (no clipping).
 *   mode=zoom              — fit once on settle, then pan/zoom to explore. Best
 *                            for large/dense graphs. Node-drag is off here.
 *
 * Params: nodes (count), height (px), mode (contain|fit|zoom).
 * Returns a teardown that stops the simulation across re-renders.
 */
import {
  type FigureContext,
  d3,
  clamp,
  boundsOf,
  fitTransform,
  attachZoom,
  addOverlayButton,
} from "@d3-runtime";

// Lucide "scan" — a frame with corner ticks; reads as "fit / reset to frame".
const RESET_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/></svg>';

interface Node extends d3.SimulationNodeDatum {
  id: string;
  group: number;
}

interface Link extends d3.SimulationLinkDatum<Node> {
  source: string | Node;
  target: string | Node;
  value: number;
}

type Mode = "contain" | "fit" | "zoom";

const NODE_RADIUS = 8;

export const render = ({ el, width, theme, params }: FigureContext): (() => void) => {
  const n = Number(params.nodes ?? "20");
  const height = Number(params.height ?? "380");
  const mode: Mode =
    params.mode === "fit" || params.mode === "zoom" ? params.mode : "contain";

  // Deterministic sample graph: spanning tree (connected) + a few cross-links.
  const rng = d3.randomLcg(0.7);
  const nodes: Node[] = d3.range(n).map((i) => ({ id: `n${i}`, group: Math.floor(rng() * 4) }));
  const links: Link[] = [];
  for (let i = 1; i < n; i++) {
    links.push({ source: `n${i}`, target: `n${Math.floor(rng() * i)}`, value: 1 });
  }
  for (let k = 0; k < Math.round(n / 3); k++) {
    const a = Math.floor(rng() * n);
    const b = Math.floor(rng() * n);
    if (a !== b) links.push({ source: `n${a}`, target: `n${b}`, value: 1 });
  }

  const accents = theme.palette.accents;
  const color = (group: number): string => accents[group % accents.length] ?? theme.palette.link;

  const svg = d3
    .select(el)
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("width", "100%")
    .attr("height", height)
    .attr("font-family", theme.fontFamily)
    .style("cursor", mode === "zoom" ? "move" : "grab");

  // Everything lives inside `inner`; fit/zoom drive its transform, the links and
  // nodes stay in raw simulation coordinates so drag math needs no inversion.
  const inner = svg.append("g");

  const linkSel = inner
    .append("g")
    .attr("stroke", theme.palette.muted)
    .attr("stroke-opacity", 0.45)
    .selectAll<SVGLineElement, Link>("line")
    .data(links)
    .join("line")
    .attr("stroke-width", (d) => Math.sqrt(d.value));

  const nodeSel = inner
    .append("g")
    .attr("stroke", theme.palette.bg)
    .attr("stroke-width", 1.5)
    .selectAll<SVGCircleElement, Node>("circle")
    .data(nodes)
    .join("circle")
    .attr("r", NODE_RADIUS)
    .attr("fill", (d) => color(d.group));

  nodeSel.append("title").text((d) => d.id);

  const viewport = { width, height };
  const applyFit = (): void => {
    const box = boundsOf(nodes, NODE_RADIUS);
    if (!box) return;
    const t = fitTransform(box, viewport, { padding: 24 });
    if (t) inner.attr("transform", `translate(${t.x},${t.y}) scale(${t.k})`);
  };

  let zoom: d3.ZoomBehavior<SVGSVGElement, unknown> | null = null;
  const fittedZoom = (): d3.ZoomTransform | null => {
    const box = boundsOf(nodes, NODE_RADIUS);
    if (!box) return null;
    const t = fitTransform(box, viewport, { padding: 24 });
    return t ? d3.zoomIdentity.translate(t.x, t.y).scale(t.k) : null;
  };
  if (mode === "zoom") {
    zoom = attachZoom(svg, inner, { min: 0.15, max: 6 });
    addOverlayButton(el, {
      label: "Reset view",
      icon: RESET_ICON,
      onClick: () => {
        const t = fittedZoom();
        if (t && zoom) svg.transition().duration(400).call(zoom.transform, t);
      },
    });
  }

  const simulation = d3
    .forceSimulation<Node>(nodes)
    .force("link", d3.forceLink<Node, Link>(links).id((d) => d.id).distance(42))
    .force("charge", d3.forceManyBody().strength(-170))
    .force("center", d3.forceCenter(width / 2, height / 2))
    .force("collide", d3.forceCollide(NODE_RADIUS + 4))
    .on("tick", () => {
      // contain: hard walls keep every node (incl. dragged) inside the frame.
      if (mode === "contain") {
        for (const d of nodes) {
          d.x = clamp(d.x ?? 0, NODE_RADIUS, width - NODE_RADIUS);
          d.y = clamp(d.y ?? 0, NODE_RADIUS, height - NODE_RADIUS);
        }
      }
      linkSel
        .attr("x1", (d) => (d.source as Node).x ?? 0)
        .attr("y1", (d) => (d.source as Node).y ?? 0)
        .attr("x2", (d) => (d.target as Node).x ?? 0)
        .attr("y2", (d) => (d.target as Node).y ?? 0);
      nodeSel.attr("cx", (d) => d.x ?? 0).attr("cy", (d) => d.y ?? 0);
      // fit: re-frame every tick so the spreading layout never clips. Cheap —
      // bounds come from node data, not a getBBox reflow.
      if (mode === "fit") applyFit();
    })
    // zoom: frame once when the layout settles, then hand control to the user.
    .on("end", () => {
      if (mode === "zoom" && zoom) {
        const t = fittedZoom();
        if (t) svg.call(zoom.transform, t);
      }
    });

  // Node drag (contain + fit). Zoom mode navigates instead of rearranging.
  if (mode !== "zoom") {
    const drag = d3
      .drag<SVGCircleElement, Node>()
      .on("start", (event, d) => {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on("drag", (event, d) => {
        if (mode === "contain") {
          d.fx = clamp(event.x, NODE_RADIUS, width - NODE_RADIUS);
          d.fy = clamp(event.y, NODE_RADIUS, height - NODE_RADIUS);
        } else {
          d.fx = event.x;
          d.fy = event.y;
        }
      })
      .on("end", (event, d) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });
    nodeSel.call(drag);
  }

  return () => simulation.stop();
};
