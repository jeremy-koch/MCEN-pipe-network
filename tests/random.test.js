// random.test.js -- the solver on a few hundred random networks.
//
// There is no referee for these, so we check what must be true of any
// correct answer: the solver converges, flow is conserved at every
// junction, and every pipe's loss equals the head difference across it.

import test from "node:test";
import assert from "node:assert/strict";

import { analyze } from "../src/solver/analyze.js";
import { newDesign, addComponent, addPipe } from "../src/solver/design.js";
import { PUMP_CATALOG, ROUGHNESS } from "../src/solver/tables.js";

// A small seeded random number generator, so failures can be reproduced.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomDesign(seed) {
  const r = rng(seed);
  const pick = (list) => list[Math.floor(r() * list.length)];
  const d = newDesign();
  const pipeProps = () => ({
    L: r() < 0.15 ? 0 : 1 + 300 * r(),
    D: pick([0.025, 0.05, 0.08, 0.1, 0.15, 0.2, 0.3]),
    material: pick(Object.keys(ROUGHNESS)),
    K_extra: r() < 0.5 ? 0 : 10 * r(),
  });
  const nodes = [];
  const nTanks = 1 + Math.floor(3 * r());
  for (let i = 0; i < nTanks; i++) nodes.push(addComponent(d, "tank", 0, 0, { z: 40 * r(), p_kPa: r() < 0.8 ? 0 : 100 * r() }));
  const nJunctions = Math.floor(7 * r());
  for (let i = 0; i < nJunctions; i++) nodes.push(addComponent(d, "junction", 0, 0, { z: 20 * r() }));

  // Join node a to node b: by a plain pipe, or through a pump or a valve.
  const join = (a, b) => {
    const kind = r();
    if (kind < 0.6) {
      addPipe(d, a.id, "a", b.id, "a", pipeProps());
    } else if (kind < 0.8) {
      const p = addComponent(d, "pump", 0, 0, {
        model: pick(Object.keys(PUMP_CATALOG)), speed: 0.6 + 0.6 * r(), on: r() < 0.85, z: 5 * r(),
      });
      addPipe(d, a.id, "a", p.id, "in", pipeProps());
      addPipe(d, p.id, "out", b.id, "a", pipeProps());
    } else {
      const v = addComponent(d, "valve", 0, 0, { K: r() < 0.2 ? 0 : 50 * r(), D: pick([0.05, 0.1, 0.2]) });
      addPipe(d, a.id, "a", v.id, "a", pipeProps());
      addPipe(d, v.id, "b", b.id, "a", pipeProps());
    }
  };
  // A spanning tree keeps everything connected to a tank; extras make loops.
  for (let i = 1; i < nodes.length; i++) join(nodes[Math.floor(r() * i)], nodes[i]);
  const extras = Math.floor(4 * r());
  for (let i = 0; i < extras && nodes.length > 1; i++) {
    const a = pick(nodes), b = pick(nodes);
    if (a !== b) join(a, b);
  }
  return d;
}

test("300 random networks: converged, mass conserved, head relation satisfied", () => {
  let solved = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const d = randomDesign(seed);
    const r = analyze(d, { curves: false });
    if (r.status === "empty") continue; // a single tank and nothing else
    // The generator sometimes joins two tanks with a lossless pipe. That is
    // a modeling error with its own message, not a solver failure.
    if (r.errors.length && r.errors.every((e) => /would be infinite/.test(e.text))) continue;
    assert.equal(r.status, "solved", `seed ${seed}: ${r.errors.map((e) => e.text).join(" | ")}`);
    solved++;

    // net flow into every junction and every pump/valve port is zero
    const net = new Map();
    const bump = (key, q) => net.set(key, (net.get(key) || 0) + q);
    const key = (end) => {
      const c = d.components.find((x) => x.id === end.comp);
      return c.type === "tank" ? null : c.type === "junction" ? c.id : `${c.id}:${end.port}`;
    };
    for (const p of d.pipes) {
      const Q = r.pipes[p.id].Q;
      if (key(p.from)) bump(key(p.from), -Q);
      if (key(p.to)) bump(key(p.to), Q);
    }
    for (const c of d.components) {
      if (c.type !== "pump" && c.type !== "valve") continue;
      const [a, b] = c.type === "pump" ? ["in", "out"] : ["a", "b"];
      bump(`${c.id}:${a}`, -r.comps[c.id].Q);
      bump(`${c.id}:${b}`, r.comps[c.id].Q);
    }
    for (const [k, q] of net) assert.ok(Math.abs(q) < 5e-6, `seed ${seed}: node ${k} is out of balance by ${q} m3/s`);

    for (const p of d.pipes) {
      const x = r.pipes[p.id];
      if (x.Q === 0) continue;
      const loss = Math.sign(x.Q) * (x.hMajor + x.hMinor);
      assert.ok(Math.abs(x.Hfrom - x.Hto - loss) < 1e-4 * (1 + Math.abs(loss)),
        `seed ${seed}: pipe ${p.name} loses ${loss} m but the heads differ by ${x.Hfrom - x.Hto} m`);
    }
    // a pump never runs backward, and an off pump carries nothing
    for (const c of d.components.filter((x) => x.type === "pump")) {
      assert.ok(r.comps[c.id].Q >= 0, `seed ${seed}: reverse flow through ${c.name}`);
      if (!c.on) assert.equal(r.comps[c.id].Q, 0);
    }
  }
  assert.ok(solved > 250);
});

test("pump flow curves exist and are finite on random networks", () => {
  for (let seed = 1; seed <= 150; seed++) {
    const d = randomDesign(seed);
    const r = analyze(d);
    if (r.status !== "solved") continue;
    for (const c of d.components.filter((x) => x.type === "pump")) {
      const curve = r.comps[c.id].curve;
      if (!curve) continue;
      // The sweep runs to the end of the pump curve, unless the demanded
      // head climbs out of the pump's reach first.
      const last = curve.Q.length - 1;
      const reachedEnd = curve.Q[last] > 0.95 * curve.Qmax;
      const outOfReach = curve.demand[last] > 3 * r.comps[c.id].shutoff;
      assert.ok(reachedEnd || outOfReach, `seed ${seed}: the flow curve of ${c.name} stops at ${curve.Q[last]} of ${curve.Qmax} m3/s`);
      assert.ok(curve.demand.every(Number.isFinite));
      // more flow through the pump never takes less head
      for (let i = 1; i <= last; i++) assert.ok(curve.demand[i] >= curve.demand[i - 1] - 1e-6, `seed ${seed}: flow curve of ${c.name} is not increasing`);
    }
  }
});
