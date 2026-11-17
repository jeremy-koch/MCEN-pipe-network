// panel.js -- the property panel on the right. It shows the properties of
// whatever is selected, or the design-wide settings when nothing is.

import { S, changed, findSelected } from "./state.js";
import { ROUGHNESS, FITTINGS, PUMP_CATALOG } from "../solver/tables.js";
import { pumpSpec, pipeKTotal, pipeRoughness, TYPE_LABEL } from "../solver/design.js";
import { water } from "../solver/hydraulics.js";
import { deleteSelected, rotateSelected, duplicateSelected } from "./canvas.js";
import { h, fmt, money } from "./util.js";

let root = null;
export function initPanel(el) { root = el; }

// --- form pieces -------------------------------------------------------------

// A labelled number box bound to obj[key]. An empty box stores null, which
// the solver reports as "missing".
function numberField(label, unit, obj, key, opts = {}) {
  const input = h("input", {
    type: "number", step: opts.step || "any", value: obj[key] ?? "",
    min: opts.min, max: opts.max,
    oninput: () => {
      obj[key] = input.value.trim() === "" ? null : Number(input.value);
      changed(`${opts.group || ""}:${key}:${obj.id || ""}`, { keepPanel: true });
      if (opts.after) opts.after();
    },
  });
  return h("label", { class: "field" },
    h("span", { class: "lab", html: label }),
    h("span", { class: "inp" }, input, unit ? h("span", { class: "unit", html: unit }) : null),
    opts.hint ? h("span", { class: "hint", html: opts.hint }) : null);
}

function textField(label, obj, key) {
  const input = h("input", {
    type: "text", value: obj[key] ?? "",
    oninput: () => { obj[key] = input.value; changed(`name:${obj.id || ""}`, { keepPanel: true }); },
  });
  return h("label", { class: "field" }, h("span", { class: "lab" }, label), h("span", { class: "inp" }, input));
}

// A box for several lines of text.
function areaField(label, obj, key, rows = 3, placeholder = "") {
  const input = h("textarea", {
    rows, placeholder, value: obj[key] ?? "",
    oninput: () => { obj[key] = input.value; changed(`text:${key}:${obj.id || ""}`, { keepPanel: true }); },
  });
  return h("label", { class: "field" }, h("span", { class: "lab" }, label), h("span", { class: "inp" }, input));
}

function selectField(label, options, value, onchange) {
  const sel = h("select", { onchange: () => onchange(sel.value) },
    options.map(([v, text]) => h("option", { value: v, selected: v === value }, text)));
  return h("label", { class: "field" }, h("span", { class: "lab" }, label), h("span", { class: "inp" }, sel));
}

const section = (title, ...kids) => h("div", { class: "section" }, title ? h("h3", {}, title) : null, ...kids);
const readout = (label, value) => h("div", { class: "readout" }, h("span", { html: label }), h("b", { html: value }));

function header(item, kind) {
  const more = S.also.length;
  return [h("div", { class: "panel-head" },
    h("h2", {}, TYPE_LABEL[kind] || "Text"),
    h("div", { class: "panel-actions" },
      kind === "pump" || kind === "valve"
        ? h("button", { type: "button", title: "Rotate a quarter turn (R)", onclick: rotateSelected }, "Rotate") : null,
      h("button", { type: "button", title: "Make a copy (Ctrl/Cmd+D)", onclick: duplicateSelected }, "Duplicate"),
      h("button", { type: "button", title: "Delete (Delete key)", onclick: deleteSelected }, "Delete"))),
  more ? h("p", { class: "help multi" }, `${more + 1} things are selected. Dragging, Duplicate and Delete act on all of them; the properties below are for this one.`) : null];
}

function labelPanel(t) {
  return [
    header(t, "label"),
    section(null, areaField("Text", t, "text", 4)),
    h("p", { class: "help" }, "Text is only a note on the drawing. It is saved in the design file and takes no part in the solution."),
  ];
}

// --- one panel per kind of thing --------------------------------------------

function tankPanel(c) {
  return [
    header(c, "tank"),
    section(null,
      textField("Name", c, "name"),
      numberField("Surface elevation z", "m", c, "z"),
      numberField("Surface pressure (gauge)", "kPa", c, "p_kPa", { hint: "0 for a tank open to the atmosphere" })),
    h("p", { class: "help" }, "A tank is a large reservoir: its surface stays at this elevation and the water there is at rest (V = 0). Any number of pipes can connect to it."),
  ];
}

function junctionPanel(c) {
  return [
    header(c, "junction"),
    section(null,
      textField("Name", c, "name"),
      numberField("Elevation z", "m", c, "z"),
      numberField("Flow in (set)", "L/s", c, "Qin_Ls", { hint: "a flow you fix here: positive enters the network, negative leaves it (a demand). 0 for an ordinary junction." })),
    h("p", { class: "help" }, "A junction is where pipes meet. The flows in, including any flow set here, equal the flows out, and all pipe ends there share one head. " +
      "A set flow fixes Q but not the head, so the network still needs at least one tank: that is where the set flow comes from or goes to."),
  ];
}

function valvePanel(c) {
  return [
    header(c, "valve"),
    section(null,
      textField("Name", c, "name"),
      h("label", { class: "check" },
        h("input", { type: "checkbox", checked: !!c.closed, onchange: (e) => { c.closed = e.target.checked; changed(); } }),
        "Closed", h("span", { class: "hint" }, "A closed valve passes no flow, whatever its K. Use it to shut a line.")),
      numberField("Loss coefficient K", "", c, "K", { min: 0, hint: "h<sub>L</sub> = K V²/2g, when the valve is open. A larger K means a more throttled valve; 0.15 is a fully open gate valve." }),
      numberField("Line diameter D", "m", c, "D", { min: 0, hint: "V is the speed in a line of this diameter" }),
      numberField("Elevation z", "m", c, "z")),
  ];
}

function pumpPanel(c) {
  const spec = pumpSpec(c);
  const custom = c.model === "custom";
  const options = Object.entries(PUMP_CATALOG).map(([k, p]) => [k, p.name]).concat([["custom", "Custom curve…"]]);
  const info = h("div", { class: "readouts" });
  const fillInfo = () => {
    const sp = pumpSpec(c), rr = Number(c.speed) || 0;
    info.replaceChildren(
      readout("Head curve", "H = h<sub>0</sub> − a Q²"),
      !custom ? readout("h<sub>0</sub> (shutoff head)", `${fmt(sp.h0)} m`) : null,
      !custom ? readout("a", `${fmt(sp.a)} m/(m³/s)²`) : null,
      !custom ? readout("Peak efficiency η<sub>max</sub>", fmt(sp.eta)) : null,
      !custom ? readout("NPSH required", `${fmt(sp.n0)} + ${fmt(sp.n1)} Q² m`) : null,
      !custom && sp.rpm ? readout("Rated speed", `${sp.rpm} rpm`) : null,
      !custom ? readout("Price", money(sp.price)) : null,
      readout("Shutoff head at this speed", `${fmt(rr * rr * sp.h0)} m`),
      readout("Zero-head flow at this speed", `${fmt(rr * Math.sqrt(sp.h0 / sp.a) * 1000)} L/s`),
      readout("Best-efficiency flow at this speed", `${fmt(rr * Math.sqrt(sp.h0 / (3 * sp.a)) * 1000)} L/s`));
  };
  fillInfo();
  const opts = { group: "pump", after: fillInfo };
  return [
    header(c, "pump"),
    section(null,
      textField("Name", c, "name"),
      h("label", { class: "check" },
        h("input", { type: "checkbox", checked: !!c.on, onchange: (e) => { c.on = e.target.checked; changed(); } }),
        "Running", h("span", { class: "hint" }, "An off pump passes no flow.")),
      selectField("Model", options, c.model, (v) => { c.model = v; changed(); }),
      custom ? [
        numberField("Shutoff head h<sub>0</sub>", "m", c.custom, "h0", opts),
        numberField("Curve coefficient a", "m/(m³/s)²", c.custom, "a", opts),
        numberField("Peak efficiency η<sub>max</sub>", "", c.custom, "eta", { ...opts, min: 0, max: 1 }),
        numberField("NPSH required n<sub>0</sub>", "m", c.custom, "n0", { ...opts, hint: "NPSH<sub>r</sub> = n<sub>0</sub> + n<sub>1</sub> Q²" }),
        numberField("NPSH required n<sub>1</sub>", "m/(m³/s)²", c.custom, "n1", opts),
        numberField("Price", "$", c.custom, "price", opts),
      ] : null,
      numberField("Speed ratio", "", c, "speed", { ...opts, step: 0.05, min: 0, hint: "1 = rated speed. A variable-frequency drive changes this; the curve follows the affinity laws." }),
      h("label", { class: "check" },
        h("input", { type: "checkbox", checked: !!c.vfd, onchange: (e) => { c.vfd = e.target.checked; changed(); } }),
        "Variable-frequency drive",
        h("span", { class: "hint" }, "Adds the price of a drive to the purchase prices. A pump at any speed ratio other than 1 is counted as having one, ticked or not.")),
      numberField("Elevation z", "m", c, "z", { hint: "of the pump centerline; it sets the NPSH available" }),
      h("label", { class: "check" },
        h("input", { type: "checkbox", checked: !!c.ideal, onchange: (e) => { c.ideal = e.target.checked; changed(); } }),
        "Ideal efficiency (η = 100%)",
        h("span", { class: "hint", html: "Checked: η = 1 (100%) at every flow, a pump with no losses, so shaft power = ρ g Q H. Unchecked: η follows a curve that peaks at η<sub>max</sub> at the best-efficiency flow and drops away on either side." }))),
    section("This pump", info),
    h("p", { class: "help" }, "Flow goes from the inlet to the outlet, in the direction of the arrow. A running pump passes no reverse flow (a check valve is assumed)."),
  ];
}

function pipePanel(p) {
  const materials = Object.entries(ROUGHNESS).map(([k, m]) => [k, `${m.label}  (ε = ${fmt(m.eps * 1000)} mm)`]).concat([["custom", "Custom roughness…"]]);
  const sumK = h("b", {});
  const showK = () => { sumK.textContent = fmt(pipeKTotal(p)); };
  showK();

  const rows = h("div", { class: "fittings" });
  const fittingOptions = Object.entries(FITTINGS).map(([k, f]) => [k, `${f.label}  (K = ${f.K})`]);
  const fillRows = () => {
    rows.replaceChildren(...p.fittings.map((f, i) => {
      const n = h("input", {
        type: "number", min: 0, step: 1, value: f.n ?? "", class: "count", title: "how many",
        oninput: () => { f.n = n.value.trim() === "" ? null : Number(n.value); changed(`fit:${p.id}:${i}`, { keepPanel: true }); showK(); },
      });
      const sel = h("select", { onchange: () => { f.kind = sel.value; changed(null, { keepPanel: true }); showK(); } },
        fittingOptions.map(([v, text]) => h("option", { value: v, selected: v === f.kind }, text)));
      const del = h("button", { type: "button", class: "x", title: "Remove this fitting",
        onclick: () => { p.fittings.splice(i, 1); changed(null, { keepPanel: true }); fillRows(); showK(); } }, "×");
      return h("div", { class: "fitting" }, n, h("span", { class: "times" }, "×"), sel, del);
    }));
  };
  fillRows();

  return [
    header(p, "pipe"),
    section(null,
      textField("Name", p, "name"),
      numberField("Length L", "m", p, "L", { min: 0, hint: "0 makes a direct connection with no friction" }),
      numberField("Inside diameter D", "m", p, "D", { min: 0 }),
      selectField("Material", materials, p.material, (v) => {
        if (v === "custom") p.eps_mm = pipeRoughness(p) * 1000;
        p.material = v; changed();
      }),
      p.material === "custom" ? numberField("Roughness ε", "mm", p, "eps_mm", { min: 0 }) : null),
    section("Fittings (minor losses)",
      rows,
      h("button", { type: "button", class: "add",
        onclick: () => { p.fittings.push({ kind: "elbow_90_standard", n: 1 }); changed(null, { keepPanel: true }); fillRows(); showK(); } }, "+ Add a fitting"),
      numberField("Extra K (anything not in the list)", "", p, "K_extra", { min: 0, after: showK }),
      h("div", { class: "readout" }, h("span", {}, "ΣK on this pipe"), sumK)),
    h("p", { class: "help", html: "h<sub>L</sub> = (f L/D + ΣK) V²/2g. The direction you drew the pipe does not matter: the solver finds which way the water goes." }),
  ];
}

function settingsPanel() {
  const d = S.design, s = d.settings;
  const props = h("div", { class: "readouts" });
  const fill = () => {
    let w = null;
    try { w = water(s.temperature_C); } catch { /* out of range: the solver reports it */ }
    props.replaceChildren(
      readout("Density ρ", w ? `${fmt(w.rho, 4)} kg/m³` : "–"),
      readout("Viscosity μ", w ? `${fmt(w.mu * 1000, 3)} mPa·s` : "–"),
      readout("Vapor pressure p<sub>v</sub>", w ? `${fmt(w.pv / 1000, 3)} kPa (abs)` : "–"));
  };
  fill();
  return [
    h("div", { class: "panel-head" }, h("h2", {}, "Design")),
    section(null,
      textField("Design name", d, "name"),
      textField("Your name", d, "author"),
      areaField("Notes", d, "notes", 4, "Anything the reader of this file should know")),
    section("Water and site",
      numberField("Water temperature", "°C", s, "temperature_C", { group: "set", after: fill, min: 0, max: 100 }),
      numberField("Atmospheric pressure", "kPa", s, "patm_kPa", { group: "set", min: 0, hint: "83 kPa in Boulder; 101.325 kPa at sea level" }),
      props),
    h("p", { class: "help" }, "Click a component or a pipe to edit it. Tank surface pressures are gauge pressures, relative to this atmospheric pressure. Your name and notes are saved in the design file."),
  ];
}

export function renderPanel() {
  const item = findSelected();
  let content;
  if (!item) content = settingsPanel();
  else if (S.sel.kind === "pipe") content = pipePanel(item);
  else if (S.sel.kind === "label") content = labelPanel(item);
  else content = { tank: tankPanel, junction: junctionPanel, pump: pumpPanel, valve: valvePanel }[item.type](item);
  root.replaceChildren(...content.flat().filter(Boolean));
}
