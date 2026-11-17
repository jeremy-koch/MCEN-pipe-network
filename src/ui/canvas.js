// canvas.js -- the drawing: components and pipes as SVG, and everything the
// mouse does on it (select, move, draw a pipe, pan, zoom).
//
// The whole drawing is rebuilt from S.design every time something changes.
// Networks are small, so this is fast, and there is no second copy of the
// design to keep in step.

import { S, changed, select, render, selectedIds, kindOf } from "./state.js";
import { addComponent, addPipe, addLabel, PORTS, pumpSpec } from "../solver/design.js";
import { esc, fmt, fix } from "./util.js";

const GRID = 10;
const snap = (v) => Math.round(v / GRID) * GRID;

let svg = null; // the <svg> element
let drag = null; // what the pointer is doing right now, or null

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

// Rotate an offset by 0, 90, 180 or 270 degrees (clockwise on screen).
function rotated(dx, dy, rot) {
  switch ((((rot || 0) % 360) + 360) % 360) {
    case 90: return [-dy, dx];
    case 180: return [-dx, -dy];
    case 270: return [dy, -dx];
    default: return [dx, dy];
  }
}

// Where pipes can attach to a port. A tank offers three spots (all the same
// port); the drawing uses whichever is nearest to where the pipe is going.
function anchors(c, port) {
  if (c.type === "tank") {
    return [{ x: c.x - 40, y: c.y + 14 }, { x: c.x + 40, y: c.y + 14 }, { x: c.x, y: c.y + 28 }];
  }
  if (c.type === "junction") return [{ x: c.x, y: c.y }];
  const reach = c.type === "pump" ? 30 : 24;
  const sign = port === "in" || port === "a" ? -1 : 1;
  const [dx, dy] = rotated(sign * reach, 0, c.rot);
  return [{ x: c.x + dx, y: c.y + dy }];
}

function nearest(points, to) {
  let best = points[0];
  for (const p of points) {
    if ((p.x - to.x) ** 2 + (p.y - to.y) ** 2 < (best.x - to.x) ** 2 + (best.y - to.y) ** 2) best = p;
  }
  return best;
}

const compById = (id) => S.design.components.find((c) => c.id === id);

// The points a pipe is drawn through: start, optional bend, end.
function pipePoints(pipe) {
  const a = compById(pipe.from.comp), b = compById(pipe.to.comp);
  if (!a || !b) return null;
  const aim = (c, port) => { const an = anchors(c, port); return an.length === 1 ? an[0] : { x: c.x, y: c.y }; };
  const A = nearest(anchors(a, pipe.from.port), pipe.mid || aim(b, pipe.to.port));
  const B = nearest(anchors(b, pipe.to.port), pipe.mid || aim(a, pipe.from.port));
  return pipe.mid ? [A, pipe.mid, B] : [A, B];
}

// Point and direction halfway along a polyline.
function halfway(pts) {
  const seg = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const len = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    seg.push(len); total += len;
  }
  let s = total / 2;
  for (let i = 0; i < seg.length; i++) {
    if (s <= seg[i] || i === seg.length - 1) {
      const t = seg[i] ? s / seg[i] : 0;
      const p = pts[i], q = pts[i + 1];
      return { x: p.x + t * (q.x - p.x), y: p.y + t * (q.y - p.y), angle: Math.atan2(q.y - p.y, q.x - p.x) };
    }
    s -= seg[i];
  }
  return { x: pts[0].x, y: pts[0].y, angle: 0 };
}

function toWorld(clientX, clientY) {
  const r = svg.getBoundingClientRect();
  return { x: (clientX - r.left - S.view.x) / S.view.k, y: (clientY - r.top - S.view.y) / S.view.k };
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

function isSel(kind, id) { return !!S.sel && (S.sel.id === id || S.also.includes(id)); }

// How the solved flows are drawn on the pipes: width for flow rate, color
// for speed or pressure, and moving dashes. Worked out once per redraw.
let enc = null;
function encoding() {
  if (S.result.status !== "solved") return null;
  const rs = S.design.pipes.map((p) => S.result.pipes[p.id]).filter(Boolean);
  const out = { qMax: Math.max(0, ...rs.map((r) => Math.abs(r.Q))), vMax: Math.max(0, ...rs.map((r) => r.V)), value: null, lo: 0, hi: 0, label: "" };
  if (S.show.color === "velocity") {
    out.value = (r) => r.V; out.label = "speed V [m/s]";
  } else if (S.show.color === "pressure") {
    // the mean of the static pressures at the two ends, where they are known
    out.value = (r) => { const ps = [r.pFrom, r.pTo].filter((v) => v !== null); return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length / 1000 : null; };
    out.label = "gauge pressure [kPa]";
  }
  if (out.value) {
    const vals = rs.map(out.value).filter((v) => v !== null);
    if (vals.length) { out.lo = Math.min(...vals); out.hi = Math.max(...vals); } else out.value = null;
  }
  return out;
}

// A color between light and dark blue for t from 0 to 1.
const RAMP = [[176, 204, 230], [10, 48, 115]];
function rampColor(t) {
  const u = Math.min(1, Math.max(0, t));
  return `rgb(${RAMP[0].map((a, i) => Math.round(a + (RAMP[1][i] - a) * u)).join(",")})`;
}

// The second line under a component's name: a result if there is one,
// otherwise a key property.
function compCaption(c) {
  const r = S.result.status === "solved" ? S.result.comps[c.id] : null;
  switch (c.type) {
    case "tank": {
      const p = c.p_kPa ? ` · ${fmt(c.p_kPa)} kPa` : ""; // a pressurized tank says so
      return (r ? `H = ${fix(r.H, 2)} m` : `z = ${fmt(c.z)} m`) + p;
    }
    case "junction": {
      const set = c.Qin_Ls ? (c.Qin_Ls > 0 ? `${fmt(c.Qin_Ls)} L/s in · ` : `${fmt(-c.Qin_Ls)} L/s out · `) : "";
      return set + (r ? `H = ${fix(r.H, 2)} m · ${fix(r.p / 1000, 1)} kPa` : `z = ${fmt(c.z)} m`);
    }
    case "pump": {
      if (!c.on) return "off";
      if (!r) return pumpSpec(c).name;
      return `${fix(r.Q * 1000, 2)} L/s · +${fix(r.head, 2)} m`;
    }
    case "valve":
      if (c.closed) return "closed";
      return r ? `K = ${fmt(c.K)} · loss ${fix(r.hLoss, 2)} m` : `K = ${fmt(c.K)}`;
    default: return "";
  }
}

function drawComp(c, flagged) {
  const lowP = (S.result.lowP || []).includes(c.id);
  const cls = `comp ${c.type}${isSel("comp", c.id) ? " sel" : ""}${flagged.has(c.id) ? " flag" : ""}${lowP ? " lowp" : ""}${c.type === "pump" && !c.on ? " off" : ""}${c.type === "valve" && c.closed ? " shut" : ""}`;
  let body = "";
  let labelDy = 30;
  if (c.type === "tank") {
    body = `<rect class="hit" x="-40" y="-28" width="80" height="56"/>
      <rect class="water" x="-39" y="-12" width="78" height="39"/>
      <path class="wave" d="M-39,-12 q6.5,-5 13,0 t13,0 t13,0 t13,0 t13,0 t13,0"/>
      <path class="outline" d="M-40,-28 V28 H40 V-28"/>`;
    labelDy = 48;
  } else if (c.type === "junction") {
    body = `<circle class="outline hit" r="12"/>`;
    // A set flow is drawn as an arrow from above: pointing in for an inflow,
    // pointing away for a withdrawal.
    if (c.Qin_Ls > 0) body = `<path class="setflow" d="M0,-44 V-18 M-6,-25 L0,-16 L6,-25"/>` + body;
    else if (c.Qin_Ls < 0) body = `<path class="setflow" d="M0,-16 V-42 M-6,-35 L0,-44 L6,-35"/>` + body;
    labelDy = 28;
  } else if (c.type === "pump") {
    body = `<g transform="rotate(${c.rot || 0})">
      <path class="stub" d="M-30,0 H-22 M22,0 H30"/>
      <circle class="outline hit" r="22"/>
      <path class="glyph" d="M-8,-11 L12,0 L-8,11 Z"/>
      ${c.on ? "" : `<path class="slash" d="M-15,15 L15,-15"/>`}</g>`;
    labelDy = (c.rot || 0) % 180 ? 48 : 40;
  } else if (c.type === "valve") {
    body = `<g transform="rotate(${c.rot || 0})">
      <path class="stub" d="M-24,0 H-16 M16,0 H24"/>
      <rect class="hit" x="-18" y="-16" width="36" height="28" fill="transparent"/>
      <path class="outline" d="M-16,-11 V11 L0,0 Z M16,-11 V11 L0,0 Z"/>
      <path class="stub" d="M0,0 V-15 M-7,-15 H7"/></g>`;
    labelDy = (c.rot || 0) % 180 ? 42 : 30;
  }
  let ports = "";
  for (const port of PORTS[c.type]) {
    for (const a of anchors(c, port)) {
      ports += `<circle class="port" data-comp="${c.id}" data-port="${port}" cx="${a.x - c.x}" cy="${a.y - c.y}" r="5"/>`;
    }
  }
  return `<g class="${cls}" data-comp="${c.id}" transform="translate(${c.x},${c.y})">${body}${ports}
    <text class="name" y="${labelDy}">${esc(c.name)}</text>
    <text class="cap" y="${labelDy + 14}">${esc(compCaption(c))}</text></g>`;
}

function drawPipe(p, flagged) {
  const pts = pipePoints(p);
  if (!pts) return "";
  const d = "M" + pts.map((q) => `${q.x},${q.y}`).join(" L");
  const sel = isSel("pipe", p.id);
  const direct = Number(p.L) === 0; // a zero-length pipe is just a connection
  const cls = `pipe${sel ? " sel" : ""}${flagged.has(p.id) ? " flag" : ""}${direct ? " direct" : ""}`;
  const mid = halfway(pts);
  const r = S.result.status === "solved" ? S.result.pipes[p.id] : null;

  let arrow = "", style = "", dashes = "";
  if (r && r.Q !== 0) {
    const deg = (mid.angle * 180) / Math.PI + (r.Q < 0 ? 180 : 0);
    arrow = `<path class="arrow" transform="translate(${mid.x},${mid.y}) rotate(${deg})" d="M-7,-6 L7,0 L-7,6 Z"/>`;
  }
  if (r && enc) {
    if (S.show.width && enc.qMax > 0) {
      const frac = Math.abs(r.Q) / enc.qMax;
      // One scale for every pipe, zero-length connections included: the same
      // flow rate must always draw the same width, or the picture lies.
      style += `stroke-width:${(3 + 7 * frac).toFixed(1)}px;`;
    }
    const v = enc.value && !sel && !flagged.has(p.id) ? enc.value(r) : null;
    if (v !== null) style += `stroke:${rampColor(enc.hi > enc.lo ? (v - enc.lo) / (enc.hi - enc.lo) : 0.5)};`;
    if (S.show.animate && r.Q !== 0) {
      // Dashes that run the way the water does, faster where it is faster.
      const way = r.Q < 0 ? [...pts].reverse() : pts;
      const speed = 14 + 50 * (enc.vMax > 0 ? r.V / enc.vMax : 0); // pixels per second
      dashes = `<path class="flowdash" style="animation-duration:${(16 / speed).toFixed(2)}s" d="M${way.map((q) => `${q.x},${q.y}`).join(" L")}"/>`;
    }
  }
  // Label beside the pipe, on the upper side of the line.
  let label = "";
  if (!direct || sel) {
    let nx = Math.sin(mid.angle), ny = -Math.cos(mid.angle);
    if (ny > 0) { nx = -nx; ny = -ny; }
    // On a slanted pipe, start (or end) the text at the offset point so it
    // grows away from the line instead of across it.
    const anchor = nx > 0.25 ? "start" : nx < -0.25 ? "end" : "middle";
    const lx = mid.x + nx * 18, ly = mid.y + ny * 26;
    const cap = r ? `${fix(Math.abs(r.Q) * 1000, 2)} L/s` : `${fmt(p.L)} m · D ${fmt(p.D)} m`;
    label = `<text class="name" style="text-anchor:${anchor}" x="${lx}" y="${ly - 3}">${esc(p.name)}</text>` +
      `<text class="cap" style="text-anchor:${anchor}" x="${lx}" y="${ly + 11}">${esc(cap)}</text>`;
  }
  const handle = sel
    ? `<circle class="handle" data-handle="${p.id}" cx="${mid.x}" cy="${mid.y}" r="6"><title>Drag to bend this pipe. Double-click to straighten it.</title></circle>`
    : "";
  return `<g class="${cls}" data-pipe="${p.id}"><path class="hitline" d="${d}"/><path class="line" style="${style}" d="${d}"/>${dashes}${arrow}${label}${handle}</g>`;
}

// A piece of text on the canvas. Line breaks in the text are kept.
function drawLabel(t) {
  const lines = String(t.text || "").split("\n");
  const spans = lines.map((ln, i) => `<tspan x="0" dy="${i ? 15 : 0}">${esc(ln) || " "}</tspan>`).join("");
  return `<g class="label${isSel("label", t.id) ? " sel" : ""}" data-label="${t.id}" transform="translate(${t.x},${t.y})">` +
    `<text>${String(t.text || "").trim() ? spans : "(empty text)"}</text></g>`;
}

// Everything on the canvas, as SVG markup.
function worldHtml(flagged) {
  enc = encoding();
  let html = "";
  for (const p of S.design.pipes) html += drawPipe(p, flagged);
  for (const c of S.design.components) html += drawComp(c, flagged);
  for (const t of S.design.labels || []) html += drawLabel(t);
  return html;
}

// The corners of everything drawn, with room for the names and captions.
function bounds() {
  const pts = S.design.components.map((c) => ({ x: c.x, y: c.y }))
    .concat(S.design.pipes.filter((p) => p.mid).map((p) => p.mid));
  for (const t of S.design.labels || []) {
    const lines = String(t.text).split("\n");
    pts.push({ x: t.x + 30, y: t.y }, { x: t.x + 7 * Math.max(...lines.map((ln) => ln.length)) - 60, y: t.y + 15 * lines.length - 70 });
  }
  if (!pts.length) return null;
  return {
    x0: Math.min(...pts.map((p) => p.x)) - 90, x1: Math.max(...pts.map((p) => p.x)) + 90,
    y0: Math.min(...pts.map((p) => p.y)) - 70, y1: Math.max(...pts.map((p) => p.y)) + 90,
  };
}

// The drawing on its own, for saving as a picture: nothing selected, no
// grid, cropped to the network.
export function diagramDrawing() {
  const keep = [S.sel, S.also];
  S.sel = null; S.also = [];
  const html = worldHtml(new Set());
  [S.sel, S.also] = keep;
  const b = bounds() || { x0: 0, x1: 200, y0: 0, y1: 100 };
  return { html, cls: "canvas", box: [b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0] };
}

export function renderCanvas() {
  if (!svg) return;
  const flagged = new Set(S.result.errors.flatMap((e) => e.ids));
  const v = S.view;
  let html = `<defs><pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
      <circle cx="1" cy="1" r="1" class="griddot"/></pattern></defs>
    <g id="world" transform="translate(${v.x},${v.y}) scale(${v.k})">
    <rect x="-20000" y="-20000" width="40000" height="40000" fill="url(#grid)" class="bg"/>`;
  html += worldHtml(flagged);
  if (drag && drag.kind === "pipe" && drag.to) {
    html += `<path class="rubber" d="M${drag.from.x},${drag.from.y} L${drag.to.x},${drag.to.y}"/>`;
  }
  if (drag && drag.kind === "box" && drag.moved) {
    const a = drag.from, b = drag.to;
    html += `<rect class="rubber-box" x="${Math.min(a.x, b.x)}" y="${Math.min(a.y, b.y)}" width="${Math.abs(a.x - b.x)}" height="${Math.abs(a.y - b.y)}"/>`;
  }
  html += "</g>";
  svg.innerHTML = html;
  svg.classList.toggle("pipemode", S.pipeMode);

  // The key for the pipe colors, when they mean something.
  const key = document.getElementById("color-legend");
  if (key) {
    key.hidden = !(enc && enc.value);
    if (!key.hidden) {
      key.innerHTML = `${esc(enc.label)}: ${fix(enc.lo, 1)} <i style="background:linear-gradient(90deg, ${rampColor(0)}, ${rampColor(1)})"></i> ${fix(enc.hi, 1)}`;
    }
  }
}

// ---------------------------------------------------------------------------
// Editing actions
// ---------------------------------------------------------------------------

export function addAtClient(type, clientX, clientY) {
  const r = svg.getBoundingClientRect();
  if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return false;
  const w = toWorld(clientX, clientY);
  if (type === "label") {
    const t = addLabel(S.design, snap(w.x), snap(w.y));
    S.sel = { kind: "label", id: t.id };
  } else {
    const c = addComponent(S.design, type, snap(w.x), snap(w.y));
    S.sel = { kind: "comp", id: c.id };
  }
  S.also = [];
  changed();
  return true;
}

// Used when a palette tile is clicked rather than dragged.
let stagger = 0;
export function addAtCenter(type) {
  const r = svg.getBoundingClientRect();
  stagger = (stagger + 1) % 6;
  addAtClient(type, r.left + r.width / 2 + stagger * 24 - 60, r.top + r.height / 2 + stagger * 24 - 60);
}

export function deleteSelected() {
  const ids = new Set(selectedIds());
  if (!ids.size) return;
  const d = S.design;
  d.components = d.components.filter((c) => !ids.has(c.id));
  d.labels = (d.labels || []).filter((t) => !ids.has(t.id));
  d.pipes = d.pipes.filter((p) => !ids.has(p.id) && !ids.has(p.from.comp) && !ids.has(p.to.comp));
  S.sel = null; S.also = [];
  changed();
}

// --- copy, paste, duplicate ---------------------------------------------------

// A copy of the selection: the selected components and text, every pipe
// that runs between two selected components, and (as "lone") any selected
// pipe whose ends were not both selected.
function grab() {
  const ids = new Set(selectedIds());
  const d = S.design;
  const inside = (p) => ids.has(p.from.comp) && ids.has(p.to.comp);
  const data = {
    components: d.components.filter((c) => ids.has(c.id)),
    labels: (d.labels || []).filter((t) => ids.has(t.id)),
    pipes: d.pipes.filter(inside),
    lone: d.pipes.filter((p) => ids.has(p.id) && !inside(p)),
  };
  const n = data.components.length + data.labels.length + data.lone.length;
  return n ? JSON.parse(JSON.stringify(data)) : null;
}

// A name for a copy: "Pump 1" -> the next free "Pump n"; "header" -> "header 2".
function copyName(name) {
  const used = new Set([...S.design.components, ...S.design.pipes].map((c) => c.name));
  const m = /^(.*?)(\s*)(\d+)$/.exec(name);
  const [base, gap] = m ? [m[1], m[2]] : [name, " "];
  for (let n = 2; ; n++) if (!used.has(base + gap + n)) return base + gap + n;
}

// Put a grabbed selection onto the canvas, moved down and right by `shift`.
function place(data, shift) {
  const d = S.design;
  const newId = new Map(), made = [];
  for (const c of data.components) {
    const { id, name, x, y, type, ...props } = JSON.parse(JSON.stringify(c));
    const copy = addComponent(d, type, x + shift, y + shift, { ...props, name: copyName(name) });
    newId.set(id, copy.id); made.push(copy.id);
  }
  for (const p of data.pipes) {
    const { id, name, from, to, ...props } = JSON.parse(JSON.stringify(p));
    if (props.mid) props.mid = { x: props.mid.x + shift, y: props.mid.y + shift };
    made.push(addPipe(d, newId.get(from.comp), from.port, newId.get(to.comp), to.port, { ...props, name: copyName(name) }).id);
  }
  // A pipe copied on its own becomes a second pipe between the same two
  // ports, bent away from the first so that both can be seen.
  for (const p of data.lone) {
    const { id, name, from, to, ...props } = JSON.parse(JSON.stringify(p));
    const a = compById(from.comp), b = compById(to.comp);
    if (!a || !b) continue;
    const mid = props.mid || { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    props.mid = { x: snap(mid.x), y: snap(mid.y + shift) };
    made.push(addPipe(d, from.comp, from.port, to.comp, to.port, { ...props, name: copyName(name) }).id);
  }
  for (const t of data.labels) made.push(addLabel(d, t.x + shift, t.y + shift, t.text).id);
  if (!made.length) return;
  S.sel = { kind: kindOf(made[0]), id: made[0] };
  S.also = made.slice(1);
  changed();
}

let clip = null, pasted = 0;
export function copySelected() { const data = grab(); if (data) { clip = data; pasted = 0; } }
export function pasteClipboard() { if (clip) place(clip, 40 * ++pasted); }
export function duplicateSelected() { const data = grab(); if (data) place(data, 40); }

export function selectAll() {
  const ids = [...S.design.components, ...(S.design.labels || []), ...S.design.pipes].map((c) => c.id);
  if (!ids.length) return;
  S.sel = { kind: kindOf(ids[0]), id: ids[0] };
  S.also = ids.slice(1);
  render();
}

export function rotateSelected() {
  const c = S.sel && S.sel.kind === "comp" ? compById(S.sel.id) : null;
  if (!c || (c.type !== "pump" && c.type !== "valve")) return;
  c.rot = ((c.rot || 0) + 90) % 360;
  changed();
}

export function zoomBy(factor, cx = null, cy = null) {
  const r = svg.getBoundingClientRect();
  if (cx === null) { cx = r.width / 2; cy = r.height / 2; }
  const k = Math.min(3, Math.max(0.25, S.view.k * factor));
  S.view.x = cx - ((cx - S.view.x) * k) / S.view.k;
  S.view.y = cy - ((cy - S.view.y) * k) / S.view.k;
  S.view.k = k;
  renderCanvas();
}

// Zoom and pan so the whole network is in view.
export function fitView() {
  const r = svg.getBoundingClientRect();
  const b = bounds();
  if (!b || !r.width) { S.view = { x: 0, y: 0, k: 1 }; renderCanvas(); return; }
  const { x0, x1, y0, y1 } = b;
  const k = Math.min(1.25, r.width / (x1 - x0), r.height / (y1 - y0));
  S.view = { k, x: (r.width - k * (x0 + x1)) / 2, y: (r.height - k * (y0 + y1)) / 2 };
  renderCanvas();
}

// The port of component c closest to a point.
function nearestPort(c, w) {
  let best = null;
  for (const port of PORTS[c.type]) {
    for (const a of anchors(c, port)) {
      const d2 = (a.x - w.x) ** 2 + (a.y - w.y) ** 2;
      if (!best || d2 < best.d2) best = { port, d2, x: a.x, y: a.y };
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Pointer handling
// ---------------------------------------------------------------------------

function onDown(e) {
  if (e.button !== 0 && e.pointerType === "mouse") return;
  const t = e.target;
  const w = toWorld(e.clientX, e.clientY);
  const start = { sx: e.clientX, sy: e.clientY, moved: false };
  const handleEl = t.closest("[data-handle]");
  const portEl = t.closest("[data-port]");
  const compEl = t.closest("[data-comp]");
  const pipeEl = t.closest("[data-pipe]");
  const labelEl = t.closest("[data-label]");

  if (handleEl) {
    drag = { kind: "bend", id: handleEl.dataset.handle, ...start };
  } else if (portEl || (compEl && S.pipeMode)) {
    const c = compById((portEl || compEl).dataset.comp);
    const near = nearestPort(c, w);
    const port = portEl ? portEl.dataset.port : near.port;
    const from = portEl ? { x: c.x + Number(portEl.getAttribute("cx")), y: c.y + Number(portEl.getAttribute("cy")) } : near;
    drag = { kind: "pipe", comp: c.id, port, from: { x: from.x, y: from.y }, to: null, ...start };
  } else if (compEl || labelEl || pipeEl) {
    const pick = compEl ? { kind: "comp", id: compEl.dataset.comp }
      : labelEl ? { kind: "label", id: labelEl.dataset.label } : { kind: "pipe", id: pipeEl.dataset.pipe };
    if (e.shiftKey) {
      select(pick, true); // add it to, or take it out of, the selection
      drag = { kind: "none", ...start };
    } else {
      if (!isSel(pick.kind, pick.id)) select(pick);
      // Dragging moves everything selected. A pipe on its own does not move.
      drag = pick.kind === "pipe" ? { kind: "none", pick, ...start } : { kind: "move", pick, wx: w.x, wy: w.y, items: movable(), ...start };
    }
  } else if (e.shiftKey) {
    drag = { kind: "box", from: w, to: w, ...start };
  } else {
    drag = { kind: "pan", vx: S.view.x, vy: S.view.y, ...start };
  }
  svg.setPointerCapture(e.pointerId);
  e.preventDefault();
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
}

// What a drag moves: the selected components and text, and the bend of any
// pipe that is selected or has both ends selected. Each entry remembers
// where its object started.
function movable() {
  const ids = new Set(selectedIds());
  const items = [];
  const hold = (obj) => items.push({ obj, x0: obj.x, y0: obj.y });
  for (const c of S.design.components) if (ids.has(c.id)) hold(c);
  for (const t of S.design.labels || []) if (ids.has(t.id)) hold(t);
  for (const p of S.design.pipes) {
    if (p.mid && ids.size > 1 && (ids.has(p.id) || (ids.has(p.from.comp) && ids.has(p.to.comp)))) hold(p.mid);
  }
  return items;
}

function onMove(e) {
  if (!drag) return;
  if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 4) return;
  drag.moved = true;
  const w = toWorld(e.clientX, e.clientY);
  if (drag.kind === "move") {
    const dx = snap(w.x - drag.wx), dy = snap(w.y - drag.wy);
    for (const it of drag.items) { it.obj.x = it.x0 + dx; it.obj.y = it.y0 + dy; }
    renderCanvas();
  } else if (drag.kind === "box") {
    drag.to = w;
    renderCanvas();
  } else if (drag.kind === "bend") {
    const p = S.design.pipes.find((q) => q.id === drag.id);
    p.mid = { x: snap(w.x), y: snap(w.y) };
    renderCanvas();
  } else if (drag.kind === "pipe") {
    drag.to = w;
    renderCanvas();
  } else if (drag.kind === "pan") {
    S.view.x = drag.vx + e.clientX - drag.sx;
    S.view.y = drag.vy + e.clientY - drag.sy;
    renderCanvas();
  }
}

function finishPipe(e, d) {
  const w = toWorld(e.clientX, e.clientY);
  const under = document.elementFromPoint(e.clientX, e.clientY);
  const portEl = under && under.closest ? under.closest("[data-port]") : null;
  const compEl = under && under.closest ? under.closest("[data-comp]") : null;
  let target = null;
  if (portEl) target = { comp: portEl.dataset.comp, port: portEl.dataset.port };
  else if (compEl) target = { comp: compEl.dataset.comp, port: nearestPort(compById(compEl.dataset.comp), w).port };

  const source = compById(d.comp);
  if (!target) {
    // Released on empty canvas: end the pipe at a new junction there.
    const j = addComponent(S.design, "junction", snap(w.x), snap(w.y), { z: source.type === "tank" ? 0 : source.z });
    target = { comp: j.id, port: "a" };
  }
  if (target.comp === d.comp) return; // a pipe from a component to itself: ignore
  // New pipes copy the diameter and material of the last pipe drawn.
  const last = S.design.pipes[S.design.pipes.length - 1];
  const props = last ? { D: last.D, material: last.material, eps_mm: last.eps_mm } : {};
  const pipe = addPipe(S.design, d.comp, d.port, target.comp, target.port, props);
  S.sel = { kind: "pipe", id: pipe.id };
  S.pipeMode = false;
}

function onUp(e) {
  if (!drag) return;
  const d = drag;
  drag = null;
  try { svg.releasePointerCapture(e.pointerId); } catch { /* already released */ }
  if (d.kind === "pipe") {
    if (d.moved) finishPipe(e, d);
    changed();
  } else if (d.kind === "move" || d.kind === "bend") {
    if (d.moved) changed();
    else if (d.pick && S.also.length) select(d.pick); // a plain click on one of several: keep just that one
    else renderCanvas();
  } else if (d.kind === "none" && d.pick && !d.moved && S.also.length) {
    select(d.pick);
  } else if (d.kind === "box") {
    finishBox(d);
  } else if (d.kind === "pan" && !d.moved) {
    if (S.sel || S.pipeMode) { S.pipeMode = false; select(null); }
  }
}

// Select everything inside the box that was dragged out.
function finishBox(d) {
  const x0 = Math.min(d.from.x, d.to.x), x1 = Math.max(d.from.x, d.to.x);
  const y0 = Math.min(d.from.y, d.to.y), y1 = Math.max(d.from.y, d.to.y);
  const inBox = (p) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
  const comps = new Set(S.design.components.filter(inBox).map((c) => c.id));
  const ids = [...comps, ...(S.design.labels || []).filter(inBox).map((t) => t.id),
    ...S.design.pipes.filter((p) => comps.has(p.from.comp) && comps.has(p.to.comp)).map((p) => p.id)];
  if (!d.moved || !ids.length) { select(null); return; }
  S.sel = { kind: kindOf(ids[0]), id: ids[0] };
  S.also = ids.slice(1);
  render();
}

function onDblClick(e) {
  const handleEl = e.target.closest("[data-handle]");
  if (!handleEl) return;
  const p = S.design.pipes.find((q) => q.id === handleEl.dataset.handle);
  if (p) { p.mid = null; changed(); }
}

function onWheel(e) {
  e.preventDefault();
  const r = svg.getBoundingClientRect();
  zoomBy(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - r.left, e.clientY - r.top);
}

export function initCanvas(svgElement) {
  svg = svgElement;
  svg.addEventListener("pointerdown", onDown);
  svg.addEventListener("pointermove", onMove);
  svg.addEventListener("pointerup", onUp);
  svg.addEventListener("pointercancel", () => { drag = null; render(); });
  svg.addEventListener("dblclick", onDblClick);
  svg.addEventListener("wheel", onWheel, { passive: false });
}
