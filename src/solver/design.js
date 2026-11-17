// design.js -- what a "design" is: the thing the student draws, the app
// autosaves, and the downloaded file contains.
//
// A design is plain JSON:
//
//   {
//     app: "mcen3021-pipe-network",
//     schema: 2,                      <- bump when the format changes
//     name: "...", author: "...", notes: "...",
//     settings: { temperature_C, patm_kPa, price_per_kWh, hours_per_year, years,
//                 vfd_price, pipe_price },
//     components: [ tank | junction | pump | valve ... ],
//     pipes: [ ... ],
//     labels: [ { id, x, y, text } ... ]      text written on the canvas
//     scenarios: [ { name, share, design } ... ]   saved states for comparison;
//                 share = percent of the running time spent in that state
//   }
//
// Schema 2 added author, notes, labels, the two prices, a pump's "vfd" flag
// and a scenario's share. A schema 1 file opens with those at their defaults.
//
// Components sit on the canvas at (x, y) and have ports that pipes attach
// to. A tank or junction has one port, "a", which takes any number of pipes.
// A pump has "in" and "out"; a valve has "a" and "b".
//
//   tank:     { id, type, name, x, y, z, p_kPa }         z = surface elevation
//   junction: { id, type, name, x, y, z, Qin_Ls }   Qin_Ls = flow set at the
//             junction, L/s: > 0 enters the network there, < 0 leaves it
//   pump:     { id, type, name, x, y, rot, z, model, custom, speed, on, ideal, vfd }
//             ideal = true holds the efficiency at its peak at every flow
//   valve:    { id, type, name, x, y, rot, z, K, D, closed }   closed = true passes no flow
//   pipe:     { id, name, from: {comp, port}, to: {comp, port}, mid,
//               L, D, material, eps_mm, fittings: [{kind, n}], K_extra }
//
// Units in the file are the units shown in the app: m, kPa, °C, and mm for
// roughness. The solver converts to plain SI.

import { PUMP_CATALOG, ROUGHNESS, FITTINGS } from "./tables.js";

export const APP_ID = "mcen3021-pipe-network";
export const SCHEMA = 2;

export const DEFAULT_SETTINGS = {
  temperature_C: 20,
  patm_kPa: 83, // Boulder
  price_per_kWh: 0.12,
  hours_per_year: 6000,
  years: 10,
  vfd_price: 4000, // $ for one variable-frequency drive (a teaching prop)
  pipe_price: 150, // $ per metre of 0.10 m pipe; other sizes in proportion to D
};

export function newDesign() {
  return {
    app: APP_ID,
    schema: SCHEMA,
    name: "Untitled design",
    author: "",
    notes: "",
    settings: { ...DEFAULT_SETTINGS },
    components: [],
    pipes: [],
    labels: [],
    scenarios: [],
  };
}

export const PORTS = {
  tank: ["a"],
  junction: ["a"],
  pump: ["in", "out"],
  valve: ["a", "b"],
};

export const TYPE_LABEL = { tank: "Tank", junction: "Junction", pump: "Pump", valve: "Valve", pipe: "Pipe" };

const DEFAULT_CUSTOM_PUMP = { h0: 30, a: 9e4, eta: 0.7, n0: 1.5, n1: 4e3, price: 0 };

// Default properties for a new component of the given type.
export function defaultProps(type) {
  switch (type) {
    case "tank": return { z: 0, p_kPa: 0 };
    case "junction": return { z: 0, Qin_Ls: 0 };
    case "pump": return { rot: 0, z: 0, model: "CV-50", custom: { ...DEFAULT_CUSTOM_PUMP }, speed: 1, on: true, ideal: false, vfd: false };
    case "valve": return { rot: 0, z: 0, K: 0.15, D: 0.1, closed: false };
    case "pipe": return { L: 10, D: 0.1, material: "commercial_steel", eps_mm: 0.045, fittings: [], K_extra: 0, mid: null };
    default: throw new Error(`unknown component type "${type}"`);
  }
}

// A name not yet used in the design: "Tank 1", "Tank 2", "J1", "Pipe 3"...
export function nextName(design, type) {
  const prefix = { tank: "Tank ", junction: "J", pump: "Pump ", valve: "Valve ", pipe: "Pipe " }[type];
  const used = new Set([...design.components, ...design.pipes].map((c) => c.name));
  for (let n = 1; ; n++) if (!used.has(prefix + n)) return prefix + n;
}

export function nextId(design) {
  const used = new Set([...design.components, ...design.pipes, ...(design.labels || [])].map((c) => c.id));
  for (let n = 1; ; n++) if (!used.has("c" + n)) return "c" + n;
}

// Add a piece of text to the canvas; returns it.
export function addLabel(design, x, y, text = "Text") {
  const label = { id: nextId(design), x, y, text };
  design.labels.push(label);
  return label;
}

// Does this pump have a variable-frequency drive to pay for? Yes if the box
// is ticked, and also whenever it runs at anything but its rated speed.
export function pumpHasDrive(pump) {
  return !!pump.vfd || Number(pump.speed) !== 1;
}

// Purchase price of a pipe: pipe_price dollars per metre at D = 0.10 m, in
// proportion to the diameter. A teaching prop, like the pump prices.
export function pipePrice(pipe, settings) {
  const v = (Number(settings.pipe_price) || 0) * (Number(pipe.L) || 0) * ((Number(pipe.D) || 0) / 0.1);
  return v > 0 ? v : 0;
}

// Add a component; returns it.
export function addComponent(design, type, x, y, props = {}) {
  const comp = { id: nextId(design), type, name: nextName(design, type), x, y, ...defaultProps(type), ...props };
  design.components.push(comp);
  return comp;
}

// Add a pipe between two ports; returns it.
export function addPipe(design, fromComp, fromPort, toComp, toPort, props = {}) {
  const pipe = {
    id: nextId(design),
    name: nextName(design, "pipe"),
    from: { comp: fromComp, port: fromPort },
    to: { comp: toComp, port: toPort },
    ...defaultProps("pipe"),
    ...props,
  };
  design.pipes.push(pipe);
  return pipe;
}

// The pump's curve numbers: from the catalog, or the student's own.
export function pumpSpec(pump) {
  if (pump.model !== "custom" && PUMP_CATALOG[pump.model]) return PUMP_CATALOG[pump.model];
  return { name: "custom pump", rpm: null, ...pump.custom };
}

// Roughness of a pipe in metres.
export function pipeRoughness(pipe) {
  if (pipe.material !== "custom" && ROUGHNESS[pipe.material]) return ROUGHNESS[pipe.material].eps;
  return Number(pipe.eps_mm) / 1000;
}

// Sum of the loss coefficients on a pipe.
export function pipeKTotal(pipe) {
  let K = Number(pipe.K_extra) || 0;
  for (const f of pipe.fittings || []) {
    if (FITTINGS[f.kind]) K += FITTINGS[f.kind].K * Number(f.n);
  }
  return K;
}

// Check that an object read from a file or from storage is a design this
// version understands, and fill in anything missing. Throws an Error with a
// message meant for the student if it is not usable.
export function loadDesign(obj) {
  if (!obj || typeof obj !== "object" || obj.app !== APP_ID) {
    throw new Error("That file is not a pipe network design saved by this app.");
  }
  if (!(obj.schema >= 1)) throw new Error("That design file has no schema version.");
  if (obj.schema > SCHEMA) {
    throw new Error(
      `That design was saved by a newer version of the app (file schema ${obj.schema}, ` +
      `this app reads up to ${SCHEMA}). Reload the page to get the latest version.`);
  }
  const d = newDesign();
  d.name = typeof obj.name === "string" ? obj.name : d.name;
  d.author = typeof obj.author === "string" ? obj.author : "";
  d.notes = typeof obj.notes === "string" ? obj.notes : "";
  d.settings = { ...DEFAULT_SETTINGS, ...(obj.settings || {}) };
  for (const c of obj.components || []) {
    if (!PORTS[c.type] || typeof c.id !== "string") continue;
    const comp = { ...defaultProps(c.type), ...c };
    if (c.type === "pump") comp.custom = { ...DEFAULT_CUSTOM_PUMP, ...(c.custom || {}) };
    d.components.push(comp);
  }
  const ids = new Map(d.components.map((c) => [c.id, c]));
  for (const p of obj.pipes || []) {
    const ok = (end) => end && ids.has(end.comp) && PORTS[ids.get(end.comp).type].includes(end.port);
    if (typeof p.id !== "string" || !ok(p.from) || !ok(p.to)) continue;
    d.pipes.push({ ...defaultProps("pipe"), ...p, fittings: (p.fittings || []).map((f) => ({ ...f })) });
  }
  for (const t of Array.isArray(obj.labels) ? obj.labels : []) {
    if (t && typeof t.id === "string" && typeof t.text === "string") d.labels.push({ id: t.id, x: Number(t.x) || 0, y: Number(t.y) || 0, text: t.text });
  }
  // A saved scenario is a design too, so it gets the same treatment (an old
  // file's scenarios pick up the newer settings at their defaults).
  for (const sc of Array.isArray(obj.scenarios) ? obj.scenarios : []) {
    if (!sc || !sc.design) continue;
    try {
      const inner = loadDesign({ ...sc.design, app: APP_ID, schema: sc.design.schema || 1, scenarios: [] });
      d.scenarios.push({ name: String(sc.name || "Scenario"), share: Number(sc.share) || 0, design: inner });
    } catch { /* a scenario we cannot read is dropped; the design itself still opens */ }
  }
  return d;
}
