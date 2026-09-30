"""Figures for the recommender simulation.

    python scripts/plot-simulation.py

Reads docs/simulation/learning-curves.csv and summary.json (written by
simulate-recommender.ts) and writes two PNGs for the report.
"""
import csv
import json
from collections import defaultdict
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

OUT = Path("docs/simulation")
POLICIES = ["random", "fixed", "adaptive", "linucb"]
LABEL = {"random": "Random order", "fixed": "Fixed weights (baseline)",
         "adaptive": "Adaptive weights (old rule)", "linucb": "LinUCB (deployed)"}
COLOR = {"random": "#9aa0a6", "fixed": "#1f77b4", "adaptive": "#ff9f1c", "linucb": "#9e2a2b"}
STYLE = {"random": ":", "fixed": "--", "adaptive": "-.", "linucb": "-"}


def smooth(ys, k=7):
    out = []
    for i in range(len(ys)):
        w = ys[max(0, i - k + 1): i + 1]
        out.append(sum(w) / len(w))
    return out


rows = list(csv.DictReader(open(OUT / "learning-curves.csv")))
series = defaultdict(lambda: defaultdict(list))
for r in rows:
    if r["type"] == "all":
        series[r["policy"]]["attempt"].append(int(r["attempt"]))
        for f in ("value", "top", "regret"):
            series[r["policy"]][f].append(float(r[f]))

plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 10})
fig, axes = plt.subplots(1, 3, figsize=(15, 4.4))
panels = [("value", "P(student books a suggestion)", "(a) Suggestions that get booked"),
          ("top", "P(top card is the one booked)", "(b) Best option ranked first"),
          ("regret", "Regret vs oracle (lower is better)", "(c) Distance from perfect ranking")]
for ax, (field, ylabel, title) in zip(axes, panels):
    for p in POLICIES:
        s = series[p]
        ax.plot(s["attempt"], [100 * v for v in smooth(s[field])], STYLE[p],
                color=COLOR[p], lw=2.2 if p == "linucb" else 1.6, label=LABEL[p])
    ax.set_title(title, fontsize=11, loc="left")
    ax.set_xlabel("Booking attempts by the same student")
    ax.set_ylabel(ylabel + " (%)")
    ax.grid(alpha=0.25)
handles, labels = axes[0].get_legend_handles_labels()
fig.legend(handles, labels, loc="lower center", ncol=4, fontsize=9, frameon=False)
fig.suptitle("Recommender learning curves - 240 simulated students x 80 attempts, 7-attempt moving average",
             fontsize=11, x=0.01, ha="left")
fig.tight_layout(rect=(0, 0.07, 1, 1))
fig.savefig(OUT / "learning-curves.png", dpi=200)

summary = json.load(open(OUT / "summary.json"))
types = list(summary["by_type_last20"].keys())
fig, ax = plt.subplots(figsize=(10, 4.4))
width = 0.2
for i, p in enumerate(POLICIES):
    vals = [summary["by_type_last20"][t][p]["value"] for t in types]
    means = [100 * v["mean"] for v in vals]
    errs = [[100 * (v["mean"] - v["lo"]) for v in vals], [100 * (v["hi"] - v["mean"]) for v in vals]]
    xs = [j + (i - 1.5) * width for j in range(len(types))]
    ax.bar(xs, means, width, yerr=errs, capsize=3, color=COLOR[p], label=LABEL[p],
           edgecolor="white", linewidth=0.6)
ax.set_xticks(range(len(types)))
ax.set_xticklabels([t + ("\n(not linear -\nrobustness check)" if t == "exact-only" else "") for t in types])
ax.set_ylabel("P(student books a suggestion) (%)")
ax.set_ylim(0, 105)
ax.set_title("After learning (last 20 attempts), by type of student - bars are 95% confidence intervals",
             fontsize=11, loc="left")
ax.legend(fontsize=8.5, frameon=False, ncol=4, loc="upper center", bbox_to_anchor=(0.5, -0.22))
ax.grid(axis="y", alpha=0.25)
fig.tight_layout()
fig.savefig(OUT / "by-student-type.png", dpi=200)
print("wrote", OUT / "learning-curves.png", "and", OUT / "by-student-type.png")
