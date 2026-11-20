// analyze.js -- from a design (see design.js) to numbers.
//
//   analyze(design)  ->  {
//     status:  "empty" | "error" | "solved",
//     errors:  [{ text, ids }]   modeling errors; nothing was solved
//     notes:   [{ text, ids }]   things to know about a solved result
//     fluid, patm,
//     pipes:   { pipeId: { Q, V, Re, f, hMajor, hMinor, ... } },
//     comps:   { compId: { H, p, ... } },
//     totals:  { power, driveLoss, drawn, kWhPerYear, costPerYear, lifetimeCost,
//                purchase, drives, driveCost, pipeCost, pipeLength },
//     lowP:    [compId]          places where the pressure is below vapor pressure
//   }
//
// The app reports numbers; it does not judge the design. Errors are only
// for networks that cannot be solved as drawn, and each one names the
// component and says what to change.

import { G } from "./tables.js";
import { water, pipeState, pipeArea, pumpHead, pumpRunout, pumpNpshr, pumpEfficiency, pumpShaftPower, pumpBepFlow } from "./hydraulics.js";
import { solveNetwork } from "./network.js";
import { pumpSpec, pipeRoughness, pipeKTotal, pumpHasDrive, drivePrice, pipePrice, PORTS } from "./design.js";

// Flows smaller than this [m^3/s] are reported as "no flow" (0.002 L/s).
// It sits just above what leaks through a closed link in the solver.
export const Q_ZERO = 2e-6;

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const q = (name) => `“${name}”`;
const fmt = (x, digits = 3) => Number(x).toPrecision(digits).replace(/\.?0+$/, (m) => (m.includes(".") ? "" : m));

// The solver node a pipe end attaches to. Tanks and junctions are one node;
// a pump or valve has a node at each port.
function nodeId(comp, port) {
  return comp.type === "tank" || comp.type === "junction" ? comp.id : `${comp.id}:${port}`;
}

const PORT_WORD = { in: "inlet", out: "outlet", a: "first port", b: "second port" };

// ---------------------------------------------------------------------------
// Step 1: check the properties
// ---------------------------------------------------------------------------

function checkProperties(design, errors) {
  const need = (item, kind, value, what, rule) => {
    const who = `${kind} ${q(item.name)}`;
    if (!isNum(value)) {
      errors.push({ text: `${who}: ${what} is missing. Enter a number.`, ids: [item.id] });
      return false;
    }
    if (rule === "positive" && !(value > 0)) {
      errors.push({ text: `${who}: ${what} must be greater than zero (it is ${value}).`, ids: [item.id] });
      return false;
    }
    if (rule === "nonnegative" && value < 0) {
      errors.push({ text: `${who}: ${what} cannot be negative (it is ${value}).`, ids: [item.id] });
      return false;
    }
    return true;
  };

  const s = design.settings;
  if (!isNum(s.temperature_C) || s.temperature_C < 0 || s.temperature_C > 100) {
    errors.push({ text: "Settings: the water temperature must be between 0 and 100 °C.", ids: [] });
  }
  if (!isNum(s.patm_kPa) || !(s.patm_kPa > 0)) {
    errors.push({ text: "Settings: the atmospheric pressure must be greater than zero.", ids: [] });
  }
  if (design.components.some((c) => c.type === "pump" && pumpHasDrive(c)) && !(isNum(s.vfd_eta) && s.vfd_eta > 0 && s.vfd_eta <= 1)) {
    errors.push({ text: "Costs tab: the drive efficiency must be greater than 0 and no more than 1 (0.97 is typical).", ids: [] });
  }

  for (const c of design.components) {
    if (c.type === "tank") {
      need(c, "Tank", c.z, "the surface elevation");
      need(c, "Tank", c.p_kPa, "the surface pressure");
    } else if (c.type === "junction") {
      need(c, "Junction", c.z, "the elevation");
      need(c, "Junction", c.Qin_Ls, "the flow in (enter 0 for none)");
    } else if (c.type === "valve") {
      need(c, "Valve", c.z, "the elevation");
      need(c, "Valve", c.K, "the loss coefficient K", "nonnegative");
      need(c, "Valve", c.D, "the line diameter", "positive");
    } else if (c.type === "pump") {
      need(c, "Pump", c.z, "the elevation");
      need(c, "Pump", c.speed, "the speed ratio", "positive");
      if (c.model === "custom") {
        const k = c.custom || {};
        need(c, "Pump", k.h0, "the shutoff head h0", "positive");
        need(c, "Pump", k.a, "the curve coefficient a", "positive");
        if (need(c, "Pump", k.eta, "the peak efficiency η", "positive") && k.eta > 1) {
          errors.push({ text: `Pump ${q(c.name)}: the peak efficiency η must be between 0 and 1 (it is ${k.eta}).`, ids: [c.id] });
        }
        need(c, "Pump", k.n0, "the NPSH coefficient n0", "nonnegative");
        need(c, "Pump", k.n1, "the NPSH coefficient n1", "nonnegative");
      }
    }
  }
  for (const p of design.pipes) {
    need(p, "Pipe", p.L, "the length", "nonnegative");
    need(p, "Pipe", p.D, "the inside diameter", "positive");
    if (p.material === "custom") need(p, "Pipe", p.eps_mm, "the roughness", "nonnegative");
    need(p, "Pipe", p.K_extra, "the extra loss coefficient K", "nonnegative");
    for (const f of p.fittings || []) {
      if (!isNum(f.n) || f.n < 0) {
        errors.push({ text: `Pipe ${q(p.name)}: the number of each fitting must be zero or more.`, ids: [p.id] });
        break;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Step 2: turn the drawing into nodes and links, checking connections
// ---------------------------------------------------------------------------

function buildNetwork(design, fluid, errors, notes) {
  const comps = new Map(design.components.map((c) => [c.id, c]));
  const rhoG = fluid.rho * G;

  // Which nodes have at least one pipe?
  const piped = new Set();
  const links = [];
  for (const p of design.pipes) {
    const a = comps.get(p.from?.comp), b = comps.get(p.to?.comp);
    if (!a || !b) {
      errors.push({ text: `Pipe ${q(p.name)} has an end that is connected to nothing. Delete it and draw it again between two ports.`, ids: [p.id] });
      continue;
    }
    const from = nodeId(a, p.from.port), to = nodeId(b, p.to.port);
    if (from === to) {
      errors.push({ text: `Pipe ${q(p.name)} starts and ends at the same port. Connect its two ends to different components, or delete it.`, ids: [p.id] });
      continue;
    }
    piped.add(from); piped.add(to);
    links.push({ id: p.id, kind: "pipe", from, to, L: p.L, D: p.D, eps: pipeRoughness(p), K: pipeKTotal(p), name: p.name });
  }

  const nodes = [];
  for (const c of design.components) {
    if (c.type === "tank" || c.type === "junction") {
      if (!piped.has(c.id)) {
        const word = c.type === "tank" ? "Tank" : "Junction";
        notes.push({ text: `${word} ${q(c.name)} is not connected to anything, so it was left out.`, ids: [c.id] });
        continue;
      }
      nodes.push({
        id: c.id, comp: c.id, name: c.name,
        fixedHead: c.type === "tank" ? c.z + (c.p_kPa * 1000) / rhoG : null,
        // the solver's "demand" is flow withdrawn, so a set inflow is a negative demand
        demand: c.type === "junction" ? -(c.Qin_Ls || 0) / 1000 : 0,
      });
      continue;
    }
    // pump or valve: both ports must have a pipe
    const kind = c.type === "pump" ? "Pump" : "Valve";
    const free = PORTS[c.type].filter((port) => !piped.has(`${c.id}:${port}`));
    for (const port of free) {
      errors.push({
        text: `${kind} ${q(c.name)}: nothing is connected to its ${PORT_WORD[port]}. Draw a pipe from that port to another component, or delete the ${c.type}.`,
        ids: [c.id],
      });
    }
    if (free.length) continue;
    const [pa, pb] = PORTS[c.type];
    nodes.push({ id: `${c.id}:${pa}`, comp: c.id, name: c.name, fixedHead: null });
    nodes.push({ id: `${c.id}:${pb}`, comp: c.id, name: c.name, fixedHead: null });
    if (c.type === "pump") {
      const spec = pumpSpec(c);
      links.push({ id: c.id, kind: "pump", from: `${c.id}:in`, to: `${c.id}:out`, name: c.name,
        h0: spec.h0, a: spec.a, n0: spec.n0, n1: spec.n1, eta: spec.eta, ideal: !!c.ideal, speed: c.speed, on: !!c.on });
    } else {
      links.push({ id: c.id, kind: "valve", from: `${c.id}:a`, to: `${c.id}:b`, name: c.name, K: c.K, D: c.D, closed: !!c.closed });
    }
  }
  return { nodes, links, fluid };
}

// Groups of nodes that are joined to each other. `skip` is a link id to
// leave out; `only` (optional) says which links count. Returns an array of
// arrays of node ids.
function sections(net, skip = null, only = () => true) {
  const parent = new Map(net.nodes.map((n) => [n.id, n.id]));
  const find = (x) => { while (parent.get(x) !== x) x = parent.get(x); return x; };
  for (const l of net.links) {
    if (l.id === skip || !only(l) || !parent.has(l.from) || !parent.has(l.to)) continue;
    parent.set(find(l.from), find(l.to));
  }
  const groups = new Map();
  for (const n of net.nodes) {
    const r = find(n.id);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(n.id);
  }
  return [...groups.values()];
}

function checkTopology(design, net, errors) {
  if (!net.nodes.some((n) => n.fixedHead !== null)) {
    errors.push({
      text: "There is no tank in the network. A tank is the only place where the head is known, so at least one is needed. Add a tank and connect it with a pipe.",
      ids: [],
    });
    return;
  }
  const byId = new Map(net.nodes.map((n) => [n.id, n]));
  for (const group of sections(net)) {
    if (group.some((id) => byId.get(id).fixedHead !== null)) continue;
    const members = new Set(group.map((id) => byId.get(id).comp));
    const pipeIds = net.links.filter((l) => l.kind === "pipe" && group.includes(l.from)).map((l) => l.id);
    const names = design.components.filter((c) => members.has(c.id)).map((c) => c.name)
      .concat(design.pipes.filter((p) => pipeIds.includes(p.id)).map((p) => p.name));
    errors.push({
      text: `This part of the network is not connected to any tank, so its head cannot be found: ${names.join(", ")}. Connect it to the rest of the network, or delete it.`,
      ids: [...members, ...pipeIds],
    });
  }

  // Two tanks at different heads joined by connections that have no loss at
  // all (zero-length pipes without fittings, valves with K = 0): the flow
  // between them would be infinite.
  const lossless = (l) => (l.kind === "pipe" && l.L === 0 && l.K === 0) || (l.kind === "valve" && l.K === 0 && !l.closed);
  for (const group of sections(net, null, lossless)) {
    const tanks = group.map((id) => byId.get(id)).filter((n) => n.fixedHead !== null);
    const heads = tanks.map((n) => n.fixedHead);
    if (tanks.length < 2 || Math.max(...heads) - Math.min(...heads) < 1e-9) continue;
    const inGroup = new Set(group);
    const path = net.links.filter((l) => lossless(l) && inGroup.has(l.from) && inGroup.has(l.to));
    errors.push({
      text: `Tanks ${tanks.map((n) => q(n.name)).join(" and ")} are at different heads but are joined by connections with no loss at all ` +
        `(${path.map((l) => l.name).join(", ")}), so the flow between them would be infinite. Give a pipe on that path a length or a fitting, or give the valve a K above zero.`,
      ids: path.map((l) => l.id),
    });
  }
}

// ---------------------------------------------------------------------------
// Step 3: the flow curve seen by one pump
// ---------------------------------------------------------------------------

// The head the rest of the network demands of a pump, as a function of the
// flow through that pump. We take the pump out, push a chosen flow Q into
// its outlet node and draw the same Q from its inlet node, solve everything
// else (other pumps keep running), and read off H_outlet - H_inlet.
//
// Returns { Q: [...], demand: [...], Hin: [...] } or null when the question
// has no answer (one side of the pump would be cut off from every tank).
// The sweep stops early once the demanded head passes headCap: beyond that
// the curve is far above anything the pump can do, and off the plot.
export function pumpFlowCurve(net, pumpId, Qmax, headCap = Infinity, nPts = 41) {
  const pump = net.links.find((l) => l.id === pumpId);
  const byId = new Map(net.nodes.map((n) => [n.id, n]));
  for (const group of sections(net, pumpId)) {
    if (!group.some((id) => byId.get(id).fixedHead !== null)) return null;
  }
  const rest = { fluid: net.fluid, links: net.links.filter((l) => l.id !== pumpId) };
  const out = { Q: [], demand: [], Hin: [] };
  let guess = null;
  for (let i = 0; i < nPts; i++) {
    const Q = (Qmax * i) / (nPts - 1);
    rest.nodes = net.nodes.map((n) =>
      n.id === pump.from ? { ...n, demand: Q } : n.id === pump.to ? { ...n, demand: -Q } : n);
    const sol = solveNetwork(rest, guess);
    if (!sol.converged) { guess = null; continue; }
    guess = sol;
    out.Q.push(Q);
    out.demand.push(sol.H[pump.to] - sol.H[pump.from]);
    out.Hin.push(sol.H[pump.from]);
    if (out.demand[out.demand.length - 1] > headCap) break;
  }
  return out.Q.length > 1 ? out : null;
}

// ---------------------------------------------------------------------------
// The whole analysis
// ---------------------------------------------------------------------------

export function analyze(design, options = {}) {
  const wantCurves = options.curves !== false;
  const result = { status: "empty", errors: [], notes: [], pipes: {}, comps: {}, totals: null, lowP: [] };
  const { errors, notes } = result;
  if (!design.components.length && !design.pipes.length) return result;

  // Collect every problem we can find before giving up, so the student
  // sees the whole list at once.
  checkProperties(design, errors);
  const T = design.settings.temperature_C;
  const fluid = water(isNum(T) && T >= 0 && T <= 100 ? T : 20);
  const patm = design.settings.patm_kPa * 1000;
  const rhoG = fluid.rho * G;
  result.fluid = fluid;
  result.patm = patm;

  const before = errors.length;
  const net = buildNetwork(design, fluid, errors, notes);
  if (errors.length === before && net.nodes.length) checkTopology(design, net, errors);
  if (errors.length) { result.status = "error"; return result; }
  if (!net.nodes.length) return result; // only loose tanks and junctions so far

  const sol = solveNetwork(net);
  if (!sol.converged) {
    errors.push({
      text: "The solver did not converge on this network. That is a limit of the app's numerical method, not a statement about the design. " +
        "Try a small change to a property (a valve K, a pipe length). If it keeps happening, send the design file to your instructor.",
      ids: [],
    });
    result.status = "error";
    return result;
  }

  // A flow set at a junction must have somewhere to go. If its only way out
  // is through a pump that is off, or backward through a running pump's
  // check valve, the solver forces it through the closed pump with an
  // enormous head. That is a modeling error, not a result.
  const blocked = net.links.filter((l) => l.kind === "pump" && sol.closed[l.id] && Math.abs(sol.Q[l.id]) > 1e-5);
  if (blocked.length) {
    const setAt = design.components.filter((c) => c.type === "junction" && c.Qin_Ls).map((c) => q(c.name));
    for (const l of blocked) {
      const c = design.components.find((x) => x.id === l.id);
      errors.push({
        text: `Pump ${q(c.name)} is ${c.on ? "running, but its check valve is shut" : "off"}, and the flow set at ${setAt.join(", ") || "a junction"} can only get through by passing it` +
          `${c.on ? " backward" : ""}. Give that flow another path to a tank${c.on ? ", or change the flow you set" : ", or turn the pump on"}.`,
        ids: [c.id],
      });
    }
    result.status = "error";
    return result;
  }
  // The same for a closed valve: a set flow with no way round it.
  const shut = net.links.filter((l) => l.kind === "valve" && l.closed && Math.abs(sol.Q[l.id]) > 1e-5);
  if (shut.length) {
    const setAt = design.components.filter((c) => c.type === "junction" && c.Qin_Ls).map((c) => q(c.name));
    for (const l of shut) {
      errors.push({
        text: `Valve ${q(l.name)} is closed, and the flow set at ${setAt.join(", ") || "a junction"} can only get through by passing it. ` +
          "Open the valve, give that flow another path to a tank, or change the flow you set.",
        ids: [l.id],
      });
    }
    result.status = "error";
    return result;
  }
  result.status = "solved";
  result.iterations = sol.iterations;

  const comps = new Map(design.components.map((c) => [c.id, c]));
  const inNet = new Set(net.nodes.map((n) => n.comp));
  const zOf = (c) => (c.type === "tank" ? null : c.z); // a tank's z is its surface, not the pipe
  // "Pressure" at a node: rho g (H - z). It includes the velocity head.
  const pOf = (H, z) => (z === null ? null : rhoG * (H - z));

  // ---- pipes ----
  for (const p of design.pipes) {
    const link = net.links.find((l) => l.id === p.id);
    let Q = sol.Q[p.id];
    if (Math.abs(Q) < Q_ZERO) Q = 0;
    const st = pipeState(link, Q, fluid);
    const a = comps.get(p.from.comp), b = comps.get(p.to.comp);
    const Hfrom = sol.H[link.from], Hto = sol.H[link.to];
    const hv = (st.V * st.V) / (2 * G); // alpha = 1
    const staticP = (H, c) => (zOf(c) === null ? null : rhoG * (H - zOf(c) - hv));
    result.pipes[p.id] = {
      Q, V: st.V, Re: st.Re, f: Q === 0 ? null : st.f, hMajor: st.hMajor, hMinor: st.hMinor,
      regime: st.regime, K: link.K, eps: link.eps, Hfrom, Hto,
      pFrom: staticP(Hfrom, a), pTo: staticP(Hto, b),
    };
    if (Q !== 0 && st.regime === "laminar") {
      notes.push({ text: `Pipe ${q(p.name)}: the flow is laminar (Re = ${Math.round(st.Re)}), so f = 64/Re was used.`, ids: [p.id] });
    } else if (Q !== 0 && st.regime === "transitional") {
      notes.push({
        text: `Pipe ${q(p.name)}: Re = ${Math.round(st.Re)} is in the transitional range (2300 to 4000), where the friction factor is uncertain. The Colebrook value was used.`,
        ids: [p.id],
      });
    }
  }

  // ---- places where the water would boil ----
  // The solver assumes liquid everywhere. Where the absolute static pressure
  // in a pipe end falls below the vapor pressure that is no longer true, so
  // we say so: one note per component, for the lowest pressure found there.
  const lowest = new Map(); // compId -> { p, pipe }
  for (const p of design.pipes) {
    const r = result.pipes[p.id];
    for (const [end, pEnd] of [[p.from, r.pFrom], [p.to, r.pTo]]) {
      if (pEnd === null) continue;
      const seen = lowest.get(end.comp);
      if (!seen || pEnd < seen.p) lowest.set(end.comp, { p: pEnd, pipe: p });
    }
  }
  result.lowP = [];
  for (const [id, low] of lowest) {
    const pAbs = low.p + patm;
    if (pAbs >= fluid.pv) continue;
    const c = comps.get(id);
    result.lowP.push(id);
    notes.push({
      kind: "lowp",
      text: `At ${c.type} ${q(c.name)} (z = ${fmt(c.z)} m) the absolute pressure in pipe ${q(low.pipe.name)} comes out as ${fmt(pAbs / 1000)} kPa, ` +
        `below the vapor pressure of the water (${fmt(fluid.pv / 1000)} kPa). Water cannot stay liquid there, and the solver assumes it does, ` +
        "so the numbers for this network are not physical as drawn. The elevation there, or the losses upstream of it, set that pressure.",
      ids: [id],
    });
  }

  // ---- components ----
  let anyFlow = Object.values(result.pipes).some((r) => r.Q !== 0);
  const running = [];
  for (const c of design.components) {
    if (!inNet.has(c.id)) continue;
    if (c.type === "tank") {
      result.comps[c.id] = { H: sol.H[c.id] };
    } else if (c.type === "junction") {
      const H = sol.H[c.id];
      result.comps[c.id] = { H, p: pOf(H, c.z) };
      const n = design.pipes.filter((p) => p.from.comp === c.id || p.to.comp === c.id).length;
      if (n === 1 && !c.Qin_Ls) {
        notes.push({ text: `Junction ${q(c.name)} has only one pipe, so it is a dead end and that pipe carries no flow.`, ids: [c.id] });
      }
    } else if (c.type === "valve") {
      let Q = sol.Q[c.id];
      if (c.closed || Math.abs(Q) < Q_ZERO) Q = 0;
      const V = Math.abs(Q) / pipeArea(c.D);
      const Ha = sol.H[`${c.id}:a`], Hb = sol.H[`${c.id}:b`];
      result.comps[c.id] = { Q, V, hLoss: (c.K * V * V) / (2 * G), Ha, Hb, pa: pOf(Ha, c.z), pb: pOf(Hb, c.z), closed: !!c.closed };
    } else if (c.type === "pump") {
      const link = net.links.find((l) => l.id === c.id);
      const spec = pumpSpec(c);
      let Q = sol.Q[c.id];
      if (!c.on || Q < Q_ZERO) Q = 0;
      const Hin = sol.H[link.from], Hout = sol.H[link.to];
      const head = c.on ? pumpHead(link, Q) : 0;
      const shutoff = c.speed * c.speed * spec.h0;
      const runout = pumpRunout(link);
      const r = {
        on: !!c.on, Q, head, Hin, Hout, pin: pOf(Hin, c.z), pout: pOf(Hout, c.z),
        power: c.on ? pumpShaftPower(link, Q, fluid) : 0, // shaft power, W
        eta: c.on ? pumpEfficiency(link, Q) : null, // efficiency at this flow
        etaMax: spec.eta, bep: pumpBepFlow(link), ideal: !!c.ideal, price: spec.price, model: spec.name, shutoff, runout,
        // NPSH available: absolute total head at the inlet, above the pump
        // centerline, minus the vapor pressure head.
        npsha: Hin - c.z + (patm - fluid.pv) / rhoG,
        npshr: c.on ? pumpNpshr(link, Q) : null,
        curve: null,
      };
      result.comps[c.id] = r;
      if (c.on) {
        running.push({ c, r });
        if (Q === 0 && anyFlow) {
          notes.push({
            text: `Pump ${q(c.name)} is running but delivers no flow. The head across it (${fmt(Hout - Hin)} m) is above its shutoff head (${fmt(shutoff)} m), so its check valve stays closed.`,
            ids: [c.id],
          });
        }
        // A number, not a verdict: the margin is negative, and the student
        // decides what to do about it. (The pump plot shows the same thing.)
        if (Q > 0 && r.npsha < r.npshr) {
          notes.push({
            text: `Pump ${q(c.name)}: NPSH available (${fmt(r.npsha)} m) is below NPSH required (${fmt(r.npshr)} m) at Q = ${fmt(Q * 1000)} L/s, ` +
              `so NPSH available − NPSH required = ${fmt(r.npsha - r.npshr)} m. The pump plot shows both curves. ` +
              "NPSH available rises if the pump sits lower or the suction line loses less; NPSH required falls at a lower flow per pump or a lower speed.",
            ids: [c.id],
          });
        }
        if (Q >= runout) {
          notes.push({
            text: `Pump ${q(c.name)} is running beyond the end of its curve: Q = ${fmt(Q * 1000)} L/s, and the curve reaches zero head at ${fmt(runout * 1000)} L/s. ` +
              `Past that point H = h0 − a Q² is negative (${fmt(head)} m here), so the pump takes head from the flow; its shaft power is reported as zero.`,
            ids: [c.id],
          });
        }
      }
      if (wantCurves) {
        const Qmax = Math.max(runout, 1.2 * Q);
        const curve = pumpFlowCurve(net, c.id, Qmax, 3 * shutoff);
        if (curve) {
          curve.npsha = curve.Hin.map((H) => H - c.z + (patm - fluid.pv) / rhoG);
          curve.Qmax = Qmax;
        }
        r.curve = curve;
        // The same question with every other pump switched off, to show how
        // much the other pumps move this pump's flow curve.
        r.curveAlone = null;
        if (curve && net.links.some((l) => l.kind === "pump" && l.id !== c.id && l.on)) {
          const alone = { ...net, links: net.links.map((l) => (l.kind === "pump" && l.id !== c.id ? { ...l, on: false } : l)) };
          r.curveAlone = pumpFlowCurve(alone, c.id, Qmax, 3 * shutoff, 21);
        }
      }
    }
  }

  if (!anyFlow) {
    const tanks = design.components.filter((c) => c.type === "tank" && inNet.has(c.id))
      .map((c) => `${c.name} = ${fmt(result.comps[c.id].H)} m`).join(", ");
    if (running.length) {
      const pumps = running.map(({ c, r }) => `${c.name} adds ${fmt(r.shutoff)} m of head`).join(", ");
      notes.unshift({
        text: `Nothing is flowing. At zero flow, ${pumps}; the tank heads are ${tanks}. ` +
          "If the running pumps cannot overcome the static lift between the tanks, there is no flow: that takes more pump head " +
          "(a different pump, a higher speed, pumps in series) or a smaller lift. Also check that there is a path from one tank to another that is not shut by a closed valve.",
        ids: running.map(({ c }) => c.id),
      });
    } else {
      notes.unshift({
        text: `Nothing is flowing: no pump is running (a pump that is off passes no flow) and nothing else drives a flow. Tank heads: ${tanks}.` +
          (design.components.some((c) => c.type === "valve" && c.closed) ? " A closed valve passes no flow either." : ""),
        ids: [],
      });
    }
  }

  // ---- energy ----
  const s = design.settings;
  const allPumps = design.components.filter((c) => c.type === "pump");
  // A pump with a drive draws more than its shaft power: the drive loses
  // (1 - vfd_eta) of what it takes in. Energy is billed on what is drawn.
  for (const c of design.components) {
    const r = c.type === "pump" ? result.comps[c.id] : null;
    if (!r) continue;
    r.drawn = pumpHasDrive(c) ? r.power / s.vfd_eta : r.power;
    r.driveLoss = r.drawn - r.power;
  }
  const power = running.reduce((sum, { r }) => sum + r.power, 0);
  const drawn = running.reduce((sum, { r }) => sum + r.drawn, 0);
  const kWhPerYear = (drawn / 1000) * s.hours_per_year;
  result.totals = {
    power,
    drawn,
    driveLoss: drawn - power,
    kWhPerYear,
    costPerYear: kWhPerYear * s.price_per_kWh,
    lifetimeCost: kWhPerYear * s.price_per_kWh * s.years,
    purchase: allPumps.reduce((sum, c) => sum + (Number(pumpSpec(c).price) || 0), 0),
    drives: allPumps.filter(pumpHasDrive).length,
    pipeCost: design.pipes.reduce((sum, p) => sum + pipePrice(p, s), 0),
    pipeLength: design.pipes.reduce((sum, p) => sum + (Number(p.L) || 0), 0),
  };
  result.totals.driveCost = allPumps.filter(pumpHasDrive).reduce((sum, c) => sum + drivePrice(c, s), 0);
  return result;
}
