# Claude Mission Panel - Design Document

**Date:** 2026-03-16
**Author:** Lam Nguyen + Claude
**Status:** Approved

## Vision

A JARVIS-style smart assistant overlay for macOS and Windows. A transparent HUD that surrounds the screen, sees your cursor, draws annotations on screen to guide you, auto-clicks, types, runs terminal commands, and speaks — all powered by Claude Agent SDK.

## Architecture

Single Electron process. Main process runs the Agent SDK + screen control. Renderer process handles the transparent overlay + drawing. They communicate via Electron IPC.

```
┌─────────────────────────────────────┐
│        Electron Main Process        │
│                                     │
│  ┌──────────┐  ┌─────────────────┐  │
│  │ Overlay   │  │ Claude Agent    │  │
│  │ Window    │  │ SDK (JS)        │  │
│  │(transparent│ │                 │  │
│  │ fullscreen)│ │ - screencapture │  │
│  │           │  │ - mouse/keyboard│  │
│  │ - HUD UI  │  │ - terminal cmds │  │
│  │ - draw    │  │ - voice I/O     │  │
│  │ annotations│ │                 │  │
│  │ - prompt  │  │                 │  │
│  └──────────┘  └─────────────────┘  │
│        ↕ IPC (contextBridge)        │
└─────────────────────────────────────┘
```

### Key Components

- **Overlay Window** - Transparent, fullscreen, always-on-top, click-through (except HUD elements)
- **Agent Brain** - Claude Agent SDK session, persistent conversation, system prompt with screen-control tools
- **Screen Control** - `screenshot-desktop` for captures, `nut.js` for mouse/keyboard
- **Voice Engine** - Whisper (local STT) + macOS `say` / Windows SAPI (TTS)
- **Annotation Renderer** - Canvas layer that draws circles, arrows, highlights at coordinates

## HUD Interface

The overlay covers the full screen but is **click-through by default**.

### Bottom Center - Prompt Bar
- Glassmorphic input bar (like Spotlight)
- Appears on hotkey (`Cmd+Shift+Space`) or voice activation ("Hey Claude")
- Type or speak your command
- Disappears after sending

### Top Right - Status Pill
- Small floating indicator: listening / thinking / executing
- Pulses when Claude is working
- Shows brief text for terminal output

### Annotations (Anywhere on Screen)
- Red circles, arrows, highlights drawn at coordinates
- Rectangular highlights around regions
- Pulsing/glowing effects
- Text labels next to annotations
- Trace paths showing sequences (1 → 2 → 3)
- Fade out after action completes

**No chat history visible.** This isn't a chat app. It's a HUD. Claude acts, draws, speaks. Minimal text.

## Voice System

### Input (Speech-to-Text)
- Wake word: "Hey Claude" (always listening via low-power audio stream)
- Push-to-talk: `Cmd+Shift+V`
- Engine: Whisper (local, ~75MB model, no external API)
- Fallback: Web Speech API

### Output (Text-to-Speech)
- macOS: `say` command with premium voice
- Windows: SAPI / Edge TTS
- Speaks concisely: "Clicking Settings" not "I'm going to click on the Settings button for you"
- Mutable via HUD toggle or "Claude, mute"

### Voice Flow Example
```
"Hey Claude, open Slack and message Lam"
  → Whisper transcribes
  → Agent screenshots + reasons
  → "Opening Slack" (speaks + draws circle on Dock icon)
  → Clicks Slack → screenshots again
  → "Messaging Lam" (draws circle on conversation)
  → Clicks → types message
  → "Done" (speaks)
```

## Agent Tools

| Tool | Description |
|------|-------------|
| `screenshot` | Captures screen, returns base64 image to Claude |
| `mouse_click` | Click at x,y (left/right/double) |
| `mouse_move` | Move cursor to x,y |
| `mouse_scroll` | Scroll up/down at current position |
| `mouse_drag` | Drag from point A to point B |
| `keyboard_type` | Type a string of text |
| `keyboard_shortcut` | Press key combo (e.g., Cmd+C) |
| `run_command` | Execute shell command, return stdout/stderr |
| `draw_annotation` | Draw circle/arrow/highlight at x,y on overlay |
| `clear_annotations` | Remove all drawings from screen |
| `speak` | Say something out loud via TTS |
| `wait` | Pause for N milliseconds |

### System Prompt Behavior
- Always screenshot first before acting
- Draw annotations before clicking so user sees what's happening
- Speak brief status updates, not paragraphs
- For terminal tasks, use `run_command` and report results on HUD
- If unsure, ask the user via `speak` before acting destructively

### Agent Loop
```
User prompt → screenshot → Claude reasons → tool calls (draw + click/type/command) → screenshot to verify → speak result
```

## Project Structure

```
claude-mission-panel/
├── package.json
├── electron-builder.yml
├── src/
│   ├── main/
│   │   ├── index.ts
│   │   ├── agent.ts
│   │   ├── tools/
│   │   │   ├── screenshot.ts
│   │   │   ├── mouse.ts
│   │   │   ├── keyboard.ts
│   │   │   ├── command.ts
│   │   │   └── annotation.ts
│   │   ├── voice/
│   │   │   ├── whisper.ts
│   │   │   ├── tts.ts
│   │   │   └── wakeword.ts
│   │   └── ipc.ts
│   └── renderer/
│       ├── index.html
│       ├── hud/
│       │   ├── PromptBar.tsx
│       │   ├── StatusPill.tsx
│       │   └── HUD.tsx
│       ├── canvas/
│       │   ├── AnnotationLayer.tsx
│       │   └── animations.ts
│       └── styles/
│           └── hud.css
├── assets/
│   └── icon.png
└── README.md
```

## Tech Stack

- **Runtime:** Electron 33 + TypeScript
- **UI Framework:** React (renderer only)
- **AI Brain:** `@anthropic-ai/claude-code` Agent SDK
- **Screen Control:** `nut.js` (mouse/keyboard), `screenshot-desktop` (captures)
- **Voice STT:** `whisper-node` (local Whisper model)
- **Voice TTS:** macOS `say` / Windows SAPI
- **Drawing:** Canvas API
- **Build:** electron-builder (Mac + Windows)

## Cost

Everything is free except the Claude subscription (already owned). Whisper runs locally on device.

## Platforms

- macOS (primary)
- Windows (same codebase via Electron)
