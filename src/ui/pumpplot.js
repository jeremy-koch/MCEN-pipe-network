// pumpplot.js -- the plot for one pump.
//
// Two panels share the flow axis. Top: the pump's head curve, the flow curve
// (the head the rest of the network demands of this pump), and the
// operating point where they cross. Bottom: NPSH required by the pump and
// NPSH available from the network. Third: the pump's efficiency. In every
// panel blue belongs to the pump and orange to the network. The plot shows the numbers; reading them is
// the student's job.

import { pumpHead, pumpNpshr, pumpEfficiency } from "../solver/hydraulics.js";
import { pumpSpec } from "../solver/design.js";
import { h, fix, niceTicks } from "./util.js";

const W = 560, LEFT = 50, RIGHT = 18;
const TOP1 = 14, H1 = 190; // head panel
const TOP2 = TOP1 + H1 + 30, H2 = 120; // NPSH panel
const TOP3 = TOP2 + H2 + 30, H3 = 90; // efficiency panel
const HEIGHT = TOP3 + H3 + 40;
const PW = W - LEFT - RIGHT; // plot width

// Linear interpolation in a table (xs increasing). null outside the table.
function interp(xs, ys, x) {
  if (!xs || !xs.length || x < xs[0] || x > xs[xs.length - 1]) return null;
  let i = 1;
  while (i < xs.length - 1 && xs[i] < x) i++;
  const t = xs[i] === xs[i - 1] ? 0 : (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
  return ys[i - 1] + t * (ys[i] - ys[i - 1]);
}

// pump: the pump component.  r: its entry in result.comps.
export function pumpPlot(pump, r) {
  const spec = pumpSpec(pump);
  const link = { h0: spec.h0, a: spec.a, n0: spec.n0, n1: spec.n1, eta: spec.eta, ideal: !!pump.ideal, speed: pump.speed };
  const curve = r.curve;

  // ---- data, in display units (L/s, m) ----
  const qMaxSI = curve ? curve.Qmax : Math.max(r.runout, 1.2 * r.Q);
  const xAxis = niceTicks(qMaxSI * 1000, 6);
  const N = 80;
  const qs = Array.from({ length: N + 1 }, (_, i) => (qMaxSI * i) / N);
  const headPts = qs.map((qq) => [qq * 1000, pumpHead(link, qq)]);
  const npshrPts = qs.map((qq) => [qq * 1000, pumpNpshr(link, qq)]);
  const etaPts = qs.map((qq) => [qq * 1000, pumpEfficiency(link, qq)]);
  const demandPts = curve ? curve.Q.map((qq, i) => [qq * 1000, curve.demand[i]]) : [];
  const npshaPts = curve ? curve.Q.map((qq, i) => [qq * 1000, curve.npsha[i]]) : [];

  const lift = demandPts.length ? demandPts[0][1] : 0;
  const y1 = niceTicks(1.12 * Math.max(r.shutoff, Math.min(lift, 2 * r.shutoff), r.head), 5);
  const npshTop = Math.max(...npshrPts.map((p) => p[1]), ...npshaPts.map((p) => p[1]), r.npsha, 1);
  const y2 = niceTicks(1.1 * npshTop, 4);
  const y3 = niceTicks(Math.min(1, 1.2 * spec.eta), 3);

  const X = (v) => LEFT + (PW * v) / xAxis.max;
  const Y1 = (v) => TOP1 + H1 - (H1 * v) / y1.max;
  const Y2 = (v) => TOP2 + H2 - (H2 * v) / y2.max;
  const Y3 = (v) => TOP3 + H3 - (H3 * v) / y3.max;
  const path = (pts, Y) => pts.length ? "M" + pts.map(([x, y]) => `${X(x).toFixed(1)},${Y(y).toFixed(1)}`).join(" L") : "";

  // ---- static drawing ----
  const uid = "clip" + pump.id;
  let s = `<defs>
    <clipPath id="${uid}a"><rect x="${LEFT}" y="${TOP1}" width="${PW}" height="${H1}"/></clipPath>
    <clipPath id="${uid}b"><rect x="${LEFT}" y="${TOP2}" width="${PW}" height="${H2}"/></clipPath>
    <clipPath id="${uid}c"><rect x="${LEFT}" y="${TOP3}" width="${PW}" height="${H3}"/></clipPath></defs>`;
  const frame = (top, height, axis, Y, label) => {
    let g = "";
    for (const t of axis.ticks) {
      g += `<line class="gridline" x1="${LEFT}" x2="${LEFT + PW}" y1="${Y(t)}" y2="${Y(t)}"/>
            <text class="tick" x="${LEFT - 7}" y="${Y(t) + 4}" text-anchor="end">${t}</text>`;
    }
    for (const t of xAxis.ticks) g += `<line class="gridline" x1="${X(t)}" x2="${X(t)}" y1="${top}" y2="${top + height}"/>`;
    g += `<line class="axisline" x1="${LEFT}" x2="${LEFT + PW}" y1="${top + height}" y2="${top + height}"/>
          <text class="axislabel" x="${LEFT + 6}" y="${top + 13}">${label}</text>`;
    return g;
  };
  s += frame(TOP1, H1, y1, Y1, "head [m]");
  s += frame(TOP2, H2, y2, Y2, "NPSH [m]");
  s += frame(TOP3, H3, y3, Y3, "efficiency η");
  for (const t of xAxis.ticks) {
    s += `<text class="tick" x="${X(t)}" y="${TOP3 + H3 + 16}" text-anchor="middle">${t}</text>`;
  }
  s += `<text class="axislabel" x="${LEFT + PW / 2}" y="${HEIGHT - 6}" text-anchor="middle">flow rate Q through this pump [L/s]</text>`;

  const dim = r.on ? "" : " dim";
  s += `<g clip-path="url(#${uid}a)">
      <path class="series network" d="${path(demandPts, Y1)}"/>
      <path class="series pump${dim}" d="${path(headPts, Y1)}"/></g>
    <g clip-path="url(#${uid}b)">
      <path class="series network" d="${path(npshaPts, Y2)}"/>
      <path class="series pump${dim}" d="${path(npshrPts, Y2)}"/></g>
    <g clip-path="url(#${uid}c)">
      <path class="series pump${dim}" d="${path(etaPts, Y3)}"/></g>`;

  if (r.on) {
    const qx = X(r.Q * 1000);
    s += `<line class="opline" x1="${qx}" x2="${qx}" y1="${TOP1}" y2="${TOP3 + H3}"/>
      <circle class="dot pump" cx="${qx}" cy="${Y3(Math.min(r.eta, y3.max))}" r="4.5"/>
      <circle class="oppoint" cx="${qx}" cy="${Y1(r.head)}" r="5.5"/>
      <circle class="dot network" cx="${qx}" cy="${Math.max(TOP2, Y2(Math.max(r.npsha, 0)))}" r="4.5"/>
      <circle class="dot pump" cx="${qx}" cy="${Y2(r.npshr)}" r="4.5"/>`;
  }
  s += `<line class="cross" x1="0" x2="0" y1="${TOP1}" y2="${TOP3 + H3}" visibility="hidden"/>
    <rect class="hover" x="${LEFT}" y="${TOP1}" width="${PW}" height="${TOP3 + H3 - TOP1}" fill="transparent"/>`;

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${HEIGHT}`);
  svg.setAttribute("class", "pumpplot");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `Head, NPSH and efficiency against flow rate for ${pump.name}`);
  svg.innerHTML = s;

  // ---- hover readout: the value of every curve at the pointer's Q ----
  const tip = h("div", { class: "plot-tip", hidden: true });
  const cross = svg.querySelector(".cross");
  const hover = svg.querySelector(".hover");
  const row = (cls, label, v, unit = " m", dec = 2) => (v === null ? "" : `<div><i class="sw ${cls}"></i>${label}<b>${fix(v, dec)}${unit}</b></div>`);
  hover.addEventListener("pointermove", (e) => {
    const box = svg.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    const qL = Math.min(xAxis.max, Math.max(0, ((px - LEFT) / PW) * xAxis.max));
    const qSI = qL / 1000;
    cross.setAttribute("x1", X(qL)); cross.setAttribute("x2", X(qL));
    cross.setAttribute("visibility", "visible");
    tip.innerHTML = `<div class="tip-q">Q = ${fix(qL, 2)} L/s</div>` +
      row("pump", "pump head", qSI <= qMaxSI ? pumpHead(link, qSI) : null) +
      row("network", "head demanded", curve ? interp(curve.Q, curve.demand, qSI) : null) +
      row("pump", "NPSH required", qSI <= qMaxSI ? pumpNpshr(link, qSI) : null) +
      row("network", "NPSH available", curve ? interp(curve.Q, curve.npsha, qSI) : null) +
      row("pump", "efficiency η", qSI <= qMaxSI ? pumpEfficiency(link, qSI) : null, "", 3);
    tip.hidden = false;
    const frac = (e.clientX - box.left) / box.width;
    tip.style.left = frac < 0.6 ? `${e.clientX - box.left + 14}px` : "";
    tip.style.right = frac < 0.6 ? "" : `${box.right - e.clientX + 14}px`;
    tip.style.top = `${Math.max(0, e.clientY - box.top - 20)}px`;
  });
  hover.addEventListener("pointerleave", () => { tip.hidden = true; cross.setAttribute("visibility", "hidden"); });

  const legend = h("div", { class: "legend" },
    h("span", {}, h("i", { class: "sw pump" }), "this pump: head curve, NPSH required, efficiency"),
    h("span", {}, h("i", { class: "sw network" }), "the network: flow curve, NPSH available"),
    r.on ? h("span", {}, h("i", { class: "sw op" }), "operating point") : null);
  const missing = curve ? null : h("p", { class: "help" },
    "No flow curve is drawn for this pump: with the pump taken out, part of the network has no tank to set its head.");
  return h("div", { class: "plot-wrap" }, legend, h("div", { class: "plot-box" }, svg, tip), missing);
}
