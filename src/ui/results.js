// results.js -- the panel under the canvas: messages, pump plots, energy
// cost, tables, and scenario comparison.
//
// Everything here reports numbers. Nothing here says whether a design is
// good; that judgment belongs to the student.

import { S, changed, select, replaceDesign } from "./state.js";
import { analyze } from "../solver/analyze.js";
import { designDiff } from "../solver/insight.js";
import { pumpSpec, pumpHasDrive, drivePrice, pipePrice } from "../solver/design.js";
import { pumpPlot } from "./pumpplot.js";
import { gradeTab, budgetTab, sweepTab, pipeWork, moodyChart } from "./insight-tabs.js";
import { csvButton } from "./export.js";
import { glossFor } from "./help.js";
import { table, needSolve, kW, Ls, compName } from "./bits.js";
import { h, fmt, fix, money } from "./util.js";

let tabsEl = null, bodyEl = null;
export function initResults(tabs, body) { tabsEl = tabs; bodyEl = body; }

const TABS = [
  ["messages", "Messages"], ["pumps", "Pumps"], ["power", "Where the power goes"], ["energy", "Costs"],
  ["sweep", "Sweep"], ["grade", "Grade line"], ["pipes", "Pipes"], ["nodes", "Heads and pressures"], ["scenarios", "Scenarios"],
];

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

function messagesTab() {
  const r = S.result;
  const out = [];
  const list = (items, cls) => h("ul", { class: "msgs " + cls }, items.map((m) => h("li", {
    class: m.ids.length ? "link" : "",
    title: m.ids.length ? "Click to select it on the canvas" : null,
    onclick: m.ids.length ? () => {
      const id = m.ids[0];
      select({ kind: S.design.pipes.some((p) => p.id === id) ? "pipe" : "comp", id });
    } : null,
  }, m.text)));

  if (r.status === "empty" && !r.notes.length) {
    out.push(h("div", { class: "start" },
      h("p", {}, h("b", {}, "To build a network: "), "drag tanks, junctions, pumps and valves from the left onto the canvas. To add a pipe, drag from a port (a small circle) on one component to a port on another. Click anything to edit its properties on the right."),
      h("p", {}, "The network is solved every time you change it. A network needs at least one tank, and every pump and valve needs a pipe on both sides. The Examples menu has a few small systems to start from.")));
  }
  if (r.errors.length) {
    out.push(h("h3", {}, "This network cannot be solved as drawn"), list(r.errors, "errors"));
  }
  if (r.status === "solved") {
    out.push(h("p", { class: "solved" }, `Solved in ${r.iterations} iterations.`));
  }
  if (r.notes.length) {
    out.push(h("h3", {}, "Notes"), list(r.notes, "notes"));
  }
  if (!S.storageOk) {
    out.push(h("p", { class: "help" }, "This browser is not letting the app autosave. Use Download design to keep your work."));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Pumps
// ---------------------------------------------------------------------------

function pumpsTab() {
  if (S.result.status !== "solved") return [needSolve()];
  const pumps = S.design.components.filter((c) => c.type === "pump" && S.result.comps[c.id]);
  if (!pumps.length) return [h("p", { class: "empty" }, "There is no pump in this network.")];
  const stat = (label, value, unit) => h("div", { class: "stat" }, h("span", { html: label, title: glossFor(label) }), h("b", {}, value), h("i", {}, unit));
  return [h("div", { class: "cards" }, pumps.map((c) => {
    const r = S.result.comps[c.id];
    const spec = pumpSpec(c);
    return h("div", { class: "card" + (S.sel?.id === c.id ? " sel" : "") },
      h("h3", { class: "link", onclick: () => select({ kind: "comp", id: c.id }) },
        c.name, h("span", { class: "sub" }, ` ${spec.name} · speed ratio ${fmt(c.speed)}${c.on ? "" : " · off"}`)),
      h("div", { class: "stats" },
        stat("flow rate Q", Ls(r.Q), "L/s"),
        stat("pump head", fix(r.head, 2), "m"),
        stat("efficiency η", r.on ? fix(r.eta, 3) : "–", ""),
        stat("shaft power", kW(r.power), "kW"),
        stat("NPSH available", fix(r.npsha, 2), "m"),
        stat("NPSH required", r.on ? fix(r.npshr, 2) : "–", "m"),
        stat("best-efficiency flow", fix(r.bep * 1000, 2), "L/s")),
      pumpPlot(c, r));
  }))];
}

// ---------------------------------------------------------------------------
// Energy cost
// ---------------------------------------------------------------------------

function energyOutput() {
  if (S.result.status !== "solved") return [needSolve()];
  const s = S.design.settings, t = S.result.totals;
  const pumps = S.design.components.filter((c) => c.type === "pump");
  if (!pumps.length) return [h("p", { class: "empty" }, "There is no pump in this network.")];
  const perYear = (watts) => (watts / 1000) * s.hours_per_year;
  const rows = pumps.map((c) => {
    const r = S.result.comps[c.id];
    const spec = pumpSpec(c);
    if (!r) return { cells: [c.name, spec.name, "not connected", "–", "–", "–", "–", "–", "–", "–", "–", money(spec.price)] };
    return {
      pick: { kind: "comp", id: c.id }, sel: S.sel?.id === c.id,
      cells: [c.name, spec.name, c.on ? "running" : "off", Ls(r.Q), fix(r.head, 2), r.on ? fix(r.eta, 3) : "–", kW(r.power),
        pumpHasDrive(c) ? kW(r.drawn) : "no drive",
        fmt(perYear(r.drawn), 4), money(perYear(r.drawn) * s.price_per_kWh),
        money(perYear(r.drawn) * s.price_per_kWh * s.years), money(spec.price)],
    };
  });
  rows.push({ total: true, cells: ["All pumps", "", "", "", "", "", kW(t.power), kW(t.drawn), fmt(t.kWhPerYear, 4), money(t.costPerYear), money(t.lifetimeCost), money(t.purchase)] });
  const energy = table(["Pump", "Model", "State", "Q [L/s]", "Pump head [m]", "η", "Shaft power [kW]", "Drawn through the drive [kW]", "Energy [kWh/yr]", "Energy cost per year",
    `Energy cost over ${fmt(s.years)} yr`, "Purchase price"], rows, { text: [1, 2] });

  // What it costs to buy, beside what it costs to run.
  const driven = pumps.filter(pumpHasDrive).map((c) => `${c.name} ${money(drivePrice(c, s))}`);
  const buy = table(["Purchase", "What", "Price"], [
    { cells: ["Pumps", pumps.map((c) => pumpSpec(c).name).join(", "), money(t.purchase)] },
    { cells: ["Variable-frequency drives", driven.length ? driven.join(", ") : "none", money(t.driveCost)] },
    { cells: ["Pipe", `${fmt(t.pipeLength, 4)} m in all`, money(t.pipeCost)] },
    { total: true, cells: ["All purchases", "", money(t.purchase + t.driveCost + t.pipeCost)] },
  ], { text: [1] });
  const pipeRows = S.design.pipes.filter((p) => p.L > 0).map((p) => ({
    pick: { kind: "pipe", id: p.id }, sel: S.sel?.id === p.id, cells: [p.name, fmt(p.L), fmt(p.D), money(pipePrice(p, s) / p.L), money(pipePrice(p, s))] }));
  return [
    energy, csvButton(energy, `${S.design.name} energy cost`),
    h("p", { class: "help", html: "Shaft power = ρ g Q H / η, with H the pump's own head and η its efficiency at this flow: the loss in a throttling valve downstream is energy the pump has already been paid for. " +
      `A pump with a variable-frequency drive draws more than that, since the drive passes on only ${fmt(s.vfd_eta)} of what it takes in: shaft power / ${fmt(s.vfd_eta)}. ` +
      "Energy cost = power drawn × hours per year × years × electricity price, at this operating point. Motor losses are not included." }),
    h("h3", { class: "gap" }, "Purchase prices"),
    buy, csvButton(buy, `${S.design.name} purchase prices`),
    pipeRows.length ? table(["Pipe", "L [m]", "D [m]", "Price per metre", "Price"], pipeRows) : null,
    h("p", { class: "help" }, "Purchase prices are for everything as drawn, running or not, and are teaching props, not quotes. A drive is counted for every pump whose drive box is ticked, and costs the base price plus the per-kW price times the pump's rated power " +
      "(its shaft power at the best-efficiency point at rated speed), so a bigger pump needs a dearer drive. The drive price includes installing it. " +
      "Pipe is priced per metre in proportion to its diameter. Energy cost and purchase price are shown side by side; weighing one against the other is left to you."),
  ];
}

function energyTab() {
  const s = S.design.settings;
  const out = h("div", { id: "energy-out" }, energyOutput());
  const box = (label, key, unit) => {
    const input = h("input", {
      type: "number", step: "any", min: 0, value: s[key] ?? "",
      oninput: () => {
        s[key] = input.value.trim() === "" ? 0 : Number(input.value);
        changed("energy:" + key, { keepPanel: true });
      },
    });
    return h("label", { class: "field inline" }, h("span", { class: "lab" }, label), h("span", { class: "inp" }, input, h("span", { class: "unit" }, unit)));
  };
  return [
    h("div", { class: "inputs-row" },
      box("Electricity price", "price_per_kWh", "$/kWh"),
      box("Running time", "hours_per_year", "hours/yr"),
      box("Lifetime", "years", "years"),
      box("Drive price, base", "vfd_base", "$ each"),
      box("Drive price, per kW", "vfd_per_kW", "$/kW"),
      box("Drive efficiency", "vfd_eta", ""),
      box("Pipe price at D = 0.10 m", "pipe_price", "$/m")),
    out,
  ];
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

function pipesTab() {
  if (S.result.status !== "solved") return [needSolve()];
  const rows = S.design.pipes.filter((p) => S.result.pipes[p.id]).map((p) => {
    const r = S.result.pipes[p.id];
    const back = r.Q < 0;
    const a = compName(back ? p.to.comp : p.from.comp), b = compName(back ? p.from.comp : p.to.comp);
    const kPa = (pa) => (pa === null ? "–" : fix(pa / 1000, 1));
    return {
      pick: { kind: "pipe", id: p.id }, sel: S.sel?.id === p.id,
      cells: [p.name, r.Q === 0 ? `${a} – ${b} (no flow)` : `${a} → ${b}`, fmt(p.L), fmt(p.D), Ls(Math.abs(r.Q)), fix(r.V, 2),
        r.Q === 0 ? "–" : fmt(r.Re, 3), r.f === null ? "–" : fix(r.f, 4), fix(r.hMajor, 3), fix(r.hMinor, 3), fmt(r.K),
        kPa(back ? r.pTo : r.pFrom), kPa(back ? r.pFrom : r.pTo)],
    };
  });
  if (!rows.length) return [h("p", { class: "empty" }, "There is no pipe in this network.")];
  const picked = S.sel?.kind === "pipe" ? S.design.pipes.find((p) => p.id === S.sel.id) : null;
  const tbl = table(["Pipe", "Flow direction", "L [m]", "D [m]", "Q [L/s]", "V [m/s]", "Re", "f", "Major loss [m]", "Minor loss [m]", "ΣK",
    "p upstream end [kPa]", "p downstream end [kPa]"], rows, { text: [1] });
  return [
    tbl, csvButton(tbl, `${S.design.name} pipes`),
    h("p", { class: "help", html: "Major loss = f (L/D) V²/2g; minor loss = ΣK V²/2g. f = 64/Re below Re = 2300, Colebrook above. " +
      "The pressures are gauge static pressures just inside each end of the pipe, p = ρg (H − z − αV²/2g) with α = 1; none is given at a tank, where the pipe's elevation is not known." }),
    picked ? pipeWork(picked) : h("p", { class: "help" }, "Click a pipe, in this table or on the canvas, to see its head equation worked out with the numbers put in."),
    moodyChart(),
  ];
}

function nodesTab() {
  if (S.result.status !== "solved") return [needSolve()];
  const rows = [];
  const kPa = (pa) => (pa === null || pa === undefined ? "–" : fix(pa / 1000, 1));
  for (const c of S.design.components) {
    const r = S.result.comps[c.id];
    if (!r) continue;
    const pick = { kind: "comp", id: c.id }, sel = S.sel?.id === c.id;
    if (c.type === "tank") rows.push({ pick, sel, cells: [c.name, "tank surface", fmt(c.z), fix(r.H, 2), fix(c.p_kPa, 1)] });
    else if (c.type === "junction") rows.push({ pick, sel, cells: [c.name, "junction", fmt(c.z), fix(r.H, 2), kPa(r.p)] });
    else if (c.type === "pump") {
      rows.push({ pick, sel, cells: [c.name, "pump inlet", fmt(c.z), fix(r.Hin, 2), kPa(r.pin)] });
      rows.push({ pick, sel, cells: [c.name, "pump outlet", fmt(c.z), fix(r.Hout, 2), kPa(r.pout)] });
    } else if (c.type === "valve") {
      const back = r.Q < 0;
      rows.push({ pick, sel, cells: [c.name, "valve, upstream side", fmt(c.z), fix(back ? r.Hb : r.Ha, 2), kPa(back ? r.pb : r.pa)] });
      rows.push({ pick, sel, cells: [c.name, "valve, downstream side", fmt(c.z), fix(back ? r.Ha : r.Hb, 2), kPa(back ? r.pa : r.pb)] });
    }
  }
  const tbl = table(["Name", "Where", "Elevation z [m]", "Head H [m]", "Pressure ρg(H − z) [kPa]"], rows, { text: [1] });
  return [
    tbl, csvButton(tbl, `${S.design.name} heads and pressures`),
    h("p", { class: "help", html: "H is the total head, p/ρg + αV²/2g + z, measured from the same datum as the elevations, with gauge pressure. " +
      "The last column is ρg (H − z): the gauge pressure plus the dynamic pressure αρV²/2. " +
      "For the static pressure inside a particular pipe, see the Pipes table. Atmospheric pressure here is " + fmt(S.design.settings.patm_kPa, 4) + " kPa." }),
  ];
}

// ---------------------------------------------------------------------------
// Scenarios: saved states, compared side by side
// ---------------------------------------------------------------------------

const scenarioCache = new Map(); // JSON text -> analysis
function analyzeScenario(design) {
  const key = JSON.stringify(design);
  if (!scenarioCache.has(key)) {
    if (scenarioCache.size > 40) scenarioCache.clear();
    let r;
    try { r = analyze(design, { curves: false }); } catch { r = { status: "error" }; }
    scenarioCache.set(key, r);
  }
  return scenarioCache.get(key);
}

let onlyDiffs = false; // show only the rows where the scenarios differ

function scenariosTab() {
  const d = S.design;
  const snapshot = () => JSON.parse(JSON.stringify({ ...d, scenarios: [] }));
  const nameInput = h("input", { type: "text", placeholder: "e.g. one pump out", value: "" });
  const save = () => {
    d.scenarios.push({ name: nameInput.value.trim() || `Scenario ${d.scenarios.length + 1}`, share: 0, design: snapshot() });
    changed();
  };
  const top = h("div", { class: "inputs-row" },
    h("label", { class: "field inline" }, h("span", { class: "lab" }, "Name"), h("span", { class: "inp" }, nameInput)),
    h("button", { type: "button", class: "primary", onclick: save }, "Save the current state as a scenario"),
    d.scenarios.length ? h("label", { class: "check flat" },
      h("input", { type: "checkbox", checked: onlyDiffs, onchange: (e) => { onlyDiffs = e.target.checked; renderResults(); } }), "Show only the rows that differ") : null);

  if (!d.scenarios.length) {
    return [top, h("p", { class: "empty" },
      "A scenario is a saved copy of the whole design, for example “all three pumps” and “one pump out”. Save two or more and they appear here side by side, with what differs marked. Scenarios are stored in the design file.")];
  }

  // Columns: the canvas as it is now, then each saved scenario.
  const cols = [{ name: "Now (on the canvas)", design: d, result: S.result }]
    .concat(d.scenarios.map((sc) => ({ name: sc.name, design: sc.design, result: analyzeScenario(sc.design), saved: sc })));
  const names = (type) => [...new Set(cols.flatMap((c) => c.design.components.filter((x) => x.type === type).map((x) => x.name)))];
  const pipeNames = [...new Set(cols.flatMap((c) => c.design.pipes.filter((p) => Number(p.L) > 0).map((p) => p.name)))];
  const comp = (col, name) => col.design.components.find((x) => x.name === name);
  const res = (col, item) => (item && col.result.status === "solved" ? (col.result.comps[item.id] || col.result.pipes[item.id]) : null);

  // A row is [label, value in each column]. A cell that differs from the
  // first column ("Now") is marked.
  const rows = [];
  const add = (label, fn) => {
    const vals = cols.map((c) => { const v = fn(c); return v === null || v === undefined ? "–" : v; });
    rows.push({ label, vals, differs: vals.some((v) => v !== vals[0]) });
  };
  const group = (label) => rows.push({ group: label });

  for (const name of names("pump")) {
    group(name);
    add("model", (c) => { const p = comp(c, name); return p ? pumpSpec(p).name : null; });
    add("state", (c) => { const p = comp(c, name); return p ? (p.on ? `running, speed ratio ${fmt(p.speed)}` : "off") : null; });
    add("Q [L/s]", (c) => { const r = res(c, comp(c, name)); return r ? Ls(r.Q) : null; });
    add("pump head [m]", (c) => { const r = res(c, comp(c, name)); return r ? fix(r.head, 2) : null; });
    add("efficiency η", (c) => { const r = res(c, comp(c, name)); return r && r.on ? fix(r.eta, 3) : null; });
    add("shaft power [kW]", (c) => { const r = res(c, comp(c, name)); return r ? kW(r.power) : null; });
    add("NPSH available [m]", (c) => { const r = res(c, comp(c, name)); return r ? fix(r.npsha, 2) : null; });
    add("NPSH required [m]", (c) => { const r = res(c, comp(c, name)); return r && r.on ? fix(r.npshr, 2) : null; });
  }
  for (const name of names("valve")) {
    group(name);
    add("K", (c) => { const v = comp(c, name); return v ? (v.closed ? "closed" : fmt(v.K)) : null; });
    add("head loss [m]", (c) => { const r = res(c, comp(c, name)); return r ? fix(r.hLoss, 2) : null; });
  }
  if (pipeNames.length) group("Pipe flows [L/s]");
  for (const name of pipeNames) {
    add(name, (c) => { const r = res(c, c.design.pipes.find((p) => p.name === name)); return r ? Ls(Math.abs(r.Q)) : null; });
  }
  group("All pumps");
  const tot = (c) => (c.result.status === "solved" ? c.result.totals : null);
  add("shaft power [kW]", (c) => (tot(c) ? kW(tot(c).power) : null));
  add("power drawn, with drive losses [kW]", (c) => (tot(c) ? kW(tot(c).drawn) : null));
  add("energy cost per year", (c) => (tot(c) ? money(tot(c).costPerYear) : null));
  add("energy cost over the lifetime", (c) => (tot(c) ? `${money(tot(c).lifetimeCost)} (${fmt(c.design.settings.years)} yr)` : null));
  add("purchase: pumps, drives and pipe", (c) => (tot(c) ? money(tot(c).purchase + tot(c).driveCost + tot(c).pipeCost) : null));

  // Drop the unchanged rows if asked, and then any group left empty.
  let shown = onlyDiffs ? rows.filter((r) => r.group || r.differs) : rows;
  shown = shown.filter((r, i) => !r.group || (shown[i + 1] && !shown[i + 1].group));

  const share = (sc) => {
    const input = h("input", { type: "number", min: 0, max: 100, step: "any", value: sc.share || 0, class: "share",
      title: "Percent of the running time spent in this state",
      onchange: () => { sc.share = Math.max(0, Number(input.value) || 0); changed(); } });
    return h("span", { class: "share-box" }, input, "% of the time");
  };
  const head = ["", ...cols.map((c) => {
    if (!c.saved) return c.name;
    const load = h("button", { type: "button", title: "Put this scenario back on the canvas (your current canvas is replaced; Undo brings it back)",
      onclick: () => replaceDesign({ ...JSON.parse(JSON.stringify(c.design)), scenarios: d.scenarios }) }, "Load");
    const update = h("button", { type: "button", title: "Replace this scenario with what is on the canvas now",
      onclick: () => { c.saved.design = snapshot(); changed(); } }, "Update");
    const rename = h("button", { type: "button", title: "Rename this scenario",
      onclick: () => { const name = prompt("Scenario name", c.saved.name); if (name && name.trim()) { c.saved.name = name.trim(); changed(); } } }, "Rename");
    const del = h("button", { type: "button", title: "Delete this scenario",
      onclick: () => { d.scenarios = d.scenarios.filter((x) => x !== c.saved); changed(); } }, "Delete");
    return h("span", {}, c.name, h("span", { class: "col-actions" }, load, update, rename, del),
      c.result.status === "solved" ? null : h("div", { class: "sub" }, "not solvable as saved"),
      h("div", {}, share(c.saved)));
  })];
  const tbl = h("div", { class: "table-scroll" }, h("table", { class: "data compare" },
    h("thead", {}, h("tr", {}, head.map((t) => h("th", {}, t)))),
    h("tbody", {}, shown.map((r) => (r.group
      ? h("tr", {}, h("th", {}, h("span", { class: "group" }, r.group)), cols.map(() => h("td", {})))
      : h("tr", {}, h("th", { title: glossFor(r.label) }, r.label),
        r.vals.map((v, i) => h("td", { class: "txt" + (i > 0 && v !== r.vals[0] ? " diff" : "") }, v))))))));

  // The inputs that changed, in words, for each scenario against the canvas.
  const changes = cols.filter((c) => c.saved).map((c) => {
    const diff = designDiff(d, c.design);
    return h("div", { class: "changes" }, h("b", {}, `${c.name}, compared with the canvas: `),
      diff.length ? h("ul", {}, diff.map((x) => h("li", {}, `${x.who}: ${x.what} ${x.from} → ${x.to}`)))
        : "the same inputs as the canvas.");
  });

  // Energy cost weighted by how much of the time each scenario runs.
  const used = d.scenarios.filter((sc) => sc.share > 0);
  let blend = null;
  if (used.length) {
    const sum = used.reduce((t, sc) => t + sc.share, 0);
    const s = d.settings;
    const solved = used.every((sc) => analyzeScenario(sc.design).status === "solved");
    const avg = solved ? used.reduce((t, sc) => t + (sc.share / 100) * analyzeScenario(sc.design).totals.drawn, 0) : null;
    const perYear = avg === null ? null : (avg / 1000) * s.hours_per_year * s.price_per_kWh;
    blend = h("div", { class: "blend" },
      h("h3", {}, "Weighted by the share of the time in each scenario"),
      solved ? h("div", { class: "stats" },
        h("div", { class: "stat" }, h("span", {}, "average power drawn"), h("b", {}, kW(avg)), h("i", {}, "kW")),
        h("div", { class: "stat" }, h("span", {}, "energy cost per year"), h("b", {}, money(perYear))),
        h("div", { class: "stat" }, h("span", {}, `energy cost over ${fmt(s.years)} yr`), h("b", {}, money(perYear * s.years))))
        : h("p", { class: "help" }, "A scenario with a share is not solvable as saved, so there is no weighted figure."),
      h("p", { class: "help" }, `${used.map((sc) => `${sc.name} ${fmt(sc.share)}%`).join(" + ")} = ${fmt(sum)}%` +
        (Math.abs(sum - 100) > 0.01 ? ". The shares do not add up to 100%, so this covers only part of (or more than) the running time." : ".") +
        ` Uses the canvas's ${fmt(s.hours_per_year)} hours per year and $${fmt(s.price_per_kWh)}/kWh.`));
  }
  return [top, tbl, csvButton(tbl, `${d.name} scenarios`),
    h("p", { class: "help" }, "Components are matched between scenarios by name. A shaded cell differs from the canvas. Energy costs use each scenario's own price, hours and lifetime. " +
      "To weight the energy cost by how the plant actually runs, give each scenario its share of the running time."),
    blend, h("div", { class: "changes-wrap" }, changes)];
}

// ---------------------------------------------------------------------------

export function renderResults(opts = {}) {
  const r = S.result;
  const count = r.errors.length + r.notes.length;
  tabsEl.replaceChildren(...TABS.map(([key, label]) => h("button", {
    type: "button", role: "tab", class: "tab" + (S.tab === key ? " active" : ""),
    "aria-selected": S.tab === key ? "true" : "false",
    onclick: () => { S.tab = key; renderResults(); },
  }, label, key === "messages" && count ? h("span", { class: "count" + (r.errors.length ? " err" : "") }, String(count)) : null,
  key === "scenarios" && S.design.scenarios.length ? h("span", { class: "count" }, String(S.design.scenarios.length)) : null)));

  // While the student types in the energy inputs, only refresh the numbers.
  const out = document.getElementById("energy-out");
  if (opts.keepPanel && S.tab === "energy" && out && bodyEl.contains(document.activeElement)) {
    out.replaceChildren(...energyOutput().filter(Boolean));
    return;
  }
  if (!TABS.some(([key]) => key === S.tab)) S.tab = "messages";
  const make = { messages: messagesTab, pumps: pumpsTab, power: budgetTab, energy: energyTab, sweep: sweepTab, grade: gradeTab,
    pipes: pipesTab, nodes: nodesTab, scenarios: scenariosTab }[S.tab];
  const scroll = bodyEl.scrollTop;
  bodyEl.replaceChildren(...make().flat().filter(Boolean));
  bodyEl.scrollTop = scroll;
}
