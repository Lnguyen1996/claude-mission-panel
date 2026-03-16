# Claude Mission Panel — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a JARVIS-style transparent HUD overlay for macOS/Windows that sees the screen, draws annotations, auto-clicks, types, runs commands, and speaks — powered by Claude Agent SDK.

**Architecture:** Electron app with a transparent fullscreen overlay window. Main process runs the Claude Agent SDK (TypeScript) with custom MCP tools for screen control. Renderer draws annotations on a Canvas layer with glassmorphic HUD elements (prompt bar, status pill). Voice via local Whisper (STT) + native TTS.

**Tech Stack:** Electron 33, TypeScript, React 19, @anthropic-ai/claude-agent-sdk, nut.js, screenshot-desktop, whisper-node, Canvas API

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `electron-builder.yml`
- Create: `src/main/index.ts`
- Create: `src/renderer/index.html`

**Step 1: Initialize package.json**

```json
{
  "name": "claude-mission-panel",
  "version": "0.1.0",
  "description": "JARVIS-style AI assistant overlay powered by Claude",
  "main": "dist/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "start": "electron .",
    "package": "electron-builder"
  },
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "latest",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "electron": "^33.0.0",
    "electron-builder": "^25.0.0",
    "electron-vite": "^3.0.0",
    "typescript": "^5.7.0",
    "vite": "^6.0.0",
    "@vitejs/plugin-react": "^4.0.0"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "jsx": "react-jsx",
    "declaration": true
  },
  "include": ["src/**/*"]
}
```

**Step 3: Create electron-vite config**

Create `electron.vite.config.ts`:
```typescript
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    plugins: [react()],
  },
});
```

**Step 4: Create minimal Electron main process**

`src/main/index.ts`:
```typescript
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
```

**Step 5: Create renderer HTML and entry**

`src/renderer/index.html`:
```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>Claude Mission Panel</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body, #root {
      width: 100vw;
      height: 100vh;
      overflow: hidden;
      background: transparent;
    }
  </style>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="./src/main.tsx"></script>
</body>
</html>
```

`src/renderer/src/main.tsx`:
```tsx
import React from "react";
import { createRoot } from "react-dom/client";

function App() {
  return <div style={{ width: "100vw", height: "100vh" }} />;
}

createRoot(document.getElementById("root")!).render(<App />);
```

**Step 6: Create preload script**

`src/preload/index.ts`:
```typescript
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("api", {
  onAnnotation: (cb: (data: any) => void) =>
    ipcRenderer.on("annotation", (_e, data) => cb(data)),
  onStatus: (cb: (data: any) => void) =>
    ipcRenderer.on("status", (_e, data) => cb(data)),
  onSpeak: (cb: (data: any) => void) =>
    ipcRenderer.on("speak", (_e, data) => cb(data)),
  sendPrompt: (text: string) => ipcRenderer.send("prompt", text),
  setClickThrough: (enabled: boolean) =>
    ipcRenderer.send("set-click-through", enabled),
});
```

**Step 7: Install dependencies and verify build**

Run: `cd /Users/lamnguyen/Documents/repos/claude-mission-panel && npm install`
Run: `npx electron-vite build`
Expected: Build succeeds, `dist/` created

**Step 8: Commit**

```bash
git add -A
git commit -m "feat: scaffold Electron + React + TypeScript project"
```

---

### Task 2: Transparent Overlay Window with Click-Through

**Files:**
- Modify: `src/main/index.ts`
- Create: `src/main/overlay.ts`

**Step 1: Create overlay window manager**

`src/main/overlay.ts`:
```typescript
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
    });

    return this.window;
  }

  sendToRenderer(channel: string, data: any) {
    this.window?.webContents.send(channel, data);
  }

  get browserWindow() {
    return this.window;
  }
}
```

**Step 2: Update main process to use OverlayManager**

Update `src/main/index.ts` to import and use `OverlayManager`.

**Step 3: Verify transparent window launches**

Run: `npm run dev`
Expected: A transparent fullscreen window appears, desktop is visible through it, mouse clicks pass through to desktop.

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: transparent fullscreen overlay with click-through"
```

---

### Task 3: HUD Components (Prompt Bar + Status Pill)

**Files:**
- Create: `src/renderer/src/hud/PromptBar.tsx`
- Create: `src/renderer/src/hud/StatusPill.tsx`
- Create: `src/renderer/src/hud/HUD.tsx`
- Create: `src/renderer/src/styles/hud.css`
- Modify: `src/renderer/src/main.tsx`

**Step 1: Create glassmorphic CSS**

`src/renderer/src/styles/hud.css`:
```css
.hud-prompt-bar {
  position: fixed;
  bottom: 40px;
  left: 50%;
  transform: translateX(-50%);
  width: 600px;
  padding: 12px 20px;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 16px;
  display: flex;
  align-items: center;
  gap: 12px;
  z-index: 9999;
}

.hud-prompt-bar input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  color: #fff;
  font-size: 16px;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
}

.hud-prompt-bar input::placeholder {
  color: rgba(255, 255, 255, 0.4);
}

.hud-status-pill {
  position: fixed;
  top: 20px;
  right: 20px;
  padding: 8px 16px;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 20px;
  color: #fff;
  font-size: 13px;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
  display: flex;
  align-items: center;
  gap: 8px;
  z-index: 9999;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #4ade80;
}

.status-dot.thinking {
  background: #facc15;
  animation: pulse 1.5s ease-in-out infinite;
}

.status-dot.executing {
  background: #60a5fa;
  animation: pulse 0.8s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(1.3); }
}
```

**Step 2: Create PromptBar component**

`src/renderer/src/hud/PromptBar.tsx` — input bar at bottom center. On Enter, calls `window.api.sendPrompt(text)` and hides. On Escape, hides.

**Step 3: Create StatusPill component**

`src/renderer/src/hud/StatusPill.tsx` — shows status dot + label text. Receives status via `window.api.onStatus()`.

**Step 4: Create HUD layout wrapper**

`src/renderer/src/hud/HUD.tsx` — renders PromptBar + StatusPill. Manages show/hide state for prompt bar.

**Step 5: Wire HUD into main App, handle mouse enter/leave for click-through toggle**

When mouse enters a HUD element, call `window.api.setClickThrough(false)`. On leave, call `window.api.setClickThrough(true)`.

**Step 6: Verify HUD renders**

Run: `npm run dev`
Expected: Glassmorphic prompt bar at bottom, status pill at top-right. Typing in prompt bar works. Clicking elsewhere passes through to desktop.

**Step 7: Commit**

```bash
git add -A
git commit -m "feat: glassmorphic HUD with prompt bar and status pill"
```

---

### Task 4: Annotation Canvas Layer

**Files:**
- Create: `src/renderer/src/canvas/AnnotationLayer.tsx`
- Create: `src/renderer/src/canvas/animations.ts`
- Modify: `src/renderer/src/hud/HUD.tsx`

**Step 1: Create annotation types**

```typescript
type Annotation = {
  id: string;
  type: "circle" | "arrow" | "highlight" | "label";
  x: number;
  y: number;
  x2?: number; // for arrows
  y2?: number;
  color?: string;
  text?: string;
  pulse?: boolean;
  fadeMs?: number;
};
```

**Step 2: Create AnnotationLayer canvas component**

Full-screen `<canvas>` that draws annotations received via IPC. Uses requestAnimationFrame for smooth pulse/glow/fade animations.

**Step 3: Create animation helpers**

`animations.ts` — `drawPulsingCircle()`, `drawArrow()`, `drawHighlight()`, `drawLabel()`, `fadeOut()`.

**Step 4: Wire annotations from IPC**

Listen to `window.api.onAnnotation()` → add/remove annotations from canvas state.

**Step 5: Verify annotations render**

Test by sending mock annotation data from main process.
Expected: Red pulsing circles appear on screen, arrows point between coordinates, fade out after timeout.

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: annotation canvas layer with pulse/glow/fade animations"
```

---

### Task 5: Screen Control Tools (Screenshot + Mouse + Keyboard)

**Files:**
- Create: `src/main/tools/screenshot.ts`
- Create: `src/main/tools/mouse.ts`
- Create: `src/main/tools/keyboard.ts`

**Step 1: Install screen control dependencies**

Run: `npm install screenshot-desktop @nut-tree-fork/nut-js`

Note: `@nut-tree-fork/nut-js` is the maintained fork of nut.js for Node 20+.

**Step 2: Create screenshot tool**

`src/main/tools/screenshot.ts`:
```typescript
import screenshot from "screenshot-desktop";

export async function captureScreen(): Promise<string> {
  const img = await screenshot({ format: "png" });
  return img.toString("base64");
}
```

**Step 3: Create mouse control tool**

`src/main/tools/mouse.ts` — uses nut.js for `click(x, y, button)`, `move(x, y)`, `scroll(direction, amount)`, `drag(x1, y1, x2, y2)`.

**Step 4: Create keyboard control tool**

`src/main/tools/keyboard.ts` — uses nut.js for `type(text)`, `shortcut(keys[])`.

**Step 5: Verify screen control works**

Write a quick test: screenshot → check base64 length > 0, move mouse → verify cursor moved.

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: screen control tools (screenshot, mouse, keyboard)"
```

---

### Task 6: Shell Command Tool

**Files:**
- Create: `src/main/tools/command.ts`

**Step 1: Create command execution tool**

`src/main/tools/command.ts`:
```typescript
import { exec } from "child_process";

export function runCommand(command: string, timeout = 30000): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    exec(command, { timeout, shell: process.platform === "win32" ? "powershell.exe" : "/bin/zsh" }, (error, stdout, stderr) => {
      resolve({
        stdout: stdout.toString(),
        stderr: stderr.toString(),
        exitCode: error?.code ?? 0,
      });
    });
  });
}
```

**Step 2: Commit**

```bash
git add -A
git commit -m "feat: shell command execution tool"
```

---

### Task 7: Claude Agent SDK Integration

**Files:**
- Create: `src/main/agent.ts`
- Create: `src/main/tools/mcp-server.ts`
- Modify: `src/main/index.ts`

**Step 1: Create MCP server with custom tools**

`src/main/tools/mcp-server.ts` — uses `createSdkMcpServer` and `tool` from the Agent SDK to define all screen control tools as MCP tools:

```typescript
import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { captureScreen } from "./screenshot";
import { click, move, scroll, drag } from "./mouse";
import { type as typeText, shortcut } from "./keyboard";
import { runCommand } from "./command";

const screenshotTool = tool(
  "screenshot",
  "Capture the screen and return base64 PNG image",
  {},
  async () => {
    const base64 = await captureScreen();
    return { content: [{ type: "image", data: base64, mimeType: "image/png" }] };
  }
);

const mouseClickTool = tool(
  "mouse_click",
  "Click at screen coordinates",
  { x: z.number(), y: z.number(), button: z.enum(["left", "right", "double"]).optional() },
  async ({ x, y, button }) => {
    await click(x, y, button ?? "left");
    return { content: [{ type: "text", text: `Clicked at (${x}, ${y})` }] };
  }
);

// ... similar for mouse_move, mouse_scroll, mouse_drag, keyboard_type,
// keyboard_shortcut, run_command, draw_annotation, clear_annotations, speak, wait

export function createMissionTools(sendToOverlay: (channel: string, data: any) => void) {
  const drawAnnotationTool = tool(
    "draw_annotation",
    "Draw a visual annotation on the screen overlay",
    {
      type: z.enum(["circle", "arrow", "highlight", "label"]),
      x: z.number(),
      y: z.number(),
      x2: z.number().optional(),
      y2: z.number().optional(),
      color: z.string().optional(),
      text: z.string().optional(),
      pulse: z.boolean().optional(),
    },
    async (args) => {
      sendToOverlay("annotation", { action: "add", ...args, id: crypto.randomUUID() });
      return { content: [{ type: "text", text: `Drew ${args.type} at (${args.x}, ${args.y})` }] };
    }
  );

  const clearAnnotationsTool = tool(
    "clear_annotations",
    "Remove all annotations from the screen overlay",
    {},
    async () => {
      sendToOverlay("annotation", { action: "clear" });
      return { content: [{ type: "text", text: "Annotations cleared" }] };
    }
  );

  return createSdkMcpServer({
    name: "mission-panel-tools",
    tools: [
      screenshotTool, mouseClickTool, /* all other tools */,
      drawAnnotationTool, clearAnnotationsTool,
    ],
  });
}
```

**Step 2: Create agent session manager**

`src/main/agent.ts`:
```typescript
import { query, ClaudeAgentOptions } from "@anthropic-ai/claude-agent-sdk";
import { createMissionTools } from "./tools/mcp-server";

const SYSTEM_PROMPT = `You are JARVIS, an AI assistant that controls the user's computer screen.

Rules:
- Always call screenshot first to see the current screen state before acting
- Call draw_annotation to show the user what you're about to do (draw a circle on the target)
- Then perform the action (click, type, etc.)
- Call screenshot again to verify the action succeeded
- Call speak to give brief status updates ("Clicking Settings", "Done")
- For terminal tasks, use run_command and report results via speak
- If unsure about a destructive action, ask the user via speak before proceeding
- Be concise. Speak in short phrases, not paragraphs.`;

export class AgentSession {
  private sendToOverlay: (channel: string, data: any) => void;

  constructor(sendToOverlay: (channel: string, data: any) => void) {
    this.sendToOverlay = sendToOverlay;
  }

  async execute(prompt: string) {
    this.sendToOverlay("status", { state: "thinking", text: "Thinking..." });

    const mcpServer = createMissionTools(this.sendToOverlay);

    for await (const message of query({
      prompt,
      options: {
        systemPrompt: SYSTEM_PROMPT,
        mcpServers: { "mission-tools": mcpServer },
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        maxTurns: 50,
      },
    })) {
      if ("result" in message) {
        this.sendToOverlay("status", { state: "idle", text: "Ready" });
      }
    }
  }
}
```

**Step 3: Wire agent to IPC in main process**

In `src/main/index.ts`, listen for `prompt` IPC from renderer → call `agentSession.execute(prompt)`.

**Step 4: Verify agent responds to prompts**

Run: `npm run dev`, type "take a screenshot" in prompt bar.
Expected: Agent captures screen and responds.

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: Claude Agent SDK integration with custom MCP tools"
```

---

### Task 8: Global Hotkey

**Files:**
- Modify: `src/main/index.ts`

**Step 1: Register global shortcut**

```typescript
import { globalShortcut } from "electron";

globalShortcut.register("CommandOrControl+Shift+Space", () => {
  overlayManager.sendToRenderer("toggle-prompt", {});
});
```

**Step 2: Handle toggle in renderer**

PromptBar listens for `toggle-prompt` event, shows/hides, and toggles click-through accordingly.

**Step 3: Verify hotkey works**

Press Cmd+Shift+Space → prompt bar appears. Press again → hides.

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: global hotkey (Cmd+Shift+Space) to toggle prompt bar"
```

---

### Task 9: Text-to-Speech

**Files:**
- Create: `src/main/voice/tts.ts`
- Modify: `src/main/tools/mcp-server.ts`

**Step 1: Create TTS module**

`src/main/voice/tts.ts`:
```typescript
import { exec } from "child_process";

export function speak(text: string): Promise<void> {
  return new Promise((resolve) => {
    if (process.platform === "darwin") {
      exec(`say "${text.replace(/"/g, '\\"')}"`, () => resolve());
    } else {
      // Windows: use PowerShell SAPI
      exec(`powershell -Command "Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak('${text.replace(/'/g, "''")}')"`, () => resolve());
    }
  });
}
```

**Step 2: Wire speak tool to TTS**

Update the `speak` MCP tool to call the `speak()` function.

**Step 3: Verify TTS works**

Type prompt "say hello" → agent calls speak tool → Mac says "Hello".

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: text-to-speech (macOS say + Windows SAPI)"
```

---

### Task 10: Speech-to-Text (Whisper)

**Files:**
- Create: `src/main/voice/whisper.ts`
- Create: `src/main/voice/wakeword.ts`
- Modify: `src/main/index.ts`

**Step 1: Install whisper dependency**

Run: `npm install whisper-node`

**Step 2: Create Whisper STT module**

`src/main/voice/whisper.ts` — records audio from mic, sends to local Whisper model, returns transcription text.

**Step 3: Create wake word detection**

`src/main/voice/wakeword.ts` — simple approach: continuously listen with a small audio buffer, run Whisper on it, check if "hey claude" is in the transcription.

**Step 4: Wire to agent**

When wake word detected or push-to-talk hotkey (Cmd+Shift+V) released → transcribe full utterance → send to `agentSession.execute()`.

**Step 5: Verify voice input works**

Say "Hey Claude, what time is it" → agent responds.

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: speech-to-text with local Whisper + wake word detection"
```

---

### Task 11: End-to-End Integration Test

**Step 1: Manual test flow**

1. Launch app: `npm run dev`
2. Press Cmd+Shift+Space → prompt bar appears
3. Type: "Open Safari" → agent screenshots, draws circle on Safari icon, clicks it, speaks "Opening Safari"
4. Type: "Click the search bar and type hello" → agent finds search bar, circles it, clicks, types
5. Say "Hey Claude, close this window" → voice recognized, agent presses Cmd+W
6. Type: "Run ls -la in terminal" → agent runs command, shows output on HUD

**Step 2: Fix any issues found**

**Step 3: Commit**

```bash
git add -A
git commit -m "fix: integration test fixes"
```

---

### Task 12: Electron Builder Config + Package

**Files:**
- Modify: `electron-builder.yml`

**Step 1: Configure electron-builder**

```yaml
appId: com.lamnguyen.claude-mission-panel
productName: Claude Mission Panel
directories:
  output: release
mac:
  target: dmg
  icon: assets/icon.png
  category: public.app-category.utilities
  extendInfo:
    NSMicrophoneUsageDescription: "Claude Mission Panel needs microphone access for voice commands"
    NSAppleEventsUsageDescription: "Claude Mission Panel needs accessibility for screen control"
win:
  target: nsis
  icon: assets/icon.png
```

**Step 2: Build package**

Run: `npm run build && npm run package`
Expected: DMG for macOS, NSIS installer for Windows in `release/`

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: electron-builder config for macOS + Windows packaging"
```

---

## Execution Notes

- **macOS Accessibility permissions**: The app needs Accessibility permission for mouse/keyboard control. On first run, macOS will prompt. Grant it in System Settings > Privacy & Security > Accessibility.
- **Microphone permission**: Required for voice input. macOS will prompt on first mic access.
- **nut.js on macOS**: May need `@nut-tree-fork/nut-js` instead of `nut-js` for Apple Silicon compatibility.
- **Whisper model download**: First run will download the Whisper base model (~75MB). This happens once.
- **Agent SDK requires Claude Code CLI**: The `@anthropic-ai/claude-agent-sdk` package requires the Claude Code CLI to be installed and authenticated.
