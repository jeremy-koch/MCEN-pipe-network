"""
make_referee.py -- regenerate the referee numbers the JavaScript solver is
tested against.

Run from the repo root (needs numpy and scipy):

    python reference/make_referee.py

It writes reference/referee.json. The tests in tests/ read that file, so
never edit the JSON by hand: change this script (or pipeflow.py) and rerun.

Everything here is computed by reference/pipeflow.py, a copy of the course
repo's src/fluidtools/pipeflow.py. Water at 20 C throughout.
"""

import json
import os
import sys

import numpy as np
from scipy.optimize import brentq

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import pipeflow as pf  # noqa: E402

G = pf.G
W = pf.water(20.0)
out = {"fluid": {"T": 20.0, "rho": W.rho, "mu": W.mu, "pv": W.pv}}

# --- spot checks of the correlations themselves -----------------------------
out["friction"] = [
    {"Re": Re, "rr": rr, "f": pf.friction_factor(Re, rr)}
    for Re in (500.0, 2000.0, 5000.0, 1e5, 3e6)
    for rr in (0.0, 1e-4, 2.6e-3)
]
out["water"] = [
    {"T": T, "rho": pf.water(T).rho, "mu": pf.water(T).mu, "pv": pf.water(T).pv}
    for T in (0.0, 5.0, 20.0, 40.0, 60.0, 80.0, 100.0)
]

# --- gravity drain ----------------------------------------------------------
s = pf.PipeSystem(W, z1=15.0, z2=0.0)
p = pf.Pipe(L=200, D=0.10, roughness="cast_iron")
p.add_fitting("entrance_sharp").add_fitting("elbow_90_standard", n=4).add_fitting("exit")
s.add(p)
out["gravity_drain"] = {"Q": s.solve_flow()}

# --- parallel pipes ---------------------------------------------------------
A = pf.Pipe(L=100, D=0.05, roughness="commercial_steel")
B = pf.Pipe(L=40, D=0.04, roughness="commercial_steel")
par = pf.Parallel([A, B])
QA, QB = par.flow_split(0.010, W)
out["parallel_pipes"] = {"Q_total": 0.010, "QA": QA, "QB": QB,
                         "h": par.head_loss(0.010, W)}


# --- simple lift ------------------------------------------------------------
def lift_pump():
    return pf.Pump.from_coeffs(30.0, 9e4, efficiency=0.70, z=1.0,
                               npsh_r=lambda Q: 1.5 + 4e3 * Q**2)


def lift(pump, patm=83e3):
    s = pf.PipeSystem(W, z1=0.0, z2=12.0, patm=patm)
    suction = pf.Pipe(L=5, D=0.08, roughness="commercial_steel")
    suction.add_fitting("entrance_sharp").add_fitting("strainer")
    discharge = pf.Pipe(L=60, D=0.08, roughness="commercial_steel")
    discharge.add_fitting("elbow_90_standard", n=4)
    discharge.add_fitting("check_valve_swing").add_fitting("exit")
    s.add(suction, pump, discharge)
    return s


one = lift(lift_pump())
Q1 = one.solve_flow()
pump1 = one.pumps[0]
out["simple_lift"] = {
    "one_pump": {
        "Q": Q1,
        "head": pump1.head(Q1),
        "power": pump1.power(Q1, W),
        "npsha_83": one.npsh_available(Q1),
        "npshr": pump1.npsh_required(Q1),
        "npsha_101": lift(lift_pump(), patm=101325.0).npsh_available(Q1),
    },
    "two_parallel": {
        "Q": lift(pf.PumpsInParallel([lift_pump(), lift_pump()])).solve_flow()},
    "two_series": {
        "Q": lift(pf.PumpsInSeries([lift_pump(), lift_pump()])).solve_flow()},
    "speed_80": {"Q": lift(lift_pump().at_speed(0.8)).solve_flow()},
}

# --- three-pump station -----------------------------------------------------
# The referee has no valve component, so the valve loss K V^2/2g on each
# 0.10 m pump line is folded into that pump's curve to find the FLOW. The
# shaft power is then computed from the pump's own head (the valve loss is
# NOT subtracted), which is what the app reports.
ELK = pf.PUMP_CATALOG_SPECS['CV-80  "Elk"']
h0, a, eta = ELK[0], ELK[1], ELK[2]
A_line = np.pi * 0.10**2 / 4.0


def station(n_pumps, K):
    kq = K / (2 * G * A_line**2)        # valve loss = kq * Q^2
    throttled = [pf.Pump.from_coeffs(h0, a + kq, efficiency=eta)
                 for _ in range(n_pumps)]
    s = pf.PipeSystem(W, z1=0.0, z2=25.0, patm=83e3)
    header = pf.Pipe(L=250, D=0.20, roughness="commercial_steel")
    header.add_fitting("elbow_90_standard", n=6)
    header.add_fitting("check_valve_swing").add_fitting("exit")
    s.add(pf.PumpsInParallel(throttled), header)
    return s


def station_case(n_pumps, K):
    Q = station(n_pumps, K).solve_flow()
    q_each = Q / n_pumps
    head_true = h0 - a * q_each**2                       # pump's own head
    power = n_pumps * W.rho * G * q_each * head_true / eta
    return {"n": n_pumps, "K": K, "Q": Q, "Q_each": q_each,
            "pump_head": head_true, "power_true": power}


out["station"] = {
    "cases": [station_case(3, 0.15), station_case(3, 20.0), station_case(2, 0.15)],
    "K_for_60_Ls": brentq(lambda K: station(3, K).solve_flow() - 0.060, 0.15, 200.0),
}

path = os.path.join(HERE, "referee.json")
with open(path, "w") as fh:
    json.dump(out, fh, indent=2)
    fh.write("\n")

# A short printout to compare against the table in CLAUDE.md.
sl = out["simple_lift"]["one_pump"]
print(f"gravity drain      Q = {out['gravity_drain']['Q']*1e3:.2f} L/s")
print(f"parallel pipes     A = {QA*1e3:.3f}  B = {QB*1e3:.3f} L/s   h = {out['parallel_pipes']['h']:.2f} m")
print(f"simple lift        Q = {sl['Q']*1e3:.2f} L/s  head = {sl['head']:.2f} m  power = {sl['power']/1e3:.2f} kW")
print(f"   NPSHa 83 kPa = {sl['npsha_83']:.2f} m (required {sl['npshr']:.2f})   101.325 kPa = {sl['npsha_101']:.2f} m")
print(f"   parallel {out['simple_lift']['two_parallel']['Q']*1e3:.2f}   series {out['simple_lift']['two_series']['Q']*1e3:.2f}"
      f"   80% speed {out['simple_lift']['speed_80']['Q']*1e3:.2f} L/s")
for c in out["station"]["cases"]:
    print(f"station  {c['n']} pumps  K = {c['K']:<5}  Q = {c['Q']*1e3:.1f} L/s   power = {c['power_true']/1e3:.1f} kW")
print(f"station  K for 60 L/s = {out['station']['K_for_60_Ls']:.1f}")
print("wrote", path)
