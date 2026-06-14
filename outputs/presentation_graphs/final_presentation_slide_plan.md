# Final Presentation Slide Plan - Timebox

Source basis:
- Final assignment brief: `research/Project-AAMAS2026 (1).pdf`
- Previous presentation: `research/Project-Week4-AAMAS2026-Group45.pdf`
- Current benchmark: `C:\Users\yFake\AppData\Roaming\timebox\benchmark-results\2026-06-05T08-22-09-929Z-combined`
- Old prompt benchmark for prompt-tuning comparison: `research/2026-06-04T14-36-55-053Z (1) old prompt.zip`

Suggested duration: 7 minutes.

Use Slides 1-10, 12, and 13 as the core final talk. Slide 11 is an optional appendix/detail slide if you have time or if the discussion asks where models failed by scenario.

## Slide 1 - Title

Status from previous deck: keep, update subtitle from "Week 4" to "Final Presentation".

Title:
Multi-Agent Student Calendar Planner

Subtitle:
Final Presentation - AASMA 2025/26

Names:
Daniel Bernardes, 116246
Pedro Silva, 116117
Group 45

Speaker point:
We built Timebox, a multi-agent calendar planner that turns natural-language student constraints into a calendar through agent critique, revision, and quorum approval.

## Slide 2 - Motivation and Problem

Status from previous deck: keep with minor tightening.

Title:
Why Student Planning Is a Multi-Agent Problem

On-slide text:
- Students must balance deadlines, grade weights, uncertain effort, fixed commitments, and wellbeing.
- These goals often conflict: the safest deadline plan may be too intense, while the healthiest plan may leave academic risk.
- Our problem: generate a feasible multi-day calendar that explains its compromises.

Speaker point:
The point is not just to output a schedule. The system should expose why some tasks are earlier, why some are shorter, and which risks remain.

## Slide 3 - Related Work and Design Inspiration

Status from previous deck: keep, shorten.

Title:
Related Work: MACI-Style Critique and Revision

On-slide text:
- Inspired by MACI: plan generation plus independent validation and refinement.
- We reproduce the core idea in a smaller, practical domain.
- Planner creates a calendar.
- Specialist agents critique it.
- Planner revises until acceptance or fallback.

Footer:
Related work: MACI, Multi-Agent Collaborative Intelligence for Adaptive Reasoning and Temporal Planning.

Speaker point:
We are not reproducing the full MACI framework. We use its central orchestration pattern: a generator produces a plan, other agents inspect it from different perspectives, and feedback drives revision.

## Slide 4 - System Architecture

Status from previous deck: keep but redraw as a cleaner pipeline.

Title:
Architecture: Debate Before Acceptance

On-slide diagram:
User input
-> Interpreter Agent
-> 5 Specialist Agents
-> Planner-Arbiter drafts calendar
-> Specialist critiques
-> Revision loop
-> Final calendar + JSON/ICS export

Specialist agents:
- Deadline Agent
- Grade Agent
- Effort Agent
- Wellbeing Agent
- Risk Agent

Speaker point:
Each specialist receives the same interpreted planning state, but defends a different priority. Their disagreement is preserved instead of collapsed into one hidden score.

## Slide 5 - Acceptance and Revision Logic

Status from previous deck: new slide, needed for final explanation.

Title:
How a Calendar Is Accepted

On-slide text:
- Default quorum: 5 approvals from 5 specialist agents.
- Blocking condition: unresolved critical critiques.
- Validation is diagnostic, not a hard gate.
- If max iterations is reached, the system chooses the best available version by critique severity and approvals.

Small callout:
We intentionally avoid brittle hard constraints. Validation logs mistakes so prompts and models can be improved.

Speaker point:
This is a design choice. Hard validation can reject a schedule that agents consider reasonable in context. Instead, the agents are the acceptance mechanism, and validation gives us transparent failure labels for evaluation.

## Slide 6 - Final Prototype

Status from previous deck: change from "Demo" placeholder to concrete feature summary.

Title:
Final Prototype

On-slide text:
- Electron + React desktop app.
- Natural-language planning input.
- Configurable model, quorum, and max iterations.
- Multi-agent progress trace.
- Calendar visualization and event details.
- Saved plans, JSON import/export, and ICS export.
- Benchmark analytics page for model comparison and prompt debugging.

Speaker point:
The final system is executable, not only a notebook or mockup. It supports interactive planning, stored outputs, and repeatable benchmarks.

## Slide 7 - Evaluation Score

Status from previous deck: replace entirely.

Title:
How We Scored Each Model

Use graph:
`outputs/presentation_graphs/figures/deterministic_scoring_weights.png`

On-slide text:
Big formula first:

```text
Model comparison =
  deterministic schedule score
+ fixed LLM judge score
- penalties for failures, critical mistakes, and cost
```

Benchmark setup:
- Same 8 student scenarios for each model.
- Same quorum: 5 approvals.
- Same max revision depth: 3 iterations.
- Same evaluator model for every run.

Then we inspect the deterministic score:

Deterministic score =
25% task coverage +
25% deadline discipline +
15% availability discipline +
15% wellbeing respect +
10% fixed commitments +
10% revision efficiency

Speaker point:
Start with the overall comparison logic: we do not pick a model just because it sounds good. The fixed judge measures qualitative usefulness, while deterministic checks catch objective schedule failures such as missed deadlines. Cost and critical mistakes are then used as practical penalties. After that, explain the deterministic score components shown in the graph.

## Slide 8 - Model Results

Status from previous deck: replace entirely.

Title:
Results: Gemini Models Were Strongest

Use graph:
`outputs/presentation_graphs/figures/model_quality_scores.png`

Optional supporting graph:
`outputs/presentation_graphs/figures/cost_vs_quality.png`

On-slide text:
- Gemini 2.5 Flash Lite: 92.6 overall score, best final ranking.
- Gemini 3.1 Flash Lite: 92.0 overall score, almost tied but more expensive.
- DeepSeek V3.2: 69.0 overall score because deterministic mistakes and unresolved critiques were much higher.
- The overall score is the right-side benchmark table score: deterministic quality plus fixed judge evidence, minus penalties for failures, critical mistakes, and cost.

Speaker point:
Start with the green overall score bars. This is the value score from the benchmark ranking table, so it is the main comparison. Gemini 3.1 had the strongest raw quality signals, but Gemini 2.5 wins the final ranking because it is almost as good and cheaper. DeepSeek falls behind because it accumulates more critical deterministic mistakes.

## Slide 9 - Failure Analysis

Status from previous deck: new slide, required for limitations/results interpretation.

Title:
Failure Labels Explain Why Scores Differ

Use graph:
`outputs/presentation_graphs/figures/top_mistakes_before_prompt_change.png`

Second graph:
`outputs/presentation_graphs/figures/top_mistakes_after_prompt_change.png`

Optional supporting graph:
`outputs/presentation_graphs/figures/mistake_load_by_model.png`

On-slide text:
- Before tuning, the most important critical failure was work scheduled after a deadline: 5 cases.
- After tuning, work-after-deadline dropped to 1 case across the comparable Gemini runs.
- Availability overruns also fell from 8 to 3.
- Remaining failures are more spread out: rest/buffer blocks, one missing expected task, and one unresolved critical critique.

Speaker point:
Use these graphs to show how the deterministic labels guide debugging. The old Deadline Agent prompt missed repeated deadline violations. After the prompt change, that failure mode is mostly gone, so the remaining mistakes are smaller and more diverse. Mention that this before/after comparison uses only Gemini 2.5 and Gemini 3.1 because those are the models rerun under both prompt versions.

## Slide 10 - Prompt Improvement Example

Status from previous deck: new slide, uses the zipped old benchmark.

Title:
Prompt Tuning Reduced Deadline Errors

Use graph:
`outputs/presentation_graphs/figures/deadline_prompt_improvement.png`

On-slide text:
- Old Deadline Agent prompt did not catch enough "work ends after deadline" cases.
- We changed it to audit exact deadline timestamps and name offending blocks.
- Gemini 2.5 critical deadline mistakes: 4 -> 1.
- Gemini 3.1 critical deadline mistakes: 2 -> 1.
- This shows how deterministic labels guide prompt improvement.

Important footnote:
Comparison uses only Gemini models rerun after the Deadline Agent prompt change. DeepSeek is excluded here because the available DeepSeek result in the combined benchmark came from the old prompt hash.

Speaker point:
This is the clearest example of the evaluation loop. The old benchmark showed repeated `block_after_deadline` errors. We strengthened the Deadline Agent prompt, reran comparable models, and reduced critical deadline-related mistakes.

## Slide 11 - Scenario-Level Robustness (Optional Appendix)

Status from previous deck: optional if time permits; include if you want a richer evaluation section.

Title:
Where Models Still Struggle

Use graph:
`outputs/presentation_graphs/figures/scenario_score_heatmap.png`

On-slide text:
- Gemini models are strong across most scenarios.
- Lower scores appear in deadline-heavy or low-energy scenarios.
- DeepSeek struggles most in low-energy and uncertain-scope scenarios.
- Hard scenarios reveal failure modes that average scores hide.

Speaker point:
The benchmark is not only a leaderboard. Scenario-level results tell us which types of planning situations are still fragile.

## Slide 12 - Limitations and Future Work

Status from previous deck: new final-analysis slide, required by the final assignment criteria.

Title:
Limitations and Next Steps

On-slide text:
- LLM reliability: models can still produce schedules with objective mistakes.
- Prompt sensitivity: small prompt changes can change benchmark behavior.
- Benchmark size: current final comparison uses 8 fixed scenarios per model.
- Validation is diagnostic only; future work could add user-selectable hard gates.
- Real calendar integration and user history are not implemented yet.
- More models, repeated seeds, and larger scenario sets would make conclusions stronger.

Speaker point:
The system is useful as a multi-agent orchestration prototype, but the evaluation also shows why safety checks and transparent mistake labels matter.

## Slide 13 - Final Demo / Closing

Status from previous deck: keep demo, add conclusion.

Title:
Demo and Takeaway

On-slide text:
- Input: natural-language student planning problem.
- Output: calendar with reasoning, critiques, validation log, and exports.
- Main result: multi-agent critique improves transparency and creates a measurable prompt-improvement loop.

Closing sentence:
Timebox shows how multi-agent orchestration can turn calendar generation from a single-shot answer into a negotiated, auditable planning process.

Speaker point:
End by showing the app: input prompt, progress trace, final calendar, and analytics page with the benchmark graphs or rankings.

# Evaluation Slides: Presenter Script

Use this script for Slides 7-11 if you want a coherent explanation:

1. We evaluate with fixed scenarios, not ad-hoc examples.
2. Every model receives the same student prompts, same quorum, same max iterations, and the same fixed judge model.
3. The deterministic score is 0-100 and weighted toward task coverage and deadline discipline because those are the most important schedule failures.
4. The LLM judge score is useful but secondary because it can reward a schedule that sounds good while missing objective mistakes.
5. Gemini 3.1 had the highest quality score, but Gemini 2.5 was almost tied and cheaper.
6. DeepSeek V3.2 was weaker in this orchestration setting because it often failed convergence and left critical critiques.
7. The prompt-improvement experiment is the key takeaway: deterministic mistakes identified Deadline Agent weaknesses, and after changing the prompt, critical deadline-related mistakes dropped for both rerun Gemini models.

# Generated Graph Inventory

- `outputs/presentation_graphs/figures/deterministic_scoring_weights.png`
- `outputs/presentation_graphs/figures/model_quality_scores.png`
- `outputs/presentation_graphs/figures/cost_vs_quality.png`
- `outputs/presentation_graphs/figures/mistake_load_by_model.png`
- `outputs/presentation_graphs/figures/top_mistakes_before_prompt_change.png`
- `outputs/presentation_graphs/figures/top_mistakes_after_prompt_change.png`
- `outputs/presentation_graphs/figures/deadline_prompt_improvement.png`
- `outputs/presentation_graphs/figures/scenario_score_heatmap.png`

# Data Tables

- `outputs/presentation_graphs/current_model_aggregates.csv`
- `outputs/presentation_graphs/current_adjusted_value_aggregates.csv`
- `outputs/presentation_graphs/benchmark_runs_flat.csv`
- `outputs/presentation_graphs/deadline_prompt_improvement.csv`
- `outputs/presentation_graphs/mistake_counts.csv`
- `outputs/presentation_graphs/prompt_top_mistakes.csv`
