# Benchmark Summary

Baseline summary from the pulled `results/*` artifacts after applying the deterministic scenario scorer in `benchmarks/scenarios.json`.

These are legacy runs: they predate per-call usage tracing, so cost values in the analytics view are marked as `legacy_estimate`. Fresh runs from `npm run benchmark` will have stronger per-call `traced` usage data.

## Current Ranking

| Model | Completed / Total | Avg LLM Score | Avg Deterministic Score | Main caveat |
|---|---:|---:|---:|---|
| `google/gemini-2.5-flash-lite-preview-09-2025` | 15 / 15 | 4.26 / 5 | 93.22 / 100 | Strong deterministic score, but many availability/rest-block issues. |
| `google/gemini-3.1-flash-lite-preview` | 15 / 15 | 4.43 / 5 | 91.80 / 100 | Best LLM evaluator average, but more critical deterministic mistakes than Gemini 2.5. |
| `minimax/minimax-m2.7` | 5 / 15 | 4.12 / 5 | 83.96 / 100 | Too many provider/run failures for fair comparison. |
| `deepseek/deepseek-v3.2` | 14 / 15 | 3.32 / 5 | 81.84 / 100 | Often failed to converge under quorum; many critical critique leftovers. |

## Cost-Benefit Interpretation

Using the legacy cost proxy, Gemini 2.5 Flash Lite is currently the best cost-benefit candidate: it combines the highest deterministic score with the lowest estimated average cost among complete result sets.

Gemini 3.1 Flash Lite is still a strong quality candidate because the LLM evaluator preferred it on average, but the deterministic mistake labels show more deadline/task omissions than Gemini 2.5. For the final report, this is a useful comparison: the subjective evaluator and deterministic scorer do not fully agree, which supports the design choice to keep both.

## Common Mistakes By Model

### Gemini 2.5 Flash Lite

- `availability_overrun`: 21
- `rest_block_not_allowed`: 15
- `late_work_when_avoided`: 2
- `block_after_deadline`: 1
- `deadline_task_unscheduled`: 1

Interpretation: usually covers the tasks, but sometimes violates the "unscheduled time is rest" design and overloads days.

### Gemini 3.1 Flash Lite

- `block_after_deadline`: 7
- `too_few_work_blocks`: 5
- `deadline_task_unscheduled`: 2
- `missing_expected_task`: 2
- `wellbeing_agent_rejected`: 2
- `max_iterations_fallback`: 2

Interpretation: produces high-quality prose and evaluator scores, but deterministic checks catch more deadline/task coverage risk.

### MiniMax M2.7

- `block_after_deadline`: 6
- `availability_overrun`: 5
- `missing_expected_task`: 1

Interpretation: not reliable enough in the current setup because only 5 of 15 scenarios completed.

### DeepSeek V3.2

- `max_iterations_fallback`: 11
- `quorum_not_reached`: 11
- `final_critical_critiques`: 10
- `block_after_deadline`: 9
- `availability_overrun`: 3
- `wellbeing_agent_rejected`: 3

Interpretation: tends to get stuck in the multi-agent negotiation loop and often leaves serious critique issues unresolved.

## Prompt Improvement Targets

1. Reinforce that rest/buffer/break blocks must not be scheduled as explicit blocks.
2. Strengthen deadline handling in the planner prompt, especially "work must end before the inferred deadline".
3. Make revision prompts explicitly preserve all expected tasks, not only the criticized tasks.
4. Add a compact reminder that accepted calendars should still satisfy quorum and avoid unresolved critical critiques.
5. For wellbeing-sensitive scenarios, repeat the user's late-night avoidance preference in revision prompts.

## Recommended Next Benchmark

After prompt changes, rerun the same scenario set with:

```bash
npm run benchmark -- --models google/gemini-2.5-flash-lite-preview-09-2025,google/gemini-3.1-flash-lite-preview --quorums 3,5 --max-iterations 2,3
```

Do not include `:free` models unless deliberately testing latency, because the benchmark runner skips them by default for speed.
