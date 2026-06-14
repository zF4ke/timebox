# Final Presentation Slide Plan - Timebox

Source basis:
- Final assignment brief: `research/Project-AAMAS2026 (1).pdf`
- Previous presentation: `research/Project-Week4-AAMAS2026-Group45.pdf`
- Current benchmark: `C:\Users\yFake\AppData\Roaming\timebox\benchmark-results\2026-06-05T08-22-09-929Z-combined`
- Old prompt benchmark for prompt-tuning comparison: `research/2026-06-04T14-36-55-053Z (1) old prompt.zip`

Suggested duration: 7 minutes.

Use Slides 1-11, 13, and 14 as the core final talk. Slide 12 is an optional appendix/detail slide if you have time or if the discussion asks where models failed by scenario.

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

## Slide 7 - Evaluation Method

Status from previous deck: replace entirely.

Title:
Evaluation: Fixed Scenarios, Fixed Judge, Deterministic Checks

Use graph:
`outputs/presentation_graphs/figures/deterministic_scoring_weights.png`

On-slide text:
- We created fixed natural-language student scenarios.
- Each model ran the same 8 scenarios with quorum 5 and max 3 iterations.
- A fixed evaluator model judged qualitative quality.
- A deterministic scorer checked objective failures and produced mistake labels.

Scoring formula to show:
Deterministic score =
25% task coverage +
25% deadline discipline +
15% availability discipline +
15% wellbeing respect +
10% fixed commitments +
10% revision efficiency

Speaker point:
The deterministic score is intentionally explainable. It checks whether expected tasks appear, whether work ends before deadlines, whether availability is overloaded, whether late-night preferences are respected, and whether the revision process converges.

## Slide 8 - How We Interpret Scores

Status from previous deck: new slide, part of the reworked evaluation.

Title:
Interpreting the Evaluation

On-slide text:
- LLM judge score: qualitative schedule usefulness, coherence, and compromise quality.
- Deterministic score: objective scenario checks and named mistake labels.
- Cost per run: traced OpenRouter token cost across the full multi-agent pipeline.
- Adjusted value: deterministic score first, LLM score second, then penalties for failures, critical mistakes, and cost.

Key message:
The best model is not simply the one with the highest judge score. We prefer the model that is accurate, cheap, and produces fewer critical scheduling mistakes.

Speaker point:
This matters because a schedule can read well while still putting work after a deadline. The deterministic score catches those cases and gives us prompt-tuning targets.

## Slide 9 - Model Results

Status from previous deck: replace entirely.

Title:
Results: Gemini Models Were Strongest

Use graph:
`outputs/presentation_graphs/figures/model_quality_scores.png`

Optional supporting graph:
`outputs/presentation_graphs/figures/cost_vs_quality.png`

On-slide text:
- Gemini 3.1 Flash Lite: 97.5 deterministic, 4.6/5 judge score.
- Gemini 2.5 Flash Lite: 97.3 deterministic, 4.5/5 judge score.
- DeepSeek V3.2: 81.6 deterministic, 3.0/5 judge score.
- Gemini 2.5 had the best cost-quality tradeoff: similar quality to Gemini 3.1 at lower average cost.

Speaker point:
Gemini 3.1 had the best raw quality, but Gemini 2.5 is more attractive operationally because it is much cheaper per full planning run while reaching almost the same deterministic score.

## Slide 10 - Failure Analysis

Status from previous deck: new slide, required for limitations/results interpretation.

Title:
Failure Labels Explain Why Scores Differ

Use graph:
`outputs/presentation_graphs/figures/mistake_load_by_model.png`

On-slide text:
- Gemini 2.5: 1 critical / 6 total deterministic mistakes.
- Gemini 3.1: 2 critical / 6 total deterministic mistakes.
- DeepSeek V3.2: 13 critical / 31 total deterministic mistakes.
- DeepSeek often reached max iterations without quorum and left critical critiques unresolved.

Speaker point:
The mistake labels are more useful than a single score. They tell us whether the problem is deadline handling, availability overload, missing tasks, wellbeing, or convergence.

## Slide 11 - Prompt Improvement Example

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

## Slide 12 - Scenario-Level Robustness (Optional Appendix)

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

## Slide 13 - Limitations and Future Work

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

## Slide 14 - Final Demo / Closing

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

Use this script for Slides 7-12 if you want a coherent explanation:

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
- `outputs/presentation_graphs/figures/deadline_prompt_improvement.png`
- `outputs/presentation_graphs/figures/scenario_score_heatmap.png`

# Data Tables

- `outputs/presentation_graphs/current_model_aggregates.csv`
- `outputs/presentation_graphs/benchmark_runs_flat.csv`
- `outputs/presentation_graphs/deadline_prompt_improvement.csv`
- `outputs/presentation_graphs/mistake_counts.csv`
