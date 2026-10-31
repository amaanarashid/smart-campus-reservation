"""Figure for the no-show simulation (SIMULATED data).

    python scripts/plot-noshow.py

Reads docs/evaluation/noshow-sim.json (written by
scripts/eval/noshow-simulate.ts) and writes
docs/evaluation/noshow-sim-calibration.png: a calibration plot on the test
set (newest 20%) plus test AUC against the baselines.
"""
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

OUT = Path("docs/evaluation")
sim = json.load(open(OUT / "noshow-sim.json"))
test = sim["test"]

SERIES = [("logreg", "Logistic model", "#9e2a2b", "-", "o"),
          ("baseline", "Cold-start baseline", "#ff9f1c", "--", "s"),
          ("user_rate", "Student rate only", "#1f77b4", "-.", "^")]

fig, (ax, bx) = plt.subplots(1, 2, figsize=(11, 4.6), gridspec_kw={"width_ratios": [1.15, 1]})

ax.plot([0, 1], [0, 1], color="#9aa0a6", ls=":", lw=1, label="Perfect calibration")
for key, label, color, ls, mk in SERIES:
    bins = [b for b in test[key]["calibration"] if b["n"] > 0]
    ax.plot([b["mean_p"] for b in bins], [b["rate"] for b in bins], color=color, ls=ls, marker=mk, label=label)
    for b in bins if key == "logreg" else []:
        ax.annotate(f"n={b['n']}", (b["mean_p"], b["rate"]), textcoords="offset points", xytext=(6, -10), fontsize=7, color=color)
ax.set_xlim(0, 1); ax.set_ylim(0, 1)
ax.set_xlabel("Predicted no-show probability (bin average)")
ax.set_ylabel("Observed no-show rate")
ax.set_title("Calibration on the test set (5 bins)")
ax.legend(fontsize=8, loc="upper left")
ax.grid(alpha=0.25)

names = [("campus", "Campus rate"), ("category", "Room type rate"), ("user_rate", "Student rate"),
         ("baseline", "Baseline"), ("logreg", "Logistic model")]
aucs = [test[k]["auc"] for k, _ in names] + [sim["oracle_true_p"]["auc"]]
labels = [n for _, n in names] + ["True p (ceiling)"]
colors = ["#9aa0a6", "#9aa0a6", "#1f77b4", "#ff9f1c", "#9e2a2b", "#d0d0d0"]
bars = bx.barh(labels, aucs, color=colors)
for bar, v in zip(bars, aucs):
    bx.text(v + 0.005, bar.get_y() + bar.get_height() / 2, f"{v:.3f}", va="center", fontsize=8)
bx.axvline(0.5, color="#9aa0a6", ls=":", lw=1)
bx.set_xlim(0.4, 0.85)
bx.set_xlabel("Test AUC (higher is better)")
bx.set_title("Ranking no-shows vs baselines")

fig.suptitle(f"SIMULATED - {sim['students']} students, {sim['weeks']} weeks, {sim['bookings']} bookings "
             f"({100 * sim['no_show_rate']:.1f}% no-shows); time-based split, newest 20% tested",
             fontsize=10)
fig.tight_layout()
fig.savefig(OUT / "noshow-sim-calibration.png", dpi=160)
print("wrote", OUT / "noshow-sim-calibration.png")
