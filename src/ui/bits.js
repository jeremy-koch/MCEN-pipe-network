// bits.js -- small pieces the results tabs share.

import { S, select } from "./state.js";
import { glossFor } from "./help.js";
import { h, fix } from "./util.js";

export const kW = (watts) => fix(watts / 1000, 2);
export const Ls = (q) => fix(q * 1000, 2);
export const compName = (id) => (S.design.components.find((c) => c.id === id) || {}).name || "?";

// A data table. head: column headings (HTML allowed). rows: [{ cells,
// pick, sel, total }]; `pick` is what clicking the row selects.
// opts.text: the column numbers that hold text, not numbers.
export function table(head, rows, opts = {}) {
  return h("div", { class: "table-scroll" }, h("table", { class: "data" },
    h("thead", {}, h("tr", {}, head.map((t) => h("th", { html: t, title: glossFor(t) })))),
    h("tbody", {}, rows.map((r) => h("tr", {
      class: (r.sel ? "sel " : "") + (r.total ? "total" : ""),
      onclick: r.pick ? () => select(r.pick) : null,
    }, r.cells.map((c, i) => h(i === 0 ? "th" : "td", { class: typeof c === "string" && i > 0 && opts.text?.includes(i) ? "txt" : "" }, c)))))));
}

export const needSolve = () => h("p", { class: "empty" },
  S.result.status === "error" ? "No results yet: the network cannot be solved as drawn. See Messages."
    : "No results yet. Build a network on the canvas: it is solved as you go.");

// A labelled <select>. options: [[value, text], ...]
export function pickField(label, options, value, onchange, wide = false) {
  const sel = h("select", { onchange: () => onchange(sel.value) },
    options.map(([v, text]) => h("option", { value: v, selected: v === value }, text)));
  return h("label", { class: "field inline" + (wide ? " wide" : "") }, h("span", { class: "lab" }, label), h("span", { class: "inp" }, sel));
}
