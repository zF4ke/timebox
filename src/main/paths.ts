import { app } from "electron";
import path from "node:path";

export function dataDir(): string {
  return path.join(app.getPath("userData"), "data");
}

export function calendarsDir(): string {
  return path.join(dataDir(), "calendars");
}

export function debugDir(): string {
  return path.join(app.getPath("userData"), "debug");
}

export function configPath(): string {
  return path.join(dataDir(), "config.json");
}
