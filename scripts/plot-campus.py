"""Figures for the campus-level simulation.

    python scripts/plot-campus.py

Reads docs/simulation/campus/ (written by simulate-campus.ts) and writes three
PNGs for the report into the same folder.
"""
import csv
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

OUT = Path("docs/simulation/campus")
S = json.load(open(OUT / "summary.json"))
POLICIES = ["none", "manual", "fixed", "linucb"]
LABEL = {"none": "No help (turned away)", "manual": "Student searches by hand",
         "fixed": "Suggestions, fixed weights", "linucb": "Suggestions, LinUCB (deployed)"}
COLOR = {"none": "#2a78d6", "manual": "#eb6834", "fixed": "#1baf7a", "linucb": "#9e2a2b"}
STYLE = {"none": ":", "manual": "--", "fixed": "-.", "linucb": "-"}
INK, MUTED, GRID = "#0b0b0b", "#52514e", "#e4e3df"

plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 10, "axes.edgecolor": GRID,
                     "axes.labelcolor": MUTED, "xtick.color": MUTED, "ytick.color": MUTED,
                     "axes.spines.top": False, "axes.spines.right": False})
main = S["main"]["summary"]
cfg = S["settings"]["main"]
seeds = S["settings"]["seeds_main"]
sub = f'{cfg["weeks"]} weeks, {cfg["students"]} simulated students, {cfg["courts"]} courts, mean of {seeds} runs'

# 1. what happens to a request ------------------------------------------------
fig, ax = plt.subplots(figsize=(9, 3.6))
parts = [("first_choice", "Got the slot asked for", "#33415c", "white"),
         ("redirected", "Booked an alternative", "#8fa0c2", INK),
         ("turned_away", "Turned away", "#dddcd7", INK)]
ys = list(range(len(POLICIES)))[::-1]
left = [0.0] * len(POLICIES)
for key, lab, col, txt in parts:
    vals = [100 * main[p][key]["mean"] for p in POLICIES]
    ax.barh(ys, vals, left=left, height=0.62, color=col, edgecolor="white", linewidth=2, label=lab)
    for y, v, l in zip(ys, vals, left):
        if v >= 4:
            ax.text(l + v / 2, y, f"{v:.0f}%", ha="center", va="center", color=txt, fontsize=9.5)
    left = [l + v for l, v in zip(left, vals)]
ax.set_yticks(ys)
ax.set_yticklabels([LABEL[p] for p in POLICIES], color=INK)
ax.set_xlim(0, 100)
ax.set_xlabel("Share of booking requests (%)")
ax.tick_params(length=0)
ax.spines["left"].set_visible(False)
ax.legend(loc="lower center", bbox_to_anchor=(0.5, 1.0), ncol=3, frameon=False, fontsize=9)
fig.suptitle(f"What happens to a booking request - {sub}", fontsize=10.5, x=0.01, ha="left", color=INK)
fig.tight_layout(rect=(0, 0, 1, 0.94))
fig.savefig(OUT / "campus-outcomes.png", dpi=200)

# 2. where the bookings land --------------------------------------------------
rows = list(csv.DictReader(open(OUT / "hourly-load.csv")))
hours = [int(r["hour"]) for r in rows]
fig, ax = plt.subplots(figsize=(9, 4.2))
peaks = S["settings"]["true_peak_hours"]
for h in peaks:
    ax.axvspan(h - 0.5, h + 0.5, color="#f3f1ec", zorder=0)
for p in POLICIES:
    ax.plot(hours, [100 * float(r[p]) for r in rows], STYLE[p], color=COLOR[p],
            lw=2.4 if p == "linucb" else 1.8, marker="o", ms=4, label=LABEL[p])
ax.set_xticks(hours)
ax.set_xticklabels([f"{h}:00" for h in hours], fontsize=8.5)
ax.set_ylim(0, 100)
ax.set_ylabel("Court-hours booked (%)")
ax.set_xlabel("Hour of day (shaded = hours students ask for most)")
ax.grid(axis="y", color=GRID, lw=0.8)
ax.legend(loc="lower center", bbox_to_anchor=(0.5, 1.0), ncol=2, frameon=False, fontsize=9)
fig.suptitle(f"How full the courts are, hour by hour - {sub}", fontsize=10.5, x=0.01, ha="left", color=INK)
fig.tight_layout(rect=(0, 0, 1, 0.95))
fig.savefig(OUT / "campus-hourly.png", dpi=200)

# 3. demand -------------------------------------------------------------------
fig, ax = plt.subplots(figsize=(9, 4.2))
xs = [d["demand"] for d in S["demand"]]
for p in POLICIES:
    ys_ = [100 * d["summary"][p]["served"]["mean"] for d in S["demand"]]
    lo = [100 * d["summary"][p]["served"]["lo"] for d in S["demand"]]
    hi = [100 * d["summary"][p]["served"]["hi"] for d in S["demand"]]
    ax.fill_between(xs, lo, hi, color=COLOR[p], alpha=0.12, lw=0)
    ax.plot(xs, ys_, STYLE[p], color=COLOR[p], lw=2.4 if p == "linucb" else 1.8, marker="o", ms=4, label=LABEL[p])
last = S["demand"][-1]["summary"]
ax.annotate("by hand, fixed and LinUCB\nare within 1 point of each other", (xs[-1], 100 * last["linucb"]["served"]["mean"]),
            xytext=(-8, 26), textcoords="offset points", ha="right", fontsize=9, color=MUTED)
ax.annotate("no help", (xs[-1], 100 * last["none"]["served"]["mean"]),
            xytext=(-8, -16), textcoords="offset points", ha="right", fontsize=9, color=MUTED)
ax.set_xticks(xs)
ax.set_xticklabels([f"{int(100 * x)}%" for x in xs])
ax.set_ylim(40, 100)
ax.set_ylabel("Requests that end in a booking (%)")
ax.set_xlabel("Weekly requests as a share of the court-hours available")
ax.grid(axis="y", color=GRID, lw=0.8)
ax.legend(loc="lower center", bbox_to_anchor=(0.5, 1.0), ncol=2, frameon=False, fontsize=9)
fig.suptitle(f'Requests served as demand rises - mean of {S["settings"]["seeds_side"]} runs per level, band = 95% CI',
             fontsize=10.5, x=0.01, ha="left", color=INK)
fig.tight_layout(rect=(0, 0, 1, 0.95))
fig.savefig(OUT / "campus-demand.png", dpi=200)
print("wrote campus-outcomes.png, campus-hourly.png, campus-demand.png")
