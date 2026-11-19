# Pipe network — MCEN 3021

A small pipe-network analysis tool that runs in the browser. We drag tanks, junctions, pumps and valves onto a canvas, join them with pipes, set their properties, and the app solves for the steady flow — think of it as a free, much smaller stand-in for AFT Fathom. It is built for the MCEN 3021 term project, but nothing in it is specific to that project.

The app reports numbers and plots. It never says whether a design is good... that part is the student's job.

## Using it

Open `index.html` through a web server (GitHub Pages does this for us). Opening the file straight from disk won't work, because browsers refuse to load JavaScript modules from `file://`. For a local copy:

```
python3 -m http.server 8000
```

and then visit `http://localhost:8000`.

The rest is hopefully discoverable (and there is a Help button with a short tour and a glossary), but briefly: drag a component from the left onto the canvas; drag from one port (a small circle) to another to make a pipe; click anything to edit it on the right. The network is solved after every change, so there is no Solve button.

The tabs under the canvas are where the reading happens:

- **Messages** says what is missing when the network cannot be solved, and notes things worth knowing when it can (laminar pipes, a pump past the end of its curve, a spot where the pressure has dropped below the vapor pressure).
- **Pumps** has a plot for each pump: its head curve against the flow curve, NPSH required against available, and efficiency, with the best-efficiency point marked. Faint curves show the head at other speeds, and a dashed flow curve shows what this pump would see with the other pumps off.
- **Where the power goes** is an energy balance on the whole network: shaft power in; pump losses, pipe friction, fittings, valves and lift out, each in kW, percent and dollars per year.
- **Costs** has the energy cost and, beside it, the purchase prices of pumps, drives and pipe. It does not compute a payback... that comparison is the student's. A drive is priced by the size of its pump: a base price plus a price per kW of the pump's rated power (shaft power at its best-efficiency point), both editable and including installation. A drive also loses a little: a pump with one draws its shaft power divided by the drive efficiency (0.97 by default), and the energy cost is billed on that. A pump's speed ratio can only be moved off 1 once its "Variable-frequency drive" box is ticked.
- **Sweep** varies any one input (a valve's K, all the valves together, a speed ratio, a diameter...) and plots any one output against it. Probably the most useful design tool in the app.
- **Grade line** plots the energy and hydraulic grade lines along a path between two tanks or junctions. Select something on the canvas and the path goes through it.
- **Pipes** and **Heads and pressures** are the tables. Click a pipe and its head equation is written out with the numbers put in, so it can be checked by hand; under that is a Moody chart with a dot for every pipe.
- **Scenarios** are saved copies of the design, compared side by side with the differences marked, the changed inputs listed in words, and an energy cost weighted by the share of the time spent in each.

On the canvas, pipe width shows flow rate, color can show speed or pressure, and moving dashes show direction (all three can be switched off, bottom left). Shift+click or Shift+drag selects several things; Ctrl/Cmd+D duplicates them, which makes short work of three identical pump lines. Every plot and the diagram can be saved as SVG or PNG, and every table as CSV, for reports.

"Download design" writes one `.pipenet.json` file — that is what students submit, and "Open design" (or dropping the file on the page) reads it back. The app also autosaves to the browser, so a reload picks up where we left off.

A pipe of length zero with no fittings is a plain connection: no loss at all. That is how we put a valve directly after a pump.

To shut a line, tick "Closed" on its valve or untick "Running" on its pump; either one stops the flow in that line.

## How it is put together

There is no build step and there are no dependencies. Everything is plain JavaScript modules.

- `src/solver/` is the physics, and knows nothing about the page. `hydraulics.js` has the water properties, the friction factor and the pump curves; `network.js` is the network solver; `analyze.js` takes a design, checks it, solves it, and produces every number the app shows; `design.js` describes the design file; `tables.js` holds the roughness, fitting and pump tables.
- `src/solver/insight.js` is also physics with no page: the grade line along a path, the power balance, the list of differences between two designs, and the parameter sweep.
- `src/ui/` is the page: `canvas.js` (the drawing and the mouse), `panel.js` (properties), `results.js` and `insight-tabs.js` (the tabs), `pumpplot.js` (the pump plot), `chart.js` (the line chart the other plots share), `export.js` (pictures and CSV), `help.js` (glossary, Help window, tour), `state.js` (undo, autosave), `app.js` (the wiring).
- `src/examples.js` builds the example systems. The tests use the same ones.
- `reference/` holds the referee: `pipeflow.py` is a copy of the course toolbox, and `make_referee.py` runs it to write `referee.json`.

The solver uses the same formulation as EPANET (just giving you some vocabulary if you want to read more: Todini's "global gradient algorithm"). The unknowns are the head at every node and the flow in every link, and Newton's method does the rest. The one wrinkle is the check valve on each pump, which is a switch rather than a smooth curve — so each pump is either open or closed, and after each solve we check whether every pump is in the state we assumed, flip the ones that aren't, and solve again.

## Tests

```
npm test          # or:  node --test
```

This needs Node 20 or newer and nothing else. There are four groups. `referee.test.js` checks the JavaScript against the Python toolbox on the systems in `CLAUDE.md` (gravity drain, parallel pipes, simple lift, three-pump station); the two must agree to 0.5%, and in practice they agree to five or six digits. `messages.test.js` checks that every unsolvable network produces a message naming the component. `insight.test.js` checks the grade line, the power balance (what goes in must come out), the sweep (all three valves together reach 60 L/s at K = 23.3, the referee's number), the low-pressure note, and that an older design file still opens. `random.test.js` solves a few hundred random networks and checks what must be true of any right answer: flow is conserved at every junction and each pipe's loss matches the head difference across it.

To regenerate the referee numbers after changing `reference/pipeflow.py` (needs numpy and scipy):

```
python reference/make_referee.py
```

## Where the app and the Python toolbox differ

On the test systems they give the same answers. There are four deliberate differences elsewhere.

- The friction factor jumps at Re = 2300 (from 64/Re to Colebrook). A jump can leave a network with no solution, so the app ramps between the two over 2300 < Re < 2400. A pipe in that band gets a "transitional" note anyway.
- Past the end of a pump curve the toolbox holds the head at zero. The app lets `H = h0 − a Q²` go negative instead, so an overrun pump resists the flow rather than passing an unlimited amount of it.
- NPSH available is computed at every pump from the solved head at its own inlet, not only at the first pump.

- Pump efficiency follows a curve, `η = η_max [2(Q/Q_bep) − (Q/Q_bep)²]`, with the catalog η as the peak and `Q_bep = sqrt(h0/3a)`. The toolbox has one constant η per pump instead. Ticking "Ideal efficiency" on a pump makes it 100% efficient (shaft power = ρgQH); the tests check the referee's shaft powers as that ideal power divided by the catalog η.

Shaft power always uses the pump's own head. The loss in a throttling valve is never subtracted from it.
