import fs from "node:fs";
import path from "node:path";
import type { AgentName } from "../shared/types";

const PROMPTS_DIR = path.join(__dirname, "prompts");

function loadPrompt(name: string): string {
  const filePath = path.join(PROMPTS_DIR, `${name}.md`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Prompt file not found: ${filePath}`);
  }
  return fs.readFileSync(filePath, "utf-8").trim();
}

export const BASE_SYSTEM_PROMPT = loadPrompt("base-system");

export const AGENT_PROMPTS: Record<AgentName, string> = {
  "Deadline Agent": loadPrompt("deadline-agent"),
  "Grade Agent": loadPrompt("grade-agent"),
  "Effort Agent": loadPrompt("effort-agent"),
  "Wellbeing Agent": loadPrompt("wellbeing-agent"),
  "Risk Agent": loadPrompt("risk-agent")
};

export const AGENT_NAMES: AgentName[] = [
  "Deadline Agent",
  "Grade Agent",
  "Effort Agent",
  "Wellbeing Agent",
  "Risk Agent"
];
