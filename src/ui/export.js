// export.js -- getting pictures and tables out of the app, for reports.
//
// A picture is saved from an SVG that is on the page. The page's stylesheet
// is copied into the file, so the file looks the same on its own.

import { h } from "./util.js";

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = h("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const fileName = (text) => String(text || "").trim().replace(/[^\w\- ]+/g, "").replace(/\s+/g, "-") || "design";

function pageCss() {
  let out = "";
  for (const sheet of document.styleSheets) {
    try { for (const rule of sheet.cssRules) out += rule.cssText + "\n"; } catch { /* a sheet we may not read: skip it */ }
  }
  return out;
}

// A stand-alone SVG file from a drawing.
//   inner: the SVG markup inside the drawing
//   cls:   the class of the <svg> it came from (the stylesheet keys on it)
//   box:   [x, y, width, height] of the part to keep
function svgFile(inner, cls, box, scale = 1) {
  const [x, y, w, hh] = box;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${hh}" width="${w * scale}" height="${hh * scale}">` +
    `<style>${pageCss().replace(/</g, "&lt;")}</style>` +
    `<rect x="${x}" y="${y}" width="${w}" height="${hh}" fill="#fff"/>` +
    `<g class="${cls}">${inner}</g></svg>`;
}

export function saveSvg(inner, cls, box, name) {
  downloadBlob(new Blob([svgFile(inner, cls, box)], { type: "image/svg+xml" }), `${fileName(name)}.svg`);
}

// The same drawing as a PNG, at `scale` pixels per SVG unit.
export function savePng(inner, cls, box, name, scale = 2) {
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svgFile(inner, cls, box, scale)], { type: "image/svg+xml" }));
  img.onload = () => {
    const canvas = h("canvas", { width: Math.round(box[2] * scale), height: Math.round(box[3] * scale) });
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    canvas.toBlob((blob) => { if (blob) downloadBlob(blob, `${fileName(name)}.png`); }, "image/png");
  };
  img.onerror = () => { URL.revokeObjectURL(url); alert("This browser could not make the PNG. Try the SVG instead."); };
  img.src = url;
}

// "Save plot" buttons for a plot whose <svg> is on the page.
export function plotButtons(svg, name) {
  const box = () => svg.getAttribute("viewBox").split(/\s+/).map(Number);
  const cls = svg.getAttribute("class");
  return h("div", { class: "save-row" },
    h("span", {}, "Save this plot:"),
    h("button", { type: "button", onclick: () => saveSvg(svg.innerHTML, cls, box(), name) }, "SVG"),
    h("button", { type: "button", onclick: () => savePng(svg.innerHTML, cls, box(), name) }, "PNG"));
}

// A table on the page as CSV text. The typographic minus and dash the app
// displays are turned back into something a spreadsheet reads as a number.
export function tableCsv(tableEl) {
  const cell = (el) => {
    const copy = el.cloneNode(true);
    for (const extra of copy.querySelectorAll("button, input, .sub")) extra.remove();
    let t = copy.textContent.trim().replace(/−/g, "-");
    if (t === "–") t = "";
    else if (/^-?[\d,]+(\.\d+)?$/.test(t)) t = t.replace(/,/g, ""); // 1,234 -> 1234
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  return [...tableEl.querySelectorAll("tr")].map((tr) => [...tr.children].map(cell).join(",")).join("\r\n") + "\r\n";
}

// A "Download this table" button for a table (or a wrapper around one).
export function csvButton(wrap, name) {
  return h("div", { class: "save-row" }, h("button", { type: "button",
    onclick: () => downloadBlob(new Blob([tableCsv(wrap.querySelector("table") || wrap)], { type: "text/csv" }), `${fileName(name)}.csv`) },
  "Download this table (CSV)"));
}
