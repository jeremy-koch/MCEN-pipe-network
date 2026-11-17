// insight-tabs.js -- the tabs and cards that look at a solved network from
// another angle: grade lines along a path, where the power goes, a sweep of
// one input, the worked numbers for one pipe, and a Moody chart.
//
// As everywhere in the app: numbers and plots, no verdicts.

import { S, render } from "./state.js";
import { G, FITTINGS } from "../solver/tables.js";
import { colebrook, pipeArea, RE_LAMINAR } from "../solver/hydraulics.js";
import { gradeLine, powerBudget, sweepTargets, sweepOutputs, runSweep } from "../solver/insight.js";
import { lineChart, tipRow, COLORS } from "./chart.js";
import { plotButtons, csvButton } from "./export.js";
import { table, needSolve, pickField, kW, compName } from "./bits.js";
import { h, fmt, fix, money, esc } from "./util.js";

const rerender = () => render({ keepPanel: true });

// ---------------------------------------------------------------------------
// Grade lines
// ---------------------------------------------------------------------------

// Linear interpolation of field `key` at distance x along the path. Where
// the line jumps (a pump, a valve) the value just downstream is returned.
function along(points, key, x) {
  for (let i = points.length - 2; i >= 0; i--) {
    const a = points[i], b = points[i + 1];
    if (x < a.x || x > b.x || a[key] === null || b[key] === null) continue;
    if (b.x === a.x) return b[key];
    return a[key] + ((b[key] - a[key]) * (x - a.x)) / (b.x - a.x);
  }
  return null;
}

export function gradeTab() {
  if (S.result.status !== "solved") return [needSolve()];
  const r = S.result;
  const ends = S.design.components.filter((c) => (c.type === "tank" || c.type === "junction") && r.comps[c.id]);
  if (ends.length < 2) return [h("p", { class: "empty" }, "A grade line runs between two tanks or junctions, and this network has fewer than two.")];

  // Start with the tank the water leaves and the tank it arrives at.
  const g = S.grade;
  const has = (id) => ends.some((c) => c.id === id);
  if (!has(g.from) || !has(g.to) || g.from === g.to) {
    const into = new Map(ends.map((c) => [c.id, 0]));
    for (const p of S.design.pipes) {
      const q = r.pipes[p.id]?.Q || 0;
      if (into.has(p.to.comp)) into.set(p.to.comp, into.get(p.to.comp) + q);
      if (into.has(p.from.comp)) into.set(p.from.comp, into.get(p.from.comp) - q);
    }
    const tanks = ends.filter((c) => c.type === "tank");
    const pool = tanks.length >= 2 ? tanks : ends;
    const sorted = [...pool].sort((a, b) => into.get(a.id) - into.get(b.id));
    g.from = sorted[0].id; g.to = sorted[sorted.length - 1].id;
  }
  const via = S.sel && S.sel.kind !== "label" ? S.sel.id : null;
  const line = gradeLine(S.design, r, g.from, g.to, via);
  const options = ends.map((c) => [c.id, c.name]);
  const top = h("div", { class: "inputs-row" },
    pickField("From", options, g.from, (v) => { if (v === g.to) g.to = g.from; g.from = v; rerender(); }),
    pickField("To", options, g.to, (v) => { if (v === g.from) g.from = g.to; g.to = v; rerender(); }),
    h("button", { type: "button", onclick: () => { [g.from, g.to] = [g.to, g.from]; rerender(); } }, "Swap"));
  if (!line) return [top, h("p", { class: "empty" }, `There is no path from ${compName(g.from)} to ${compName(g.to)}.`)];

  const pts = line.points;
  const rhoG = r.fluid.rho * G;
  // Mark the distance axis at the tanks and junctions, with the true distance.
  const ticks = [];
  for (const st of line.stations) {
    if (ticks.length && (st.s === ticks[ticks.length - 1].s || st.type === "pump" || st.type === "valve")) continue;
    ticks.push({ v: st.x, s: st.s, text: line.scaled ? fmt(st.s, 4) : "" });
  }
  const chart = lineChart({
    x: { label: line.scaled ? "distance along the pipes [m]" : "position along the path (every pipe on it has zero length)", min: 0, max: pts[pts.length - 1].x, ticks },
    y: { label: "head [m]" },
    series: [
      { name: "energy grade line: p/ρg + αV²/2g + z", pts: pts.map((p) => [p.x, p.egl]), color: COLORS[0] },
      { name: "hydraulic grade line: p/ρg + z", pts: pts.map((p) => [p.x, p.hgl]), color: COLORS[1] },
      { name: "pipe elevation z", pts: pts.map((p) => [p.x, p.z]), color: COLORS[7], dash: "5 4" },
    ],
    stations: line.stations,
    tip: (x) => {
      const egl = along(pts, "egl", x), hgl = along(pts, "hgl", x), z = along(pts, "z", x);
      if (egl === null) return null;
      return `<div class="tip-q">${line.scaled ? `${fix(along(pts, "s", x), 1)} m along` : "here"}</div>` +
        tipRow(COLORS[0], "energy grade line", `${fix(egl, 2)} m`) + tipRow(COLORS[1], "hydraulic grade line", `${fix(hgl, 2)} m`) +
        (z === null ? "" : tipRow(COLORS[7], "elevation z", `${fix(z, 2)} m`) + tipRow("transparent", "gauge pressure", `${fix((rhoG * (hgl - z)) / 1000, 1)} kPa`));
    },
  });
  const names = line.stations.map((s) => s.name).join(" → ");
  return [
    top,
    h("p", { class: "help" }, `Path: ${names}. ` + (via && line.path.includes(via) ? "It passes through what is selected on the canvas." :
      "Where the network branches, select a pipe, pump or valve on the canvas and the path will go through it.")),
    chart.el,
    plotButtons(chart.svg, `${S.design.name} grade line`),
    h("p", { class: "help", html: "The energy grade line is the total head; it falls with every loss and jumps up across a pump. The hydraulic grade line sits one velocity head, αV²/2g, below it. " +
      "The gap between the hydraulic grade line and the pipe elevation is the gauge pressure head p/ρg in the pipe: where the line dips under the pipe, the gauge pressure there is negative. " +
      "Inside a pipe the loss is drawn as a straight line from end to end, because a design does not record where along the pipe each fitting sits. " +
      "Elevation is known at junctions, pumps and valves, and is drawn straight between them; a tank has only its surface elevation. " +
      "A pump, a valve or a zero-length connection has no length, but each is drawn with a little width so that its step can be seen; the distances marked on the axis are the true ones." }),
  ];
}

// ---------------------------------------------------------------------------
// Where the power goes
// ---------------------------------------------------------------------------

export function budgetTab() {
  if (S.result.status !== "solved") return [needSolve()];
  const b = powerBudget(S.design, S.result);
  const s = S.design.settings;
  const sources = [], uses = [];
  if (b.shaft > 0) sources.push(["shaft power to the pumps", b.shaft]);
  if (b.lift < 0) sources.push(["water ending up lower than it started", -b.lift]);
  if (b.pumpLoss > 0) uses.push(["lost inside the pumps (1 − η)", b.pumpLoss, COLORS[7]]);
  if (b.major > 0) uses.push(["pipe friction (major losses)", b.major, COLORS[0]]);
  if (b.minor > 0) uses.push(["fittings (minor losses)", b.minor, COLORS[3]]);
  if (b.valves > 0) uses.push(["valves", b.valves, COLORS[1]]);
  if (b.lift > 0) uses.push(["lift: raising the water", b.lift, COLORS[2]]);
  const total = sources.reduce((sum, x) => sum + x[1], 0);
  if (!(total > 0)) return [h("p", { class: "empty" }, "Nothing is flowing, so no power is going anywhere.")];

  const paid = b.shaft > 0; // a dollar figure only means something when a pump is paying
  const perYear = (W) => money((W / 1000) * s.hours_per_year * s.price_per_kWh);
  const pct = (W) => `${fix((100 * W) / total, 1)}%`;
  const head = ["", "Power [kW]", "Share"].concat(paid ? ["Energy cost per year"] : []);
  const row = (name, W, extra = {}) => ({ ...extra, cells: [name, kW(W), pct(W)].concat(paid ? [perYear(W)] : []) });
  const swatch = (name, color) => h("span", {}, h("i", { class: "sw block", style: `background:${color}` }), name);

  const bar = h("div", { class: "budget-bar", role: "img", "aria-label": "Where the power goes" },
    uses.map(([name, W, color]) => h("div", { style: `width:${(100 * W) / total}%;background:${color}`, title: `${name}: ${kW(W)} kW (${pct(W)})` },
      (100 * W) / total > 7 ? pct(W) : "")));
  const summary = table(head, [
    ...sources.map(([name, W]) => row(name, W)),
    ...(sources.length > 1 ? [row("total in", total, { total: true })] : []),
    ...uses.map(([name, W, color]) => row(swatch(name, color), W)),
  ]);
  const KIND = { "pump loss": "lost inside the pump", major: "pipe friction", minor: "fittings", valve: "valve" };
  const detail = table(["Where", "What"].concat(head.slice(1)), b.items.map((it) => {
    const isPipe = S.design.pipes.some((p) => p.id === it.id);
    return { pick: { kind: isPipe ? "pipe" : "comp", id: it.id }, sel: S.sel?.id === it.id,
      cells: [it.name, KIND[it.kind], kW(it.W), pct(it.W)].concat(paid ? [perYear(it.W)] : []) };
  }), { text: [1] });
  return [
    bar, summary, csvButton(summary, `${S.design.name} power`),
    h("h3", { class: "gap" }, "Item by item, largest first"),
    detail, csvButton(detail, `${S.design.name} power items`),
    h("p", { class: "help", html: "An energy balance on the whole network: the power going in equals the power going out. The power lost in a pipe or a valve is ρ g Q h<sub>L</sub>. " +
      "Lift is ρ g Q H summed where water leaves the network minus the same where it enters: the power that raised the water (and its pressure) from one tank to another. " +
      (paid ? `The cost column is that power × ${fmt(s.hours_per_year)} hours per year × $${fmt(s.price_per_kWh)}/kWh.` : "") }),
  ];
}

// ---------------------------------------------------------------------------
// Sweep: vary one input, plot one output
// ---------------------------------------------------------------------------

let sweepMemo = { key: "", value: null };

export function sweepTab() {
  if (S.result.status !== "solved") return [needSolve()];
  const targets = sweepTargets(S.design), outputs = sweepOutputs(S.design);
  if (!outputs.length) return [h("p", { class: "empty" }, "There is nothing to plot yet: add a pipe, a pump or a valve.")];
  const w = S.sweep;
  let target = targets.find((t) => t.key === w.target);
  if (!target) { target = targets[0]; w.target = target.key; w.lo = null; }
  if (w.lo === null || w.hi === null) [w.lo, w.hi] = target.range.map((v) => Number(v.toPrecision(4)));
  const output = outputs.find((o) => o.key === w.output) || outputs[0];
  w.output = output.key;

  const num = (label, key, unit, extra = {}) => {
    const input = h("input", { type: "number", step: "any", value: w[key], ...extra,
      onchange: () => { const v = Number(input.value); if (input.value.trim() !== "" && Number.isFinite(v)) w[key] = v; rerender(); } });
    return h("label", { class: "field inline narrow" }, h("span", { class: "lab" }, label), h("span", { class: "inp" }, input, unit ? h("span", { class: "unit" }, unit) : null));
  };
  const top = h("div", { class: "inputs-row" },
    pickField("Vary", targets.map((t) => [t.key, t.label]), target.key, (v) => { w.target = v; w.lo = w.hi = null; rerender(); }, true),
    num("from", "lo", target.unit), num("to", "hi", target.unit), num("steps", "steps", "", { min: 2, max: 101, step: 1 }),
    pickField("Plot", outputs.map((o) => [o.key, o.label + (o.unit ? ` [${o.unit}]` : "")]), output.key, (v) => { w.output = v; rerender(); }, true));
  if (!(w.hi > w.lo)) return [top, h("p", { class: "empty" }, "“to” must be larger than “from”.")];

  const key = JSON.stringify([S.design.components, S.design.pipes, S.design.settings, w]);
  if (sweepMemo.key !== key) sweepMemo = { key, value: runSweep(S.design, target, output, w.lo, w.hi, w.steps) };
  const sw = sweepMemo.value;
  const unit = (u) => (u ? ` [${u}]` : "");
  const xLabel = target.label + unit(target.unit);
  const series = sw.series.map((sr, i) => ({ name: sr.name, color: COLORS[i % COLORS.length], pts: sw.xs.map((x, k) => [x, sr.ys[k]]) }));
  const show = (v) => (v === null ? "–" : fmt(v, 4));
  const chart = lineChart({
    x: { label: xLabel, min: w.lo, max: w.hi },
    y: { label: output.label + unit(output.unit) },
    series,
    vlines: Number.isFinite(target.value) ? [{ x: target.value, label: "now" }] : [],
    snap: sw.xs,
    tip: (x) => {
      const k = sw.xs.indexOf(x);
      if (k < 0) return null;
      return `<div class="tip-q">${esc(target.label)} = ${fmt(x, 4)}${target.unit ? " " + esc(target.unit) : ""}</div>` +
        series.map((sr) => tipRow(sr.color, sr.name, `${show(sw.series[series.indexOf(sr)].ys[k])}${output.unit ? " " + esc(output.unit) : ""}`)).join("");
    },
  });
  const tbl = table([esc(xLabel), ...sw.series.map((sr) => esc(sr.name + unit(output.unit)))],
    sw.xs.map((x, k) => ({ cells: [fmt(x, 4), ...sw.series.map((sr) => show(sr.ys[k]))] })));
  return [
    top,
    sw.failed ? h("p", { class: "help" }, `The network could not be solved at ${sw.failed} of the ${sw.xs.length} steps; the lines have gaps there.`) : null,
    chart.el,
    plotButtons(chart.svg, `${S.design.name} sweep`),
    h("p", { class: "help" }, "Everything else in the design is held as it is on the canvas while this one input changes; the dashed line marks its value now. " +
      "The sweep changes nothing in your design. Lines that are identical at every step (identical pumps, say) are drawn once and named together."),
    tbl, csvButton(tbl, `${S.design.name} sweep`),
  ];
}

// ---------------------------------------------------------------------------
// The worked numbers for one pipe
// ---------------------------------------------------------------------------

// The head equation for the selected pipe with the numbers put in, so it
// can be checked by hand.
export function pipeWork(p) {
  const r = S.result.pipes[p.id];
  if (!r) return null;
  const fl = S.result.fluid;
  const Q = Math.abs(r.Q), A = pipeArea(p.D), hv = (r.V * r.V) / (2 * G);
  const back = r.Q < 0;
  const [up, down] = back ? [p.to.comp, p.from.comp] : [p.from.comp, p.to.comp];
  const [H1, H2] = back ? [r.Hto, r.Hfrom] : [r.Hfrom, r.Hto];
  const [p1, p2] = back ? [r.pTo, r.pFrom] : [r.pFrom, r.pTo];
  const line = (what, html) => h("div", { class: "work-line" }, h("span", { html: what }), h("b", { html }));
  const n = (x, sig = 4) => fmt(x, sig);
  if (Q === 0) return h("div", { class: "card work" }, h("h3", {}, `Worked numbers for ${p.name}`), h("p", { class: "help" }, "No flow in this pipe, so there is no loss to work out."));

  const fits = (p.fittings || []).filter((f) => FITTINGS[f.kind] && f.n > 0)
    .map((f) => `${f.n} × ${FITTINGS[f.kind].label} (${FITTINGS[f.kind].K})`);
  if (p.K_extra > 0) fits.push(`extra K (${n(p.K_extra)})`);
  const fHow = r.regime === "laminar" ? `64/Re = 64/${n(r.Re)}`
    : `Colebrook with ε/D = ${n(r.eps / p.D, 3)}` + (r.Re < 2400 ? " (ramped from the laminar value over 2300 &lt; Re &lt; 2400)" : "");
  const z = (id) => { const c = S.design.components.find((x) => x.id === id); return c && c.type !== "tank" ? c.z : null; };
  const side = (id, H, pp) => (z(id) === null
    ? `${n(H)} m (tank ${esc(compName(id))}: surface head)`
    : `${n(pp / (fl.rho * G))} + ${n(hv, 3)} + ${n(z(id))} = ${n(H)} m`);
  return h("div", { class: "card work" },
    h("h3", {}, `Worked numbers for ${p.name}`, h("span", { class: "sub" }, `  ${compName(up)} → ${compName(down)}`)),
    line("A = πD²/4", `π (${n(p.D)})²/4 = ${n(A, 4)} m²`),
    line("V = Q/A", `${n(Q, 4)} / ${n(A, 4)} = ${n(r.V)} m/s`),
    line("Re = ρVD/μ", `${n(fl.rho)} × ${n(r.V)} × ${n(p.D)} / ${n(fl.mu, 4)} = ${n(r.Re)}`),
    line("f", `${fHow} → ${n(r.f)}`),
    line("V²/2g", `${n(hv)} m`),
    line("major loss = f (L/D) V²/2g", `${n(r.f)} × (${n(p.L)}/${n(p.D)}) × ${n(hv)} = ${n(r.hMajor)} m`),
    line("ΣK", fits.length ? `${fits.join(" + ")} = ${n(r.K)}` : "0 (no fittings)"),
    line("minor loss = ΣK V²/2g", `${n(r.K)} × ${n(hv)} = ${n(r.hMinor)} m`),
    line("h<sub>L</sub>", `${n(r.hMajor)} + ${n(r.hMinor)} = ${n(r.hMajor + r.hMinor)} m`),
    h("div", { class: "work-eq", html: "The head equation between the two ends, upstream (1) to downstream (2), with α = 1 and no pump in the pipe:<br>" +
      "p<sub>1</sub>/ρg + V<sub>1</sub>²/2g + z<sub>1</sub> = p<sub>2</sub>/ρg + V<sub>2</sub>²/2g + z<sub>2</sub> + h<sub>L</sub>" }),
    line("left side", side(up, H1, p1)),
    line("right side", `${side(down, H2, p2)}, plus h<sub>L</sub> = ${n(r.hMajor + r.hMinor)} m, makes ${n(H2 + r.hMajor + r.hMinor)} m`),
    h("p", { class: "help" }, `Water at ${n(fl.T)} °C: ρ = ${n(fl.rho)} kg/m³, μ = ${n(fl.mu, 4)} Pa·s. Q = ${n(Q * 1000)} L/s = ${n(Q, 4)} m³/s. Numbers are shown to four figures, so a hand check agrees to about that.`));
}

// ---------------------------------------------------------------------------
// Moody chart
// ---------------------------------------------------------------------------

export function moodyChart() {
  const pipes = S.design.pipes.filter((p) => S.result.pipes[p.id] && S.result.pipes[p.id].Q !== 0 && p.L > 0);
  if (!pipes.length) return null;
  const res = pipes.map((p) => S.result.pipes[p.id]);
  const reMax = Math.max(1e6, ...res.map((r) => r.Re)), reMin = Math.min(600, ...res.map((r) => r.Re));
  const grid = (lo, hi, nPts = 60) => Array.from({ length: nPts + 1 }, (_, i) => lo * (hi / lo) ** (i / nPts));
  const top = 10 ** Math.ceil(Math.log10(reMax) - 1e-9);
  const series = [{ name: "laminar: f = 64/Re", color: "#9aa3ad", thin: true, pts: grid(Math.min(reMin, 600), RE_LAMINAR, 12).map((re) => [re, 64 / re]) }];
  [0, 1e-5, 1e-4, 1e-3, 0.01, 0.05].forEach((rr, i) => series.push({
    name: i === 0 ? "Colebrook, for the ε/D written on each line" : null, color: "#9aa3ad", thin: true,
    endLabel: rr === 0 ? "smooth" : String(rr), pts: grid(4000, top).map((re) => [re, colebrook(re, rr)]),
  }));
  const fs = res.map((r) => r.f);
  const chart = lineChart({
    x: { label: "Reynolds number Re = ρVD/μ", log: true, min: Math.min(reMin, 600), max: top },
    y: { label: "friction factor f", log: true, min: Math.min(0.008, ...fs.map((f) => 0.9 * f)), max: Math.max(0.1, ...fs.map((f) => 1.1 * f)) },
    series,
    points: pipes.map((p, i) => ({ x: res[i].Re, y: res[i].f, color: S.sel?.id === p.id ? COLORS[1] : COLORS[0],
      title: `${p.name}: Re = ${fmt(res[i].Re)}, f = ${fmt(res[i].f, 4)}, ε/D = ${fmt(res[i].eps / p.D, 3)}` })),
  });
  return [
    h("h3", { class: "gap" }, "Where each pipe sits on the Moody chart"),
    chart.el,
    plotButtons(chart.svg, `${S.design.name} Moody chart`),
    h("p", { class: "help" }, "One dot for every pipe that has a length and a flow; hover over a dot for its numbers. The selected pipe is the orange one. The gray lines are the usual curves of the Moody chart."),
  ];
}
