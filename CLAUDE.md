# CLAUDE.md — pipe network app for MCEN 3021

Context for Claude Code working in this repository. This file is the design
brief. It records decisions already made with the instructor, so read it
before building and don't reopen the settled ones.

---

## What this is

A graphical pipe-network analysis tool for an undergraduate fluid mechanics
course (MCEN 3021, CU Boulder, ~50–60 students). Think of a small,
free, browser-based stand-in for AFT Fathom. Students drag components onto a
canvas, connect them, set properties, and solve for steady incompressible
flow. They use it for a term design project.

It replaces a Python object API (`fluidtools.pipeflow` in the course repo,
`jeremy-koch/MCEN3021`). The instructor judged that API too complex for
students (`system.add(...)`, `pipe.add_fitting(...)`). Students should not
write or read code to use this tool.

Instructor: Jeremy Koch (GitHub `jeremy-koch`). He iterates fast and
proofreads later. Generate complete, tested work and don't stop to ask
permission mid-build. He is not a JavaScript developer by trade, so keep the
code plain enough for him to read and patch.

---

## Settled decisions (do not undo)

1. **Static browser app.** Everything runs client-side and is served by
   GitHub Pages. No server, no login, no executable, no Python at runtime.
   Model: the instructor's `jeremy-koch/MCEN-degree-planner`.
2. **Free-form canvas, small palette.** Students can build any network from
   five component types: tank (reservoir), pipe, pump, valve, junction.
   This is not a fixed template for one project.
3. **Information, not verdicts.** The app reports numbers and plots, and
   students make the judgment. It never says a design "passes", "fails", or
   "is not viable", and never recommends a choice. (Modeling errors are a
   different thing; see "Error messages".)
4. **The Python toolbox is the referee.** `reference/pipeflow.py` is a copy
   of the course repo's `src/fluidtools/pipeflow.py`. The JavaScript solver
   must reproduce its answers on the test systems below. Use the same
   correlations (Colebrook, the same roughness and fitting tables, the same
   water property fits) so the two cannot disagree.
5. **Saving is a file plus autosave.** The app autosaves to the browser's
   `localStorage`, and has "Download design" and "Open design" buttons that
   write and read one JSON file. That file is what students submit on
   Canvas, and the instructor opens it in the same app. Put a schema version
   number in the file from the first release.
6. **Boulder is the default.** Atmospheric pressure defaults to 83 kPa, not
   101.325 kPa. It is a visible, editable setting.

---

## What students see

### Canvas
- Drag from a palette, connect ports, click a component to edit it in a
  side panel. Undo/redo, delete, pan, zoom.
- After a solve, show the flow rate and direction on each pipe and the
  pressure and head at each junction, directly on the diagram.

### Component properties
- **Tank:** surface elevation; surface pressure (gauge, default 0).
- **Junction:** elevation (needed for pressures and for pump suction).
- **Pipe:** length, inside diameter, material (roughness table) or custom
  roughness, a list of fittings from the fitting table, optional custom K.
- **Valve:** loss coefficient K. An adjustable setting is the point of this
  component, since throttling is central to the project story.
- **Pump:** chosen from the course catalog or entered as a custom curve;
  elevation; speed ratio (a variable-frequency drive, via the affinity
  laws); on/off, so students can take a pump out of service. An off pump
  passes no flow. A running pump passes no reverse flow (assume a check
  valve).

### Outputs for judgment
- **Pump plot, per pump:** the pump's head curve, the head the rest of the
  network demands of it, and the operating point. On the same plot, the
  NPSH-required curve and the NPSH-available at the operating point, so the
  cavitation margin can be read off the figure.
- **Energy cost:** shaft power per pump and total, then cost over a
  lifetime the student chooses. Inputs are editable: electricity price,
  hours per year, lifetime in years. Show pump purchase price beside it.
  Do not compute payback or net savings; that comparison is the student's.
- **Tables:** per pipe, flow, velocity, Reynolds number, friction factor,
  major and minor loss. Per junction, head and pressure.
- **Scenarios (later):** a way to compare two saved states side by side,
  for example "all three pumps" against "one pump out".

---

## Error messages

Free-form editing means students will build systems that cannot be solved.
Each case needs a message that names the component and says what to change:

- a pipe or pump end that is connected to nothing;
- a network with no tank (no fixed head anywhere);
- a section isolated from every tank;
- missing or non-physical properties (zero diameter, negative length);
- no flow possible (the pumps cannot overcome the static lift);
- a pump held shut by the others (running, but delivering zero flow);
- the solver failing to converge.

Warn, without blocking the result, when a pipe is laminar or transitional
(2300 < Re < 4000), and when a pump runs beyond the end of its curve.

---

## Physics and conventions

- SI inside the solver. Display flow in L/s, head in m, pressure in kPa,
  power in kW.
- The head equation between two points:
  `p1/(ρg) + α1 V1²/2g + z1 + h_pump = p2/(ρg) + α2 V2²/2g + z2 + h_L`
- Pipe loss: `h_L = (f L/D + ΣK) V²/2g`. Laminar `f = 64/Re` below
  Re = 2300, Colebrook above (solved numerically).
- Pump curve: `H = h0 − a Q²` (m, m³/s). NPSH required: `n0 + n1 Q²`.
- Affinity laws at speed ratio r: `H(Q) → r² H(Q/r)`; NPSH required scales
  the same way.
- NPSH available at a pump: absolute head at the pump inlet minus vapor
  pressure head, computed from the solved network. Unlike the Python
  toolbox, every pump gets its own check, using its own suction path.
- Shaft power: `ρ g Q H / η`, with H the pump's own head. Loss in a valve
  is never subtracted from the pump's head. (The Python workaround of
  folding a valve into the pump curve under-reports power; see the test
  table.)
- Water properties from temperature (0–100 °C), including vapor pressure,
  using the fits in `reference/pipeflow.py`.

Course wording, used in every label and message:
- "flow curve", never "system curve";
- "the head equation", not "energy equation";
- `ρg`, never `γ`;
- `U` or `V` for speed as the reference file uses them; explicit `α`.

### Course pump catalog

`H = h0 − a Q²`, `NPSHr = n0 + n1 Q²`. Prices are teaching props.

| model | h0 [m] | a | η | n0 [m] | n1 | rpm | price |
|---|---|---|---|---|---|---|---|
| GN-25 "Gopher" | 18 | 2.0e5 | 0.58 | 1.0 | 1.5e4 | 1750 | $1,400 |
| GN-40 "Badger" | 28 | 1.1e5 | 0.66 | 1.2 | 1.2e4 | 1750 | $2,300 |
| CV-50 "Coyote" | 38 | 7.0e4 | 0.78 | 1.2 | 1.0e4 | 1750 | $3,200 |
| CV-80 "Elk" | 52 | 3.5e4 | 0.74 | 1.8 | 6.5e3 | 1750 | $5,600 |
| HS-120 "Bighorn" | 85 | 2.8e4 | 0.70 | 2.6 | 3.4e3 | 3500 | $9,800 |
| MF-200 "Moose" | 16 | 6.0e1 | 0.80 | 2.0 | 8.0 | 960 | $11,500 |
| AX-350 "Pelican" | 7 | 4.8 | 0.76 | 1.5 | 1.2 | 705 | $14,800 |
| AX-600 "Heron" | 5 | 0.85 | 0.72 | 1.4 | 0.4 | 590 | $21,000 |

---

## Solver

The Python referee only handles one path with series components, parallel
pipe sections, and lumped parallel pumps. This app needs a general network
solver.

Recommended approach: unknowns are the head at each junction and the flow in
each link; tanks are fixed-head nodes. Solve mass balance at junctions plus
each link's head relation with Newton's method (EPANET's "global gradient
algorithm" is the standard formulation). Points that need care:

- the derivative of pipe loss goes to zero at Q = 0, so regularize near
  zero flow;
- pumps have a check-valve condition (Q ≥ 0), which is a switching
  condition, not a smooth function;
- flow direction in a pipe is an output, not an input.

Keep the solver in its own module with no dependence on the page, so it
runs under Node for tests.

---

## Tests: referee numbers

All from `reference/pipeflow.py`, water at 20 °C. Regenerate them with a
script in `reference/`; don't hand-edit. The file imports scipy, so the
script needs `numpy` and `scipy` installed. Match to 0.5% or better.

**Gravity drain.** Tank at 15 m to tank at 0 m. One pipe: L = 200 m,
D = 0.10 m, cast iron; sharp entrance, 4 standard 90° elbows, exit.
→ Q = 17.89 L/s.

**Parallel pipes.** Total 10 L/s through two commercial-steel branches:
A (L = 100 m, D = 0.05 m) and B (L = 40 m, D = 0.04 m), no fittings.
→ A carries 5.286 L/s, B carries 4.714 L/s, head loss 15.70 m.

**Simple lift.** Tank at 0 m to tank at 12 m, all pipe D = 0.08 m
commercial steel. Suction: L = 5 m, sharp entrance, strainer. Pump:
h0 = 30, a = 9e4, η = 0.70, NPSHr = 1.5 + 4e3 Q², elevation 1.0 m.
Discharge: L = 60 m, 4 standard 90° elbows, swing check valve, exit.

| case | result |
|---|---|
| one pump | Q = 11.34 L/s, pump head 18.43 m, shaft power 2.92 kW |
| NPSH available, 83 kPa | 6.28 m (required 2.01 m) |
| NPSH available, 101.325 kPa | 8.15 m |
| two pumps in parallel | 15.85 L/s |
| two pumps in series | 14.47 L/s |
| one pump at 80% speed | 7.13 L/s |

**Three-pump station** (the project's skeleton). Tank at 0 m to tank at
25 m, 83 kPa. Elk pumps in parallel, each followed by a valve of
coefficient K on a 0.10 m line (K applied to that line's velocity; no other
loss on the pump lines). Common header: L = 250 m, D = 0.20 m, commercial
steel, 6 standard 90° elbows, swing check valve, exit.

| pumps running | valve K | total Q | true shaft power (all pumps) |
|---|---|---|---|
| 3 | 0.15 | 71.0 L/s | 30.4 kW |
| 3 | 20 | 61.3 L/s | 30.3 kW |
| 2 | 0.15 | 51.3 L/s | 19.7 kW |

Valve K for 60 L/s with three running: 23.3.

---

## The project this serves

A company runs the same pump on three parallel lines so production
continues when one pump or line is down for service. The pumps are
oversized, so a partly closed valve after each pump sets the flow. With
one pump out, operators open the other two valves to try to hold the flow.

Students investigate questions such as:
- Is it worth replacing the pumps with ones that need no throttling? What
  happens then with one pump out?
- Would running two pumps with one on standby do the job?
- What does a variable-frequency drive buy, compared with its cost?
- Does cavitation margin shrink when one pump is out and the other two run
  further out on their curves?

The app must support all of these without special-casing them. The project
handout is written separately; this repo is only the tool.

---

## Tech guidance

- Plain JavaScript modules, SVG for the canvas and plots, and as few
  dependencies as possible. Prefer no build step, so GitHub Pages serves
  the repo as-is. If a framework or bundler looks necessary, say why
  before adding it.
- Tests run with Node's built-in test runner.
- Wrap every `localStorage` read and write in try/catch; the app must work
  with storage unavailable.
- Layout: `index.html`, `src/solver/`, `src/ui/`, `tests/`, `reference/`.

## Build order

1. Solver module plus the referee tests above, all passing.
2. Bare editor: place, connect, edit properties, solve, show numbers.
3. Rebuild the three-pump station in the editor by hand as the first full
   check.
4. Pump plot with NPSH, then energy cost.
5. Download/open design file and autosave.
6. Error messages for every case listed above.
7. Polish: undo/redo, on-diagram results, scenario comparison.

---

## Open questions for the instructor

- **Pump efficiency.** The catalog has one constant η per pump, so a pump
  running far from its best point costs nothing extra. That hides part of
  the cost of an oversized pump and decides "three slow pumps against two
  fast ones" by assumption. Recommended: give each pump an efficiency
  curve that peaks at its best-efficiency flow. Needs his sign-off, since
  it changes catalog numbers.
- **Valve input.** K directly, or "percent open" mapped to K?
- **Custom pumps.** May students enter their own curves, or catalog only?
- **Impeller trim** as a pump option, alongside speed ratio?
- **Units.** SI only, or a US customary display toggle?

---

## Build notes (first build, 2026-11-12)

Build-order steps 1–7 are done; see `README.md` for the layout. Decisions
made during the build, so they are not re-derived:

- **Canvas model.** Tanks, junctions, pumps and valves are components with
  ports; pipes are the connections drawn between ports (the AFT Fathom
  arrangement). A pump or valve needs a pipe on both sides. A pipe with
  `L = 0` and no fittings is a lossless direct connection; that is how the
  three-pump station puts a valve straight after a pump.
- **Set flows.** A junction has a "Flow in (set)" in L/s (negative = a
  withdrawal), stored as `Qin_Ls`. A tank is still required for the head.
  A set flow whose only exit is through a closed pump is a modeling error.
- **Valves have a line diameter** as well as K, because K needs a velocity.
- **Node head is total head** `p/ρg + αV²/2g + z`, with α = 1. Junction
  "pressure" in the table is `ρg(H − z)`; static pressure at each pipe end
  is in the pipe table.
- **No Solve button.** The network is solved after every edit.
- **Solver.** Newton on heads and flows (global gradient algorithm) with
  step shortening. Each pump is open or closed; states are checked after
  each solve and flipped until consistent. A closed pump is a resistance of
  1e8 m per m³/s. `tests/random.test.js` is the guard: change the solver
  only with that test passing.
- **Three differences from `reference/pipeflow.py`**, listed in the README:
  friction ramp over 2300 < Re < 2400; pump head continues negative past
  the end of the curve; NPSH available at every pump.
- **Extra error message** beyond the list above: two tanks at different
  heads joined by a lossless path (flow would be infinite).
- **Pump efficiency curve** (instructor asked for it, 2026-11-13). The
  catalog η is the peak, reached at `Q_bep = r·sqrt(h0/(3a))` (head at 2/3
  of shutoff, the rule `catalog_report()` uses). Away from it
  `η = η_max [2(Q/Q_bep) − (Q/Q_bep)²]`. Each pump has an "Ideal
  efficiency" checkbox (`ideal: true`) that sets η = 1 (100%, instructor's
  choice): shaft power = ρgQH. No mode reproduces the Python referee's
  constant-η power directly; tests check ideal power / η against it. The
  curve is the default.
  A running pump at zero flow draws shutoff power `ρ g h0 Q_bep/(2 η_max)`.
- **End of the pump curve** (confirmed direction, 2026-11-13): head goes
  negative past runout; it is not pinned at zero.
- **Open questions were answered with defaults**, pending the instructor:
  valve input is K; custom pump curves are
  allowed (h0, a, η, n0, n1, price); no impeller trim; SI only. Energy
  defaults are $0.12/kWh, 6000 h/yr, 10 yr.
- **Examples menu** leaves out the three-pump station on purpose; it opens
  with `index.html?example=station`.
- **Node is not on the instructor's PATH.** Tests were run with VS Code's
  bundled Node:
  `ELECTRON_RUN_AS_NODE=1 "/Applications/Visual Studio Code.app/Contents/MacOS/Code" --test`.
  The referee script was run with `~/miniconda3/envs/quartos/bin/python`.

---

## Build notes (second build, 2026-11-16)

Student-facing additions, all built and tested. `README.md` lists them tab
by tab. Decisions made, so they are not re-derived:

- **Design file is schema 2.** Added `author`, `notes`, `labels` (text on
  the canvas, `{id, x, y, text}`), `settings.vfd_price` and
  `settings.pipe_price`, a pump's `vfd` flag, and a scenario's `share`.
  A schema 1 file opens with these at their defaults.
- **`src/solver/insight.js`** holds the new page-free physics: `gradeLine`,
  `powerBudget`, `designDiff`, and the sweep (`sweepTargets`,
  `sweepOutputs`, `runSweep`). Tests are in `tests/insight.test.js`.
- **Sweep** varies one input and re-solves the whole design at each step
  (25 by default). It never changes the design. There is no goal-seek
  button on purpose: the student reads the answer off the curve. "All
  valves together" and "All pumps together" are targets, because the
  project moves three valves at once.
- **Where the power goes** is an energy balance on the whole network, not
  a head budget along one path, because a path is not unique in a network.
  Lift = rho g (sum of Q H where water leaves minus where it enters).
- **Grade line.** Losses inside a pipe are drawn as a straight line (the
  design does not say where each fitting sits). Pumps, valves and
  zero-length connections are drawn 3% of the path wide so their steps
  can be seen; axis labels are true distances.
- **Pump plot.** Instead of a "combined curve" for parallel pumps (which
  only exists when pumps share both nodes, and the station's do not), each
  pump's plot has a second, dashed flow curve: the same pump with every
  other pump off. Also ghost head curves at 100/90/80/70% speed and the
  best-efficiency point.
- **Low pressure.** A note (not an error) wherever the absolute static
  pressure at a pipe end is below vapor pressure; `result.lowP` lists the
  components.
- **Prices.** A drive costs `vfd_price` ($4,000 default) for every pump
  whose drive box is ticked or whose speed ratio is not 1. Pipe costs
  `pipe_price` ($150/m default) at D = 0.10 m, in proportion to D. Both
  are teaching props and editable. Still no payback calculation.
- **Scenarios** mark cells that differ from the canvas, list the changed
  inputs in words, can be updated and renamed, and carry a share of the
  running time for a weighted energy cost.
- **Selection.** `S.sel` is still the one thing the panel shows; `S.also`
  holds the ids of anything else selected (Shift+click, Shift+drag box).
  Move, duplicate, copy/paste and delete act on all of them.
- **Not verified in a real browser.** The page code was run under Node
  with a stand-in DOM (no exceptions on every tab and example) and its
  SVG output was looked at as images, but hover readouts, the tour's
  placement, PNG export and drag gestures have not been clicked through.

---

## Build notes (third pass, 2026-11-16)

- **Valves can be closed.** A valve has a `closed` flag (a "Closed" box in
  its panel). A closed valve is the same 1e8 m per m³/s resistance as a
  closed pump, whatever its K. A flow set behind a closed valve is a
  modeling error that names the valve. The project asks students to "shut
  all lines but one", and the valve is where they will reach first.
- **A pressurized tank shows its pressure** on the diagram, since the
  delivery pressure is a project specification.
- **Scenarios inside an opened file** go through `loadDesign` too, so an
  old file's scenarios pick up newer settings at their defaults.
- **`project/` is in `.gitignore`.** It holds the handout draft, seven
  baseline cases, their answer keys and design files, and the script that
  generates them from the solver (`project/make_cases.mjs`; see
  `project/README.md`). It must never be committed: the repo is public and
  the keys are in there.
- **Checked without a browser.** Pointer gestures (click, shift-click,
  group drag, box select, drawing a pipe) and every chart's hover readout
  were run under Node with made-up events. Still not clicked through by a
  person: the tour's placement on screen and PNG export.
