import { BrowserWindow, screen, ipcMain } from "electron";
import path from "path";

export class OverlayManager {
  private window: BrowserWindow | null = null;

  create() {
    const { width, height } = screen.getPrimaryDisplay().bounds;

    this.window = new BrowserWindow({
      width,
      height,
      x: 0,
      y: 0,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
      focusable: false,
      type: "panel",
      webPreferences: {
        preload: path.join(__dirname, "../preload/index.js"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    this.window.setIgnoreMouseEvents(true, { forward: true });
    this.window.setVisibleOnAllWorkspaces(true);
    this.window.setAlwaysOnTop(true, "screen-saver");

    // When HUD elements need interaction, toggle click-through off
    ipcMain.on("set-click-through", (_e, enabled: boolean) => {
      this.window?.setIgnoreMouseEvents(enabled, { forward: true });
      if (!enabled) {
        this.window?.setFocusable(true);
      } else {
        this.window?.setFocusable(false);
      }
    });

    return this.window;
  }

  loadContent() {
    if (!this.window) return;

    if (process.env.ELECTRON_RENDERER_URL) {
      this.window.loadURL(process.env.ELECTRON_RENDERER_URL);
    } else {
      this.window.loadFile(path.join(__dirname, "../renderer/index.html"));
    }
  }

  sendToRenderer(channel: string, data: any) {
    this.window?.webContents.send(channel, data);
  }

  get browserWindow() {
    return this.window;
  }
}
