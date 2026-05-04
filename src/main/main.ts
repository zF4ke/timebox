import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import dotenv from "dotenv";
import { getPlannerDefaults, runPlanningPipeline } from "./planner";
import type { PlanningRequest } from "../shared/types";

dotenv.config({ path: path.join(__dirname, "../../.env") });

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 720,
    minHeight: 520,
    backgroundColor: "#fafafa",
    title: "Student Calendar Planner",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (isDev) {
    void win.loadURL(process.env.VITE_DEV_SERVER_URL!);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    void win.loadFile(path.join(__dirname, "../../dist-renderer/index.html"));
  }
}

ipcMain.handle("planner:run", async (_event, request: PlanningRequest) => {
  return runPlanningPipeline(request);
});

ipcMain.handle("planner:defaults", async () => {
  return getPlannerDefaults();
});

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
