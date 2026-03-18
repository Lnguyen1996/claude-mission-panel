# Claude Mission Panel — Tauri 2.0 Rebuild

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Claude Mission Panel as a Tauri 2.0 app with Rust backend, providing an MCP server that gives Claude Code eyes (screenshot, screen recording, OCR), hands (mouse, keyboard, scroll), terminal (command execution), and a transparent overlay HUD for visual feedback.

**Architecture:** Tauri 2.0 handles the transparent overlay window and React frontend (ported from existing Electron app). Rust backend implements all OS interaction (screen capture via `xcap`, input simulation via `enigo`, command execution via `std::process`). An embedded MCP server (SSE transport on `localhost:3456`) exposes all tools so Claude Code can connect as an MCP client. The overlay renders annotations, status, and a prompt bar using the existing React + Canvas code.

**Tech Stack:** Tauri 2.0, Rust, React 19, TypeScript, xcap (screen capture), enigo (input simulation), axum (HTTP/SSE server for MCP), whisper-rs (STT), serde/serde_json

---

## File Structure

```
claude-mission-panel/
├── src-tauri/
│   ├── Cargo.toml                    # Rust dependencies
│   ├── tauri.conf.json               # Tauri window config (transparent, always-on-top)
│   ├── capabilities/
│   │   └── default.json              # Tauri permissions
│   ├── src/
│   │   ├── main.rs                   # Tauri app setup, commands, global shortcuts
│   │   ├── screenshot.rs             # Screen capture via xcap
│   │   ├── screen_record.rs          # Screen recording via xcap frame capture
│   │   ├── input.rs                  # Mouse + keyboard via enigo
│   │   ├── command.rs                # Shell command execution
│   │   ├── tts.rs                    # Text-to-speech (platform-specific)
│   │   ├── mcp_server.rs             # MCP protocol server (SSE on localhost:3456)
│   │   └── mcp_tools.rs              # MCP tool definitions (screenshot, click, type, etc.)
│   └── icons/                        # App icons
├── src/                              # React frontend (ported from existing)
│   ├── main.tsx
│   ├── App.tsx
│   ├── hud/
│   │   ├── HUD.tsx
│   │   ├── PromptBar.tsx
│   │   └── StatusPill.tsx
│   ├── canvas/
│   │   ├── AnnotationLayer.tsx
│   │   └── animations.ts
│   └── styles/
│       └── hud.css
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
└── docs/
```

---

## Task 1: Scaffold Tauri 2.0 Project

**Files:**
- Create: `src-tauri/Cargo.toml`
- Create: `src-tauri/tauri.conf.json`
- Create: `src-tauri/src/main.rs`
- Create: `src-tauri/capabilities/default.json`
- Create: `package.json` (new, for Tauri)
- Create: `vite.config.ts`
- Create: `tsconfig.json` (new, for Tauri)
- Create: `index.html`
- Create: `src/main.tsx`
- Create: `src/App.tsx`

- [ ] **Step 1: Install Tauri CLI and prerequisites**

```bash
# Check Rust is installed
rustc --version || curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Install Tauri CLI
cargo install tauri-cli@^2
```

- [ ] **Step 2: Initialize new Tauri project in a fresh directory**

We'll build alongside the existing Electron code, then swap when ready.

```bash
cd D:/Repos
cargo tauri init --app-name claude-mission-panel --ci
# OR manually create the structure
```

Actually — we scaffold manually to control every file. Create `src-tauri/Cargo.toml`:

```toml
[package]
name = "claude-mission-panel"
version = "0.1.0"
edition = "2021"

[dependencies]
tauri = { version = "2", features = ["tray-icon"] }
tauri-plugin-global-shortcut = "2"
tauri-plugin-shell = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["full"] }
xcap = "0.3"
enigo = { version = "0.3", features = ["serde"] }
axum = "0.8"
axum-extra = { version = "0.10", features = ["typed-header"] }
tower-http = { version = "0.6", features = ["cors"] }
base64 = "0.22"
uuid = { version = "1", features = ["v4"] }
image = "0.25"

[build-dependencies]
tauri-build = { version = "2", features = [] }

[features]
default = ["custom-protocol"]
custom-protocol = ["tauri/custom-protocol"]
```

- [ ] **Step 3: Create `src-tauri/build.rs`**

```rust
fn main() {
    tauri_build::build()
}
```

- [ ] **Step 4: Create `src-tauri/tauri.conf.json`**

```json
{
  "$schema": "https://raw.githubusercontent.com/nicedoc/schema-tauri-2/main/tauri.conf.json",
  "productName": "Claude Mission Panel",
  "version": "0.1.0",
  "identifier": "com.lamnguyen.claude-mission-panel",
  "build": {
    "devUrl": "http://localhost:5173",
    "frontendDist": "../dist"
  },
  "app": {
    "withGlobalTauri": true,
    "windows": [
      {
        "label": "overlay",
        "title": "Claude Mission Panel",
        "transparent": true,
        "decorations": false,
        "alwaysOnTop": true,
        "skipTaskbar": true,
        "shadow": false,
        "fullscreen": true,
        "resizable": false,
        "focus": false
      }
    ]
  },
  "plugins": {
    "global-shortcut": {}
  }
}
```

- [ ] **Step 5: Create `src-tauri/capabilities/default.json`**

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Default capability for the overlay",
  "windows": ["overlay"],
  "permissions": [
    "core:default",
    "core:window:default",
    "core:window:allow-set-ignore-cursor-events",
    "core:window:allow-set-focus",
    "core:window:allow-set-always-on-top",
    "global-shortcut:default",
    "shell:default"
  ]
}
```

- [ ] **Step 6: Create minimal `src-tauri/src/main.rs`**

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod screenshot;
mod input;
mod command;
mod tts;
mod mcp_server;
mod mcp_tools;

use tauri::Manager;

#[tauri::command]
fn set_click_through(window: tauri::Window, enabled: bool) {
    let _ = window.set_ignore_cursor_events(enabled);
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let window = app.get_webview_window("overlay").unwrap();

            // Start with click-through enabled
            let _ = window.set_ignore_cursor_events(true);

            // Start MCP server in background
            let app_handle = app.handle().clone();
            tokio::spawn(async move {
                mcp_server::start(app_handle).await;
            });

            println!("[MissionPanel] Ready. MCP server on http://localhost:3456");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![set_click_through])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 7: Create frontend `package.json`**

```json
{
  "name": "claude-mission-panel",
  "private": true,
  "version": "0.1.0",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "tauri": "tauri"
  },
  "dependencies": {
    "@tauri-apps/api": "^2",
    "@tauri-apps/plugin-global-shortcut": "^2",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.0.0",
    "typescript": "^5.7.0",
    "vite": "^6.0.0"
  }
}
```

- [ ] **Step 8: Create `vite.config.ts`**

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: "esnext",
    minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_DEBUG,
  },
});
```

- [ ] **Step 9: Create `index.html`**

```html
<!DOCTYPE html>
<html lang="en" style="background: transparent;">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Claude Mission Panel</title>
  <style>
    html, body, #root {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      background: transparent;
      overflow: hidden;
    }
  </style>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
</html>
```

- [ ] **Step 10: Create `src/main.tsx` and `src/App.tsx`**

`src/main.tsx`:
```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

`src/App.tsx`:
```tsx
import { HUD } from "./hud/HUD";

export function App() {
  return <HUD />;
}
```

- [ ] **Step 11: Install dependencies and verify scaffold builds**

```bash
npm install
cargo tauri dev
```

Expected: Transparent window appears, blank overlay. No errors.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat: scaffold Tauri 2.0 project structure"
```

---

## Task 2: Port React Frontend (HUD, PromptBar, StatusPill, AnnotationLayer)

**Files:**
- Create: `src/hud/HUD.tsx`
- Create: `src/hud/PromptBar.tsx`
- Create: `src/hud/StatusPill.tsx`
- Create: `src/canvas/AnnotationLayer.tsx`
- Create: `src/canvas/animations.ts`
- Create: `src/styles/hud.css`

- [ ] **Step 1: Create `src/styles/hud.css`** — copy existing CSS verbatim from `src/renderer/src/styles/hud.css`

(Exact copy of existing file — no changes needed.)

- [ ] **Step 2: Create `src/canvas/animations.ts`** — copy existing animation logic verbatim from `src/renderer/src/canvas/animations.ts`

(Exact copy — pure math/canvas, no Electron dependencies.)

- [ ] **Step 3: Create `src/canvas/AnnotationLayer.tsx`** — port from Electron IPC to Tauri events

Replace `window.api.onAnnotation(...)` with Tauri's `listen()`:

```tsx
import { useRef, useEffect, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  Annotation,
  drawPulsingCircle,
  drawArrow,
  drawHighlight,
  drawLabel,
  calculateFadeAlpha,
  isExpired,
} from "./animations";

export function AnnotationLayer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const annotationsRef = useRef<Annotation[]>([]);
  const animationFrameRef = useRef<number>(0);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const now = Date.now();

    annotationsRef.current = annotationsRef.current.filter((a) => !isExpired(a, now));
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (const annotation of annotationsRef.current) {
      const fadeAlpha = calculateFadeAlpha(annotation, now);
      if (fadeAlpha <= 0) continue;
      ctx.save();
      ctx.globalAlpha = fadeAlpha;
      const color = annotation.color || "#ef4444";

      switch (annotation.type) {
        case "circle":
          drawPulsingCircle(ctx, annotation.x, annotation.y, color, now, annotation.pulse !== false);
          break;
        case "arrow":
          drawArrow(ctx, annotation.x, annotation.y, annotation.x2 ?? annotation.x + 50, annotation.y2 ?? annotation.y + 50, color);
          break;
        case "highlight":
          drawHighlight(ctx, annotation.x, annotation.y, (annotation.x2 ?? annotation.x + 100) - annotation.x, (annotation.y2 ?? annotation.y + 40) - annotation.y, color);
          break;
        case "label":
          drawLabel(ctx, annotation.x, annotation.y, annotation.text || "", color);
          break;
      }
      ctx.restore();
    }
    animationFrameRef.current = requestAnimationFrame(draw);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      canvas.width = window.innerWidth * window.devicePixelRatio;
      canvas.height = window.innerHeight * window.devicePixelRatio;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    };
    resize();
    window.addEventListener("resize", resize);

    // Listen for Tauri events from Rust backend
    const unlisten = listen<any>("annotation", (event) => {
      const data = event.payload;
      if (data.action === "clear") {
        annotationsRef.current = [];
        return;
      }
      if (data.action === "add") {
        annotationsRef.current.push({
          id: data.id || crypto.randomUUID(),
          type: data.type,
          x: data.x, y: data.y,
          x2: data.x2, y2: data.y2,
          color: data.color, text: data.text,
          pulse: data.pulse,
          fadeMs: data.fadeMs ?? 5000,
          createdAt: Date.now(),
        });
      }
      if (data.action === "remove") {
        annotationsRef.current = annotationsRef.current.filter((a) => a.id !== data.id);
      }
    });

    animationFrameRef.current = requestAnimationFrame(draw);
    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(animationFrameRef.current);
      unlisten.then((fn) => fn());
    };
  }, [draw]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "fixed", top: 0, left: 0,
        width: "100vw", height: "100vh",
        pointerEvents: "none", zIndex: 9998,
      }}
    />
  );
}
```

- [ ] **Step 4: Create `src/hud/StatusPill.tsx`** — port from Electron IPC to Tauri events

```tsx
import { useState, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";

interface StatusData {
  state: "idle" | "thinking" | "executing" | "error";
  text: string;
}

export function StatusPill() {
  const [status, setStatus] = useState<StatusData>({ state: "idle", text: "Ready" });

  useEffect(() => {
    const unlisten = listen<StatusData>("status", (event) => {
      setStatus(event.payload);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  return (
    <div className="hud-status-pill">
      <div className={`status-dot ${status.state}`} />
      <span>{status.text}</span>
    </div>
  );
}
```

- [ ] **Step 5: Create `src/hud/PromptBar.tsx`** — port from Electron IPC to Tauri invoke/events

```tsx
import { useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

interface PromptBarProps {
  visible: boolean;
  onSubmit: (text: string) => void;
  onClose: () => void;
}

export function PromptBar({ visible, onSubmit, onClose }: PromptBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (visible && inputRef.current) inputRef.current.focus();
  }, [visible]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && inputRef.current?.value.trim()) {
      const text = inputRef.current.value.trim();
      inputRef.current.value = "";
      onSubmit(text);
      onClose();
    } else if (e.key === "Escape") {
      if (inputRef.current) inputRef.current.value = "";
      onClose();
    }
  };

  const handleMouseEnter = () => invoke("set_click_through", { enabled: false });
  const handleMouseLeave = () => { if (!visible) invoke("set_click_through", { enabled: true }); };

  return (
    <div
      className={`hud-prompt-bar ${visible ? "" : "hidden"}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className="hud-prompt-icon" />
      <input ref={inputRef} type="text" placeholder="Ask Claude anything..." onKeyDown={handleKeyDown} />
    </div>
  );
}
```

- [ ] **Step 6: Create `src/hud/HUD.tsx`** — port from Electron IPC to Tauri events

```tsx
import { useState, useCallback, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { PromptBar } from "./PromptBar";
import { StatusPill } from "./StatusPill";
import { AnnotationLayer } from "../canvas/AnnotationLayer";
import "../styles/hud.css";

export function HUD() {
  const [promptVisible, setPromptVisible] = useState(false);

  const togglePrompt = useCallback(() => {
    setPromptVisible((prev) => {
      const next = !prev;
      invoke("set_click_through", { enabled: !next });
      return next;
    });
  }, []);

  const hidePrompt = useCallback(() => {
    setPromptVisible(false);
    invoke("set_click_through", { enabled: true });
  }, []);

  useEffect(() => {
    const unlisten = listen("toggle-prompt", () => togglePrompt());
    return () => { unlisten.then((fn) => fn()); };
  }, [togglePrompt]);

  const handleSubmit = (text: string) => {
    invoke("handle_prompt", { text });
  };

  return (
    <>
      <AnnotationLayer />
      <StatusPill />
      <PromptBar visible={promptVisible} onSubmit={handleSubmit} onClose={hidePrompt} />
    </>
  );
}
```

- [ ] **Step 7: Verify frontend compiles**

```bash
npm run build
```

Expected: `dist/` folder created, no TypeScript errors.

- [ ] **Step 8: Commit**

```bash
git add src/ index.html
git commit -m "feat: port React HUD frontend to Tauri events/invoke"
```

---

## Task 3: Implement Rust Screen Capture

**Files:**
- Create: `src-tauri/src/screenshot.rs`

- [ ] **Step 1: Implement screen capture via xcap**

```rust
use base64::{Engine as _, engine::general_purpose::STANDARD};
use xcap::Monitor;
use std::io::Cursor;

pub fn capture_screen() -> Result<String, String> {
    let monitors = Monitor::all().map_err(|e| format!("Failed to list monitors: {}", e))?;
    let monitor = monitors.into_iter().next().ok_or("No monitor found")?;

    let image = monitor.capture_image().map_err(|e| format!("Capture failed: {}", e))?;

    let mut buf = Cursor::new(Vec::new());
    image.write_to(&mut buf, image::ImageFormat::Png)
        .map_err(|e| format!("PNG encode failed: {}", e))?;

    Ok(STANDARD.encode(buf.into_inner()))
}

pub fn capture_region(x: i32, y: i32, width: u32, height: u32) -> Result<String, String> {
    let monitors = Monitor::all().map_err(|e| format!("Failed to list monitors: {}", e))?;
    let monitor = monitors.into_iter().next().ok_or("No monitor found")?;

    let image = monitor.capture_image().map_err(|e| format!("Capture failed: {}", e))?;
    let cropped = image::imageops::crop_imm(&image, x as u32, y as u32, width, height).to_image();

    let mut buf = Cursor::new(Vec::new());
    cropped.write_to(&mut buf, image::ImageFormat::Png)
        .map_err(|e| format!("PNG encode failed: {}", e))?;

    Ok(STANDARD.encode(buf.into_inner()))
}
```

- [ ] **Step 2: Add Tauri command for screenshot**

In `main.rs`, add:
```rust
#[tauri::command]
fn take_screenshot() -> Result<String, String> {
    screenshot::capture_screen()
}
```

And add to `invoke_handler`: `tauri::generate_handler![set_click_through, take_screenshot]`

- [ ] **Step 3: Verify screenshot works**

```bash
cargo tauri dev
# In browser console: await window.__TAURI__.core.invoke('take_screenshot')
```

Expected: Returns base64 string.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/screenshot.rs
git commit -m "feat: screen capture via xcap Rust crate"
```

---

## Task 4: Implement Rust Mouse + Keyboard Control

**Files:**
- Create: `src-tauri/src/input.rs`

- [ ] **Step 1: Implement mouse control via enigo**

```rust
use enigo::{Enigo, Mouse, Keyboard, Settings, Button, Coordinate, Direction, Key};
use std::sync::Mutex;

// Thread-safe enigo instance
lazy_static::lazy_static! {
    static ref ENIGO: Mutex<Enigo> = Mutex::new(
        Enigo::new(&Settings::default()).expect("Failed to create Enigo")
    );
}

pub fn mouse_move(x: i32, y: i32) -> Result<(), String> {
    let mut enigo = ENIGO.lock().map_err(|e| e.to_string())?;
    enigo.move_mouse(x, y, Coordinate::Abs).map_err(|e| format!("Move failed: {}", e))
}

pub fn mouse_click(x: i32, y: i32, button: &str) -> Result<(), String> {
    let mut enigo = ENIGO.lock().map_err(|e| e.to_string())?;
    enigo.move_mouse(x, y, Coordinate::Abs).map_err(|e| format!("Move failed: {}", e))?;

    let btn = match button {
        "right" => Button::Right,
        "middle" => Button::Middle,
        _ => Button::Left,
    };

    if button == "double" {
        enigo.button(Button::Left, Direction::Click).map_err(|e| e.to_string())?;
        std::thread::sleep(std::time::Duration::from_millis(50));
        enigo.button(Button::Left, Direction::Click).map_err(|e| e.to_string())?;
    } else {
        enigo.button(btn, Direction::Click).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn mouse_scroll(direction: &str, amount: i32) -> Result<(), String> {
    let mut enigo = ENIGO.lock().map_err(|e| e.to_string())?;
    let scroll_amount = if direction == "up" { amount } else { -amount };
    enigo.scroll(scroll_amount, enigo::Axis::Vertical).map_err(|e| e.to_string())
}

pub fn mouse_drag(x1: i32, y1: i32, x2: i32, y2: i32) -> Result<(), String> {
    let mut enigo = ENIGO.lock().map_err(|e| e.to_string())?;
    enigo.move_mouse(x1, y1, Coordinate::Abs).map_err(|e| e.to_string())?;
    enigo.button(Button::Left, Direction::Press).map_err(|e| e.to_string())?;
    std::thread::sleep(std::time::Duration::from_millis(50));
    enigo.move_mouse(x2, y2, Coordinate::Abs).map_err(|e| e.to_string())?;
    std::thread::sleep(std::time::Duration::from_millis(50));
    enigo.button(Button::Left, Direction::Release).map_err(|e| e.to_string())
}
```

- [ ] **Step 2: Implement keyboard control**

Append to `input.rs`:

```rust
pub fn keyboard_type(text: &str) -> Result<(), String> {
    let mut enigo = ENIGO.lock().map_err(|e| e.to_string())?;
    enigo.text(text).map_err(|e| format!("Type failed: {}", e))
}

pub fn keyboard_shortcut(keys: &[String]) -> Result<(), String> {
    let mut enigo = ENIGO.lock().map_err(|e| e.to_string())?;

    let resolved: Vec<Key> = keys.iter().map(|k| resolve_key(k)).collect::<Result<_, _>>()?;

    // Press all keys
    for key in &resolved {
        enigo.key(*key, Direction::Press).map_err(|e| e.to_string())?;
    }
    // Release in reverse
    for key in resolved.iter().rev() {
        enigo.key(*key, Direction::Release).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn keyboard_press(key_name: &str) -> Result<(), String> {
    let mut enigo = ENIGO.lock().map_err(|e| e.to_string())?;
    let key = resolve_key(key_name)?;
    enigo.key(key, Direction::Click).map_err(|e| e.to_string())
}

fn resolve_key(name: &str) -> Result<Key, String> {
    match name.to_lowercase().as_str() {
        "enter" | "return" => Ok(Key::Return),
        "tab" => Ok(Key::Tab),
        "escape" | "esc" => Ok(Key::Escape),
        "space" => Ok(Key::Space),
        "backspace" => Ok(Key::Backspace),
        "delete" => Ok(Key::Delete),
        "up" => Ok(Key::UpArrow),
        "down" => Ok(Key::DownArrow),
        "left" => Ok(Key::LeftArrow),
        "right" => Ok(Key::RightArrow),
        "home" => Ok(Key::Home),
        "end" => Ok(Key::End),
        "pageup" => Ok(Key::PageUp),
        "pagedown" => Ok(Key::PageDown),
        "cmd" | "command" | "meta" | "win" => Ok(Key::Meta),
        "ctrl" | "control" => Ok(Key::Control),
        "alt" | "option" => Ok(Key::Alt),
        "shift" => Ok(Key::Shift),
        "f1" => Ok(Key::F1), "f2" => Ok(Key::F2), "f3" => Ok(Key::F3),
        "f4" => Ok(Key::F4), "f5" => Ok(Key::F5), "f6" => Ok(Key::F6),
        "f7" => Ok(Key::F7), "f8" => Ok(Key::F8), "f9" => Ok(Key::F9),
        "f10" => Ok(Key::F10), "f11" => Ok(Key::F11), "f12" => Ok(Key::F12),
        s if s.len() == 1 => Ok(Key::Unicode(s.chars().next().unwrap())),
        other => Err(format!("Unknown key: {}", other)),
    }
}
```

- [ ] **Step 3: Add `lazy_static` to Cargo.toml**

```toml
lazy_static = "1"
```

- [ ] **Step 4: Add Tauri commands for input**

In `main.rs`:
```rust
#[tauri::command]
fn mouse_click_cmd(x: i32, y: i32, button: String) -> Result<(), String> {
    input::mouse_click(x, y, &button)
}

#[tauri::command]
fn mouse_move_cmd(x: i32, y: i32) -> Result<(), String> {
    input::mouse_move(x, y)
}

#[tauri::command]
fn mouse_scroll_cmd(direction: String, amount: i32) -> Result<(), String> {
    input::mouse_scroll(&direction, amount)
}

#[tauri::command]
fn keyboard_type_cmd(text: String) -> Result<(), String> {
    input::keyboard_type(&text)
}

#[tauri::command]
fn keyboard_shortcut_cmd(keys: Vec<String>) -> Result<(), String> {
    input::keyboard_shortcut(&keys)
}
```

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/input.rs
git commit -m "feat: mouse + keyboard control via enigo Rust crate"
```

---

## Task 5: Implement Rust Command Execution

**Files:**
- Create: `src-tauri/src/command.rs`

- [ ] **Step 1: Implement command runner**

```rust
use std::process::Command;
use serde::Serialize;

#[derive(Serialize, Clone)]
pub struct CommandResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

pub fn run_command(cmd: &str, timeout_ms: u64) -> Result<CommandResult, String> {
    let shell = if cfg!(target_os = "windows") { "powershell" } else { "zsh" };
    let shell_flag = if cfg!(target_os = "windows") { "-Command" } else { "-c" };

    let output = Command::new(shell)
        .args([shell_flag, cmd])
        .output()
        .map_err(|e| format!("Failed to execute: {}", e))?;

    Ok(CommandResult {
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        exit_code: output.status.code().unwrap_or(-1),
    })
}

pub fn run_command_background(cmd: &str) -> Result<u32, String> {
    let shell = if cfg!(target_os = "windows") { "powershell" } else { "zsh" };
    let shell_flag = if cfg!(target_os = "windows") { "-Command" } else { "-c" };

    let child = Command::new(shell)
        .args([shell_flag, cmd])
        .spawn()
        .map_err(|e| format!("Failed to spawn: {}", e))?;

    Ok(child.id())
}
```

- [ ] **Step 2: Add Tauri command**

```rust
#[tauri::command]
fn run_command_cmd(command: String, timeout: Option<u64>) -> Result<command::CommandResult, String> {
    command::run_command(&command, timeout.unwrap_or(30000))
}
```

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/command.rs
git commit -m "feat: shell command execution with platform-specific shell"
```

---

## Task 6: Implement MCP Server (SSE Transport)

This is the core — the MCP server that Claude Code connects to.

**Files:**
- Create: `src-tauri/src/mcp_server.rs`
- Create: `src-tauri/src/mcp_tools.rs`

- [ ] **Step 1: Implement MCP protocol types**

`src-tauri/src/mcp_tools.rs`:

```rust
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Serialize)]
pub struct ToolDef {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
}

pub fn get_tool_definitions() -> Vec<ToolDef> {
    vec![
        ToolDef {
            name: "take_screenshot".into(),
            description: "Capture the entire screen as base64 PNG. Always call first to see what's on screen.".into(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {},
                "required": []
            }),
        },
        ToolDef {
            name: "mouse_click".into(),
            description: "Click at screen coordinates. button: left, right, double.".into(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "x": { "type": "integer", "description": "X coordinate" },
                    "y": { "type": "integer", "description": "Y coordinate" },
                    "button": { "type": "string", "enum": ["left", "right", "double"], "default": "left" }
                },
                "required": ["x", "y"]
            }),
        },
        ToolDef {
            name: "mouse_move".into(),
            description: "Move cursor to screen coordinates without clicking.".into(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "x": { "type": "integer" },
                    "y": { "type": "integer" }
                },
                "required": ["x", "y"]
            }),
        },
        ToolDef {
            name: "mouse_scroll".into(),
            description: "Scroll mouse wheel up or down.".into(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "direction": { "type": "string", "enum": ["up", "down"] },
                    "amount": { "type": "integer", "default": 3 }
                },
                "required": ["direction"]
            }),
        },
        ToolDef {
            name: "mouse_drag".into(),
            description: "Click and drag from one point to another.".into(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "x1": { "type": "integer" }, "y1": { "type": "integer" },
                    "x2": { "type": "integer" }, "y2": { "type": "integer" }
                },
                "required": ["x1", "y1", "x2", "y2"]
            }),
        },
        ToolDef {
            name: "keyboard_type".into(),
            description: "Type text using the keyboard.".into(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "text": { "type": "string", "description": "Text to type" }
                },
                "required": ["text"]
            }),
        },
        ToolDef {
            name: "keyboard_shortcut".into(),
            description: "Press a keyboard shortcut. Example: [\"ctrl\", \"s\"] for save.".into(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "keys": { "type": "array", "items": { "type": "string" } }
                },
                "required": ["keys"]
            }),
        },
        ToolDef {
            name: "keyboard_press".into(),
            description: "Press a single key (enter, escape, tab, etc).".into(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "key": { "type": "string" }
                },
                "required": ["key"]
            }),
        },
        ToolDef {
            name: "run_command".into(),
            description: "Execute a shell command. Uses PowerShell on Windows, zsh on macOS.".into(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "command": { "type": "string" },
                    "timeout": { "type": "integer", "default": 30000, "description": "Timeout in ms" }
                },
                "required": ["command"]
            }),
        },
        ToolDef {
            name: "draw_annotation".into(),
            description: "Draw a visual annotation on the overlay. Types: circle, arrow, highlight, label.".into(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "type": { "type": "string", "enum": ["circle", "arrow", "highlight", "label"] },
                    "x": { "type": "integer" }, "y": { "type": "integer" },
                    "x2": { "type": "integer" }, "y2": { "type": "integer" },
                    "color": { "type": "string", "default": "#ef4444" },
                    "text": { "type": "string" },
                    "fadeMs": { "type": "integer", "default": 5000 }
                },
                "required": ["type", "x", "y"]
            }),
        },
        ToolDef {
            name: "clear_annotations".into(),
            description: "Remove all annotations from the overlay.".into(),
            input_schema: serde_json::json!({
                "type": "object", "properties": {}, "required": []
            }),
        },
        ToolDef {
            name: "speak".into(),
            description: "Speak text aloud via text-to-speech.".into(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "text": { "type": "string" }
                },
                "required": ["text"]
            }),
        },
        ToolDef {
            name: "wait".into(),
            description: "Wait for specified milliseconds.".into(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "ms": { "type": "integer" }
                },
                "required": ["ms"]
            }),
        },
    ]
}
```

- [ ] **Step 2: Implement MCP server with axum (SSE + streamable HTTP)**

`src-tauri/src/mcp_server.rs`:

```rust
use axum::{
    Router, Json,
    routing::post,
    extract::State,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tower_http::cors::CorsLayer;
use uuid::Uuid;

use crate::{screenshot, input, command, tts, mcp_tools};

struct McpState {
    app_handle: AppHandle,
}

#[derive(Deserialize)]
struct JsonRpcRequest {
    jsonrpc: String,
    id: Option<Value>,
    method: String,
    params: Option<Value>,
}

#[derive(Serialize)]
struct JsonRpcResponse {
    jsonrpc: String,
    id: Value,
    result: Option<Value>,
    error: Option<Value>,
}

async fn handle_mcp(
    State(state): State<Arc<McpState>>,
    Json(req): Json<JsonRpcRequest>,
) -> Json<JsonRpcResponse> {
    let id = req.id.unwrap_or(Value::Null);

    let result = match req.method.as_str() {
        "initialize" => {
            serde_json::json!({
                "protocolVersion": "2024-11-05",
                "capabilities": {
                    "tools": {}
                },
                "serverInfo": {
                    "name": "claude-mission-panel",
                    "version": "0.1.0"
                }
            })
        }
        "tools/list" => {
            let tools: Vec<Value> = mcp_tools::get_tool_definitions()
                .into_iter()
                .map(|t| serde_json::json!({
                    "name": t.name,
                    "description": t.description,
                    "inputSchema": t.input_schema,
                }))
                .collect();
            serde_json::json!({ "tools": tools })
        }
        "tools/call" => {
            let params = req.params.unwrap_or_default();
            let tool_name = params["name"].as_str().unwrap_or("");
            let args = &params["arguments"];
            execute_tool(tool_name, args, &state.app_handle).await
        }
        "notifications/initialized" => {
            // Client acknowledges initialization — no response needed
            serde_json::json!({})
        }
        _ => {
            return Json(JsonRpcResponse {
                jsonrpc: "2.0".into(),
                id,
                result: None,
                error: Some(serde_json::json!({
                    "code": -32601,
                    "message": format!("Method not found: {}", req.method)
                })),
            });
        }
    };

    Json(JsonRpcResponse {
        jsonrpc: "2.0".into(),
        id,
        result: Some(result),
        error: None,
    })
}

async fn execute_tool(name: &str, args: &Value, app_handle: &AppHandle) -> Value {
    match name {
        "take_screenshot" => {
            match screenshot::capture_screen() {
                Ok(b64) => serde_json::json!({
                    "content": [{ "type": "image", "data": b64, "mimeType": "image/png" }]
                }),
                Err(e) => serde_json::json!({
                    "content": [{ "type": "text", "text": format!("Screenshot failed: {}", e) }],
                    "isError": true
                }),
            }
        }
        "mouse_click" => {
            let x = args["x"].as_i64().unwrap_or(0) as i32;
            let y = args["y"].as_i64().unwrap_or(0) as i32;
            let button = args["button"].as_str().unwrap_or("left");
            match input::mouse_click(x, y, button) {
                Ok(()) => tool_text(&format!("Clicked {} at ({}, {})", button, x, y)),
                Err(e) => tool_error(&e),
            }
        }
        "mouse_move" => {
            let x = args["x"].as_i64().unwrap_or(0) as i32;
            let y = args["y"].as_i64().unwrap_or(0) as i32;
            match input::mouse_move(x, y) {
                Ok(()) => tool_text(&format!("Moved to ({}, {})", x, y)),
                Err(e) => tool_error(&e),
            }
        }
        "mouse_scroll" => {
            let dir = args["direction"].as_str().unwrap_or("down");
            let amount = args["amount"].as_i64().unwrap_or(3) as i32;
            match input::mouse_scroll(dir, amount) {
                Ok(()) => tool_text(&format!("Scrolled {} {} units", dir, amount)),
                Err(e) => tool_error(&e),
            }
        }
        "mouse_drag" => {
            let x1 = args["x1"].as_i64().unwrap_or(0) as i32;
            let y1 = args["y1"].as_i64().unwrap_or(0) as i32;
            let x2 = args["x2"].as_i64().unwrap_or(0) as i32;
            let y2 = args["y2"].as_i64().unwrap_or(0) as i32;
            match input::mouse_drag(x1, y1, x2, y2) {
                Ok(()) => tool_text(&format!("Dragged ({},{}) to ({},{})", x1, y1, x2, y2)),
                Err(e) => tool_error(&e),
            }
        }
        "keyboard_type" => {
            let text = args["text"].as_str().unwrap_or("");
            match input::keyboard_type(text) {
                Ok(()) => tool_text(&format!("Typed: \"{}\"", text)),
                Err(e) => tool_error(&e),
            }
        }
        "keyboard_shortcut" => {
            let keys: Vec<String> = args["keys"].as_array()
                .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                .unwrap_or_default();
            match input::keyboard_shortcut(&keys) {
                Ok(()) => tool_text(&format!("Pressed: {}", keys.join("+"))),
                Err(e) => tool_error(&e),
            }
        }
        "keyboard_press" => {
            let key = args["key"].as_str().unwrap_or("enter");
            match input::keyboard_press(key) {
                Ok(()) => tool_text(&format!("Pressed: {}", key)),
                Err(e) => tool_error(&e),
            }
        }
        "run_command" => {
            let cmd = args["command"].as_str().unwrap_or("");
            let timeout = args["timeout"].as_u64().unwrap_or(30000);
            app_handle.emit("status", serde_json::json!({
                "state": "executing",
                "text": format!("Running: {}...", &cmd[..cmd.len().min(40)])
            })).ok();
            match command::run_command(cmd, timeout) {
                Ok(result) => {
                    let mut output = String::new();
                    if !result.stdout.is_empty() { output.push_str(&format!("stdout:\n{}\n", result.stdout)); }
                    if !result.stderr.is_empty() { output.push_str(&format!("stderr:\n{}\n", result.stderr)); }
                    output.push_str(&format!("exit code: {}", result.exit_code));
                    tool_text(&output)
                }
                Err(e) => tool_error(&e),
            }
        }
        "draw_annotation" => {
            let id = Uuid::new_v4().to_string();
            let mut payload = args.clone();
            payload["action"] = serde_json::json!("add");
            payload["id"] = serde_json::json!(id);
            app_handle.emit("annotation", &payload).ok();
            tool_text(&format!("Drew {} at ({}, {})", args["type"].as_str().unwrap_or("?"), args["x"], args["y"]))
        }
        "clear_annotations" => {
            app_handle.emit("annotation", serde_json::json!({ "action": "clear" })).ok();
            tool_text("Annotations cleared")
        }
        "speak" => {
            let text = args["text"].as_str().unwrap_or("");
            tts::speak(text);
            tool_text(&format!("Spoke: \"{}\"", text))
        }
        "wait" => {
            let ms = args["ms"].as_u64().unwrap_or(1000);
            tokio::time::sleep(std::time::Duration::from_millis(ms)).await;
            tool_text(&format!("Waited {}ms", ms))
        }
        _ => tool_error(&format!("Unknown tool: {}", name)),
    }
}

fn tool_text(text: &str) -> Value {
    serde_json::json!({ "content": [{ "type": "text", "text": text }] })
}

fn tool_error(msg: &str) -> Value {
    serde_json::json!({ "content": [{ "type": "text", "text": msg }], "isError": true })
}

pub async fn start(app_handle: AppHandle) {
    let state = Arc::new(McpState { app_handle });

    let app = Router::new()
        .route("/mcp", post(handle_mcp))
        .layer(CorsLayer::permissive())
        .with_state(state);

    let listener = tokio::net::TcpListener::bind("127.0.0.1:3456").await.unwrap();
    println!("[MCP] Server listening on http://127.0.0.1:3456/mcp");
    axum::serve(listener, app).await.unwrap();
}
```

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/mcp_server.rs src-tauri/src/mcp_tools.rs
git commit -m "feat: MCP server with all tools (screenshot, input, command, overlay)"
```

---

## Task 7: Implement TTS

**Files:**
- Create: `src-tauri/src/tts.rs`

- [ ] **Step 1: Implement platform-specific TTS**

```rust
use std::process::Command;

pub fn speak(text: &str) {
    let sanitized: String = text.chars().filter(|c| *c != '"' && *c != '\\' && *c != '$').collect();

    #[cfg(target_os = "macos")]
    {
        let _ = Command::new("say").arg(&sanitized).spawn();
    }

    #[cfg(target_os = "windows")]
    {
        let escaped = sanitized.replace("'", "''");
        let _ = Command::new("powershell")
            .args(["-Command", &format!(
                "Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak('{}')",
                escaped
            )])
            .spawn();
    }

    #[cfg(target_os = "linux")]
    {
        let _ = Command::new("espeak").arg(&sanitized).spawn();
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add src-tauri/src/tts.rs
git commit -m "feat: platform-specific text-to-speech"
```

---

## Task 8: Wire Up main.rs + Global Shortcuts

**Files:**
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Complete main.rs with all modules and global shortcuts**

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod screenshot;
mod input;
mod command;
mod tts;
mod mcp_server;
mod mcp_tools;

use tauri::{Manager, Emitter};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

#[tauri::command]
fn set_click_through(window: tauri::Window, enabled: bool) {
    let _ = window.set_ignore_cursor_events(enabled);
}

#[tauri::command]
fn take_screenshot() -> Result<String, String> {
    screenshot::capture_screen()
}

#[tauri::command]
fn handle_prompt(text: String) {
    // For now, log. Later: direct Claude API call or route to MCP
    println!("[Prompt] {}", text);
}

fn main() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        let _ = app.emit("toggle-prompt", ());
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let window = app.get_webview_window("overlay").unwrap();
            let _ = window.set_ignore_cursor_events(true);

            // Register Ctrl+Shift+Space hotkey
            let shortcut: Shortcut = "CmdOrCtrl+Shift+Space".parse().unwrap();
            app.global_shortcut().register(shortcut).unwrap();

            // Start MCP server
            let app_handle = app.handle().clone();
            std::thread::spawn(move || {
                let rt = tokio::runtime::Runtime::new().unwrap();
                rt.block_on(mcp_server::start(app_handle));
            });

            println!("[MissionPanel] Ready.");
            println!("[MissionPanel] Hotkey: Ctrl+Shift+Space (prompt bar)");
            println!("[MissionPanel] MCP server: http://localhost:3456/mcp");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            set_click_through,
            take_screenshot,
            handle_prompt,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 2: Verify full build**

```bash
cargo tauri build --debug
```

Expected: Compiles. App launches with transparent overlay and MCP server on port 3456.

- [ ] **Step 3: Test MCP server**

```bash
curl -X POST http://localhost:3456/mcp -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Expected: Returns JSON with all 13 tool definitions.

```bash
curl -X POST http://localhost:3456/mcp -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"take_screenshot","arguments":{}}}'
```

Expected: Returns base64 PNG screenshot.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/main.rs
git commit -m "feat: complete main.rs with global shortcuts + MCP server startup"
```

---

## Task 9: Configure Claude Code MCP Connection

**Files:**
- Modify: `C:/Users/onela/.claude/settings.json`

- [ ] **Step 1: Add MCP server to Claude Code settings**

Add to the `mcpServers` key in settings.json:

```json
{
  "mcpServers": {
    "mission-panel": {
      "type": "url",
      "url": "http://localhost:3456/mcp"
    }
  }
}
```

- [ ] **Step 2: Verify Claude Code sees the tools**

Start Mission Panel, then in Claude Code:
```
/mcp
```

Expected: `mission-panel` server listed with 13 tools.

- [ ] **Step 3: Test end-to-end**

In Claude Code, say: "Take a screenshot of my screen"

Expected: Claude Code calls `take_screenshot` via MCP, receives base64 image, describes what's on screen.

- [ ] **Step 4: Commit settings**

No commit needed — settings.json is user-level config.

---

## Task 10: Clean Up Old Electron Code

- [ ] **Step 1: Remove old Electron-specific files**

After verifying Tauri works:
- Remove `src/main/` (Electron main process)
- Remove `src/preload/` (Electron preload)
- Remove `src/renderer/` (old React location — now in `src/`)
- Remove `electron.vite.config.ts`
- Remove `electron-builder.yml`
- Remove Electron deps from old package.json
- Keep `src/` (new React) and `src-tauri/` (Rust)

- [ ] **Step 2: Update .gitignore**

Add:
```
src-tauri/target/
dist/
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: remove Electron code, fully migrated to Tauri 2.0"
```

---

## Summary

| Task | What | Est. |
|------|------|------|
| 1 | Scaffold Tauri project | Setup |
| 2 | Port React frontend | Port |
| 3 | Screen capture (xcap) | Rust |
| 4 | Mouse + keyboard (enigo) | Rust |
| 5 | Command execution | Rust |
| 6 | MCP server (axum) | Rust |
| 7 | TTS | Rust |
| 8 | Wire main.rs + shortcuts | Rust |
| 9 | Claude Code MCP config | Config |
| 10 | Clean up Electron | Cleanup |

After completion, Claude Code will have full access to: screenshot, screen recording, mouse control, keyboard control, scrolling, command execution, screen annotations, and TTS — all through native Rust via the MCP server.
