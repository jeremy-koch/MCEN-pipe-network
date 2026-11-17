// notes.test.js -- the four built-in examples from course notes 11.3,
// "Pipe flow examples", against the answers worked by hand in the notes.
//
// The notes round to two or three figures and read f off a Moody chart in
// example 1, so the tolerance here is 1.5%, looser than the referee tests.

import test from "node:test";
import assert from "node:assert/strict";

import { analyze } from "../src/solver/analyze.js";
import { notesExample1, notesExample2, notesExample3, notesExample4, byType, pipeNamed } from "../src/examples.js";

function close(actual, expected, what, tol = 0.015) {
  const err = Math.abs(actual - expected) / Math.abs(expected);
  assert.ok(err <= tol, `${what}: got ${actual}, notes ${expected} (off by ${(100 * err).toFixed(2)}%)`);
}

function solved(design) {
  const r = analyze(design);
  assert.equal(r.status, "solved", r.errors.map((e) => e.text).join(" | "));
  return r;
}

test("notes example 1: inlet pressure for 0.4 L/s", () => {
  const d = notesExample1();
  const r = solved(d);
  close(r.pipes[pipeNamed(d, "L1").id].pFrom / 1000, 58.9, "p1 [kPa]");
  close(r.pipes[pipeNamed(d, "L1").id].V, 1.27, "U [m/s]");
});

test("notes example 2: water tower", () => {
  const d = notesExample2();
  const r = solved(d);
  close(r.pipes[pipeNamed(d, "L4").id].Q * 1000, 8.7, "Q [L/s]");
  close(r.pipes[pipeNamed(d, "L4").id].V, 4.45, "U [m/s]");
});

test("notes example 3: parallel paths", () => {
  const d = notesExample3();
  const r = solved(d);
  close(r.pipes[pipeNamed(d, "A").id].Q * 1000, 6.22, "QA [L/s]");
  close(r.pipes[pipeNamed(d, "B").id].Q * 1000, 3.78, "QB [L/s]");
  // Same diameter at 1 and 2, same elevation: p1 - p2 = rho g (H1 - H2).
  const A = r.pipes[pipeNamed(d, "A").id];
  close((A.Hfrom - A.Hto) * 998 * 9.81 / 1000, 64, "p1 - p2 [kPa]", 0.02); // notes: 6.5 m, rounded
});

test("notes example 4: pump operating point, 100% efficient", () => {
  const d = notesExample4();
  const r = solved(d);
  const Q = r.pipes[pipeNamed(d, "L1 + L2 + L3").id].Q;
  close(Q * 1000, 15.2, "Q [L/s]");
  const H = 30 * (1 - (Q / 0.025) ** 2);
  close(H, 18.9, "pump head [m]");
  assert.equal(byType(d, "pump")[0].ideal, true);
});
