/**
 * Example sidecar figure. Referenced from a tree with `\d3{histogram}`.
 *
 * Every figure exports `render(ctx)`. The filename (sans .ts) is the name you
 * pass to \d3. Full d3 typings + your strict-TS config apply here — this is the
 * whole point of the sidecar path over inline.
 */
import { type FigureContext } from "@d3-runtime";

export const render = ({ el, width, d3, theme, params }: FigureContext): void => {
  const bins = Number(params.bins ?? "24");
  const n = Number(params.n ?? "800");

  // Deterministic sample (seeded) so the build output is stable across runs.
  const rng = d3.randomNormal.source(d3.randomLcg(0.42))(0, 1);
  const data = d3.range(n).map(() => rng());

  const height = 260;
  const margin = { top: 12, right: 12, bottom: 28, left: 36 };
  const innerW = Math.max(width - margin.left - margin.right, 10);
  const innerH = height - margin.top - margin.bottom;

  const x = d3
    .scaleLinear()
    .domain(d3.extent(data) as [number, number])
    .nice()
    .range([0, innerW]);

  const binned = d3
    .bin<number, number>()
    .domain(x.domain() as [number, number])
    .thresholds(x.ticks(bins))(data);

  const y = d3
    .scaleLinear()
    .domain([0, d3.max(binned, (b) => b.length) ?? 0])
    .nice()
    .range([innerH, 0]);

  const svg = d3
    .select(el)
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("width", "100%")
    .attr("height", height)
    .attr("font-family", theme.fontFamily);

  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  g.append("g")
    .selectAll("rect")
    .data(binned)
    .join("rect")
    .attr("x", (b) => x(b.x0 ?? 0) + 1)
    .attr("width", (b) => Math.max(0, x(b.x1 ?? 0) - x(b.x0 ?? 0) - 1))
    .attr("y", (b) => y(b.length))
    .attr("height", (b) => innerH - y(b.length))
    .attr("fill", theme.palette.accents[0] ?? theme.palette.link)
    .attr("rx", 1.5);

  const axisColor = theme.palette.muted;
  const xAxis = g
    .append("g")
    .attr("transform", `translate(0,${innerH})`)
    .call(d3.axisBottom(x).ticks(6).tickSizeOuter(0));
  const yAxis = g.append("g").call(d3.axisLeft(y).ticks(5).tickSizeOuter(0));

  for (const axis of [xAxis, yAxis]) {
    axis.selectAll("text").attr("fill", axisColor).attr("font-size", 11);
    axis.selectAll("line,path").attr("stroke", axisColor).attr("stroke-opacity", 0.4);
  }
};
