// insight.js -- other ways of looking at a solved network.
//
//   gradeLine(design, result, from, to, via)   heads along one path
//   powerBudget(design, result)                where the power goes
//   designDiff(a, b)                           what differs between two designs
//   sweepTargets / sweepOutputs / runSweep     vary one input, watch an output
//
// Like analyze.js, nothing here knows about the page, and nothing here
// judges a design. These are numbers for the student to read.

import { G } from "./tables.js";
import { analyze } from "./analyze.js";
import { pumpSpec, pipeKTotal } from "./design.js";

const isNode = (c) => c.type === "tank" || c.type === "junction";
const nodeId = (c, port) => (isNode(c) ? c.id : `${c.id}:${port}`);

// ---------------------------------------------------------------------------
// Grade lines along a path
// ---------------------------------------------------------------------------

// The network as a graph we can walk: pipes join ports, and a pump or valve
// joins its own two ports.
function walkGraph(design, result) {
  const comps = new Map(design.components.map((c) => [c.id, c]));
  const edges = [];
  for (const p of design.pipes) {
    const a = comps.get(p.from.comp), b = comps.get(p.to.comp);
    if (!a || !b || !result.pipes[p.id]) continue;
    edges.push({ id: p.id, kind: "pipe", item: p, a: nodeId(a, p.from.port), b: nodeId(b, p.to.port), ca: a, cb: b });
  }
  for (const c of design.components) {
    if (isNode(c) || !result.comps[c.id]) continue;
    const [pa, pb] = c.type === "pump" ? ["in", "out"] : ["a", "b"];
    edges.push({ id: c.id, kind: c.type, item: c, a: `${c.id}:${pa}`, b: `${c.id}:${pb}`, ca: c, cb: c });
  }
  return edges;
}

// Shortest path (fewest links) from node `start` to node `goal`. Returns a
// list of { edge, forward } or null. `banned` is a set of nodes to avoid.
function shortest(edges, start, goal, banned = new Set(), skipEdge = null) {
  const prev = new Map([[start, null]]);
  const queue = [start];
  while (queue.length) {
    const at = queue.shift();
    if (at === goal) break;
    for (const e of edges) {
      if (e.id === skipEdge) continue;
      const next = e.a === at ? e.b : e.b === at ? e.a : null;
      if (next === null || prev.has(next) || banned.has(next)) continue;
      prev.set(next, { edge: e, forward: e.a === at, from: at });
      queue.push(next);
    }
  }
  if (!prev.has(goal)) return null;
  const path = [];
  for (let at = goal; prev.get(at); at = prev.get(at).from) path.unshift(prev.get(at));
  return path;
}

// A path from `start` to `goal` that passes through the link `via` if one
// exists, otherwise just the shortest path.
function pathThrough(edges, start, goal, via) {
  const e = edges.find((x) => x.id === via);
  if (e) {
    for (const [first, second] of [[e.a, e.b], [e.b, e.a]]) {
      const head = shortest(edges, start, first, new Set([second, goal].filter((n) => n !== first)), e.id);
      if (!head) continue;
      const used = new Set([start, first, ...head.map((s) => (s.forward ? s.edge.b : s.edge.a))]);
      used.delete(goal);
      const tail = shortest(edges, second, goal, used, e.id);
      if (tail) return [...head, { edge: e, forward: first === e.a }, ...tail];
    }
  }
  return shortest(edges, start, goal);
}

// Heads along a path between two tanks or junctions.
//
//   from, to: component ids (tank or junction)
//   via:      optional id of a pipe, pump or valve the path should include
//
// Returns null if there is no path, otherwise
//   { points:   [{ x, s, egl, hgl, z }]
//     stations: [{ x, s, name, type }]    the components passed, in order
//     length, scaled }
// s is the true distance along the pipes [m]. x is where to draw: the same
// thing, except that every pump, valve and zero-length connection is given
// a little width (3% of the path) so that the step across it can be seen
// as a step of its own and not piled onto its neighbors.
// egl is the total head (the energy grade line), hgl = egl - V^2/2g (the
// hydraulic grade line), z the elevation where it is known (null at a tank,
// whose pipe elevation the design does not record).
//
// Within a pipe the head falls in a straight line from one end to the
// other: the design does not say where along the pipe each fitting sits,
// so the minor losses are spread over the length with the friction.
// If every pipe on the path has zero length, `scaled` is false and x just
// counts the links.
export function gradeLine(design, result, from, to, via = null) {
  if (result.status !== "solved" || from === to) return null;
  const comps = new Map(design.components.map((c) => [c.id, c]));
  const start = comps.get(from), goal = comps.get(to);
  if (!start || !goal || !isNode(start) || !isNode(goal) || !result.comps[from] || !result.comps[to]) return null;
  const path = pathThrough(walkGraph(design, result), from, to, via);
  if (!path) return null;

  const length = path.reduce((sum, s) => sum + (s.edge.kind === "pipe" ? Number(s.edge.item.L) : 0), 0);
  const scaled = length > 0;
  const zOf = (c) => (c.type === "tank" ? null : c.z);
  const points = [], stations = [];
  const pad = scaled ? 0.03 * length : 1; // drawn width of something that has no length
  let x = 0, dist = 0;
  const station = (c, at = x) => {
    const last = stations[stations.length - 1];
    if (!last || last.id !== c.id) stations.push({ x: at, s: dist, id: c.id, name: c.name, type: c.type });
  };
  station(start);
  if (start.type === "tank") points.push({ x, s: dist, egl: result.comps[from].H, hgl: result.comps[from].H, z: null });
  for (const step of path) {
    const e = step.edge;
    if (e.kind !== "pipe") {
      // A pump or valve: the lines run straight across its drawn width,
      // from the end of the pipe before it to the start of the pipe after.
      station(e.item, x + pad / 2);
      x += pad;
      continue;
    }
    const r = result.pipes[e.id];
    const hv = (r.V * r.V) / (2 * G);
    const [H1, H2] = step.forward ? [r.Hfrom, r.Hto] : [r.Hto, r.Hfrom];
    const [c1, c2] = step.forward ? [e.ca, e.cb] : [e.cb, e.ca];
    const L = Number(e.item.L);
    if (c1.type === "tank" || c1.type === "junction") station(c1);
    points.push({ x, s: dist, egl: H1, hgl: H1 - hv, z: zOf(c1) });
    x += L > 0 && scaled ? L : pad;
    dist += L;
    points.push({ x, s: dist, egl: H2, hgl: H2 - hv, z: zOf(c2) });
    if (c2.type === "tank" || c2.type === "junction") station(c2);
  }
  if (goal.type === "tank") points.push({ x, s: dist, egl: result.comps[to].H, hgl: result.comps[to].H, z: null });
  return { points, stations, length, scaled, path: path.map((s) => s.edge.id) };
}

// ---------------------------------------------------------------------------
// Where the power goes
// ---------------------------------------------------------------------------

// An energy balance on the whole network, in watts. For any solved network
//
//   power the pumps give the water  =  friction in pipes  +  fittings
//                                      +  valves  +  lift
//
// where "lift" is rho g (sum of Q H where water leaves the network, minus
// the same where it enters): the power that went into raising the water
// (and its pressure) from where it came in to where it went out. Lift is
// negative when the water ends up lower than it started, as in a gravity
// drain; then it is the source of the power and not a use of it.
//
// Returns { shaft, water, pumpLoss, major, minor, valves, lift, items }
// with items = [{ id, name, kind, W }] for the detail table. kind is
// "pump loss" | "major" | "minor" | "valve".
export function powerBudget(design, result) {
  if (result.status !== "solved") return null;
  const rhoG = result.fluid.rho * G;
  const out = { drive: 0, shaft: 0, water: 0, pumpLoss: 0, major: 0, minor: 0, valves: 0, lift: 0, items: [] };
  const into = new Map(); // tank or junction id -> net flow arriving by pipe

  for (const p of design.pipes) {
    const r = result.pipes[p.id];
    if (!r) continue;
    const Q = Math.abs(r.Q);
    const major = rhoG * Q * r.hMajor, minor = rhoG * Q * r.hMinor;
    out.major += major; out.minor += minor;
    if (major > 0) out.items.push({ id: p.id, name: p.name, kind: "major", W: major });
    if (minor > 0) out.items.push({ id: p.id, name: p.name, kind: "minor", W: minor });
    into.set(p.to.comp, (into.get(p.to.comp) || 0) + r.Q);
    into.set(p.from.comp, (into.get(p.from.comp) || 0) - r.Q);
  }
  for (const c of design.components) {
    const r = result.comps[c.id];
    if (!r) continue;
    if (c.type === "valve") {
      const W = rhoG * Math.abs(r.Q) * r.hLoss;
      out.valves += W;
      if (W > 0) out.items.push({ id: c.id, name: c.name, kind: "valve", W });
    } else if (c.type === "pump" && r.on) {
      const water = rhoG * r.Q * r.head;
      out.water += water; out.shaft += r.power; out.drive += r.driveLoss || 0;
      if (r.driveLoss > 0) out.items.push({ id: c.id, name: c.name, kind: "drive loss", W: r.driveLoss });
      if (r.power - water > 0) out.items.push({ id: c.id, name: c.name, kind: "pump loss", W: r.power - water });
    } else if (isNode(c)) {
      // Water arriving at a tank, or leaving at a junction with a set
      // outflow, carries its head out of the network.
      out.lift += rhoG * (into.get(c.id) || 0) * r.H;
    }
  }
  out.pumpLoss = out.shaft - out.water;
  out.items.sort((a, b) => b.W - a.W);
  return out;
}

// ---------------------------------------------------------------------------
// What differs between two designs
// ---------------------------------------------------------------------------

const PROPS = {
  tank: [["z", "surface elevation", "m"], ["p_kPa", "surface pressure", "kPa"]],
  junction: [["z", "elevation", "m"], ["Qin_Ls", "flow in (set)", "L/s"]],
  valve: [["K", "K", ""], ["D", "line diameter", "m"], ["z", "elevation", "m"]],
  pump: [["speed", "speed ratio", ""], ["z", "elevation", "m"]],
  pipe: [["L", "length", "m"], ["D", "diameter", "m"]],
  settings: [["temperature_C", "water temperature", "°C"], ["patm_kPa", "atmospheric pressure", "kPa"],
    ["price_per_kWh", "electricity price", "$/kWh"], ["hours_per_year", "running time", "h/yr"], ["years", "lifetime", "yr"],
    ["vfd_base", "drive price, base", "$"], ["vfd_per_kW", "drive price, per kW", "$/kW"], ["vfd_eta", "drive efficiency", ""], ["pipe_price", "pipe price", "$/m"]],
};

// The inputs that differ going from design a to design b, matched by name.
// Returns [{ who, what, from, to }] with from and to as display text.
// Positions on the canvas, and anything else that does not change the
// answer, are ignored.
export function designDiff(a, b) {
  const out = [];
  const show = (v, unit) => (v === null || v === undefined ? "–" : `${v}${unit ? " " + unit : ""}`);
  const compare = (who, list, x, y) => {
    for (const [key, what, unit] of list) {
      if (x[key] !== y[key]) out.push({ who, what, from: show(x[key], unit), to: show(y[key], unit) });
    }
  };
  compare("Settings", PROPS.settings, a.settings, b.settings);

  const byName = (list) => new Map(list.map((c) => [c.name, c]));
  const walk = (listA, listB, kindOf, each) => {
    const A = byName(listA), B = byName(listB);
    for (const [name, x] of A) {
      const y = B.get(name);
      if (!y || kindOf(y) !== kindOf(x)) out.push({ who: name, what: kindOf(x), from: "present", to: "not there" });
      else each(name, x, y);
    }
    for (const [name, y] of B) {
      const x = A.get(name);
      if (!x || kindOf(y) !== kindOf(x)) out.push({ who: name, what: kindOf(y), from: "not there", to: "present" });
    }
  };
  walk(a.components, b.components, (c) => c.type, (name, x, y) => {
    if (x.type === "pump") {
      if (!!x.on !== !!y.on) out.push({ who: name, what: "state", from: x.on ? "running" : "off", to: y.on ? "running" : "off" });
      const sx = pumpSpec(x), sy = pumpSpec(y);
      if (x.model !== y.model) out.push({ who: name, what: "model", from: sx.name, to: sy.name });
      else if (x.model === "custom") {
        for (const k of ["h0", "a", "eta", "n0", "n1", "price"]) {
          if (sx[k] !== sy[k]) out.push({ who: name, what: `custom curve ${k}`, from: show(sx[k]), to: show(sy[k]) });
        }
      }
      if (!!x.vfd !== !!y.vfd) out.push({ who: name, what: "variable-frequency drive", from: x.vfd ? "yes" : "no", to: y.vfd ? "yes" : "no" });
      if (!!x.ideal !== !!y.ideal) out.push({ who: name, what: "ideal efficiency", from: x.ideal ? "yes" : "no", to: y.ideal ? "yes" : "no" });
    }
    if (x.type === "valve" && !!x.closed !== !!y.closed) out.push({ who: name, what: "state", from: x.closed ? "closed" : "open", to: y.closed ? "closed" : "open" });
    compare(name, PROPS[x.type], x, y);
  });
  walk(a.pipes, b.pipes, () => "pipe", (name, x, y) => {
    compare(name, PROPS.pipe, x, y);
    const mat = (p) => (p.material === "custom" ? `custom, ε = ${p.eps_mm} mm` : p.material.replace(/_/g, " "));
    if (mat(x) !== mat(y)) out.push({ who: name, what: "material", from: mat(x), to: mat(y) });
    if (pipeKTotal(x) !== pipeKTotal(y)) out.push({ who: name, what: "ΣK of the fittings", from: show(pipeKTotal(x)), to: show(pipeKTotal(y)) });
  });
  return out;
}

// ---------------------------------------------------------------------------
// Parameter sweep
// ---------------------------------------------------------------------------

// The inputs that can be varied. Each is
//   { key, label, unit, value, range: [lo, hi], set(design, v) }
// where value is what the input is now, range is a starting suggestion for
// the sweep, and set() writes a new value into a design (a copy: the caller
// makes the copy).
export function sweepTargets(design) {
  const out = [];
  const comp = (d, id) => d.components.find((c) => c.id === id);
  const one = (c, prop, label, unit, range) => out.push({
    key: `${c.id}:${prop}`, label: `${c.name}: ${label}`, unit, value: c[prop], range,
    set: (d, v) => { const x = comp(d, c.id); if (x) { x[prop] = v; if (prop === "speed") x.vfd = true; } },
  });
  const all = (type, prop, label, unit, range) => {
    const list = design.components.filter((c) => c.type === type);
    if (list.length < 2) return;
    out.push({
      key: `all:${type}:${prop}`, label: `All ${type}s together: ${label}`, unit, value: list[0][prop], range: range(list[0][prop]),
      set: (d, v) => { for (const x of d.components) if (x.type === type) { x[prop] = v; if (prop === "speed") x.vfd = true; } },
    });
  };
  const around = (v, d) => [v - d, v + d];
  const kRange = (v) => [0, Math.max(25, 2 * v)];
  const speedRange = (v) => [0.5, Math.max(1, v)];

  all("valve", "K", "K", "", kRange);
  for (const c of design.components) if (c.type === "valve") one(c, "K", "K", "", kRange(c.K));
  all("pump", "speed", "speed ratio", "", speedRange);
  for (const c of design.components) {
    if (c.type !== "pump") continue;
    one(c, "speed", "speed ratio", "", speedRange(c.speed));
    one(c, "z", "elevation", "m", around(c.z, 3));
  }
  for (const p of design.pipes) {
    if (!(p.L > 0)) continue;
    const pipe = (d) => d.pipes.find((x) => x.id === p.id);
    out.push({ key: `${p.id}:D`, label: `${p.name}: diameter`, unit: "m", value: p.D, range: [0.5 * p.D, 2 * p.D],
      set: (d, v) => { if (pipe(d)) pipe(d).D = v; } });
    out.push({ key: `${p.id}:L`, label: `${p.name}: length`, unit: "m", value: p.L, range: [0.5 * p.L, 2 * p.L],
      set: (d, v) => { if (pipe(d)) pipe(d).L = v; } });
  }
  for (const c of design.components) {
    if (c.type === "tank") {
      one(c, "z", "surface elevation", "m", around(c.z, 5));
      one(c, "p_kPa", "surface pressure", "kPa", around(c.p_kPa, 50));
    } else if (c.type === "junction") {
      one(c, "z", "elevation", "m", around(c.z, 5));
      if (c.Qin_Ls) one(c, "Qin_Ls", "flow in (set)", "L/s", c.Qin_Ls > 0 ? [0, 2 * c.Qin_Ls] : [2 * c.Qin_Ls, 0]);
    }
  }
  const s = design.settings;
  out.push({ key: "set:temperature_C", label: "Water temperature", unit: "°C", value: s.temperature_C, range: [5, 80],
    set: (d, v) => { d.settings.temperature_C = v; } });
  out.push({ key: "set:patm_kPa", label: "Atmospheric pressure", unit: "kPa", value: s.patm_kPa, range: [70, 101.325],
    set: (d, v) => { d.settings.patm_kPa = v; } });
  return out;
}

// The outputs that can be plotted. Each is
//   { key, label, unit, series: [{ name, get(result) }] }
// One output is one kind of quantity, with a line for every component that
// has it.
export function sweepOutputs(design) {
  const pumps = design.components.filter((c) => c.type === "pump");
  const valves = design.components.filter((c) => c.type === "valve");
  const junctions = design.components.filter((c) => c.type === "junction");
  const pipes = design.pipes.filter((p) => p.L > 0);
  const of = (list, fn) => list.map((c) => ({ name: c.name, get: (r) => { const x = r.comps[c.id] || r.pipes[c.id]; return x ? fn(x, r) : null; } }));
  const total = (name, fn) => (pumps.length > 1 ? [{ name, get: fn }] : []);
  const rhoG = (r) => r.fluid.rho * G;
  const out = [];
  if (pumps.length) {
    out.push({ key: "pumpQ", label: "Flow rate through each pump", unit: "L/s",
      series: [...of(pumps, (x) => x.Q * 1000), ...total("all pumps", (r) => pumps.reduce((sum, c) => sum + (r.comps[c.id]?.Q || 0), 0) * 1000)] });
    out.push({ key: "pumpH", label: "Pump head", unit: "m", series: of(pumps, (x) => (x.on ? x.head : null)) });
    out.push({ key: "power", label: "Shaft power", unit: "kW",
      series: [...of(pumps, (x) => x.power / 1000), ...total("all pumps", (r) => r.totals.power / 1000)] });
    out.push({ key: "eta", label: "Pump efficiency η", unit: "", series: of(pumps, (x) => (x.on ? x.eta : null)) });
    out.push({ key: "npsh", label: "NPSH available and required", unit: "m",
      series: pumps.flatMap((c) => [
        { name: `${c.name}: available`, get: (r) => r.comps[c.id]?.npsha ?? null },
        { name: `${c.name}: required`, get: (r) => r.comps[c.id]?.npshr ?? null }]) });
    out.push({ key: "drawn", label: "Power drawn (shaft power plus drive losses)", unit: "kW",
      series: [...of(pumps, (x) => (x.drawn ?? x.power) / 1000), ...total("all pumps", (r) => r.totals.drawn / 1000)] });
    out.push({ key: "cost", label: "Energy cost per year", unit: "$", series: [{ name: "all pumps", get: (r) => r.totals.costPerYear }] });
  }
  if (pipes.length) {
    out.push({ key: "pipeQ", label: "Flow rate in each pipe", unit: "L/s", series: of(pipes, (x) => Math.abs(x.Q) * 1000) });
    out.push({ key: "pipeV", label: "Speed in each pipe", unit: "m/s", series: of(pipes, (x) => x.V) });
    out.push({ key: "pipeLoss", label: "Head loss in each pipe", unit: "m", series: of(pipes, (x) => x.hMajor + x.hMinor) });
  }
  if (valves.length) {
    out.push({ key: "valveLoss", label: "Head loss in each valve", unit: "m", series: of(valves, (x) => x.hLoss) });
    out.push({ key: "valvePower", label: "Power dissipated in each valve", unit: "kW",
      series: of(valves, (x, r) => (rhoG(r) * Math.abs(x.Q) * x.hLoss) / 1000) });
  }
  if (junctions.length) {
    out.push({ key: "head", label: "Head at each junction", unit: "m", series: of(junctions, (x) => x.H) });
    out.push({ key: "pressure", label: "Pressure ρg(H − z) at each junction", unit: "kPa", series: of(junctions, (x) => x.p / 1000) });
  }
  return out;
}

// Solve the design once for each value of one input.
//   target: an entry of sweepTargets(design)
//   output: an entry of sweepOutputs(design)
// Returns { xs, series: [{ name, ys }], failed } where ys[i] is null if the
// network could not be solved at xs[i] (failed counts those). Lines that are
// identical at every step (three identical pumps, say) are merged into one,
// named for all of them.
export function runSweep(design, target, output, lo, hi, steps = 25) {
  const n = Math.max(2, Math.min(101, Math.round(steps)));
  const xs = Array.from({ length: n }, (_, i) => lo + ((hi - lo) * i) / (n - 1));
  const base = JSON.stringify({ ...design, scenarios: [] });
  const results = xs.map((x) => {
    const d = JSON.parse(base);
    target.set(d, x);
    try {
      const r = analyze(d, { curves: false });
      return r.status === "solved" ? r : null;
    } catch { return null; }
  });
  const raw = output.series.map((s) => ({
    name: s.name,
    ys: results.map((r) => { if (!r) return null; const v = s.get(r); return Number.isFinite(v) ? v : null; }),
  }));
  const series = [];
  for (const s of raw) {
    const same = series.find((t) => t.ys.every((y, i) => (y === null ? s.ys[i] === null : s.ys[i] !== null && Math.abs(y - s.ys[i]) <= 1e-9 * Math.max(1, Math.abs(y)))));
    if (same) same.name += `, ${s.name}`; else series.push(s);
  }
  return { xs, series, failed: results.filter((r) => !r).length };
}
