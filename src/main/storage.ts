import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { PlanningResult, SavedCalendar } from "../shared/types";

const DATA_DIR = path.join(process.cwd(), "data");
const CALENDARS_DIR = path.join(DATA_DIR, "calendars");

function ensureDir(): void {
  if (!fs.existsSync(CALENDARS_DIR)) {
    fs.mkdirSync(CALENDARS_DIR, { recursive: true });
  }
}

function filePath(id: string): string {
  return path.join(CALENDARS_DIR, `${id}.json`);
}

export function listCalendars(): SavedCalendar[] {
  ensureDir();
  const files = fs.readdirSync(CALENDARS_DIR).filter((f) => f.endsWith(".json"));
  const entries: SavedCalendar[] = [];
  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(CALENDARS_DIR, file), "utf-8");
      const parsed = JSON.parse(raw) as SavedCalendar;
      entries.push(parsed);
    } catch {
      // skip corrupt files
    }
  }
  return entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function saveCalendar(name: string, result: PlanningResult): SavedCalendar {
  ensureDir();
  const id = crypto.randomUUID();
  const entry: SavedCalendar = {
    id,
    name: name.trim() || `Plan ${new Date().toLocaleDateString()}`,
    createdAt: new Date().toISOString(),
    result
  };
  fs.writeFileSync(filePath(id), JSON.stringify(entry, null, 2), "utf-8");
  console.log(`[storage] saved calendar → ${id}`);
  return entry;
}

export function loadCalendar(id: string): SavedCalendar | null {
  ensureDir();
  const fp = filePath(id);
  if (!fs.existsSync(fp)) return null;
  try {
    return JSON.parse(fs.readFileSync(fp, "utf-8")) as SavedCalendar;
  } catch {
    return null;
  }
}

export function deleteCalendar(id: string): boolean {
  ensureDir();
  const fp = filePath(id);
  if (!fs.existsSync(fp)) return false;
  fs.unlinkSync(fp);
  console.log(`[storage] deleted calendar → ${id}`);
  return true;
}
