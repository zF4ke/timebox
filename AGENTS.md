# Agent Guidelines

## Project Structure

- `src/main/` — Electron main process (planner, OpenRouter client, validation)
- `src/renderer/` — React UI
- `src/shared/` — Types shared between main and renderer
- `src/main/prompts/` — Markdown prompt files for each agent
- `docs/` — Architecture and design documentation

## Key Documents

- **[docs/architecture.md](docs/architecture.md)** — System philosophy, agent roles, why there are no hard constraints, prompt design principles.
- **[docs/initial_plan.md](docs/initial_plan.md)** — Original project specification.

## Coding Conventions

- Prompts live in individual `.md` files, not inline in TypeScript.
- The build script (`npm run build:electron`) copies `src/main/prompts/` to `dist-electron/main/prompts/`.
- Do not add hard constraints that block calendar acceptance. Validation is for logging only.
- Keep revision prompts compact to avoid JSON truncation. See `buildRevisionPlannerPrompt` in `src/main/planner.ts`.
