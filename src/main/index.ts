import { app, globalShortcut, ipcMain } from "electron";
import { OverlayManager } from "./overlay";
import { AgentSession } from "./agent";

const overlayManager = new OverlayManager();
let agentSession: AgentSession | null = null;

app.whenReady().then(() => {
  overlayManager.create();
  overlayManager.loadContent();

  // Create agent session
  agentSession = new AgentSession((channel, data) => {
    overlayManager.sendToRenderer(channel, data);
  });

  // Listen for prompts from the renderer
  ipcMain.on("prompt", async (_event, text: string) => {
    if (agentSession) {
      await agentSession.execute(text);
    }
  });

  // Register global hotkey: Cmd+Shift+Space to toggle prompt bar
  globalShortcut.register("CommandOrControl+Shift+Space", () => {
    overlayManager.sendToRenderer("toggle-prompt", {});
  });
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => app.quit());

export { overlayManager };
