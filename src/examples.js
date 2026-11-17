// examples.js -- the test systems from CLAUDE.md, built as designs exactly
// the way a student would draw them: components on a canvas, joined by pipes.
// Used by the tests and by the Examples menu of the app.

import { newDesign, addComponent, addPipe } from "./solver/design.js";

const fit = (kind, n = 1) => ({ kind, n });

// Tank at 15 m draining to a tank at 0 m through one cast-iron pipe.
export function gravityDrain() {
  const d = newDesign();
  d.name = "Gravity drain";
  const t1 = addComponent(d, "tank", 120, 120, { z: 15 });
  const t2 = addComponent(d, "tank", 560, 300, { z: 0 });
  addPipe(d, t1.id, "a", t2.id, "a", {
    L: 200, D: 0.10, material: "cast_iron",
    fittings: [fit("entrance_sharp"), fit("elbow_90_standard", 4), fit("exit")],
  });
  return d;
}

// Two commercial-steel branches between the same two junctions. The supply
// tank's head is a free parameter: tests adjust it until the total is 10 L/s.
export function parallelPipes(zSupply = 20) {
  const d = newDesign();
  d.name = "Parallel pipes";
  const t1 = addComponent(d, "tank", 100, 200, { z: zSupply });
  const j1 = addComponent(d, "junction", 260, 200);
  const j2 = addComponent(d, "junction", 520, 200);
  const t2 = addComponent(d, "tank", 680, 200, { z: 0 });
  addPipe(d, t1.id, "a", j1.id, "a", { L: 0, D: 0.1, name: "inlet" });
  addPipe(d, j1.id, "a", j2.id, "a", { L: 100, D: 0.05, name: "A", mid: { x: 390, y: 130 } });
  addPipe(d, j1.id, "a", j2.id, "a", { L: 40, D: 0.04, name: "B", mid: { x: 390, y: 270 } });
  addPipe(d, j2.id, "a", t2.id, "a", { L: 0, D: 0.1, name: "outlet" });
  return d;
}

// The same two branches, but the 10 L/s is set at the first junction
// instead of coming from a tank. The tank downstream takes the flow.
export function parallelPipesSetFlow(Q_Ls = 10) {
  const d = newDesign();
  d.name = "Parallel pipes (set flow)";
  const j1 = addComponent(d, "junction", 260, 200, { Qin_Ls: Q_Ls });
  const j2 = addComponent(d, "junction", 520, 200);
  const t2 = addComponent(d, "tank", 680, 200, { z: 0 });
  addPipe(d, j1.id, "a", j2.id, "a", { L: 100, D: 0.05, name: "A", mid: { x: 390, y: 130 } });
  addPipe(d, j1.id, "a", j2.id, "a", { L: 40, D: 0.04, name: "B", mid: { x: 390, y: 270 } });
  addPipe(d, j2.id, "a", t2.id, "a", { L: 0, D: 0.1, name: "outlet" });
  return d;
}

const LIFT_PUMP = { h0: 30, a: 9e4, eta: 0.70, n0: 1.5, n1: 4e3, price: 0 };
const suction = () => ({
  L: 5, D: 0.08, material: "commercial_steel", name: "suction",
  fittings: [fit("entrance_sharp"), fit("strainer")],
});
const discharge = () => ({
  L: 60, D: 0.08, material: "commercial_steel", name: "discharge",
  fittings: [fit("elbow_90_standard", 4), fit("check_valve_swing"), fit("exit")],
});
const link = { L: 0, D: 0.08 }; // a direct connection: no length, no loss

// Tank at 0 m pumped to a tank at 12 m.
//   arrangement: "single" | "parallel" | "series"
export function simpleLift({ arrangement = "single", speed = 1, patm_kPa = 83 } = {}) {
  const d = newDesign();
  d.name = `Simple lift (${arrangement})`;
  d.settings.patm_kPa = patm_kPa;
  const pump = (x, y) => addComponent(d, "pump", x, y, { z: 1.0, model: "custom", custom: { ...LIFT_PUMP }, speed });
  const t1 = addComponent(d, "tank", 100, 320, { z: 0 });
  const t2 = addComponent(d, "tank", 700, 120, { z: 12 });
  if (arrangement === "single") {
    const p = pump(320, 320);
    addPipe(d, t1.id, "a", p.id, "in", suction());
    addPipe(d, p.id, "out", t2.id, "a", discharge());
  } else if (arrangement === "series") {
    const p1 = pump(300, 320), p2 = pump(440, 320);
    addPipe(d, t1.id, "a", p1.id, "in", suction());
    addPipe(d, p1.id, "out", p2.id, "in", link);
    addPipe(d, p2.id, "out", t2.id, "a", discharge());
  } else {
    const j1 = addComponent(d, "junction", 240, 320, { z: 1.0 });
    const j2 = addComponent(d, "junction", 480, 320, { z: 1.0 });
    const p1 = pump(360, 260), p2 = pump(360, 380);
    addPipe(d, t1.id, "a", j1.id, "a", suction());
    for (const p of [p1, p2]) {
      addPipe(d, j1.id, "a", p.id, "in", link);
      addPipe(d, p.id, "out", j2.id, "a", link);
    }
    addPipe(d, j2.id, "a", t2.id, "a", discharge());
  }
  return d;
}

// The project's skeleton: Elk pumps in parallel, each followed by a valve on
// a 0.10 m line, feeding one header up to a tank at 25 m.
//   on: which of the three pumps run, e.g. [true, true, false]
export function threePumpStation({ K = 0.15, on = [true, true, true] } = {}) {
  const d = newDesign();
  d.name = "Three-pump station";
  const t1 = addComponent(d, "tank", 100, 300, { z: 0 });
  const j = addComponent(d, "junction", 600, 300, { z: 0 });
  const t2 = addComponent(d, "tank", 860, 120, { z: 25 });
  const direct = { L: 0, D: 0.10 };
  on.forEach((isOn, i) => {
    const y = 160 + 140 * i;
    const p = addComponent(d, "pump", 300, y, { z: 0, model: "CV-80", on: isOn });
    const v = addComponent(d, "valve", 450, y, { z: 0, K, D: 0.10 });
    addPipe(d, t1.id, "a", p.id, "in", direct);
    addPipe(d, p.id, "out", v.id, "a", direct);
    addPipe(d, v.id, "b", j.id, "a", direct);
  });
  addPipe(d, j.id, "a", t2.id, "a", {
    L: 250, D: 0.20, material: "commercial_steel", name: "header",
    fittings: [fit("elbow_90_standard", 6), fit("check_valve_swing"), fit("exit")],
  });
  return d;
}

// ---------------------------------------------------------------------------
// The four worked examples of course notes 11.3, "Pipe flow examples"
// (jeremy-koch.github.io/MCEN3021/modules/unit-7/pipe-examples.html).
//
// The notes take some loss coefficients and roughnesses from their own
// table (11.1b), which differ from the toolbox table in tables.js: a
// threaded elbow is K = 1.5, a flanged elbow 0.3, a threaded tee 0.9
// (line flow) or 2.0 (branch flow). Those go in each pipe's custom K
// (K_extra), and the roughness in its custom roughness, so the examples
// use exactly the numbers in the notes. Fittings whose K agrees with the
// table (sharp entrance 0.5, open gate valve 0.15, exit 1.0) are fittings.
//
// A free jet leaves with its velocity head. We draw it as a tank at the
// jet's elevation, entered through an "exit" (K = 1): the head equation
// is then the same as the notes' with alpha_2 = 1.
// ---------------------------------------------------------------------------

const custom = (eps_mm) => ({ material: "custom", eps_mm });

// Example 1: 0.4 L/s to a tap. The flow is set at the gauge (point 1), and
// the answer, p1 = 58.9 kPa in the notes, is the static pressure at the
// start of the first pipe (the pipe table's "p in").
export function notesExample1() {
  const d = newDesign();
  d.name = "Notes 11.3, example 1: inlet pressure for a set flow";
  const tube = { D: 0.02, ...custom(0.0025) }; // drawn copper tubing
  const j1 = addComponent(d, "junction", 120, 340, { z: 0, Qin_Ls: 0.4, name: "1 (gauge)" });
  const j2 = addComponent(d, "junction", 420, 340, { z: 0, name: "elbow A" });
  const j3 = addComponent(d, "junction", 420, 140, { z: 4, name: "elbow B" });
  const jet = addComponent(d, "tank", 660, 140, { z: 4, name: "2 (free jet)" });
  addPipe(d, j1.id, "a", j2.id, "a", { ...tube, L: 10, name: "L1", K_extra: 1.5 }); // threaded elbow
  addPipe(d, j2.id, "a", j3.id, "a", { ...tube, L: 4, name: "L2", K_extra: 1.5 }); // threaded elbow
  addPipe(d, j3.id, "a", jet.id, "a", {
    ...tube, L: 3, name: "L3", fittings: [fit("gate_valve_open"), fit("exit")],
  });
  return d;
}

// Example 2: a water tower draining through 68 m of steel pipe to a free
// jet 28 m below its free surface. Notes: Q = 8.7 L/s.
export function notesExample2() {
  const d = newDesign();
  d.name = "Notes 11.3, example 2: water tower";
  const pipe = { D: 0.05, ...custom(0.025) }; // structural steel
  const tower = addComponent(d, "tank", 120, 100, { z: 28, name: "Tower" });
  const j1 = addComponent(d, "junction", 120, 300, { z: 3, name: "elbow A" });
  const j2 = addComponent(d, "junction", 420, 300, { z: 3, name: "elbow B" });
  const j3 = addComponent(d, "junction", 420, 360, { z: 0, name: "elbow C" });
  const jet = addComponent(d, "tank", 660, 360, { z: 0, name: "2 (free jet)" });
  addPipe(d, tower.id, "a", j1.id, "a", { ...pipe, L: 20, name: "L1", fittings: [fit("entrance_sharp")], K_extra: 0.3 });
  addPipe(d, j1.id, "a", j2.id, "a", { ...pipe, L: 30, name: "L2", K_extra: 0.3 });
  addPipe(d, j2.id, "a", j3.id, "a", { ...pipe, L: 3, name: "L3", K_extra: 0.3 });
  addPipe(d, j3.id, "a", jet.id, "a", { ...pipe, L: 15, name: "L4", fittings: [fit("exit")] });
  return d;
}

// Example 3: 10 L/s splits between two cast-iron paths. The tee losses are
// charged to each path, as in the notes. The flow is set at point 1; the
// tank after point 2 only fixes the head. p1 - p2 is the difference of the
// two junction pressures. Notes: QA = 6.2 L/s, QB = 3.8 L/s,
// p1 - p2 = 64 kPa.
export function notesExample3() {
  const d = newDesign();
  d.name = "Notes 11.3, example 3: parallel paths";
  const pipe = { D: 0.05, ...custom(0.15) };
  const j1 = addComponent(d, "junction", 220, 160, { z: 0, Qin_Ls: 10, name: "1" });
  const j2 = addComponent(d, "junction", 560, 160, { z: 0, name: "2" });
  // 10 m above the line, only so that every pressure on the diagram is
  // above atmospheric; it does not change the split or p1 - p2.
  const t = addComponent(d, "tank", 760, 160, { z: 10, name: "Downstream" });
  addPipe(d, j1.id, "a", j2.id, "a", {
    ...pipe, L: 20, name: "A", fittings: [fit("gate_valve_open")], K_extra: 2 * 0.9, // two tees, line flow
  });
  addPipe(d, j1.id, "a", j2.id, "a", {
    ...pipe, L: 50, name: "B", K_extra: 2 * 2.0 + 2 * 1.5, // two tees, branch flow; two threaded elbows
    mid: { x: 390, y: 320 },
  });
  addPipe(d, j2.id, "a", t.id, "a", { L: 0, D: 0.05, name: "outlet" });
  return d;
}

// Example 4: the generic pump of notes 11.2, H = 30 m [1 - (Q / 25 L/s)^2],
// lifting 12 m through 150 m of cast iron. The notes give no efficiency
// or NPSH curve: the pump is ideal (100% efficient), and the NPSH numbers
// are the custom-pump defaults. Notes: Q = 15.2 L/s, H_pump = 18.9 m.
export function notesExample4() {
  const d = newDesign();
  d.name = "Notes 11.3, example 4: a pump curve";
  const pipe = { D: 0.10, ...custom(0.15) };
  const t1 = addComponent(d, "tank", 100, 340, { z: 0, name: "Lower" });
  const p = addComponent(d, "pump", 300, 340, {
    z: 0, model: "custom", ideal: true,
    custom: { h0: 30, a: 30 / 0.025 ** 2, eta: 1, n0: 1.5, n1: 4e3, price: 0 },
  });
  const t2 = addComponent(d, "tank", 660, 120, { z: 12, name: "Upper" });
  addPipe(d, t1.id, "a", p.id, "in", { ...pipe, L: 0, name: "entrance", fittings: [fit("entrance_sharp")] });
  addPipe(d, p.id, "out", t2.id, "a", {
    ...pipe, L: 150, name: "L1 + L2 + L3",
    fittings: [fit("gate_valve_open"), fit("exit")], K_extra: 2 * 0.3, // two flanged elbows
    mid: { x: 300, y: 120 },
  });
  return d;
}

export const byType = (d, type) => d.components.filter((c) => c.type === type);
export const pipeNamed = (d, name) => d.pipes.find((p) => p.name === name);

// What the app's Examples menu offers. The three-pump station is left out
// on purpose: it is the skeleton of the term project, which students build
// themselves. (It still opens with  index.html?example=station .)
export const EXAMPLES = [
  { key: "drain", label: "Gravity drain", make: () => gravityDrain() },
  { key: "parallel", label: "Parallel pipes", make: () => parallelPipes(15.7) },
  { key: "parallel-set", label: "Parallel pipes, 10 L/s set at the inlet", make: () => parallelPipesSetFlow(10) },
  { key: "lift", label: "Simple lift (one pump)", make: () => simpleLift() },
  { key: "lift-parallel", label: "Simple lift, two pumps in parallel", make: () => simpleLift({ arrangement: "parallel" }) },
  { key: "lift-series", label: "Simple lift, two pumps in series", make: () => simpleLift({ arrangement: "series" }) },
  { key: "notes1", label: "Notes 11.3, ex. 1: inlet pressure", make: () => notesExample1() },
  { key: "notes2", label: "Notes 11.3, ex. 2: water tower", make: () => notesExample2() },
  { key: "notes3", label: "Notes 11.3, ex. 3: parallel paths", make: () => notesExample3() },
  { key: "notes4", label: "Notes 11.3, ex. 4: a pump curve", make: () => notesExample4() },
];
export const HIDDEN_EXAMPLES = { station: () => threePumpStation({ K: 20 }) };
