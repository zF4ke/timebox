# Timebox

Timebox is an Electron desktop prototype for the AASMA Group 45 multi-agent student calendar planner.

## Run the executable

1. Open the `executable` folder.
2. Double-click `Timebox 0.1.0.exe`.
3. In the app, open `Settings`.
4. Paste an OpenRouter API key.
5. Choose a model, or keep the default settings.
6. Return to `Planner`, write a student planning request, and run it.

The executable is portable. It does not need installation.

## Run from source

Requirements:

- Node.js 20 or newer
- npm
- OpenRouter API key

Commands:

```bash
npm install
npm run dev
```

The app stores settings, saved plans, and benchmark results in the operating-system user data folder, not in the project folder.

## Build the executable

```bash
npm run dist
```

The Windows portable executable is created in `release/`.