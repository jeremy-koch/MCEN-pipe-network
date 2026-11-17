// chart.js -- one small line chart, drawn as SVG. The Sweep, Grade line and
// Moody plots all use it.
//
//   lineChart({
//     x: { label, log, min, max, ticks },   min and max are optional; ticks
//                                       ([{ v, text }]) replaces the usual ones
//     y: { label, log, min, max },
//     series: [{ name, pts: [[x, y], ...], color, dash, thin, endLabel }],
//     points: [{ x, y, title, color }],              dots, with a hover title
//     vlines: [{ x, label }],                        dashed vertical markers
//     stations: [{ x, name }],                       names along the top edge
//     tip: (x) => html or null,     hover readout; x is in data units
//     snap: [x, ...],               hover snaps to the nearest of these
//     legend: true,
//   })  ->  { el, svg }
//
// A y of null breaks the line there.

import { h, esc, fmt } from "./util.js";

export const COLORS = ["#2a78d6", "#eb6834", "#3c9a5f", "#8e5bd0", "#c4487a", "#0e8f9b", "#a67c00", "#5f7386"];

const W = 680, H = 344, LEFT = 58, RIGHT = 20, TOP = 40, BOTTOM = 44;
const PW = W - LEFT - RIGHT, PH = H - TOP - BOTTOM;

function linearAxis(lo, hi, target) {
  if (!(hi > lo)) { const pad = Math.abs(lo) * 0.1 || 1; lo -= pad; hi += pad; }
  const raw = (hi - lo) / target;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw);
  const a = Math.floor(lo / step + 1e-9) * step, b = Math.ceil(hi / step - 1e-9) * step;
  const ticks = [];
  for (let v = a; v <= b + step * 1e-6; v += step) ticks.push(Number(v.toPrecision(12)));
  return { lo: a, hi: b, ticks: ticks.map((v) => ({ v, text: fmt(v, 4) })), pos: (v) => (v - a) / (b - a) };
}

// A log axis. With `exact` the axis runs from lo to hi as given; otherwise
// it is widened to whole decades.
function logAxis(lo, hi, exact) {
  const a = Math.floor(Math.log10(lo) + 1e-9), b = Math.ceil(Math.log10(hi) - 1e-9);
  const [l0, l1] = exact ? [Math.log10(lo), Math.log10(hi)] : [a, b];
  const ticks = [];
  for (let k = a; k <= b; k++) {
    // with only a decade or two on the axis, label 2 and 5 as well
    for (const m of l1 - l0 <= 2.5 ? [1, 2, 5] : [1]) {
      const v = m * 10 ** k;
      if (Math.log10(v) < l0 - 1e-9 || Math.log10(v) > l1 + 1e-9) continue;
      ticks.push({ v, text: m === 1 && (k < -3 || k > 3) ? `1e${k}` : fmt(v, 1) });
    }
  }
  return { lo: 10 ** l0, hi: 10 ** l1, ticks, pos: (v) => (Math.log10(v) - l0) / (l1 - l0) };
}

export function lineChart(opt) {
  const series = opt.series.map((s, i) => ({ color: COLORS[i % COLORS.length], ...s }));
  const dots = opt.points || [];
  const all = series.flatMap((s) => s.pts).concat(dots.map((p) => [p.x, p.y])).filter((p) => p[1] !== null && Number.isFinite(p[1]));
  const range = (axis, i) => {
    const vals = all.map((p) => p[i]);
    let lo = axis.min ?? (vals.length ? Math.min(...vals) : 0), hi = axis.max ?? (vals.length ? Math.max(...vals) : 1);
    if (!axis.log && axis.min === undefined && i === 1) { const pad = 0.06 * (hi - lo); lo -= pad; hi += pad; }
    if (axis.log) return logAxis(lo, hi, axis.min !== undefined && axis.max !== undefined);
    if (axis.ticks) return { lo, hi, ticks: axis.ticks, pos: (v) => (v - lo) / (hi - lo) };
    return linearAxis(lo, hi, i === 0 ? 7 : 5);
  };
  const ax = range(opt.x, 0), ay = range(opt.y, 1);
  const X = (v) => LEFT + PW * ax.pos(v), Y = (v) => TOP + PH * (1 - ay.pos(v));

  let s = `<defs><clipPath id="chartclip"><rect x="${LEFT}" y="${TOP}" width="${PW}" height="${PH}"/></clipPath></defs>`;
  for (const t of ay.ticks) {
    s += `<line class="gridline" x1="${LEFT}" x2="${LEFT + PW}" y1="${Y(t.v)}" y2="${Y(t.v)}"/>
      <text class="tick" x="${LEFT - 7}" y="${Y(t.v) + 4}" text-anchor="end">${t.text}</text>`;
  }
  for (const t of ax.ticks) {
    s += `<line class="gridline" x1="${X(t.v)}" x2="${X(t.v)}" y1="${TOP}" y2="${TOP + PH}"/>
      <text class="tick" x="${X(t.v)}" y="${TOP + PH + 16}" text-anchor="middle">${t.text}</text>`;
  }
  s += `<line class="axisline" x1="${LEFT}" x2="${LEFT + PW}" y1="${TOP + PH}" y2="${TOP + PH}"/>
    <line class="axisline" x1="${LEFT}" x2="${LEFT}" y1="${TOP}" y2="${TOP + PH}"/>
    <text class="axislabel" x="${LEFT + PW / 2}" y="${H - 8}" text-anchor="middle">${esc(opt.x.label)}</text>
    <text class="axislabel" transform="translate(14,${TOP + PH / 2}) rotate(-90)" text-anchor="middle">${esc(opt.y.label)}</text>`;

  // Names along the top edge, dropped to a second row where they would collide.
  const lastX = [-1e9, -1e9, -1e9];
  for (const st of opt.stations || []) {
    const px = X(st.x);
    const row = lastX.findIndex((x) => px - x > 62);
    s += `<line class="station" x1="${px}" x2="${px}" y1="${TOP}" y2="${TOP + PH}"/>`;
    if (row >= 0) {
      lastX[row] = px;
      const anchor = px < LEFT + 30 ? "start" : px > LEFT + PW - 30 ? "end" : "middle";
      s += `<text class="tick station-name" x="${px}" y="${TOP - 29 + row * 12}" text-anchor="${anchor}">${esc(st.name)}</text>`;
    }
  }
  for (const v of opt.vlines || []) {
    if (!(ax.pos(v.x) >= 0 && ax.pos(v.x) <= 1)) continue;
    s += `<line class="opline" x1="${X(v.x)}" x2="${X(v.x)}" y1="${TOP}" y2="${TOP + PH}"/>
      <text class="tick" x="${X(v.x) + 4}" y="${TOP + 11}">${esc(v.label)}</text>`;
  }

  s += `<g clip-path="url(#chartclip)">`;
  for (const sr of series) {
    let d = "", pen = false;
    for (const [x, y] of sr.pts) {
      if (y === null || !Number.isFinite(y) || (opt.y.log && !(y > 0)) || (opt.x.log && !(x > 0))) { pen = false; continue; }
      d += `${pen ? "L" : "M"}${X(x).toFixed(1)},${Y(y).toFixed(1)} `;
      pen = true;
    }
    s += `<path class="series${sr.thin ? " thin" : ""}" style="stroke:${sr.color}${sr.dash ? ";stroke-dasharray:" + sr.dash : ""}" d="${d}"/>`;
  }
  s += "</g>";
  for (const sr of series) {
    const end = sr.endLabel ? [...sr.pts].reverse().find((p) => p[1] !== null) : null;
    if (end) s += `<text class="tick" x="${X(end[0]) - 4}" y="${Y(end[1]) - 4}" text-anchor="end">${esc(sr.endLabel)}</text>`;
  }
  for (const p of dots) {
    s += `<circle class="dot" style="fill:${p.color || COLORS[0]}" cx="${X(p.x)}" cy="${Y(p.y)}" r="5"><title>${esc(p.title || "")}</title></circle>`;
  }
  if (opt.tip) {
    s += `<line class="cross" x1="0" x2="0" y1="${TOP}" y2="${TOP + PH}" visibility="hidden"/>
      <rect class="hover" x="${LEFT}" y="${TOP}" width="${PW}" height="${PH}" fill="transparent"/>`;
  }

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("class", "pumpplot chart");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `${opt.y.label} against ${opt.x.label}`);
  svg.innerHTML = s;

  const tip = h("div", { class: "plot-tip", hidden: true });
  if (opt.tip) {
    const cross = svg.querySelector(".cross"), hover = svg.querySelector(".hover");
    hover.addEventListener("pointermove", (e) => {
      const box = svg.getBoundingClientRect();
      const frac = Math.min(1, Math.max(0, (((e.clientX - box.left) / box.width) * W - LEFT) / PW));
      let x = opt.x.log ? ax.lo * (ax.hi / ax.lo) ** frac : ax.lo + frac * (ax.hi - ax.lo);
      if (opt.snap && opt.snap.length) x = opt.snap.reduce((best, v) => (Math.abs(v - x) < Math.abs(best - x) ? v : best));
      const html = opt.tip(x);
      if (!html) { tip.hidden = true; return; }
      cross.setAttribute("x1", X(x)); cross.setAttribute("x2", X(x));
      cross.setAttribute("visibility", "visible");
      tip.innerHTML = html;
      tip.hidden = false;
      const side = (e.clientX - box.left) / box.width;
      tip.style.left = side < 0.6 ? `${e.clientX - box.left + 14}px` : "";
      tip.style.right = side < 0.6 ? "" : `${box.right - e.clientX + 14}px`;
      tip.style.top = `${Math.max(0, e.clientY - box.top - 20)}px`;
    });
    hover.addEventListener("pointerleave", () => { tip.hidden = true; cross.setAttribute("visibility", "hidden"); });
  }

  const legend = opt.legend === false ? null : h("div", { class: "legend" },
    series.filter((sr) => sr.name).map((sr) => h("span", {},
      h("i", { class: "sw", style: `border-color:${sr.color}${sr.dash ? ";border-top-style:dashed" : ""}` }), sr.name)));
  return { el: h("div", { class: "plot-wrap chart-wrap" }, legend, h("div", { class: "plot-box" }, svg, tip)), svg };
}

// One row of a hover readout.
export function tipRow(color, label, value) {
  return `<div><i class="sw" style="border-color:${color}"></i>${esc(label)}<b>${value}</b></div>`;
}
