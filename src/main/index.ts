import { app, BrowserWindow, screen } from "electron";
import path from "path";

let overlayWindow: BrowserWindow | null = null;

function createOverlayWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  overlayWindow = new BrowserWindow({
    width,
    height,
    x: 0,
    y: 0,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Click-through: mouse events pass to windows below
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });

  if (process.env.ELECTRON_RENDERER_URL) {
    overlayWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    overlayWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(createOverlayWindow);
app.on("window-all-closed", () => app.quit());
