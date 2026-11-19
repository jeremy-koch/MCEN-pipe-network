// insight.test.js -- the grade line, the power budget, the scenario
// difference list, the parameter sweep, the low-pressure note, and the
// design-file additions of schema 2 and 3.

import test from "node:test";
import assert from "node:assert/strict";

import { analyze } from "../src/solver/analyze.js";
import { gradeLine, powerBudget, designDiff, sweepTargets, sweepOutputs, runSweep } from "../src/solver/insight.js";
import { newDesign, addComponent, addPipe, addLabel, loadDesign, SCHEMA, DEFAULT_SETTINGS, drivePrice, pumpRatedPower_kW } from "../src/solver/design.js";
import { gravityDrain, simpleLift, threePumpStation, byType, pipeNamed } from "../src/examples.js";

const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);

test("power budget balances: gravity drain, simple lift, three-pump station", () => {
  for (const d of [gravityDrain(), simpleLift(), simpleLift({ arrangement: "parallel" }), threePumpStation({ K: 20 })]) {
    const b = powerBudget(d, analyze(d));
    const uses = b.major + b.minor + b.valves + b.lift;
    near(b.water, uses, 1e-4 * Math.max(1, Math.abs(b.water), b.major + b.minor), `${d.name}: water power vs its uses`);
    near(b.items.reduce((s, i) => s + i.W, 0), b.pumpLoss + b.major + b.minor + b.valves, 1e-6 * Math.max(1, b.shaft), `${d.name}: items`);
  }
});

test("power budget of the gravity drain: the fall pays for the losses", () => {
  const d = gravityDrain();
  const b = powerBudget(d, analyze(d));
  assert.equal(b.shaft, 0);
  assert.ok(b.lift < 0);
  // rho g Q (15 m) with Q = 17.89 L/s
  near(-b.lift, 998.2 * 9.81 * 0.01789 * 15, 5, "power released by the fall [W]");
});

test("power budget of the station: throttling valves take a visible share", () => {
  const d = threePumpStation({ K: 20 });
  const b = powerBudget(d, analyze(d));
  assert.ok(b.valves > 0.1 * b.water, "valves dissipate more than a tenth of the water power at K = 20");
  const open = threePumpStation({ K: 0.15 });
  assert.ok(powerBudget(open, analyze(open)).valves < 0.01 * b.water);
});

test("grade line of the simple lift", () => {
  const d = simpleLift();
  const r = analyze(d);
  const [t1, t2] = byType(d, "tank");
  const g = gradeLine(d, r, t1.id, t2.id);
  assert.equal(g.length, 65);
  assert.equal(g.scaled, true);
  assert.deepEqual(g.stations.map((s) => s.type), ["tank", "pump", "tank"]);
  const first = g.points[0], last = g.points[g.points.length - 1];
  near(first.egl, 0, 1e-9, "starts at the lower tank"); near(last.egl, 12, 1e-9, "ends at the upper tank");
  near(last.s, 65, 1e-9, "the distance ends at the total length");
  assert.deepEqual(g.stations.map((s) => s.s), [0, 5, 65]);
  // the pump is drawn with a little width (3% of the path), so x runs past s
  near(last.x, 65 * 1.03, 1e-9, "drawn width");
  // the step across the pump, between the two pipes, is the pump head
  near(g.points[3].egl - g.points[2].egl, 18.43, 0.01, "step at the pump");
  near(g.points[3].x - g.points[2].x, 0.03 * 65, 1e-9, "drawn width of the pump");
  for (const p of g.points) assert.ok(p.hgl <= p.egl + 1e-12);
  // and the other way round is the mirror image
  const back = gradeLine(d, r, t2.id, t1.id);
  near(back.points[0].egl, 12, 1e-9, "reverse path starts high");
});

test("grade line goes through the selected branch", () => {
  const d = threePumpStation({ K: 20 });
  const r = analyze(d);
  const [t1, t2] = byType(d, "tank");
  const pumps = byType(d, "pump");
  for (const p of pumps) {
    const g = gradeLine(d, r, t1.id, t2.id, p.id);
    assert.ok(g.path.includes(p.id), `path includes ${p.name}`);
    assert.ok(g.stations.some((s) => s.id === p.id));
  }
  assert.equal(gradeLine(d, r, t1.id, t1.id), null);
});

test("designDiff lists the inputs that changed, and only those", () => {
  const a = threePumpStation({ K: 20 });
  const b = threePumpStation({ K: 0.15, on: [true, true, false] });
  b.components[0].x += 50; // moving a tank on the canvas is not a difference
  const diff = designDiff(a, b);
  assert.equal(diff.filter((x) => x.what === "K").length, 3);
  assert.deepEqual(diff.filter((x) => x.what === "state").map((x) => [x.from, x.to]), [["running", "off"]]);
  assert.equal(diff.length, 4);
  assert.equal(designDiff(a, threePumpStation({ K: 20 })).length, 0);
  b.pipes = b.pipes.filter((p) => p.name !== "header");
  assert.ok(designDiff(a, b).some((x) => x.who === "header" && x.to === "not there"));
});

test("sweep: all three valves together reach 60 L/s near K = 23.3", () => {
  const d = threePumpStation({ K: 20 });
  const target = sweepTargets(d).find((t) => t.key === "all:valve:K");
  const output = sweepOutputs(d).find((o) => o.key === "pumpQ");
  const before = JSON.stringify(d);
  const sw = runSweep(d, target, output, 0, 46.6, 3); // K = 0, 23.3, 46.6
  assert.equal(JSON.stringify(d), before, "the sweep leaves the design alone");
  assert.equal(sw.failed, 0);
  // three identical pumps collapse into one line, plus the total
  assert.equal(sw.series.length, 2);
  const total = sw.series.find((s) => s.name === "all pumps");
  near(total.ys[1], 60, 0.3, "total flow at K = 23.3 [L/s]");
  assert.ok(total.ys[0] > total.ys[1] && total.ys[1] > total.ys[2], "more throttling, less flow");
});

test("sweep: one pump's speed, and every output can be evaluated", () => {
  const d = simpleLift();
  const target = sweepTargets(d).find((t) => t.label.endsWith("speed ratio"));
  for (const output of sweepOutputs(d)) {
    const sw = runSweep(d, target, output, 0.5, 1, 6);
    assert.equal(sw.xs.length, 6);
    assert.ok(sw.series.length >= 1, output.key);
  }
  const q = runSweep(d, target, sweepOutputs(d).find((o) => o.key === "pumpQ"), 0.8, 1, 2);
  near(q.series[0].ys[0], 7.13, 0.04, "Q at 80% speed [L/s]");
  near(q.series[0].ys[1], 11.34, 0.06, "Q at full speed [L/s]");
});

test("a siphon crest above the vapor-pressure limit gets a low-pressure note", () => {
  const make = (zCrest) => {
    const d = newDesign();
    const t1 = addComponent(d, "tank", 0, 0, { z: 5 });
    const j = addComponent(d, "junction", 100, 0, { z: zCrest });
    const t2 = addComponent(d, "tank", 200, 0, { z: 0 });
    addPipe(d, t1.id, "a", j.id, "a", { L: 20, D: 0.05 });
    addPipe(d, j.id, "a", t2.id, "a", { L: 20, D: 0.05 });
    return { d, j };
  };
  const high = make(14); // 9 m above the upper surface; 83 kPa is only about 8.5 m of water
  const r = analyze(high.d);
  assert.equal(r.status, "solved");
  assert.deepEqual(r.lowP, [high.j.id]);
  assert.equal(r.notes.filter((n) => n.kind === "lowp").length, 1);
  const low = analyze(make(6).d);
  assert.deepEqual(low.lowP, []);
});

test("none of the referee systems has a low-pressure note", () => {
  for (const d of [gravityDrain(), simpleLift(), threePumpStation({ K: 20 })]) {
    assert.deepEqual(analyze(d).lowP, [], d.name);
  }
});

test("a closed valve shuts its line: the same flow as switching that line's pump off", () => {
  const off = threePumpStation({ K: 0.15, on: [true, true, false] });
  const shut = threePumpStation({ K: 0.15 });
  const valves = byType(shut, "valve");
  valves[2].closed = true;
  const a = analyze(off), b = analyze(shut);
  assert.equal(b.status, "solved");
  const q = (d, r) => Math.abs(r.pipes[pipeNamed(d, "header").id].Q) * 1000;
  near(q(shut, b), q(off, a), 0.01, "total flow [L/s]");
  near(q(shut, b), 51.3, 0.1, "two pumps deliver 51.3 L/s");
  assert.equal(b.comps[valves[2].id].Q, 0);
  assert.equal(b.comps[byType(shut, "pump")[2].id].Q, 0, "the pump behind the closed valve delivers nothing");
  assert.ok(b.notes.some((n) => n.text.includes("running but delivers no flow")));
  // every valve closed: nothing flows, and the app says so without failing
  for (const v of valves) v.closed = true;
  const none = analyze(shut);
  assert.equal(none.status, "solved");
  assert.equal(q(shut, none), 0);
  // a closed valve is a difference between two designs
  assert.ok(designDiff(threePumpStation({ K: 0.15 }), shut).some((x) => x.what === "state" && x.to === "closed"));
});

test("a flow set behind a closed valve is a modeling error that names the valve", () => {
  const d = newDesign();
  const j = addComponent(d, "junction", 0, 0, { Qin_Ls: 5 });
  const v = addComponent(d, "valve", 100, 0, { closed: true });
  const t = addComponent(d, "tank", 200, 0, { z: 0 });
  addPipe(d, j.id, "a", v.id, "a", { L: 10 });
  addPipe(d, v.id, "b", t.id, "a", { L: 10 });
  const r = analyze(d);
  assert.equal(r.status, "error");
  assert.ok(r.errors[0].text.includes("is closed") && r.errors[0].ids.includes(v.id));
});

test("purchase prices: pumps, drives and pipe", () => {
  const d = threePumpStation({ K: 20 });
  let t = analyze(d).totals;
  assert.equal(t.purchase, 3 * 5600);
  assert.equal(t.drives, 0);
  assert.equal(t.pipeLength, 250);
  assert.equal(t.pipeCost, 150 * 250 * 2); // 0.20 m pipe costs twice the 0.10 m price
  const pumps = byType(d, "pump");
  pumps[0].speed = 0.9; // running off rated speed needs a drive
  pumps[1].vfd = true; // a drive that happens to sit at rated speed
  t = analyze(d).totals;
  assert.equal(t.drives, 2);
  assert.equal(t.driveCost, drivePrice(pumps[0], d.settings) + drivePrice(pumps[1], d.settings));
});

test("drive price grows with the size of the pump", () => {
  const s = newDesign().settings;
  const elk = { type: "pump", model: "CV-80", speed: 1 };
  // Elk at its best point: Q = sqrt(52/(3*3.5e4)) = 22.25 L/s, H = 34.67 m, eta = 0.74
  const kW = (998.2 * 9.81 * Math.sqrt(52 / 1.05e5) * (2 / 3) * 52) / 0.74 / 1000;
  assert.ok(Math.abs(pumpRatedPower_kW(elk) - kW) < 1e-9);
  assert.ok(Math.abs(kW - 10.21) < 0.01);
  assert.ok(Math.abs(drivePrice(elk, s) - (s.vfd_base + s.vfd_per_kW * kW)) < 1e-9);
  const sizes = ["GN-25", "GN-40", "CV-50", "CV-80", "HS-120"].map((m) => drivePrice({ type: "pump", model: m }, s));
  for (let i = 1; i < sizes.length; i++) assert.ok(sizes[i] > sizes[i - 1]);
  // a custom pump is sized from its own curve
  const custom = { type: "pump", model: "custom", custom: { h0: 52, a: 3.5e4, eta: 0.74, n0: 1, n1: 1, price: 0 } };
  assert.ok(Math.abs(drivePrice(custom, s) - drivePrice(elk, s)) < 1e-9);
});

test("design file: a schema 2 file drops the flat drive price and ticks the drive on an off-speed pump", () => {
  const old = JSON.parse(JSON.stringify(threePumpStation()));
  old.schema = 2; old.settings.vfd_price = 4000;
  delete old.settings.vfd_base; delete old.settings.vfd_per_kW;
  const pumps = old.components.filter((c) => c.type === "pump");
  for (const c of pumps) c.vfd = false;
  pumps[0].speed = 0.9;
  const opened = loadDesign(old);
  assert.equal(opened.schema, SCHEMA);
  assert.equal(opened.settings.vfd_price, undefined);
  assert.equal(opened.settings.vfd_base, DEFAULT_SETTINGS.vfd_base);
  const p = opened.components.filter((c) => c.type === "pump");
  assert.equal(p[0].vfd, true);
  assert.equal(p[1].vfd, false);
});

test("sweeping a speed ratio puts a drive on the pump", () => {
  const d = threePumpStation({ K: 20 });
  const target = sweepTargets(d).find((t) => t.key.startsWith("all:pump:speed"));
  const copy = JSON.parse(JSON.stringify(d));
  target.set(copy, 0.9);
  assert.ok(copy.components.filter((c) => c.type === "pump").every((c) => c.vfd && c.speed === 0.9));
  assert.ok(!d.components.some((c) => c.vfd)); // the design itself is not touched
});

test("pump plot: the flow curve with the other pumps off sits below the one with them on", () => {
  const d = threePumpStation({ K: 20 });
  const r = analyze(d);
  const c = r.comps[byType(d, "pump")[0].id];
  assert.ok(c.curveAlone, "there is an alone curve when other pumps run");
  const i = c.curveAlone.Q.length - 1;
  const qEnd = c.curveAlone.Q[i];
  const j = c.curve.Q.findIndex((qq) => Math.abs(qq - qEnd) < 1e-9);
  assert.ok(j >= 0 && c.curveAlone.demand[i] < c.curve.demand[j]);
  const single = simpleLift();
  assert.equal(analyze(single).comps[byType(single, "pump")[0].id].curveAlone, null);
});

test("design file: round trip, and a schema 1 file still opens", () => {
  const d = threePumpStation();
  d.author = "A. Student"; d.notes = "first try";
  addLabel(d, 10, 20, "pump room");
  d.scenarios.push({ name: "s", share: 40, design: JSON.parse(JSON.stringify({ ...d, scenarios: [] })) });
  const back = loadDesign(JSON.parse(JSON.stringify(d)));
  assert.equal(back.schema, SCHEMA);
  assert.equal(back.author, "A. Student");
  assert.equal(back.labels[0].text, "pump room");
  assert.equal(back.scenarios[0].share, 40);
  assert.deepEqual(analyze(back).totals, analyze(d).totals);

  const old = JSON.parse(JSON.stringify(threePumpStation()));
  old.schema = 1; delete old.labels; delete old.author; delete old.notes;
  delete old.settings.vfd_base; delete old.settings.vfd_per_kW; delete old.settings.pipe_price;
  for (const c of old.components) delete c.vfd;
  const opened = loadDesign(old);
  assert.deepEqual(opened.labels, []);
  assert.equal(opened.settings.vfd_base, DEFAULT_SETTINGS.vfd_base);
  assert.equal(analyze(opened).status, "solved");
  assert.ok(pipeNamed(opened, "header"));
});

test("drive efficiency: a pump with a drive draws shaft power / eta, and energy is billed on that", () => {
  const d = threePumpStation({ K: 20 });
  const plain = analyze(d).totals;
  assert.equal(plain.drawn, plain.power); // no drives, no drive loss
  const pumps = byType(d, "pump");
  pumps[0].vfd = true; // a drive at rated speed: same flow, but it loses a little
  const r = analyze(d);
  const p0 = r.comps[pumps[0].id], p1 = r.comps[pumps[1].id];
  near(r.totals.power, plain.power, 1e-9, "the drive does not change the shaft power");
  near(p0.drawn, p0.power / d.settings.vfd_eta, 1e-9, "drawn by the pump with a drive");
  assert.equal(p1.drawn, p1.power);
  near(r.totals.kWhPerYear, (r.totals.drawn / 1000) * d.settings.hours_per_year, 1e-9, "energy is billed on power drawn");
  assert.ok(r.totals.costPerYear > plain.costPerYear);
  // and the energy balance still closes, with the drive loss as one more use
  const b = powerBudget(d, r);
  near(b.drive, p0.drawn - p0.power, 1e-9, "drive loss");
  near(b.items.reduce((s, i) => s + i.W, 0), b.drive + b.pumpLoss + b.major + b.minor + b.valves, 1e-6 * b.shaft, "items");
  // a drive efficiency that makes no sense is an error, but only when there is a drive
  d.settings.vfd_eta = 1.2;
  assert.equal(analyze(d).status, "error");
  pumps[0].vfd = false;
  assert.equal(analyze(d).status, "solved");
});
