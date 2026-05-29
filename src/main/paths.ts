import os from "node:os";
import path from "node:path";

function userDataDir(): string {
  const explicitUserData = process.env.TIMEBOX_USER_DATA_DIR;
  if (explicitUserData) {
    return explicitUserData;
  }

  const electronApp = electronAppIfAvailable();
  if (electronApp) {
    return electronApp.getPath("userData");
  }

  const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(configHome, "timebox");
}

function electronAppIfAvailable(): { getPath(name: string): string } | null {
  try {
    // In plain Node, require("electron") returns the Electron binary path.
    // In Electron, it returns the Electron module with app.getPath().
    const electron = require("electron") as { app?: { getPath(name: string): string } } | string;
    return typeof electron === "object" && electron.app ? electron.app : null;
  } catch {
    return null;
  }
}

export function dataDir(): string {
  return process.env.TIMEBOX_DATA_DIR || path.join(userDataDir(), "data");
}

export function calendarsDir(): string {
  return path.join(dataDir(), "calendars");
}

export function debugDir(): string {
  return path.join(userDataDir(), "debug");
}

export function configPath(): string {
  return path.join(dataDir(), "config.json");
}
