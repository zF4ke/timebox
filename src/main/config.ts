import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { configPath, dataDir } from "./paths";

export interface AppConfig {
  quorum: number;
  model: string;
}

const DEFAULT_MODEL = "nvidia/nemotron-3-super-120b-a12b:free";
const DEFAULT_QUORUM = 5;

export function loadConfig(): AppConfig {
  try {
    const cp = configPath();
    if (existsSync(cp)) {
      const raw = readFileSync(cp, "utf-8");
      const parsed = JSON.parse(raw);
      return {
        quorum:
          typeof parsed.quorum === "number" ? parsed.quorum : DEFAULT_QUORUM,
        model:
          typeof parsed.model === "string" && parsed.model.trim()
            ? parsed.model.trim()
            : DEFAULT_MODEL
      };
    }
  } catch {
    // fallthrough to defaults
  }
  return { quorum: DEFAULT_QUORUM, model: DEFAULT_MODEL };
}

export function saveConfig(config: AppConfig): void {
  try {
    mkdirSync(dataDir(), { recursive: true });
    writeFileSync(configPath(), JSON.stringify(config, null, 2));
  } catch {
    // ignore write failures
  }
}
