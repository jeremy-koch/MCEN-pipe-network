// hydraulics.js -- water properties, friction factor, and the head relation
// of each kind of link (pipe, valve, pump).
//
// Everything is SI: m, s, kg, Pa. The correlations are the ones in
// reference/pipeflow.py, so the two give the same numbers.

import { G } from "./tables.js";

// ---------------------------------------------------------------------------
// Water
// ---------------------------------------------------------------------------

// Liquid water from temperature in Celsius (valid 0-100 C).
// Returns density rho [kg/m^3], viscosity mu [Pa s], vapor pressure pv [Pa abs].
export function water(T) {
  if (!(T >= 0 && T <= 100)) {
    throw new RangeError("water(): the fits are valid for 0-100 °C");
  }
  const rho = 999.84 + 0.0673 * T - 0.00894 * T ** 2 + 8.78e-5 * T ** 3 - 6.62e-7 * T ** 4;
  const mu = 2.414e-5 * 10 ** (247.8 / (T + 133.15));
  const pv = 133.322 * 10 ** (8.07131 - 1730.63 / (233.426 + T)); // Antoine
  return { rho, mu, pv, T };
}

// ---------------------------------------------------------------------------
// Friction factor
// ---------------------------------------------------------------------------

export const RE_LAMINAR = 2300; // below this, f = 64/Re
export const RE_TURBULENT = 4000; // 2300-4000 is reported as "transitional"

// Colebrook: 1/sqrt(f) = -2 log10( (eps/D)/3.7 + 2.51/(Re sqrt(f)) ).
// We solve for x = 1/sqrt(f) with Newton's method; it converges in a few steps.
export function colebrook(Re, relRough) {
  let x = 7; // f ~ 0.02
  for (let i = 0; i < 60; i++) {
    const arg = relRough / 3.7 + (2.51 * x) / Re;
    const F = x + 2 * Math.log10(arg);
    const dF = 1 + (2 / Math.LN10) * (2.51 / Re) / arg;
    const step = F / dF;
    x -= step;
    if (Math.abs(step) < 1e-13 * x) break;
  }
  return 1 / (x * x);
}

// Darcy friction factor, exactly as the Python toolbox: laminar below
// Re = 2300, Colebrook above.
export function frictionFactor(Re, relRough = 0) {
  if (!(Re > 0)) throw new RangeError("Reynolds number must be positive.");
  if (Re < RE_LAMINAR) return 64 / Re;
  return colebrook(Re, relRough);
}

// The friction factor the network solver uses. It is frictionFactor() with
// one change: f jumps (from about 0.028 to about 0.05) at Re = 2300, and a
// jump in the loss can leave a network with no solution at all. So over the
// narrow band 2300 < Re < 2400 we ramp linearly from the laminar value to
// the Colebrook value. Outside that band it is identical to the toolbox.
const RE_RAMP_END = 2400;
export function frictionFactorSolver(Re, relRough = 0) {
  if (Re < RE_LAMINAR || Re >= RE_RAMP_END) return frictionFactor(Re, relRough);
  const fLam = 64 / RE_LAMINAR;
  const fTurb = colebrook(RE_RAMP_END, relRough);
  return fLam + ((fTurb - fLam) * (Re - RE_LAMINAR)) / (RE_RAMP_END - RE_LAMINAR);
}

// ---------------------------------------------------------------------------
// Pipes and valves
// ---------------------------------------------------------------------------

export function pipeArea(D) {
  return (Math.PI * D * D) / 4;
}

// Everything about one pipe at flow Q [m^3/s] (the sign of Q is ignored).
// pipe = { L, D, eps, K }  with K the sum of all its loss coefficients.
// The head loss is  h_L = (f L/D + K) V^2 / 2g.
export function pipeState(pipe, Q, fluid) {
  const q = Math.abs(Q);
  const V = q / pipeArea(pipe.D);
  const Re = (fluid.rho * V * pipe.D) / fluid.mu;
  const hv = (V * V) / (2 * G); // velocity head
  let f = null;
  let hMajor = 0;
  if (Re > 0 && pipe.L > 0) {
    f = frictionFactorSolver(Re, pipe.eps / pipe.D);
    hMajor = ((f * pipe.L) / pipe.D) * hv;
  } else if (Re > 0) {
    f = frictionFactorSolver(Re, pipe.eps / pipe.D);
  }
  const hMinor = pipe.K * hv;
  let regime = "none";
  if (Re > 0) regime = Re < RE_LAMINAR ? "laminar" : Re < RE_TURBULENT ? "transitional" : "turbulent";
  return { V, Re, f, hMajor, hMinor, hLoss: hMajor + hMinor, regime };
}

// ---------------------------------------------------------------------------
// Pumps
// ---------------------------------------------------------------------------

// Head a running pump adds at flow Q >= 0, at speed ratio r.
// Rated curve H = h0 - a Q^2. The affinity laws, H(Q) -> r^2 H(Q/r), turn
// it into r^2 h0 - a Q^2.
//
// Past the end of the curve (H = 0) the parabola simply continues, so the
// head goes negative: a pump pushed beyond its curve by the rest of the
// network resists the flow. The Python toolbox instead holds the head at
// zero there, which would let a pump between two tanks pass an unlimited
// flow. The two agree everywhere on the curve itself.
export function pumpHead(pump, Q) {
  const r = pump.speed;
  return r * r * pump.h0 - pump.a * Q * Q;
}

// Flow at which the head curve reaches zero ("the end of the curve").
export function pumpRunout(pump) {
  return pump.speed * Math.sqrt(pump.h0 / pump.a);
}

// NPSH required at flow Q; scales with speed the same way as the head.
export function pumpNpshr(pump, Q) {
  const r = pump.speed;
  return r * r * pump.n0 + pump.n1 * Q * Q;
}

// Flow at the pump's best-efficiency point (BEP). The catalog gives no BEP,
// so we take the flow where the head has fallen to 2/3 of the shutoff head,
//   Q_bep = sqrt(h0 / (3 a)),
// the same rule catalog_report() in the Python toolbox uses. By the
// affinity laws it scales with the speed ratio.
export function pumpBepFlow(pump) {
  return pump.speed * Math.sqrt(pump.h0 / (3 * pump.a));
}

// Efficiency at flow Q. pump.eta is the peak efficiency, reached at Q_bep.
//   pump.ideal true:  eta = 1 (100%) at every flow: a lossless pump.
//   otherwise:        eta = eta_max [ 2 (Q/Q_bep) - (Q/Q_bep)^2 ],
// a parabola that is zero at Q = 0 (the pump stirs the water but moves
// none), peaks at Q_bep, and falls off again beyond it. It is the simplest
// curve with the right shape, not a fit to any real pump.
export function pumpEfficiency(pump, Q) {
  if (pump.ideal) return 1;
  const x = Q / pumpBepFlow(pump);
  return Math.max(0, pump.eta * (2 * x - x * x));
}

// Shaft power [W] of a running pump at flow Q >= 0:  rho g Q H / eta.
// With the efficiency curve this is 0/0 at Q = 0, so we cancel the Q by
// hand:  Q / eta = Q_bep / (eta_max (2 - Q/Q_bep)).  That gives a finite
// power at shutoff, as a real pump has. Past the end of the head curve
// (H < 0) the formula means nothing, and we report zero.
export function pumpShaftPower(pump, Q, fluid) {
  const H = pumpHead(pump, Q);
  if (!(H > 0)) return 0;
  if (pump.ideal) return fluid.rho * G * Q * H; // eta = 1
  const Qb = pumpBepFlow(pump);
  return (fluid.rho * G * H * Qb) / (pump.eta * (2 - Q / Qb));
}

// ---------------------------------------------------------------------------
// The head relation of a link, as the network solver wants it
// ---------------------------------------------------------------------------

// A closed link (a pump that is off, or a running pump whose check valve is
// shut) is modeled as a very large resistance, R_CLOSED metres of head per
// m^3/s. 100 m of head pushes 1e-6 m^3/s (0.001 L/s) through it, which we
// then report as zero.
export const R_CLOSED = 1e8;

// headDrop(link, Q, fluid) = H_from - H_to when flow Q goes from -> to.
// It is an increasing function of Q for every kind of link, which is what
// makes the network problem well behaved.
//
// For a pump, link.closed says whether it is passing flow. The network
// solver sets it: a pump that is off is always closed, and a running pump
// is closed while the head across it is above its shutoff head.
export function headDrop(link, Q, fluid) {
  switch (link.kind) {
    case "pipe":
      return Math.sign(Q) * pipeState(link, Q, fluid).hLoss;
    case "valve": {
      const V = Q / pipeArea(link.D);
      return (link.K * V * Math.abs(V)) / (2 * G);
    }
    case "pump":
      if (link.closed) return R_CLOSED * Q;
      // Open: the head RISES by the pump head, so the drop is negative.
      // For Q < 0 the curve is continued smoothly (h0 + a Q^2). The solver
      // never accepts that branch: an open pump found with Q < 0 is closed
      // and the network is solved again.
      if (Q < 0) return -(link.speed * link.speed * link.h0 + link.a * Q * Q);
      return -pumpHead(link, Q);
    default:
      throw new Error(`unknown link kind "${link.kind}"`);
  }
}
