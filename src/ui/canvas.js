// canvas.js -- the drawing: components and pipes as SVG, and everything the
// mouse does on it (select, move, draw a pipe, pan, zoom).
//
// The whole drawing is rebuilt from S.design every time something changes.
// Networks are small, so this is fast, and there is no second copy of the
// design to keep in step.

import { S, changed, select, render } from "./state.js";
import { addComponent, addPipe, PORTS, pumpSpec } from "../solver/design.js";
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

function isSel(kind, id) { return S.sel && S.sel.kind === kind && S.sel.id === id; }

// The second line under a component's name: a result if there is one,
// otherwise a key property.
function compCaption(c) {
  const r = S.result.status === "solved" ? S.result.comps[c.id] : null;
  switch (c.type) {
    case "tank": return r ? `H = ${fix(r.H, 2)} m` : `z = ${fmt(c.z)} m`;
    case "junction": {
      const set = c.Qin_Ls ? (c.Qin_Ls > 0 ? `${fmt(c.Qin_Ls)} L/s in · ` : `${fmt(-c.Qin_Ls)} L/s out · `) : "";
      return set + (r ? `H = ${fix(r.H, 2)} m · ${fix(r.p / 1000, 1)} kPa` : `z = ${fmt(c.z)} m`);
    }
    case "pump": {
      if (!c.on) return "off";
      if (!r) return pumpSpec(c).name;
      return `${fix(r.Q * 1000, 2)} L/s · +${fix(r.head, 2)} m`;
    }
    case "valve": return r ? `K = ${fmt(c.K)} · loss ${fix(r.hLoss, 2)} m` : `K = ${fmt(c.K)}`;
    default: return "";
  }
}

function drawComp(c, flagged) {
  const cls = `comp ${c.type}${isSel("comp", c.id) ? " sel" : ""}${flagged.has(c.id) ? " flag" : ""}${c.type === "pump" && !c.on ? " off" : ""}`;
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

  let arrow = "";
  if (r && r.Q !== 0) {
    const deg = (mid.angle * 180) / Math.PI + (r.Q < 0 ? 180 : 0);
    arrow = `<path class="arrow" transform="translate(${mid.x},${mid.y}) rotate(${deg})" d="M-7,-6 L7,0 L-7,6 Z"/>`;
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
  return `<g class="${cls}" data-pipe="${p.id}"><path class="hitline" d="${d}"/><path class="line" d="${d}"/>${arrow}${label}${handle}</g>`;
}

export function renderCanvas() {
  if (!svg) return;
  const flagged = new Set(S.result.errors.flatMap((e) => e.ids));
  const v = S.view;
  let html = `<defs><pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
      <circle cx="1" cy="1" r="1" class="griddot"/></pattern></defs>
    <g id="world" transform="translate(${v.x},${v.y}) scale(${v.k})">
    <rect x="-20000" y="-20000" width="40000" height="40000" fill="url(#grid)" class="bg"/>`;
  for (const p of S.design.pipes) html += drawPipe(p, flagged);
  for (const c of S.design.components) html += drawComp(c, flagged);
  if (drag && drag.kind === "pipe" && drag.to) {
    html += `<path class="rubber" d="M${drag.from.x},${drag.from.y} L${drag.to.x},${drag.to.y}"/>`;
  }
  html += "</g>";
  svg.innerHTML = html;
  svg.classList.toggle("pipemode", S.pipeMode);
}

// ---------------------------------------------------------------------------
// Editing actions
// ---------------------------------------------------------------------------

export function addAtClient(type, clientX, clientY) {
  const r = svg.getBoundingClientRect();
  if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return false;
  const w = toWorld(clientX, clientY);
  const c = addComponent(S.design, type, snap(w.x), snap(w.y));
  S.sel = { kind: "comp", id: c.id };
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
  if (!S.sel) return;
  const d = S.design;
  if (S.sel.kind === "pipe") {
    d.pipes = d.pipes.filter((p) => p.id !== S.sel.id);
  } else {
    d.components = d.components.filter((c) => c.id !== S.sel.id);
    d.pipes = d.pipes.filter((p) => p.from.comp !== S.sel.id && p.to.comp !== S.sel.id);
  }
  S.sel = null;
  changed();
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
  const pts = S.design.components.map((c) => ({ x: c.x, y: c.y }))
    .concat(S.design.pipes.filter((p) => p.mid).map((p) => p.mid));
  if (!pts.length || !r.width) { S.view = { x: 0, y: 0, k: 1 }; renderCanvas(); return; }
  const x0 = Math.min(...pts.map((p) => p.x)) - 90, x1 = Math.max(...pts.map((p) => p.x)) + 90;
  const y0 = Math.min(...pts.map((p) => p.y)) - 70, y1 = Math.max(...pts.map((p) => p.y)) + 90;
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

  if (handleEl) {
    drag = { kind: "bend", id: handleEl.dataset.handle, ...start };
  } else if (portEl || (compEl && S.pipeMode)) {
    const c = compById((portEl || compEl).dataset.comp);
    const near = nearestPort(c, w);
    const port = portEl ? portEl.dataset.port : near.port;
    const from = portEl ? { x: c.x + Number(portEl.getAttribute("cx")), y: c.y + Number(portEl.getAttribute("cy")) } : near;
    drag = { kind: "pipe", comp: c.id, port, from: { x: from.x, y: from.y }, to: null, ...start };
  } else if (compEl) {
    const c = compById(compEl.dataset.comp);
    drag = { kind: "move", id: c.id, dx: w.x - c.x, dy: w.y - c.y, ...start };
    if (!isSel("comp", c.id)) select({ kind: "comp", id: c.id });
  } else if (pipeEl) {
    drag = { kind: "none", ...start };
    if (!isSel("pipe", pipeEl.dataset.pipe)) select({ kind: "pipe", id: pipeEl.dataset.pipe });
  } else {
    drag = { kind: "pan", vx: S.view.x, vy: S.view.y, ...start };
  }
  svg.setPointerCapture(e.pointerId);
  e.preventDefault();
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
}

function onMove(e) {
  if (!drag) return;
  if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 4) return;
  drag.moved = true;
  const w = toWorld(e.clientX, e.clientY);
  if (drag.kind === "move") {
    const c = compById(drag.id);
    c.x = snap(w.x - drag.dx); c.y = snap(w.y - drag.dy);
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
    if (d.moved) changed(); else renderCanvas();
  } else if (d.kind === "pan" && !d.moved) {
    if (S.sel || S.pipeMode) { S.pipeMode = false; select(null); }
  }
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
