// network.js -- the general steady-flow network solver.
//
// The network is a set of NODES joined by LINKS.
//
//   node = { id, fixedHead }     fixedHead is a number for a tank (its head
//                                is known) and null for every other node
//   node.demand (optional)       flow withdrawn at the node [m^3/s]
//   link = { id, from, to, kind, ... }   kind is "pipe", "valve" or "pump";
//                                see headDrop() in hydraulics.js
//
// Unknowns: the head H at every free node, and the flow Q in every link
// (positive from -> to). Equations:
//
//   at each free node:   flow in - flow out = demand
//   for each link:       H_from - H_to = headDrop(link, Q)
//
// We solve them with Newton's method, organized the way EPANET does it
// (Todini's "global gradient algorithm"): linearize every link about the
// current flow, eliminate the flows, and what is left is a small linear
// system for the node heads. Then the flows follow link by link.
//
// Pumps have a check valve, which is a switch rather than a smooth curve.
// So each pump is either open (it follows its curve) or closed (it passes
// nothing). We guess, solve, check every pump against its guess, flip the
// ones that are wrong, and solve again until nothing flips.
//
// "Head" here is the total head  p/(rho g) + alpha V^2/2g + z.  Losses take
// away total head, so that is the quantity that is continuous at a node.

import { headDrop, R_CLOSED } from "./hydraulics.js";

// Slope of headDrop is never allowed below this [m per m^3/s]. A turbulent
// loss ~ Q^2 has zero slope at Q = 0, and a zero-length pipe has no loss at
// all; without a floor the linear system would blow up.
const MIN_SLOPE = 1e-4;

// A link is "satisfied" when its head relation is off by less than
// TOL_HEAD, or when the flow change that would fix it is below TOL_FLOW.
// (The second test matters for stiff links, where a rounding error in Q of
// 1e-11 m^3/s already shows up as a visible error in head.)
const TOL_HEAD = 1e-6; // m
const TOL_FLOW = 1e-9; // m^3/s; also the tolerance on each node's mass balance

// An open pump is only called "running backward" below -Q_BACK. Closed links
// leak up to about 1e-6 m^3/s, and a leak that small drawn backward through
// an open pump (two pumps in series, one of them closed) is not a reason to
// close it.
const Q_BACK = 2e-6; // m^3/s

// d(headDrop)/dQ by a centered difference.
function slope(link, Q, fluid) {
  if (link.kind === "pump" && link.closed) return R_CLOSED;
  const dq = 1e-6 * Math.max(Math.abs(Q), 1e-4);
  const d = (headDrop(link, Q + dq, fluid) - headDrop(link, Q - dq, fluid)) / (2 * dq);
  return Math.max(d, MIN_SLOPE);
}

// A reasonable starting flow for each link.
function initialFlow(link) {
  if (link.kind === "pump") {
    return link.closed ? 0 : 0.5 * link.speed * Math.sqrt(link.h0 / link.a);
  }
  return 0.25 * Math.PI * link.D * link.D * 0.5; // 0.5 m/s
}

// Solve A x = b for a small dense matrix (Gaussian elimination with partial
// pivoting). A and b are overwritten. Returns null if A is singular.
export function solveLinear(A, b) {
  const n = b.length;
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    if (!(Math.abs(A[piv][c]) > 1e-300)) return null;
    [A[c], A[piv]] = [A[piv], A[c]];
    [b[c], b[piv]] = [b[piv], b[c]];
    for (let r = c + 1; r < n; r++) {
      const m = A[r][c] / A[c][c];
      if (m === 0) continue;
      for (let k = c; k < n; k++) A[r][k] -= m * A[c][k];
      b[r] -= m * b[c];
    }
  }
  const x = new Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r];
    for (let k = r + 1; k < n; k++) s -= A[r][k] * x[k];
    x[r] = s / A[r][r];
  }
  return x;
}

// Newton's method with every pump's open/closed state held fixed.
// H and Q are arrays (by node and link number); they are the starting point
// and are replaced by the answer. Returns { ok, iterations, H, Q }.
function newton(nodes, links, fluid, topo, H, Q) {
  const { from, to, row, nFree } = topo;
  const nN = nodes.length, nL = links.length;

  // How far a trial point is from satisfying the equations.
  function residuals(Ht, Qt) {
    let ok = true;
    let merit = 0;
    const bal = new Array(nN).fill(0);
    for (let k = 0; k < nL; k++) {
      if (from[k] === to[k]) continue;
      const r = headDrop(links[k], Qt[k], fluid) - (Ht[from[k]] - Ht[to[k]]);
      const closed = links[k].kind === "pump" && links[k].closed;
      // A closed link is judged by the leak-flow error; others by head.
      if (closed) {
        merit += ((1e4 * r) / R_CLOSED) ** 2;
        if (Math.abs(r) / R_CLOSED > TOL_FLOW) ok = false;
      } else {
        merit += r * r;
        if (Math.abs(r) > TOL_HEAD && Math.abs(r) / slope(links[k], Qt[k], fluid) > TOL_FLOW) ok = false;
      }
      bal[from[k]] -= Qt[k];
      bal[to[k]] += Qt[k];
    }
    for (let i = 0; i < nN; i++) {
      if (row[i] < 0) continue;
      const r = bal[i] - (nodes[i].demand || 0);
      if (Math.abs(r) > TOL_FLOW) ok = false;
      merit += (1e4 * r) ** 2; // 0.1 L/s of imbalance counts like 1 m of head
    }
    return { ok, merit };
  }

  const MAX_ITER = 150;
  let res = residuals(H, Q);
  let it = 0;
  for (; it < MAX_ITER && !res.ok; it++) {
    // Linearize each link:  headDrop + d (Qnew - Q) = Hnew_from - Hnew_to
    //   =>  Qnew = (Q - y) + p (Hnew_from - Hnew_to),  p = 1/d,  y = p headDrop
    const p = new Array(nL);
    const y = new Array(nL);
    const A = Array.from({ length: nFree }, () => new Array(nFree).fill(0));
    const b = new Array(nFree).fill(0);
    for (let i = 0; i < nN; i++) if (row[i] >= 0) b[row[i]] = -(nodes[i].demand || 0);
    for (let k = 0; k < nL; k++) {
      p[k] = 1 / slope(links[k], Q[k], fluid);
      y[k] = p[k] * headDrop(links[k], Q[k], fluid);
      const i = from[k], j = to[k];
      if (i === j) continue;
      const ri = row[i], rj = row[j];
      const q0 = Q[k] - y[k];
      // mass balance of node i (flow leaves) and node j (flow arrives)
      if (ri >= 0) {
        A[ri][ri] += p[k];
        b[ri] -= q0;
        if (rj >= 0) A[ri][rj] -= p[k]; else b[ri] += p[k] * H[j];
      }
      if (rj >= 0) {
        A[rj][rj] += p[k];
        b[rj] += q0;
        if (ri >= 0) A[rj][ri] -= p[k]; else b[rj] += p[k] * H[i];
      }
    }
    const x = nFree ? solveLinear(A, b) : [];
    if (x === null || x.some((v) => !Number.isFinite(v))) return { ok: false, iterations: it, H, Q };
    const Hnew = H.map((h, i) => (row[i] >= 0 ? x[row[i]] : h));
    const Qnew = Q.map((q, k) =>
      from[k] === to[k] ? 0 : q - y[k] + p[k] * (Hnew[from[k]] - Hnew[to[k]]));

    // Take the full Newton step if it helps; otherwise shorten it.
    let lambda = 1;
    let Ht = Hnew, Qt = Qnew, rt = residuals(Ht, Qt);
    while (!rt.ok && !(rt.merit < res.merit) && lambda > 1e-3) {
      lambda /= 2;
      Ht = H.map((h, i) => h + lambda * (Hnew[i] - h));
      Qt = Q.map((q, k) => q + lambda * (Qnew[k] - q));
      rt = residuals(Ht, Qt);
    }
    H = Ht; Q = Qt; res = rt;
  }
  return { ok: res.ok, iterations: it, H, Q };
}

// solveNetwork({ nodes, links, fluid }, guess)
//
// Returns { converged, iterations, H: {nodeId: head}, Q: {linkId: flow},
//           closed: {pumpId: true/false} }.
// `guess` may be a previous result; it is used as the starting point.
export function solveNetwork(net, guess = null) {
  const { nodes, fluid } = net;
  // Private copies of the links, because we set .closed on the pumps.
  const links = net.links.map((l) =>
    (l.kind === "pump" ? { ...l, closed: !l.on || guess?.closed?.[l.id] === true } : l));

  // Number the nodes; free nodes also get a row in the linear system.
  const index = new Map();
  const row = new Array(nodes.length).fill(-1);
  let nFree = 0;
  nodes.forEach((nd, i) => {
    index.set(nd.id, i);
    if (nd.fixedHead === null || nd.fixedHead === undefined) row[i] = nFree++;
  });
  const topo = { from: links.map((l) => index.get(l.from)), to: links.map((l) => index.get(l.to)), row, nFree };

  // Starting point.
  const fixed = nodes.filter((nd, i) => row[i] < 0).map((nd) => nd.fixedHead);
  const meanHead = fixed.length ? fixed.reduce((s, h) => s + h, 0) / fixed.length : 0;
  let H = nodes.map((nd, i) => (row[i] < 0 ? nd.fixedHead : guess?.H?.[nd.id] ?? meanHead));
  let Q = links.map((l) => guess?.Q?.[l.id] ?? initialFlow(l));

  let iterations = 0;
  let converged = false;
  const MAX_ROUNDS = 40;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const sol = newton(nodes, links, fluid, topo, H, Q);
    iterations += sol.iterations;
    H = sol.H; Q = sol.Q;
    if (!sol.ok) break;

    // Is every running pump in the state we assumed?
    const wrong = [];
    links.forEach((l, k) => {
      if (l.kind !== "pump" || !l.on) return;
      const rise = H[topo.to[k]] - H[topo.from[k]];
      const shutoff = l.speed * l.speed * l.h0;
      if (!l.closed && Q[k] < -Q_BACK) wrong.push(k); // open, but running backward
      else if (l.closed && rise < shutoff - TOL_HEAD) wrong.push(k); // closed, but it could push
    });
    if (!wrong.length) { converged = true; break; }
    // Flip them all; if that has not settled after a few rounds, one at a time.
    for (const k of round < 8 ? wrong : wrong.slice(0, 1)) {
      links[k].closed = !links[k].closed;
      Q[k] = links[k].closed ? 0 : 1e-6;
    }
  }

  const out = { converged, iterations, H: {}, Q: {}, closed: {} };
  nodes.forEach((nd, i) => { out.H[nd.id] = H[i]; });
  links.forEach((l, k) => {
    out.Q[l.id] = Q[k];
    if (l.kind === "pump") out.closed[l.id] = l.closed;
  });
  return out;
}
