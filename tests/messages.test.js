// messages.test.js -- networks that cannot be solved as drawn must produce
// an error that names the component; odd-but-solvable ones produce a note
// and still give numbers.

import test from "node:test";
import assert from "node:assert/strict";

import { analyze } from "../src/solver/analyze.js";
import { newDesign, addComponent, addPipe, loadDesign } from "../src/solver/design.js";
import { gravityDrain, simpleLift, threePumpStation, byType } from "../src/examples.js";

const errorText = (d) => analyze(d).errors.map((e) => e.text).join("\n");
const noteText = (d) => analyze(d).notes.map((e) => e.text).join("\n");

test("an empty canvas is not an error", () => {
  const r = analyze(newDesign());
  assert.equal(r.status, "empty");
  assert.equal(r.errors.length, 0);
});

test("a pump port connected to nothing", () => {
  const d = newDesign();
  const t = addComponent(d, "tank", 0, 0);
  const p = addComponent(d, "pump", 0, 0);
  addPipe(d, t.id, "a", p.id, "in");
  const r = analyze(d);
  assert.equal(r.status, "error");
  assert.match(r.errors[0].text, /Pump “Pump 1”: nothing is connected to its outlet/);
  assert.deepEqual(r.errors[0].ids, [p.id]);
});

test("a valve port connected to nothing", () => {
  const d = gravityDrain();
  addComponent(d, "valve", 0, 0);
  assert.match(errorText(d), /Valve “Valve 1”: nothing is connected to its first port/);
});

test("no tank anywhere", () => {
  const d = newDesign();
  const a = addComponent(d, "junction", 0, 0), b = addComponent(d, "junction", 0, 0);
  addPipe(d, a.id, "a", b.id, "a");
  assert.match(errorText(d), /There is no tank/);
});

test("a section isolated from every tank", () => {
  const d = gravityDrain();
  const a = addComponent(d, "junction", 0, 0), b = addComponent(d, "junction", 0, 0);
  const pipe = addPipe(d, a.id, "a", b.id, "a");
  const text = errorText(d);
  assert.match(text, /not connected to any tank/);
  assert.ok(text.includes("J1") && text.includes("J2") && text.includes(pipe.name));
});

test("missing and non-physical properties", () => {
  let d = gravityDrain(); d.pipes[0].D = 0;
  assert.match(errorText(d), /Pipe “Pipe 1”: the inside diameter must be greater than zero/);
  d = gravityDrain(); d.pipes[0].L = -5;
  assert.match(errorText(d), /Pipe “Pipe 1”: the length cannot be negative/);
  d = gravityDrain(); d.components[0].z = null;
  assert.match(errorText(d), /Tank “Tank 1”: the surface elevation is missing/);
  d = simpleLift(); byType(d, "pump")[0].custom.eta = 1.4;
  assert.match(errorText(d), /efficiency η must be between 0 and 1/);
  d = simpleLift(); byType(d, "pump")[0].speed = 0;
  assert.match(errorText(d), /speed ratio must be greater than zero/);
  d = gravityDrain(); d.settings.temperature_C = 140;
  assert.match(errorText(d), /temperature must be between 0 and 100/);
});

test("two tanks at different heads joined with no loss at all", () => {
  const d = gravityDrain();
  d.pipes[0].L = 0;
  d.pipes[0].fittings = [];
  assert.match(errorText(d), /Tanks “Tank 1” and “Tank 2” are at different heads .* \(Pipe 1\), so the flow between them would be infinite/);
  d.pipes[0].K_extra = 1; // any loss at all makes it solvable
  assert.equal(analyze(d).status, "solved");
});

test("every problem is listed at once, not one at a time", () => {
  const d = gravityDrain();
  d.pipes[0].D = 0;
  addComponent(d, "pump", 0, 0);
  const r = analyze(d);
  assert.ok(r.errors.length >= 3, "the bad diameter and both loose pump ports");
});

test("a set flow with nowhere to go but through a closed pump", () => {
  // Inflow at a junction whose only exit is an off pump.
  const d = newDesign();
  const j = addComponent(d, "junction", 0, 0, { Qin_Ls: 5 });
  const p = addComponent(d, "pump", 0, 0, { on: false });
  const t = addComponent(d, "tank", 0, 0);
  addPipe(d, j.id, "a", p.id, "in", { L: 10 });
  addPipe(d, p.id, "out", t.id, "a", { L: 10 });
  assert.match(errorText(d), /Pump “Pump 1” is off, and the flow set at “J1” can only get through by passing it/);
  // Turning it on fixes it.
  p.on = true;
  assert.equal(analyze(d).status, "solved");
  // A withdrawal downstream of a running pump would pull water backward through it.
  p.on = true; j.Qin_Ls = -5;
  assert.match(errorText(d), /check valve is shut.*passing it backward/);
});

test("a set flow at a one-pipe junction is not called a dead end", () => {
  const d = gravityDrain();
  const j = addComponent(d, "junction", 0, 0, { Qin_Ls: -2 });
  addPipe(d, d.components[0].id, "a", j.id, "a", { L: 20, D: 0.05 });
  const r = analyze(d);
  assert.doesNotMatch(noteText(d), /dead end/);
  const pipe = d.pipes[1];
  assert.ok(Math.abs(Math.abs(r.pipes[pipe.id].Q) - 0.002) < 1e-9, "the withdrawal flows through its pipe");
});

test("no flow possible: the pumps cannot overcome the static lift", () => {
  const d = simpleLift();
  byType(d, "tank")[1].z = 50;
  const r = analyze(d);
  assert.equal(r.status, "solved");
  assert.match(r.notes[0].text, /Nothing is flowing/);
  assert.match(r.notes[0].text, /static lift/);
  assert.equal(r.comps[byType(d, "pump")[0].id].Q, 0);
  // A pump running against a closed check valve moves no water but still
  // takes shaft power (its efficiency there is zero). An ideal pump
  // (100% efficient) takes none.
  assert.ok(r.totals.power > 1000, "shutoff power with the efficiency curve");
  byType(d, "pump")[0].ideal = true;
  assert.equal(analyze(d).totals.power, 0);
});

test("a pump held shut by the others", () => {
  const d = threePumpStation();
  byType(d, "pump")[0].model = "GN-25"; // 18 m shutoff against ~29 m
  const r = analyze(d);
  assert.equal(r.status, "solved");
  assert.match(noteText(d), /Pump “Pump 1” is running but delivers no flow/);
  assert.equal(r.comps[byType(d, "pump")[0].id].Q, 0);
  assert.ok(r.comps[byType(d, "pump")[1].id].Q > 0.02);
});

test("an off pump passes no flow, in either direction", () => {
  const d = simpleLift();
  byType(d, "pump")[0].on = false;
  byType(d, "tank")[0].z = 40; // would drain backward through the pump line
  const r = analyze(d);
  assert.equal(r.comps[byType(d, "pump")[0].id].Q, 0);
  assert.ok(d.pipes.every((p) => r.pipes[p.id].Q === 0));
});

test("a running pump passes no reverse flow", () => {
  const d = simpleLift();
  byType(d, "tank")[1].z = 80;
  const r = analyze(d);
  assert.ok(d.pipes.every((p) => r.pipes[p.id].Q === 0));
});

test("laminar and transitional pipes get a note, with results", () => {
  let d = gravityDrain(); d.components[0].z = 0.0005;
  assert.match(noteText(d), /laminar \(Re = \d+\)/);
  d = gravityDrain(); d.components[0].z = 0.004;
  assert.match(noteText(d), /transitional range/);
  assert.equal(analyze(d).status, "solved");
});

test("a pump beyond the end of its curve gets a note", () => {
  const d = simpleLift();
  byType(d, "tank")[1].z = -40;
  assert.match(noteText(d), /beyond the end of its curve/);
  const pump = analyze(d).comps[byType(d, "pump")[0].id];
  assert.ok(pump.head < 0 && pump.power === 0);
});

test("flow direction is an output: a pipe drawn backward has negative Q", () => {
  const d = gravityDrain();
  const p = d.pipes[0];
  [p.from, p.to] = [p.to, p.from];
  const r = analyze(d);
  assert.ok(r.pipes[p.id].Q < -0.017);
});

test("the app never issues a verdict", () => {
  // Push a system into cavitation territory and look for judgment words.
  const d = simpleLift();
  byType(d, "pump")[0].z = 9;
  const r = analyze(d);
  const pump = r.comps[byType(d, "pump")[0].id];
  assert.ok(pump.npsha < pump.npshr, "this case has NPSHa below NPSHr");
  const all = [...r.errors, ...r.notes].map((e) => e.text).join(" ");
  assert.doesNotMatch(all, /cavitat|fail|not viable|unsafe|danger|pass(es|ed)?\b(?! no)/i);
});

test("design files: round trip, and bad files are refused with a reason", () => {
  const d = threePumpStation();
  const again = loadDesign(JSON.parse(JSON.stringify(d)));
  assert.deepEqual(analyze(again, { curves: false }).totals, analyze(d, { curves: false }).totals);
  assert.throws(() => loadDesign({ hello: 1 }), /not a pipe network design/);
  assert.throws(() => loadDesign({ ...d, schema: 99 }), /newer version/);
});

test("note: NPSH available below required names the pump and gives both numbers", () => {
  const d = simpleLift();
  assert.ok(!analyze(d).notes.some((n) => n.text.includes("NPSH available")), "no note with a positive margin (6.28 m available, 2.01 m required)");
  const pump = byType(d, "pump")[0];
  pump.z += 5; // lifting the pump 5 m takes about 5 m off NPSH available
  const r = analyze(d);
  assert.equal(r.status, "solved"); // a note, not an error: the result still shows
  const c = r.comps[pump.id];
  assert.ok(c.npsha < c.npshr);
  const note = r.notes.find((n) => n.text.includes("NPSH available"));
  assert.ok(note, "there is an NPSH note");
  assert.deepEqual(note.ids, [pump.id]);
  assert.ok(note.text.includes(pump.name));
});
