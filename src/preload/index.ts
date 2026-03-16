import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("api", {
  onAnnotation: (cb: (data: any) => void) =>
    ipcRenderer.on("annotation", (_e, data) => cb(data)),
  onStatus: (cb: (data: any) => void) =>
    ipcRenderer.on("status", (_e, data) => cb(data)),
  onSpeak: (cb: (data: any) => void) =>
    ipcRenderer.on("speak", (_e, data) => cb(data)),
  onTogglePrompt: (cb: () => void) =>
    ipcRenderer.on("toggle-prompt", () => cb()),
  sendPrompt: (text: string) => ipcRenderer.send("prompt", text),
  setClickThrough: (enabled: boolean) =>
    ipcRenderer.send("set-click-through", enabled),
});
