import { app } from "electron";
import { OverlayManager } from "./overlay";

const overlayManager = new OverlayManager();

app.whenReady().then(() => {
  overlayManager.create();
  overlayManager.loadContent();
});

app.on("window-all-closed", () => app.quit());

export { overlayManager };
