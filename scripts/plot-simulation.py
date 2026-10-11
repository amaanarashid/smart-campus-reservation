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

# ---------------------------------------------------------------- sensitivity
# (a) demand, (b) student behaviour, (c) preference change, (d) LinUCB variants
fig, axes = plt.subplots(2, 2, figsize=(13, 8.6))

ax = axes[0][0]
busy = [100 * d["busy"] for d in summary["demand"]]
for p in POLICIES:
    ms = [100 * d[p]["mean"] for d in summary["demand"]]
    lo = [100 * d[p]["lo"] for d in summary["demand"]]
    hi = [100 * d[p]["hi"] for d in summary["demand"]]
    ax.plot(busy, ms, STYLE[p], marker="o", color=COLOR[p], lw=2.2 if p == "linucb" else 1.5, label=LABEL[p])
    if p in ("fixed", "linucb"):
        ax.fill_between(busy, lo, hi, color=COLOR[p], alpha=0.12)
ax.set_xlabel("Court-hours already booked (%)")
ax.set_ylabel("P(student books a suggestion) (%)")
ax.set_title("(a) Demand: the gain shrinks when little is free", fontsize=11, loc="left")
ax.grid(alpha=0.25)

ax = axes[0][1]
beh = summary["behaviour"]
width = 0.2
for i, p in enumerate(POLICIES):
    ms = [100 * b[p]["mean"] for b in beh]
    errs = [[100 * (b[p]["mean"] - b[p]["lo"]) for b in beh], [100 * (b[p]["hi"] - b[p]["mean"]) for b in beh]]
    ax.bar([j + (i - 1.5) * width for j in range(len(beh))], ms, width, yerr=errs, capsize=3,
           color=COLOR[p], edgecolor="white", linewidth=0.6)
ax.set_xticks(range(len(beh)))
ax.set_xticklabels(["Reads all\nfour cards", "Skims\n(may stop early)", "Changes preference\nat attempt 40"])
ax.set_ylim(0, 100)
ax.set_ylabel("P(student books a suggestion) (%)")
ax.set_title("(b) Student behaviour, last 20 attempts", fontsize=11, loc="left")
ax.grid(axis="y", alpha=0.25)

ax = axes[1][0]
drift = defaultdict(lambda: ([], []))
for r in csv.DictReader(open(OUT / "drift-curve.csv")):
    drift[r["policy"]][0].append(int(r["attempt"]))
    drift[r["policy"]][1].append(100 * float(r["value"]))
for p in POLICIES:
    xs, ys = drift[p]
    ax.plot(xs, smooth(ys), STYLE[p], color=COLOR[p], lw=2.2 if p == "linucb" else 1.5)
ax.axvline(40, color="#555", lw=1, ls=":")
ax.text(41, ax.get_ylim()[0] + 1, "preference changes", fontsize=8.5, color="#555")
ax.set_xlabel("Booking attempts by the same student")
ax.set_ylabel("P(student books a suggestion) (%)")
ax.set_title("(c) When a student's taste changes, LinUCB re-learns slowly", fontsize=11, loc="left")
ax.grid(alpha=0.25)

ax = axes[1][1]
variants = [("fixed", "Fixed weights"), ("linucb", "LinUCB (deployed,\npool of 6)"),
            ("linucb_reject", "LinUCB + learns from\n'booked nothing'"), ("linucb_wide", "LinUCB with\npool of 12")]
ov = summary["overall"]
vals = [ov[k]["value_last20"] for k, _ in variants]
ax.bar(range(len(variants)), [100 * v["mean"] for v in vals],
       yerr=[[100 * (v["mean"] - v["lo"]) for v in vals], [100 * (v["hi"] - v["mean"]) for v in vals]],
       capsize=4, color=[COLOR["fixed"], COLOR["linucb"], "#c9706f", "#5c1416"], edgecolor="white")
for i, v in enumerate(vals):
    ax.text(i, 100 * v["hi"] + 1, f"{100 * v['mean']:.1f}%", ha="center", fontsize=9)
ax.set_xticks(range(len(variants)))
ax.set_xticklabels([l for _, l in variants], fontsize=8.5)
ax.set_ylim(0, 100)
ax.set_ylabel("P(student books a suggestion) (%)")
ax.set_title("(d) Variants of LinUCB on the same requests", fontsize=11, loc="left")
ax.grid(axis="y", alpha=0.25)

handles, labels = axes[0][0].get_legend_handles_labels()
fig.legend(handles, labels, loc="lower center", ncol=4, fontsize=9, frameon=False)
fig.tight_layout(rect=(0, 0.04, 1, 1))
fig.savefig(OUT / "sensitivity.png", dpi=200)

# ---------------------------------------------------------------- seeds
seeds = summary["seeds"]["runs"]
fig, ax = plt.subplots(figsize=(8, 3.6))
for i, p in enumerate(POLICIES):
    ys = [100 * s[p] for s in seeds]
    ax.scatter([i] * len(ys), ys, color=COLOR[p], s=28, alpha=0.8, zorder=3)
    ax.hlines(sum(ys) / len(ys), i - 0.25, i + 0.25, color=COLOR[p], lw=2)
ax.set_xticks(range(len(POLICIES)))
ax.set_xticklabels([LABEL[p] for p in POLICIES], fontsize=9)
ax.set_ylabel("P(books), last 20 attempts (%)")
ax.set_title(f"Repeated with {len(seeds)} random seeds - each dot is one full run", fontsize=11, loc="left")
ax.grid(axis="y", alpha=0.25)
fig.tight_layout()
fig.savefig(OUT / "seeds.png", dpi=200)

print("wrote learning-curves.png, by-student-type.png, sensitivity.png and seeds.png in", OUT)
