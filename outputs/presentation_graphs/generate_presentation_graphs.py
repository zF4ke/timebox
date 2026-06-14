from __future__ import annotations

import json
from collections import Counter, defaultdict
from pathlib import Path

import matplotlib.pyplot as plt
import pandas as pd


ROOT = Path(__file__).resolve().parent
OLD_EXPERIMENT = ROOT / "old_benchmark_unzipped" / "2026-06-04T14-36-55-053Z" / "experiment.json"
NEW_EXPERIMENT = Path(
    r"C:\Users\yFake\AppData\Roaming\timebox\benchmark-results\2026-06-05T08-22-09-929Z-combined\experiment.json"
)
OUT = ROOT / "figures"
OUT.mkdir(parents=True, exist_ok=True)

MODEL_LABELS = {
    "google/gemini-2.5-flash-lite-preview-09-2025": "Gemini 2.5 Flash Lite",
    "google/gemini-3.1-flash-lite-preview": "Gemini 3.1 Flash Lite",
    "deepseek/deepseek-v3.2": "DeepSeek V3.2",
}

MODEL_COLORS = {
    "Gemini 2.5 Flash Lite": "#2563eb",
    "Gemini 3.1 Flash Lite": "#16a34a",
    "DeepSeek V3.2": "#dc2626",
}

MISTAKE_LABELS = {
    "availability_overrun": "Availability overrun",
    "block_after_deadline": "Work after deadline",
    "too_few_work_blocks": "Too few work blocks",
    "late_work_when_avoided": "Late work despite request",
    "final_critical_critiques": "Unresolved critical critiques",
    "max_iterations_fallback": "Max-iteration fallback",
    "quorum_not_reached": "Quorum not reached",
    "missing_expected_task": "Missing expected task",
    "rest_block_not_allowed": "Explicit rest/buffer block",
    "fixed_commitments_not_explained": "Fixed commitments not explained",
}

WEIGHTS = {
    "Expected task coverage": 25,
    "Deadline discipline": 25,
    "Availability discipline": 15,
    "Wellbeing respect": 15,
    "Fixed commitments": 10,
    "Revision efficiency": 10,
}


def load_experiment(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def rows(exp: dict, label: str) -> list[dict]:
    result = []
    for run in exp["runs"]:
        result.append(
            {
                "experiment": label,
                "model": run["model"],
                "model_label": MODEL_LABELS.get(run["model"], run["model"]),
                "scenario_id": run["scenarioId"],
                "scenario": run["scenarioTitle"],
                "status": run["status"],
                "deterministic": run["deterministicScore"],
                "llm_score": run["overallScore"],
                "cost": run["estimatedCostUsd"],
                "tokens": run["totalTokens"],
                "iterations": run["iterations"],
                "mistakes": run.get("mistakes", []),
                "mistake_count": run["mistakeCount"],
                "critical_mistakes": run["criticalMistakeCount"],
                "approvals": run["approvals"],
            }
        )
    return result


def aggregate(df: pd.DataFrame) -> pd.DataFrame:
    grouped = df[df["status"] == "ok"].groupby(["experiment", "model_label"], sort=False)
    agg = grouped.agg(
        runs=("scenario_id", "count"),
        deterministic=("deterministic", "mean"),
        llm_score=("llm_score", "mean"),
        cost=("cost", "mean"),
        tokens=("tokens", "mean"),
        iterations=("iterations", "mean"),
        mistakes=("mistake_count", "sum"),
        critical=("critical_mistakes", "sum"),
    ).reset_index()
    for col in ["deterministic", "llm_score", "cost", "tokens", "iterations"]:
        agg[col] = agg[col].round(3)
    return agg


def aggregate_from_experiment(exp: dict) -> pd.DataFrame:
    rows = []
    for aggregate_row in exp.get("aggregates", []):
        rows.append(
            {
                "model_label": MODEL_LABELS.get(aggregate_row["model"], aggregate_row["model"]),
                "runs": aggregate_row["runCount"],
                "ok_runs": aggregate_row["okCount"],
                "deterministic": aggregate_row["averageDeterministicScore"],
                "llm_score": aggregate_row["averageOverallScore"],
                "cost": aggregate_row["averageCostUsd"],
                "tokens": aggregate_row["averageTokens"],
                "adjusted_value": aggregate_row["costBenefitScore"],
                "critical": aggregate_row["criticalMistakes"],
                "mistakes": aggregate_row["totalMistakes"],
            }
        )
    return pd.DataFrame(rows)


def save_table(df: pd.DataFrame, name: str) -> None:
    df.to_csv(ROOT / name, index=False)


def style_axes(ax, title: str, subtitle: str | None = None) -> None:
    ax.set_title(title, loc="left", fontsize=16, fontweight="bold", pad=32)
    if subtitle:
        ax.text(0, 1.035, subtitle, transform=ax.transAxes, ha="left", va="bottom", fontsize=10, color="#555")
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.grid(axis="y", color="#e5e7eb", linewidth=0.8)
    ax.set_axisbelow(True)


def graph_model_scorecard(current: pd.DataFrame, current_aggregates: pd.DataFrame) -> None:
    adjusted = current_aggregates[["model_label", "adjusted_value"]]
    agg = aggregate(current).merge(adjusted, on="model_label", how="left")
    agg = agg.sort_values("adjusted_value", ascending=False)
    labels = agg["model_label"].tolist()
    x = range(len(labels))
    width = 0.25

    fig, ax = plt.subplots(figsize=(10.5, 5.6), dpi=180)
    ax.bar([i - width for i in x], agg["adjusted_value"], width, label="Overall score", color="#16a34a")
    ax.bar([i for i in x], agg["deterministic"], width, label="Deterministic score", color="#2563eb")
    ax.bar([i + width for i in x], agg["llm_score"] * 20, width, label="Fixed judge score scaled to 0-100", color="#94a3b8")
    for i, row in enumerate(agg.itertuples()):
        ax.text(i - width, row.adjusted_value + 1.2, f"{row.adjusted_value:.1f}", ha="center", fontsize=9, fontweight="bold")
        ax.text(i, row.deterministic + 1.2, f"{row.deterministic:.1f}", ha="center", fontsize=9)
        ax.text(i + width, row.llm_score * 20 + 1.2, f"{row.llm_score:.1f}/5", ha="center", fontsize=9)
    ax.set_xticks(list(x), labels, rotation=0)
    ax.set_ylim(0, 110)
    ax.set_ylabel("Score (0-100)")
    style_axes(ax, "Model quality scores", "Overall score is the benchmark adjusted value used for model ranking")
    ax.text(
        0,
        -0.18,
        "MiniMax M2.7: DNF (too slow/timeouts), excluded from the completed 8-scenario comparison.",
        transform=ax.transAxes,
        ha="left",
        va="top",
        fontsize=9,
        color="#555",
    )
    ax.legend(frameon=False, loc="upper right")
    fig.tight_layout()
    fig.savefig(OUT / "model_quality_scores.png", bbox_inches="tight")
    plt.close(fig)


def graph_cost_quality(current: pd.DataFrame) -> None:
    agg = aggregate(current)
    fig, ax = plt.subplots(figsize=(10, 5.8), dpi=180)
    for row in agg.itertuples():
        color = MODEL_COLORS.get(row.model_label, "#111827")
        ax.scatter(row.cost, row.deterministic, s=210, color=color, edgecolor="white", linewidth=1.5, zorder=3)
        ax.annotate(
            row.model_label,
            (row.cost, row.deterministic),
            xytext=(9, 3),
            textcoords="offset points",
            fontsize=9,
            weight="bold",
        )
        ax.text(row.cost, row.deterministic - 1.8, f"${row.cost:.4f}/run", ha="center", fontsize=8, color="#555")

    ax.set_xlabel("Average cost per run (USD)")
    ax.set_ylabel("Average deterministic score (0-100)")
    ax.set_ylim(max(60, agg["deterministic"].min() - 8), 102)
    ax.set_xlim(0, agg["cost"].max() * 1.25)
    style_axes(ax, "Cost vs deterministic quality", "Higher and further left is better")
    fig.tight_layout()
    fig.savefig(OUT / "cost_vs_quality.png", bbox_inches="tight")
    plt.close(fig)


def graph_mistakes(current: pd.DataFrame) -> None:
    agg = aggregate(current).sort_values("critical")
    labels = agg["model_label"].tolist()
    x = range(len(labels))
    fig, ax = plt.subplots(figsize=(10, 5.6), dpi=180)
    ax.bar(x, agg["mistakes"], color="#cbd5e1", label="All deterministic mistakes")
    ax.bar(x, agg["critical"], color="#dc2626", label="Critical mistakes")
    for i, row in enumerate(agg.itertuples()):
        ax.text(i, row.mistakes + 0.5, f"{int(row.critical)} crit / {int(row.mistakes)} total", ha="center", fontsize=9)
    ax.set_xticks(list(x), labels)
    ax.set_ylabel("Count across 8 scenarios")
    style_axes(ax, "Mistake load by model", "Critical labels identify failures that can invalidate a schedule")
    ax.legend(frameon=False, loc="upper left")
    fig.tight_layout()
    fig.savefig(OUT / "mistake_load_by_model.png", bbox_inches="tight")
    plt.close(fig)


def prompt_mistake_summary(df: pd.DataFrame, prompt: str, top_n: int = 8) -> pd.DataFrame:
    comparable_models = {"Gemini 2.5 Flash Lite", "Gemini 3.1 Flash Lite"}
    counter = Counter()
    severity = defaultdict(Counter)
    for row in df[(df["status"] == "ok") & (df["model_label"].isin(comparable_models))].itertuples():
        for mistake in row.mistakes:
            code = mistake["code"]
            counter[code] += 1
            severity[code][mistake["severity"]] += 1

    records = []
    for code, total in counter.most_common(top_n):
        records.append(
            {
                "prompt": prompt,
                "code": code,
                "label": MISTAKE_LABELS.get(code, code.replace("_", " ").title()),
                "critical": severity[code]["critical"],
                "major": severity[code]["major"],
                "minor": severity[code]["minor"],
                "total": total,
            }
        )
    return pd.DataFrame(records)


def draw_top_mistakes(summary: pd.DataFrame, title: str, subtitle: str, filename: str, x_max: int) -> None:
    data = summary.sort_values("total", ascending=True)
    fig, ax = plt.subplots(figsize=(10.5, 5.9), dpi=180)
    y = range(len(data))
    minor = data["minor"].tolist()
    major = data["major"].tolist()
    critical = data["critical"].tolist()

    ax.barh(y, minor, color="#cbd5e1", label="Minor")
    ax.barh(y, major, left=minor, color="#f97316", label="Major")
    ax.barh(y, critical, left=[m + j for m, j in zip(minor, major)], color="#dc2626", label="Critical")

    for i, row in enumerate(data.itertuples()):
        ax.text(row.total + 0.15, i, str(int(row.total)), va="center", fontsize=9, fontweight="bold")

    ax.set_yticks(list(y), data["label"])
    ax.set_xlim(0, x_max)
    ax.set_xlabel("Mistake count across 16 comparable runs")
    style_axes(ax, title, subtitle)
    ax.legend(frameon=False, loc="lower right")
    fig.tight_layout()
    fig.savefig(OUT / filename, bbox_inches="tight")
    plt.close(fig)


def graph_prompt_top_mistakes(old: pd.DataFrame, current: pd.DataFrame) -> pd.DataFrame:
    old_summary = prompt_mistake_summary(old, "Before prompt change")
    new_summary = prompt_mistake_summary(current, "After prompt change")
    combined = pd.concat([old_summary, new_summary], ignore_index=True)
    save_table(combined, "prompt_top_mistakes.csv")

    x_max = int(max(old_summary["total"].max(), new_summary["total"].max()) + 2)
    subtitle = "Gemini 2.5 + Gemini 3.1 only; 8 scenarios per model"
    draw_top_mistakes(
        old_summary,
        "Top mistakes before prompt change",
        subtitle,
        "top_mistakes_before_prompt_change.png",
        x_max,
    )
    draw_top_mistakes(
        new_summary,
        "Top mistakes after prompt change",
        subtitle,
        "top_mistakes_after_prompt_change.png",
        x_max,
    )
    return combined


def graph_scoring_weights() -> None:
    labels = list(WEIGHTS.keys())
    vals = list(WEIGHTS.values())
    colors = ["#2563eb", "#16a34a", "#f59e0b", "#14b8a6", "#64748b", "#a855f7"]
    fig, ax = plt.subplots(figsize=(10, 5.2), dpi=180)
    ax.barh(labels[::-1], vals[::-1], color=colors[::-1])
    for i, val in enumerate(vals[::-1]):
        ax.text(val + 0.7, i, f"{val}%", va="center", fontsize=9)
    ax.set_xlim(0, 30)
    ax.set_xlabel("Weight in deterministic score")
    style_axes(ax, "How deterministic scoring works", "Weighted objective checks, then mistake labels explain failures")
    fig.tight_layout()
    fig.savefig(OUT / "deterministic_scoring_weights.png", bbox_inches="tight")
    plt.close(fig)


def deadline_related(run: dict) -> tuple[int, int]:
    critical = 0
    total = 0
    deadline_codes = {"block_after_deadline", "deadline_task_unscheduled", "final_critical_critiques"}
    for mistake in run["mistakes"]:
        if mistake["code"] in deadline_codes or "deadline" in mistake["code"]:
            total += 1
            if mistake["severity"] == "critical":
                critical += 1
    return critical, total


def graph_prompt_improvement(old: pd.DataFrame, current: pd.DataFrame) -> pd.DataFrame:
    comparable_models = ["Gemini 2.5 Flash Lite", "Gemini 3.1 Flash Lite"]
    records = []
    for label, df in [("Old prompt", old), ("Deadline prompt tuned", current)]:
        for model in comparable_models:
            sub = df[(df["model_label"] == model) & (df["status"] == "ok")]
            crit = total = all_mistakes = 0
            for row in sub.itertuples():
                c, t = deadline_related(row._asdict())
                crit += c
                total += t
                all_mistakes += row.mistake_count
            records.append(
                {
                    "prompt": label,
                    "model_label": model,
                    "deadline_critical": crit,
                    "deadline_total": total,
                    "all_mistakes": all_mistakes,
                    "runs": len(sub),
                }
            )
    comp = pd.DataFrame(records)
    save_table(comp, "deadline_prompt_improvement.csv")

    fig, ax = plt.subplots(figsize=(10.5, 5.7), dpi=180)
    x = range(len(comparable_models))
    width = 0.34
    old_vals = comp[comp["prompt"] == "Old prompt"].set_index("model_label").loc[comparable_models]["deadline_critical"]
    new_vals = comp[comp["prompt"] == "Deadline prompt tuned"].set_index("model_label").loc[comparable_models]["deadline_critical"]
    ax.bar([i - width / 2 for i in x], old_vals, width, label="Old prompt", color="#f97316")
    ax.bar([i + width / 2 for i in x], new_vals, width, label="Deadline prompt tuned", color="#16a34a")
    for i, (old_v, new_v) in enumerate(zip(old_vals, new_vals)):
        ax.text(i - width / 2, old_v + 0.15, str(int(old_v)), ha="center", fontsize=10, fontweight="bold")
        ax.text(i + width / 2, new_v + 0.15, str(int(new_v)), ha="center", fontsize=10, fontweight="bold")
        if old_v:
            delta = (old_v - new_v) / old_v * 100
            ax.text(i, max(old_v, new_v) + 1.1, f"{delta:.0f}% fewer", ha="center", fontsize=9, color="#166534")
    ax.set_xticks(list(x), comparable_models)
    ax.set_ylabel("Critical deadline-related mistakes across 8 scenarios")
    ax.set_ylim(0, max(old_vals.max(), new_vals.max()) + 3)
    style_axes(
        ax,
        "Deadline prompt tuning reduced critical deadline errors",
        "Comparison uses only models rerun after the Deadline Agent prompt change",
    )
    ax.legend(frameon=False, loc="upper right")
    fig.tight_layout()
    fig.savefig(OUT / "deadline_prompt_improvement.png", bbox_inches="tight")
    plt.close(fig)
    return comp


def graph_scenario_heatmap(current: pd.DataFrame) -> None:
    pivot = current.pivot_table(index="scenario", columns="model_label", values="deterministic", aggfunc="mean")
    pivot = pivot[[c for c in ["Gemini 2.5 Flash Lite", "Gemini 3.1 Flash Lite", "DeepSeek V3.2"] if c in pivot.columns]]
    fig, ax = plt.subplots(figsize=(10.8, 6.8), dpi=180)
    im = ax.imshow(pivot.values, aspect="auto", cmap="RdYlGn", vmin=60, vmax=100)
    ax.set_xticks(range(len(pivot.columns)), pivot.columns, rotation=25, ha="right")
    ax.set_yticks(range(len(pivot.index)), pivot.index)
    for i in range(pivot.shape[0]):
        for j in range(pivot.shape[1]):
            val = pivot.values[i, j]
            ax.text(j, i, f"{val:.0f}", ha="center", va="center", fontsize=8, color="#111827")
    ax.set_title("Scenario-level deterministic scores", loc="left", fontsize=16, fontweight="bold", pad=16)
    cbar = fig.colorbar(im, ax=ax, fraction=0.025, pad=0.02)
    cbar.set_label("Score")
    fig.tight_layout()
    fig.savefig(OUT / "scenario_score_heatmap.png", bbox_inches="tight")
    plt.close(fig)


def main() -> None:
    old_exp = load_experiment(OLD_EXPERIMENT)
    new_exp = load_experiment(NEW_EXPERIMENT)
    old = pd.DataFrame(rows(old_exp, "Old prompt"))
    current = pd.DataFrame(rows(new_exp, "Current combined"))
    current_aggregates = aggregate_from_experiment(new_exp)
    all_rows = pd.concat([old, current], ignore_index=True)

    save_table(aggregate(current), "current_model_aggregates.csv")
    save_table(current_aggregates, "current_adjusted_value_aggregates.csv")
    save_table(all_rows.drop(columns=["mistakes"]), "benchmark_runs_flat.csv")

    graph_model_scorecard(current, current_aggregates)
    graph_cost_quality(current)
    graph_mistakes(current)
    graph_scoring_weights()
    graph_prompt_improvement(old, current)
    graph_prompt_top_mistakes(old, current)
    graph_scenario_heatmap(current)

    mistake_counts = []
    for exp_name, df in [("Old prompt", old), ("Current combined", current)]:
        counter = Counter()
        severity = defaultdict(Counter)
        for row in df.itertuples():
            for mistake in row.mistakes:
                counter[mistake["code"]] += 1
                severity[mistake["code"]][mistake["severity"]] += 1
        for code, count in counter.most_common():
            mistake_counts.append(
                {
                    "experiment": exp_name,
                    "code": code,
                    "count": count,
                    "critical": severity[code]["critical"],
                    "major": severity[code]["major"],
                    "minor": severity[code]["minor"],
                }
            )
    save_table(pd.DataFrame(mistake_counts), "mistake_counts.csv")

    print("Wrote figures:")
    for path in sorted(OUT.glob("*.png")):
        print(path)


if __name__ == "__main__":
    main()
