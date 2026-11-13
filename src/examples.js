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
];
export const HIDDEN_EXAMPLES = { station: () => threePumpStation({ K: 20 }) };
