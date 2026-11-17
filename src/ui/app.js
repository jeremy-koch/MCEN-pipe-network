// app.js -- starts the app and wires the toolbar, the palette and the
// keyboard to the rest.

import { S, onRender, changed, undo, redo, canUndo, canRedo, replaceDesign, loadAutosave, startWith, select, saveView } from "./state.js";
import { newDesign, loadDesign } from "../solver/design.js";
import { EXAMPLES, HIDDEN_EXAMPLES } from "../examples.js";
import { initCanvas, renderCanvas, addAtClient, addAtCenter, deleteSelected, rotateSelected, zoomBy, fitView,
  copySelected, pasteClipboard, duplicateSelected, selectAll, diagramDrawing } from "./canvas.js";
import { saveSvg, savePng, downloadBlob, fileName } from "./export.js";
import { showHelp, maybeFirstTour } from "./help.js";
import { initPanel, renderPanel } from "./panel.js";
import { initResults, renderResults } from "./results.js";
import { h } from "./util.js";

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------
// Rendering: everything is redrawn from S after each change
// ---------------------------------------------------------------------------

let panelFor = null; // what the property panel currently shows

function renderStatus() {
  const r = S.result;
  const el = $("status");
  if (r.status === "solved") {
    const n = r.notes.length;
    el.textContent = "Solved" + (n ? ` · ${n} note${n > 1 ? "s" : ""}` : "");
    el.className = "status ok";
  } else if (r.status === "error") {
    el.textContent = `Not solved · ${r.errors.length} thing${r.errors.length > 1 ? "s" : ""} to fix`;
    el.className = "status todo";
  } else {
    el.textContent = "";
    el.className = "status";
  }
  el.onclick = () => { S.tab = "messages"; renderResults(); };
  $("btn-undo").disabled = !canUndo();
  $("btn-redo").disabled = !canRedo();
  $("pipe-tool").classList.toggle("active", S.pipeMode);
  $("pipe-banner").hidden = !S.pipeMode;
}

onRender((opts = {}) => {
  renderCanvas();
  // Do not rebuild the property panel while the student is typing in it.
  const key = S.sel ? `${S.sel.kind}:${S.sel.id}` : "design";
  if (!(opts.keepPanel && key === panelFor)) { renderPanel(); panelFor = key; }
  renderResults(opts);
  renderStatus();
});

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

function download() {
  const text = JSON.stringify({ ...S.design, saved: new Date().toISOString() }, null, 2);
  downloadBlob(new Blob([text], { type: "application/json" }), `${fileName(S.design.name)}.pipenet.json`);
}

async function openFile(file) {
  try {
    const design = loadDesign(JSON.parse(await file.text()));
    replaceDesign(design);
    fitView();
  } catch (err) {
    const why = err instanceof SyntaxError ? "It is not a valid JSON file." : err.message;
    alert(`Could not open “${file.name}”. ${why}`);
  }
}

// ---------------------------------------------------------------------------
// Palette: drag a tile onto the canvas (or click it)
// ---------------------------------------------------------------------------

function initPalette() {
  for (const tile of document.querySelectorAll(".tile[data-type]")) {
    const type = tile.dataset.type;
    let ghost = null, start = null;
    tile.addEventListener("pointerdown", (e) => {
      start = { x: e.clientX, y: e.clientY };
      tile.setPointerCapture(e.pointerId);
    });
    tile.addEventListener("pointermove", (e) => {
      if (!start) return;
      if (!ghost && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 5) {
        ghost = tile.cloneNode(true);
        ghost.classList.add("ghost");
        document.body.append(ghost);
      }
      if (ghost) { ghost.style.left = `${e.clientX}px`; ghost.style.top = `${e.clientY}px`; }
    });
    const end = (e) => {
      if (!start) return;
      const dragged = !!ghost;
      if (ghost) { ghost.remove(); ghost = null; }
      start = null;
      if (e.type === "pointercancel") return;
      if (dragged) addAtClient(type, e.clientX, e.clientY); else addAtCenter(type);
    };
    tile.addEventListener("pointerup", end);
    tile.addEventListener("pointercancel", end);
  }
  $("pipe-tool").addEventListener("click", () => { S.pipeMode = !S.pipeMode; renderCanvas(); renderStatus(); });
}

// ---------------------------------------------------------------------------
// Toolbar and keyboard
// ---------------------------------------------------------------------------

function initToolbar() {
  $("btn-new").onclick = () => { replaceDesign(newDesign()); fitView(); };
  $("btn-download").onclick = download;
  $("btn-open").onclick = () => $("file-input").click();
  $("file-input").onchange = (e) => { if (e.target.files[0]) openFile(e.target.files[0]); e.target.value = ""; };
  $("btn-undo").onclick = undo;
  $("btn-redo").onclick = redo;
  $("btn-zoom-in").onclick = () => zoomBy(1.25);
  $("btn-zoom-out").onclick = () => zoomBy(0.8);
  $("btn-fit").onclick = fitView;

  $("btn-help").onclick = showHelp;
  const pictures = $("export");
  pictures.onchange = () => {
    const kind = pictures.value;
    pictures.value = "";
    const d = diagramDrawing();
    if (kind === "svg") saveSvg(d.html, d.cls, d.box, `${S.design.name} diagram`);
    else if (kind === "png") savePng(d.html, d.cls, d.box, `${S.design.name} diagram`);
  };

  // How the solved flows are drawn on the diagram.
  const color = $("opt-color"), width = $("opt-width"), animate = $("opt-animate");
  color.value = S.show.color; width.checked = !!S.show.width; animate.checked = !!S.show.animate;
  const apply = () => { S.show = { color: color.value, width: width.checked, animate: animate.checked }; saveView(); renderCanvas(); };
  color.onchange = width.onchange = animate.onchange = apply;

  const menu = $("examples");
  for (const ex of EXAMPLES) menu.append(h("option", { value: ex.key }, ex.label));
  menu.onchange = () => {
    const ex = EXAMPLES.find((x) => x.key === menu.value);
    menu.value = "";
    if (ex) { replaceDesign(ex.make()); fitView(); }
  };

  // Dropping a design file anywhere on the page opens it.
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    const file = e.dataTransfer && e.dataTransfer.files[0];
    if (file) openFile(file);
  });
}

function initKeyboard() {
  window.addEventListener("keydown", (e) => {
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName || "");
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "z") {
      if (typing) return; // let the text box undo its own typing
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
    } else if (mod && e.key.toLowerCase() === "y") {
      if (typing) return;
      e.preventDefault(); redo();
    } else if (mod && e.key.toLowerCase() === "s") {
      e.preventDefault(); download();
    } else if (mod && !typing && "cvda".includes(e.key.toLowerCase())) {
      // copy, paste, duplicate, select all: on the canvas, not in a text box.
      // If some text on the page is highlighted, Ctrl+C copies that as usual.
      if (e.key.toLowerCase() === "c" && String(window.getSelection?.() || "")) return;
      e.preventDefault();
      ({ c: copySelected, v: pasteClipboard, d: duplicateSelected, a: selectAll })[e.key.toLowerCase()]();
    } else if (typing) {
      if (e.key === "Escape") document.activeElement.blur();
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault(); deleteSelected();
    } else if (e.key === "Escape") {
      S.pipeMode = false; select(null);
    } else if (e.key.toLowerCase() === "r" && !mod) {
      rotateSelected();
    }
  });
}

// Drag the top edge of the results panel to make it taller or shorter.
function initResizer() {
  const bar = $("resizer"), workspace = document.querySelector(".workspace");
  const setHeight = (px) => workspace.style.setProperty("--results-h", `${Math.round(px)}px`);
  try {
    const saved = Number(localStorage.getItem("mcen3021-pipe-network:results-height"));
    if (saved > 0) setHeight(Math.min(saved, window.innerHeight - 220));
  } catch { /* no storage: use the default height */ }
  let dragging = false;
  bar.addEventListener("pointerdown", (e) => { dragging = true; bar.setPointerCapture(e.pointerId); });
  bar.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const box = workspace.getBoundingClientRect();
    setHeight(Math.min(box.height - 130, Math.max(90, box.bottom - e.clientY)));
    renderCanvas();
  });
  bar.addEventListener("pointerup", () => {
    dragging = false;
    try { localStorage.setItem("mcen3021-pipe-network:results-height", parseInt(workspace.style.getPropertyValue("--results-h"), 10)); } catch { /* fine */ }
  });
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

function start() {
  initCanvas($("canvas"));
  initPanel($("panel"));
  initResults($("tabs"), $("results-body"));
  initPalette();
  initToolbar();
  initKeyboard();
  initResizer();

  // ?example=lift opens an example instead of the autosaved design.
  const params = new URLSearchParams(location.search);
  const wanted = params.get("example");
  const example = EXAMPLES.find((x) => x.key === wanted)?.make || HIDDEN_EXAMPLES[wanted];
  if (example) startWith(example()); else loadAutosave();
  if (params.get("tab")) S.tab = params.get("tab");

  changed(); // solve and draw
  fitView();
  if (!example && !S.design.components.length) maybeFirstTour();
  window.addEventListener("resize", renderCanvas);
}

start();
