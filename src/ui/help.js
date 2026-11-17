// help.js -- the glossary (shown as hover text on labels and table
// headings), the Help window, and the short tour for a first visit.

import { h } from "./util.js";

// Each entry: [pattern that finds the term in a label, name, explanation].
// The first pattern that matches a label wins, so the specific ones go first.
export const GLOSSARY = [
  [/NPSH available/i, "NPSH available",
    "Net positive suction head available: the absolute total head at the pump inlet, measured above the pump centerline, minus the vapor-pressure head of the water. It comes from the network: the suction tank, the suction pipe losses, the pump's elevation and the atmospheric pressure."],
  [/NPSH required/i, "NPSH required",
    "Net positive suction head required: what the pump needs at its inlet to run without cavitating. It comes from the pump's catalog curve and grows with flow rate. The gap between available and required is the cavitation margin."],
  [/flow curve/i, "Flow curve",
    "The head the rest of the network demands of a pump, as a function of the flow through that pump: the static lift plus every loss on the way. The pump runs where its head curve crosses the flow curve."],
  [/pump head|^head curve/i, "Pump head",
    "The head the pump adds to the water, h_pump in the head equation. It falls as the flow rate rises: H = h0 − a Q²."],
  [/efficiency|η/, "Efficiency η",
    "Water power out divided by shaft power in, ρgQH / P_shaft. It peaks at the pump's best-efficiency point and falls away on either side."],
  [/best.efficiency|BEP/i, "Best-efficiency point",
    "The flow rate at which a pump's efficiency peaks. Here it is taken where the head has fallen to two-thirds of the shutoff head."],
  [/shaft power/i, "Shaft power",
    "The power the motor delivers to the pump shaft: ρ g Q H / η. This is what the electricity bill follows (motor and drive losses aside)."],
  [/speed ratio/i, "Speed ratio",
    "Pump speed divided by rated speed. By the affinity laws the head curve becomes r² H(Q/r): flow scales with r, head with r², power with r³."],
  [/energy grade line|EGL/i, "Energy grade line",
    "The total head, p/ρg + αV²/2g + z, plotted along a path. It only ever falls in the direction of flow, except across a pump."],
  [/hydraulic grade line|HGL/i, "Hydraulic grade line",
    "p/ρg + z plotted along a path: the height water would rise to in an open tube tapped into the pipe. It sits one velocity head below the energy grade line. Where it drops below the pipe itself, the gauge pressure in the pipe is negative."],
  [/major loss/i, "Major loss", "Head lost to wall friction along the length of the pipe: f (L/D) V²/2g."],
  [/minor loss/i, "Minor loss", "Head lost in fittings, entrances, exits and valves: ΣK V²/2g."],
  [/ΣK|loss coefficient|^K$/, "Loss coefficient K", "The head lost in a fitting or valve, in units of the velocity head: h_L = K V²/2g. For a valve, a larger K means more closed."],
  [/^Re$/, "Reynolds number", "Re = ρVD/μ. Below about 2300 the flow in a pipe is laminar; above about 4000 it is turbulent; in between it is transitional."],
  [/^f$/, "Friction factor", "The Darcy friction factor: 64/Re in laminar flow, and from the Colebrook equation (the Moody chart) in turbulent flow."],
  [/Head H|^head$/i, "Head", "Total head: p/ρg + αV²/2g + z, in metres of water, measured from the same datum as the elevations and with gauge pressure."],
  [/lift/i, "Lift", "The power (or head) that went into raising the water from where it entered the network to where it left."],
];

// The explanation for a label, or null.
export function glossFor(label) {
  const text = String(label).replace(/<[^>]+>/g, "");
  const hit = GLOSSARY.find(([pattern]) => pattern.test(text));
  return hit ? hit[2] : null;
}

// ---------------------------------------------------------------------------
// The Help window
// ---------------------------------------------------------------------------

const KEYS = [
  ["Delete", "delete what is selected"],
  ["R", "rotate a pump or valve"],
  ["Shift + click", "add to the selection"],
  ["Shift + drag on the canvas", "select everything in a box"],
  ["Ctrl/Cmd + D", "duplicate the selection"],
  ["Ctrl/Cmd + C, V", "copy and paste"],
  ["Ctrl/Cmd + A", "select everything"],
  ["Ctrl/Cmd + Z, Shift + Z", "undo and redo"],
  ["Ctrl/Cmd + S", "download the design file"],
  ["Esc", "clear the selection"],
];

let dialog = null;
export function showHelp() {
  if (!dialog) {
    dialog = h("dialog", { class: "help-dialog" },
      h("div", { class: "help-head" }, h("h2", {}, "Help"),
        h("button", { type: "button", onclick: () => { dialog.close(); startTour(); } }, "Take the tour"),
        h("button", { type: "button", class: "primary", onclick: () => dialog.close() }, "Close")),
      h("h3", {}, "Building a network"),
      h("p", {}, "Drag tanks, junctions, pumps and valves from the left onto the canvas. Drag from a port (a small circle) on one component to a port on another to join them with a pipe. Click anything to edit it on the right. The network is solved after every change, so there is no Solve button; the Messages tab says what is missing when it cannot be solved."),
      h("p", {}, "A pipe of length zero with no fittings is a plain connection with no loss. A pump or valve needs a pipe on both sides."),
      h("h3", {}, "Reading the results"),
      h("p", {}, "The tabs under the canvas hold a plot for each pump, where the power goes, the costs, a sweep of any one input, the grade lines along a path, the tables, and saved scenarios side by side. The app reports numbers. Deciding what they mean for the design is your part."),
      h("h3", {}, "Keyboard and mouse"),
      h("table", { class: "keys" }, KEYS.map(([k, what]) => h("tr", {}, h("th", {}, k), h("td", {}, what)))),
      h("h3", {}, "Glossary"),
      h("dl", {}, GLOSSARY.flatMap(([, name, text]) => [h("dt", {}, name), h("dd", {}, text)])));
    document.body.append(dialog);
    dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });
  }
  dialog.showModal();
}

// ---------------------------------------------------------------------------
// The tour: a few cards, each pointing at one part of the page
// ---------------------------------------------------------------------------

const STEPS = [
  ["#palette", "Components", "Drag a tank, junction, pump or valve onto the canvas. Text adds a note of your own to the drawing."],
  ["#canvas", "The canvas", "Drag from a port (a small circle) to another port to draw a pipe. Drag components to move them, drag the background to pan, scroll to zoom. Shift+click selects several things; Ctrl/Cmd+D duplicates them."],
  ["#panel", "Properties", "Click a component or a pipe and its properties appear here. With nothing selected, this is where the water temperature, the atmospheric pressure and your name go."],
  ["#tabs", "Results", "The network is solved after every change. These tabs hold the messages, pump plots, power and cost, a sweep of any one input, grade lines, tables and scenarios."],
  ["#btn-download", "Your file", "Download design saves everything in one file. That file is what you submit, and Open design reads it back. The app also autosaves in this browser."],
];
const TOUR_KEY = "mcen3021-pipe-network:tour-seen";

export function startTour() {
  let i = 0;
  const ring = h("div", { class: "tour-ring" });
  const title = h("h3", {}), text = h("p", {}), count = h("span", { class: "sub" });
  const next = h("button", { type: "button", class: "primary" }, "Next");
  const skip = h("button", { type: "button" }, "Skip");
  const card = h("div", { class: "tour-card", role: "dialog", "aria-label": "Tour" }, title, text, h("div", { class: "tour-foot" }, count, skip, next));
  const end = () => {
    ring.remove(); card.remove();
    window.removeEventListener("keydown", onKey, true);
    try { localStorage.setItem(TOUR_KEY, "1"); } catch { /* fine */ }
  };
  const show = () => {
    const [selector, name, body] = STEPS[i];
    const box = document.querySelector(selector).getBoundingClientRect();
    Object.assign(ring.style, { left: `${box.left - 3}px`, top: `${box.top - 3}px`, width: `${box.width + 6}px`, height: `${box.height + 6}px` });
    title.textContent = name; text.textContent = body;
    count.textContent = `${i + 1} of ${STEPS.length}`;
    next.textContent = i === STEPS.length - 1 ? "Done" : "Next";
    // Put the card beside the box where there is room, otherwise inside it.
    const cw = 300, ch = 190, vw = window.innerWidth, vh = window.innerHeight;
    let left, top = Math.min(vh - ch - 10, Math.max(10, box.top + 16));
    if (box.right + cw + 16 < vw) left = box.right + 12;
    else if (box.left - cw - 16 > 0) left = box.left - cw - 12;
    else { left = Math.min(vw - cw - 10, box.left + 20); top = box.top - ch - 10 > 0 ? box.top - ch - 10 : Math.min(vh - ch - 10, box.top + 40); }
    Object.assign(card.style, { left: `${left}px`, top: `${top}px` });
  };
  const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); end(); } };
  next.onclick = () => { if (++i >= STEPS.length) end(); else show(); };
  skip.onclick = end;
  window.addEventListener("keydown", onKey, true);
  document.body.append(ring, card);
  show();
}

// Run the tour once, on the first visit to an empty app.
export function maybeFirstTour() {
  try {
    if (localStorage.getItem(TOUR_KEY)) return;
  } catch { return; } // no storage: we could not remember, so do not nag
  startTour();
}
