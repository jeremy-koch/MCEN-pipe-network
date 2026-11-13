// util.js -- small helpers shared by the UI files.

// Build a DOM element:  h("div", { class: "row", onclick: fn }, child, "text")
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (k === "html") el.innerHTML = v;
    else if (k in el && k !== "list") el[k] = v;
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

// Escape text that goes into an HTML or SVG string.
export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// A number with `sig` significant figures and no exponent for ordinary
// sizes:  fmt(17.8923) -> "17.9",  fmt(20) -> "20",  fmt(0.004512) -> "0.00451",  fmt(null) -> "–"
export function fmt(x, sig = 3) {
  if (x === null || x === undefined || !Number.isFinite(x)) return "–";
  if (x === 0) return "0";
  const a = Math.abs(x);
  if (a >= 1e6 || a < 1e-4) return x.toExponential(sig - 1).replace("e+", "e").replace("-", "−");
  const digits = Math.max(0, sig - 1 - Math.floor(Math.log10(a)));
  let s = a >= 10 ** sig ? Math.round(x).toLocaleString("en-US") : x.toFixed(digits);
  if (digits > 0) s = s.replace(/\.?0+$/, ""); // 20.0 -> 20
  return s.replace("-", "−");
}

// Fixed number of decimals:  fix(12.345, 1) -> "12.3"
export function fix(x, decimals = 1) {
  if (x === null || x === undefined || !Number.isFinite(x)) return "–";
  const s = x.toFixed(decimals);
  return (Number(s) === 0 ? (0).toFixed(decimals) : s).replace("-", "−");
}

export function money(x) {
  if (x === null || x === undefined || !Number.isFinite(x)) return "–";
  return "$" + Math.round(x).toLocaleString("en-US");
}

// "Nice" axis ticks covering [0, max]: returns { max, step, ticks }.
export function niceTicks(max, target = 5) {
  if (!(max > 0)) max = 1;
  const raw = max / target;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw);
  const top = Math.ceil(max / step - 1e-9) * step;
  const ticks = [];
  for (let v = 0; v <= top + step * 1e-6; v += step) ticks.push(Number(v.toPrecision(12)));
  return { max: top, step, ticks };
}
