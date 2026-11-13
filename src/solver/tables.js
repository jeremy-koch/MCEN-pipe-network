// tables.js -- the lookup tables of the course toolbox.
//
// These are copied from reference/pipeflow.py (ROUGHNESS, FITTINGS and
// PUMP_CATALOG_SPECS). tests/tables.test.js does not check them against the
// Python file automatically, so if the Python tables change, change these
// too. The "label" fields are only what the app shows in its menus.

export const G = 9.81; // m/s^2, same value as the Python toolbox

// Absolute roughness epsilon [m] for common pipe materials.
export const ROUGHNESS = {
  drawn_tubing:     { eps: 1.5e-6, label: "drawn tubing" },
  commercial_steel: { eps: 4.5e-5, label: "commercial steel" },
  galvanized_iron:  { eps: 1.5e-4, label: "galvanized iron" },
  cast_iron:        { eps: 2.6e-4, label: "cast iron" },
  concrete:         { eps: 1.0e-3, label: "concrete" },
  riveted_steel:    { eps: 3.0e-3, label: "riveted steel" },
  pvc:              { eps: 1.5e-6, label: "PVC" },
  copper:           { eps: 1.5e-6, label: "copper" },
  smooth:           { eps: 0.0,    label: "smooth (ε = 0)" },
};

// Loss coefficients K. h_minor = K V^2 / (2g), V = speed in the pipe.
export const FITTINGS = {
  elbow_90_standard:    { K: 0.9,  label: "90° elbow, standard" },
  elbow_90_long_radius: { K: 0.6,  label: "90° elbow, long radius" },
  elbow_45:             { K: 0.4,  label: "45° elbow" },
  tee_line_flow:        { K: 0.2,  label: "tee, flow along the run" },
  tee_branch_flow:      { K: 1.0,  label: "tee, flow out the branch" },
  return_bend_180:      { K: 1.5,  label: "180° return bend" },
  gate_valve_open:      { K: 0.15, label: "gate valve, open" },
  gate_valve_half:      { K: 2.1,  label: "gate valve, half open" },
  globe_valve_open:     { K: 10.0, label: "globe valve, open" },
  angle_valve_open:     { K: 2.0,  label: "angle valve, open" },
  ball_valve_open:      { K: 0.05, label: "ball valve, open" },
  check_valve_swing:    { K: 2.0,  label: "swing check valve" },
  entrance_sharp:       { K: 0.5,  label: "entrance, sharp-edged" },
  entrance_reentrant:   { K: 0.8,  label: "entrance, re-entrant" },
  entrance_rounded:     { K: 0.03, label: "entrance, rounded" },
  exit:                 { K: 1.0,  label: "exit (into a tank)" },
  strainer:             { K: 2.0,  label: "strainer" },
  flow_meter_orifice:   { K: 2.5,  label: "orifice flow meter" },
};

// The course pump catalog. H = h0 - a Q^2 and NPSHr = n0 + n1 Q^2, with H in
// m and Q in m^3/s. Prices are teaching props.
export const PUMP_CATALOG = {
  "GN-25":  { name: 'GN-25 "Gopher"',   h0: 18, a: 2.0e5, eta: 0.58, n0: 1.0, n1: 1.5e4, rpm: 1750, price: 1400 },
  "GN-40":  { name: 'GN-40 "Badger"',   h0: 28, a: 1.1e5, eta: 0.66, n0: 1.2, n1: 1.2e4, rpm: 1750, price: 2300 },
  "CV-50":  { name: 'CV-50 "Coyote"',   h0: 38, a: 7.0e4, eta: 0.78, n0: 1.2, n1: 1.0e4, rpm: 1750, price: 3200 },
  "CV-80":  { name: 'CV-80 "Elk"',      h0: 52, a: 3.5e4, eta: 0.74, n0: 1.8, n1: 6.5e3, rpm: 1750, price: 5600 },
  "HS-120": { name: 'HS-120 "Bighorn"', h0: 85, a: 2.8e4, eta: 0.70, n0: 2.6, n1: 3.4e3, rpm: 3500, price: 9800 },
  "MF-200": { name: 'MF-200 "Moose"',   h0: 16, a: 6.0e1, eta: 0.80, n0: 2.0, n1: 8.0,   rpm: 960,  price: 11500 },
  "AX-350": { name: 'AX-350 "Pelican"', h0: 7,  a: 4.8,   eta: 0.76, n0: 1.5, n1: 1.2,   rpm: 705,  price: 14800 },
  "AX-600": { name: 'AX-600 "Heron"',   h0: 5,  a: 0.85,  eta: 0.72, n0: 1.4, n1: 0.4,   rpm: 590,  price: 21000 },
};
