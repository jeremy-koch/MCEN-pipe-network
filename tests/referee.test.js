// referee.test.js -- the JavaScript solver against the Python toolbox.
//
// The expected numbers are in reference/referee.json, written by
// reference/make_referee.py from reference/pipeflow.py. Every comparison
// must agree to 0.5% or better (most agree far more closely than that).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { analyze } from "../src/solver/analyze.js";
import { water, frictionFactor, pumpHead, pumpBepFlow, pumpEfficiency, pumpShaftPower } from "../src/solver/hydraulics.js";
import { gravityDrain, parallelPipes, parallelPipesSetFlow, simpleLift, threePumpStation, byType, pipeNamed } from "../src/examples.js";

const ref = JSON.parse(readFileSync(new URL("../reference/referee.json", import.meta.url)));

function close(actual, expected, what, tol = 0.005) {
  const err = Math.abs(actual - expected) / Math.abs(expected);
  assert.ok(err <= tol, `${what}: got ${actual}, referee ${expected} (off by ${(100 * err).toFixed(3)}%)`);
}

// The Python toolbox has one constant efficiency per pump. The app's
// "ideal efficiency" setting is 100%, so in that mode its shaft power is
// the hydraulic power rho g Q H, and the referee's power is that over eta.
function ideal(design) {
  for (const p of byType(design, "pump")) p.ideal = true;
  return design;
}

function solved(design) {
  const r = analyze(design);
  assert.equal(r.status, "solved", r.errors.map((e) => e.text).join(" | "));
  return r;
}

// Find x in [lo, hi] where fn(x) = 0 (bisection; fn must change sign).
function bisect(fn, lo, hi) {
  let flo = fn(lo);
  for (let i = 0; i < 60; i++) {
    const mid = 0.5 * (lo + hi);
    const fm = fn(mid);
    if ((fm > 0) === (flo > 0)) { lo = mid; flo = fm; } else hi = mid;
  }
  return 0.5 * (lo + hi);
}

test("water properties match the toolbox fits", () => {
  for (const w of ref.water) {
    const mine = water(w.T);
    close(mine.rho, w.rho, `rho at ${w.T} C`, 1e-9);
    close(mine.mu, w.mu, `mu at ${w.T} C`, 1e-9);
    close(mine.pv, w.pv, `pv at ${w.T} C`, 1e-9);
  }
});

test("friction factor matches the toolbox (laminar and Colebrook)", () => {
  for (const c of ref.friction) {
    close(frictionFactor(c.Re, c.rr), c.f, `f at Re=${c.Re}, eps/D=${c.rr}`, 1e-7);
  }
});

test("gravity drain: Q = 17.89 L/s", () => {
  const d = gravityDrain();
  const r = solved(d);
  close(r.pipes[d.pipes[0].id].Q, ref.gravity_drain.Q, "Q");
});

test("parallel pipes: 10 L/s splits 5.286 / 4.714 L/s with 15.70 m of loss", () => {
  // Choose the supply tank's head so that the total is the referee's 10 L/s.
  const total = (z) => {
    const d = parallelPipes(z);
    const r = solved(d);
    return r.pipes[pipeNamed(d, "A").id].Q + r.pipes[pipeNamed(d, "B").id].Q;
  };
  const z = bisect((zz) => total(zz) - ref.parallel_pipes.Q_total, 1, 60);
  const d = parallelPipes(z);
  const r = solved(d);
  const A = r.pipes[pipeNamed(d, "A").id], B = r.pipes[pipeNamed(d, "B").id];
  close(A.Q, ref.parallel_pipes.QA, "branch A flow");
  close(B.Q, ref.parallel_pipes.QB, "branch B flow");
  close(A.hMajor + A.hMinor, ref.parallel_pipes.h, "head loss in A");
  close(B.hMajor + B.hMinor, ref.parallel_pipes.h, "head loss in B");
  close(z, ref.parallel_pipes.h, "supply head equals the loss");
});

test("parallel pipes with the 10 L/s set at a junction: same split", () => {
  const d = parallelPipesSetFlow(ref.parallel_pipes.Q_total * 1000);
  const r = solved(d);
  const A = r.pipes[pipeNamed(d, "A").id], B = r.pipes[pipeNamed(d, "B").id];
  close(A.Q, ref.parallel_pipes.QA, "branch A flow");
  close(B.Q, ref.parallel_pipes.QB, "branch B flow");
  close(A.hMajor + A.hMinor, ref.parallel_pipes.h, "head loss in A");
  const j1 = d.components.find((c) => c.Qin_Ls);
  close(r.comps[j1.id].H, ref.parallel_pipes.h, "head at the junction where the flow is set");
});

test("simple lift, one pump: flow, head, power, NPSH", () => {
  const want = ref.simple_lift.one_pump;
  const d = ideal(simpleLift());
  const r = solved(d);
  const pump = r.comps[byType(d, "pump")[0].id];
  close(pump.Q, want.Q, "Q");
  close(pump.head, want.head, "pump head");
  close(pump.power / 0.70, want.power, "shaft power (ideal power / eta)");
  close(pump.npsha, want.npsha_83, "NPSH available at 83 kPa");
  close(pump.npshr, want.npshr, "NPSH required");

  const d2 = simpleLift({ patm_kPa: 101.325 });
  const pump2 = solved(d2).comps[byType(d2, "pump")[0].id];
  close(pump2.npsha, want.npsha_101, "NPSH available at 101.325 kPa");
});

test("simple lift: two pumps in parallel, in series, and one at 80% speed", () => {
  const par = simpleLift({ arrangement: "parallel" });
  const rp = solved(par);
  close(rp.pipes[pipeNamed(par, "discharge").id].Q, ref.simple_lift.two_parallel.Q, "parallel Q");
  const [a, b] = byType(par, "pump").map((p) => rp.comps[p.id].Q);
  close(a, b, "identical parallel pumps share the flow", 1e-6);

  const ser = simpleLift({ arrangement: "series" });
  close(solved(ser).pipes[pipeNamed(ser, "discharge").id].Q, ref.simple_lift.two_series.Q, "series Q");

  const slow = simpleLift({ speed: 0.8 });
  close(solved(slow).comps[byType(slow, "pump")[0].id].Q, ref.simple_lift.speed_80.Q, "80% speed Q");
});

test("three-pump station: flow and true shaft power", () => {
  for (const want of ref.station.cases) {
    const on = [true, true, true].map((_, i) => i < want.n);
    const d = ideal(threePumpStation({ K: want.K, on }));
    const r = solved(d);
    const label = `${want.n} pumps, K = ${want.K}`;
    close(r.pipes[pipeNamed(d, "header").id].Q, want.Q, `${label}: total Q`);
    close(r.totals.power / 0.74, want.power_true, `${label}: shaft power of all pumps (ideal power / eta)`);
    const pumps = byType(d, "pump").map((p) => r.comps[p.id]);
    for (const p of pumps.filter((p) => p.on)) {
      close(p.Q, want.Q_each, `${label}: flow per pump`);
      close(p.head, want.pump_head, `${label}: pump head`);
    }
    for (const p of pumps.filter((p) => !p.on)) assert.equal(p.Q, 0, `${label}: an off pump passes no flow`);
  }
});

test("three-pump station: valve K for 60 L/s is 23.3", () => {
  const total = (K) => {
    const d = threePumpStation({ K });
    return solved(d).pipes[pipeNamed(d, "header").id].Q;
  };
  const K = bisect((k) => total(k) - 0.060, 0.15, 200);
  close(K, ref.station.K_for_60_Ls, "valve K");
});

test("efficiency curve: peak at the best-efficiency flow, finite power at shutoff", () => {
  const pump = { h0: 52, a: 3.5e4, eta: 0.74, speed: 1, ideal: false }; // the Elk
  const Qb = pumpBepFlow(pump);
  close(Qb, Math.sqrt(52 / (3 * 3.5e4)), "Q_bep = sqrt(h0 / 3a)");
  close(pumpHead(pump, Qb), (2 / 3) * 52, "head at BEP is 2/3 of shutoff");
  close(pumpEfficiency(pump, Qb), 0.74, "eta at BEP is the catalog value");
  assert.equal(pumpEfficiency(pump, 0), 0);
  for (const x of [0.2, 0.5, 0.8, 1.2, 1.5]) {
    assert.ok(pumpEfficiency(pump, x * Qb) < 0.74, `eta is below its peak at ${x} Q_bep`);
    // the power formula with Q cancelled agrees with rho g Q H / eta
    const direct = (ref.fluid.rho * 9.81 * x * Qb * pumpHead(pump, x * Qb)) / pumpEfficiency(pump, x * Qb);
    close(pumpShaftPower(pump, x * Qb, ref.fluid), direct, `shaft power at ${x} Q_bep`, 1e-12);
  }
  // An ideal pump is 100% efficient, so at the BEP the real one takes 1/eta_max as much.
  assert.equal(pumpEfficiency({ ...pump, ideal: true }, Qb), 1);
  close(pumpShaftPower(pump, Qb, ref.fluid), pumpShaftPower({ ...pump, ideal: true }, Qb, ref.fluid) / 0.74, "power at BEP", 1e-12);
  // At shutoff the pump still takes power: rho g h0 Q_bep / (2 eta_max).
  close(pumpShaftPower(pump, 0, ref.fluid), (ref.fluid.rho * 9.81 * 52 * Qb) / (2 * 0.74), "shutoff power", 1e-12);
  // The affinity laws: at 80% speed the BEP moves to 80% of the flow.
  close(pumpBepFlow({ ...pump, speed: 0.8 }), 0.8 * Qb, "Q_bep at 80% speed", 1e-12);
  close(pumpEfficiency({ ...pump, speed: 0.8 }, 0.8 * Qb), 0.74, "eta at the new BEP", 1e-12);
});

test("efficiency curve changes the power, never the flow", () => {
  const a = threePumpStation({ K: 20 }), b = ideal(threePumpStation({ K: 20 }));
  const ra = solved(a), rb = solved(b);
  close(ra.pipes[pipeNamed(a, "header").id].Q, rb.pipes[pipeNamed(b, "header").id].Q, "total Q", 1e-12);
  const pa = ra.comps[byType(a, "pump")[0].id], pb = rb.comps[byType(b, "pump")[0].id];
  assert.equal(pb.eta, 1);
  assert.ok(pa.eta < 0.74 && pa.eta > 0.6, `throttled Elk runs near, not at, its peak (eta = ${pa.eta})`);
  close(pa.power, pb.power / pa.eta, "power scales with 1/eta", 1e-9);
  assert.ok(ra.totals.power > rb.totals.power);
});

test("the pump plot's two curves cross at the operating point", () => {
  // The flow curve seen by one pump of the station, interpolated at that
  // pump's flow, must equal the pump's own head there.
  const d = threePumpStation({ K: 20 });
  const r = solved(d);
  for (const p of byType(d, "pump")) {
    const pump = r.comps[p.id];
    const c = pump.curve;
    assert.ok(c, "a flow curve exists");
    const i = c.Q.findIndex((qq) => qq >= pump.Q);
    const t = (pump.Q - c.Q[i - 1]) / (c.Q[i] - c.Q[i - 1]);
    const demand = c.demand[i - 1] + t * (c.demand[i] - c.demand[i - 1]);
    close(demand, pump.head, "demanded head at the operating point", 0.002);
    const npsha = c.npsha[i - 1] + t * (c.npsha[i] - c.npsha[i - 1]);
    close(npsha, pump.npsha, "NPSH available at the operating point", 0.002);
  }
});
