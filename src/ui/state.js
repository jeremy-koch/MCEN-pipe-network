// state.js -- the one shared state object of the app, plus undo/redo and
// autosave. Every other UI file reads S and calls changed() after it edits
// S.design.

import { analyze } from "../solver/analyze.js";
import { newDesign, loadDesign } from "../solver/design.js";

export const S = {
  design: newDesign(),
  sel: null, // { kind: "comp" | "pipe" | "label", id } or null: what the property panel shows
  also: [], // ids of anything else selected with it (Shift+click, or Shift+drag a box)
  view: { x: 0, y: 0, k: 1 }, // pan (screen px) and zoom of the canvas
  result: analyze(newDesign()),
  pipeMode: false, // the Pipe tool: drag from any component to draw a pipe
  tab: "messages",
  storageOk: true,
  // How the solved diagram is drawn. Kept in the browser, not in the design.
  show: { color: "none", width: true, animate: true },
  sweep: { target: null, output: null, lo: null, hi: null, steps: 25 }, // the Sweep tab
  grade: { from: null, to: null }, // the Grade line tab
};

const VIEW_KEY = "mcen3021-pipe-network:view";
try {
  Object.assign(S.show, JSON.parse(localStorage.getItem(VIEW_KEY)) || {});
} catch { /* no storage, or nothing saved: keep the defaults */ }
export function saveView() {
  try { localStorage.setItem(VIEW_KEY, JSON.stringify(S.show)); } catch { /* fine */ }
}

const STORAGE_KEY = "mcen3021-pipe-network:autosave";

// --- rendering is done by app.js, which registers itself here --------------
let renderFn = () => {};
export function onRender(fn) { renderFn = fn; }
export function render(what = {}) { renderFn(what); }

// --- undo / redo -----------------------------------------------------------
// The stacks hold whole designs as JSON text. Designs are small.
let undoStack = [];
let redoStack = [];
let lastJson = JSON.stringify(S.design);
let lastKey = null;

export const canUndo = () => undoStack.length > 0;
export const canRedo = () => redoStack.length > 0;

function solve() {
  try {
    S.result = analyze(S.design);
  } catch (err) {
    console.error(err);
    S.result = {
      status: "error", notes: [], pipes: {}, comps: {}, totals: null, lowP: [],
      errors: [{ text: "The app hit an internal error while solving this network (" + err.message + "). Please send the design file to your instructor.", ids: [] }],
    };
  }
}

function autosave() {
  try {
    localStorage.setItem(STORAGE_KEY, lastJson);
    S.storageOk = true;
  } catch {
    S.storageOk = false; // private window, storage full, ... the app still works
  }
}

// Call after editing S.design. `key` groups edits into one undo step: typing
// in the same field several times in a row undoes all at once.
//   opts.keepPanel: do not rebuild the property panel (the student is typing in it)
export function changed(key = null, opts = {}) {
  const json = JSON.stringify(S.design);
  if (json !== lastJson) {
    if (!(key && key === lastKey)) undoStack.push(lastJson);
    if (undoStack.length > 200) undoStack.shift();
    redoStack = [];
    lastJson = json;
    lastKey = key;
    autosave();
  }
  solve();
  render(opts);
}

function restore(json) {
  S.design = JSON.parse(json);
  lastJson = json;
  lastKey = null;
  if (S.sel && !findSelected()) S.sel = null;
  S.also = S.also.filter((id) => kindOf(id));
  autosave();
  solve();
  render();
}

export function undo() {
  if (!undoStack.length) return;
  redoStack.push(lastJson);
  restore(undoStack.pop());
}

export function redo() {
  if (!redoStack.length) return;
  undoStack.push(lastJson);
  restore(redoStack.pop());
}

// Swap in a whole new design (New, Open, Examples, loading a scenario).
// It is one undoable step.
export function replaceDesign(design) {
  S.design = design;
  S.sel = null;
  S.also = [];
  changed();
}

// Select one thing (or nothing). With `add`, toggle it in or out of the
// selection that is already there.
export function select(sel, add = false) {
  if (!add || !sel || !S.sel) {
    S.sel = sel;
    S.also = [];
  } else if (S.sel.id === sel.id) {
    const next = S.also.shift();
    S.sel = next ? { kind: kindOf(next), id: next } : null;
  } else if (S.also.includes(sel.id)) {
    S.also = S.also.filter((id) => id !== sel.id);
  } else {
    S.also.push(S.sel.id);
    S.sel = sel;
  }
  lastKey = null;
  render();
}

// "comp", "pipe" or "label" for an id in the design; null if it is gone.
export function kindOf(id) {
  if (S.design.components.some((c) => c.id === id)) return "comp";
  if (S.design.pipes.some((p) => p.id === id)) return "pipe";
  if ((S.design.labels || []).some((t) => t.id === id)) return "label";
  return null;
}

// Every selected id: the main one first.
export function selectedIds() {
  return S.sel ? [S.sel.id, ...S.also] : [];
}

export function findSelected() {
  if (!S.sel) return null;
  const list = { pipe: S.design.pipes, label: S.design.labels || [], comp: S.design.components }[S.sel.kind];
  return list.find((c) => c.id === S.sel.id) || null;
}

// Read the autosaved design, if there is a usable one.
export function loadAutosave() {
  try {
    const text = localStorage.getItem(STORAGE_KEY);
    if (!text) return false;
    S.design = loadDesign(JSON.parse(text));
    lastJson = JSON.stringify(S.design);
    solve();
    return true;
  } catch {
    return false;
  }
}

// Start from a design without making it an undo step (used once at startup).
export function startWith(design) {
  S.design = design;
  lastJson = JSON.stringify(design);
  undoStack = [];
  redoStack = [];
  autosave();
  solve();
}
