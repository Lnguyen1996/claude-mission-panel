# Servo Movement & Fast Screenshots

**Date:** 2026-03-18
**Status:** Approved
**Repo:** `D:\Repos\claude-mission-panel`

## Problem

Mission Panel's screen interaction is slow and imprecise:

1. **Screenshots are slow.** `take_screenshot` captures full-screen PNG, base64-encodes it, and returns ~2-3MB through JSON-RPC. Each look costs 3-5 seconds.
2. **Mouse movement is blind.** `mouse_click` teleports the cursor to coordinates and clicks instantly. No visual feedback, no verification, no course correction. If the coordinates are wrong, Claude must take another screenshot, reason about the error, and try again — each round-trip adding seconds.

## Solution

Two complementary features:

### A. Fast JPEG Screenshots

Add JPEG support with optional downscaling. Existing `take_screenshot` keeps PNG default for backward compatibility.

**Changes to `take_screenshot`:**
- New optional parameter `format`: `"png"` (default, unchanged) or `"jpeg"`
- New optional parameter `scale`: float 0.1-1.0 (default 1.0), downscales before encoding
- When `format: "jpeg"`, quality is fixed at 85 (not user-configurable)
- Response format unchanged: `{type: "image", data: "<base64>", mimeType: "image/png"}` (or `"image/jpeg"` when JPEG requested)

**New tool `take_screenshot_fast`:**
- Preset: JPEG quality 70, scale 0.5
- Optimized for quick glances during interaction (50-100KB vs 2-3MB)
- Same response format as `take_screenshot`

**Performance targets:**
- Full JPEG screenshot: <200ms (vs ~800ms for PNG)
- Half-scale fast screenshot: <100ms (if capture latency dominates >150ms, use `FilterType::Nearest` for downscaling instead of `Triangle`)
- Payload size: 100-300KB JPEG vs 2-3MB PNG

### B. Server-Side Servo Movement

New MCP tools that smoothly move the cursor with position verification, returning a final screenshot for Claude to verify. The servo loop runs entirely in Rust — no MCP round-trips during movement.

#### `servo_move`

Smoothly moves cursor from current position to target coordinates.

**Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `x` | number | required | Target X in screenshot pixels |
| `y` | number | required | Target Y in screenshot pixels |
| `steps` | number | 15 | Number of interpolation steps |
| `duration_ms` | number | 400 | Total movement duration |

**Coordinate spaces:** Claude sends screenshot-pixel coords. The backend converts to enigo-space (multiply by DPI scale 1.25) for all movement and position checks. Response values are converted back to screenshot-pixel space (divide by 1.25) so Claude sees consistent coordinates.

**Algorithm** (all intermediate math in enigo-space):
1. Convert target (x, y) from screenshot-space to enigo-space: `ex = x * 1.25`, `ey = y * 1.25`
2. Read current cursor position via `enigo::Location` (returns enigo-space coords)
3. Calculate step deltas: `dx = (ex - cur_x) / steps`, same for Y
4. For each step (0..steps):
   a. Move cursor to `(cur_x + dx * i, cur_y + dy * i)` in enigo-space
   b. Sleep `duration_ms / steps` milliseconds (via `std::thread::sleep` — see threading note)
   c. Read actual cursor position via `enigo::Location`
   d. If deviation > 6px (enigo-space) from expected, recalculate remaining trajectory from actual position
5. Capture JPEG screenshot (quality 85)
6. Convert final cursor position back to screenshot-space (divide by 1.25) for response
7. Return result

**Constraints:** `steps` clamped to 5-50. `duration_ms` clamped to 100-5000.

**Threading:** The servo loop holds the enigo Mutex and calls `std::thread::sleep` between steps. It MUST run inside `tokio::task::spawn_blocking` to avoid blocking the async Axum runtime.

**Response:**
```json
{
  "content": [
    {
      "type": "text",
      "text": "{\"final_x\": 641, \"final_y\": 399, \"target_x\": 640, \"target_y\": 400, \"deviation_px\": 1.4, \"steps_taken\": 15, \"corrected\": false}"
    },
    {
      "type": "image",
      "data": "<base64 JPEG>",
      "mimeType": "image/jpeg"
    }
  ]
}
```

#### `servo_click`

Servo moves to target, pauses, then clicks.

**Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `x` | number | required | Target X in screenshot pixels |
| `y` | number | required | Target Y in screenshot pixels |
| `button` | string | "left" | "left", "right", or "double" |
| `steps` | number | 15 | Interpolation steps |
| `duration_ms` | number | 400 | Movement duration |

**Algorithm:**
1. Call servo_move(x, y, steps, duration_ms) internally
2. Sleep 50ms (let UI settle after cursor arrives)
3. Click at final position. For `button: "double"`, uses the same two-click-with-50ms-gap pattern as existing `mouse_click`.
4. Sleep 100ms (let UI respond to click)
5. Capture JPEG screenshot
6. Return result with `clicked: true`

**Response:** Same as servo_move, plus `"clicked": true` in the text JSON.

#### `servo_drag`

Servo moves to start, presses, servo moves to end, releases. Always uses left mouse button (matching existing `mouse_drag` behavior).

**Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `x1` | number | required | Drag start X (screenshot pixels) |
| `y1` | number | required | Drag start Y (screenshot pixels) |
| `x2` | number | required | Drag end X (screenshot pixels) |
| `y2` | number | required | Drag end Y (screenshot pixels) |
| `steps` | number | 15 | Steps per movement segment |
| `duration_ms` | number | 400 | Duration per segment |

**Algorithm:**
1. Servo move to (x1, y1)
2. Press left mouse button
3. Sleep 50ms
4. Servo move to (x2, y2)
5. Sleep 50ms
6. Release left mouse button
7. Capture JPEG screenshot
8. Return start position, end position, screenshot

## Implementation

### Files Changed

| File | Change |
|------|--------|
| `src-tauri/src/screenshot.rs` | Add `capture_screen_jpeg(quality: u8, scale: f32)`. Uses `image` crate JPEG encoder. Downscale via `imageops::resize` with `FilterType::Triangle` (fast bilinear). |
| `src-tauri/src/input.rs` | Add `get_cursor_position() -> (i32, i32)` using enigo `Location`. Add `mouse_move_smooth(from_x, from_y, to_x, to_y, steps, delay_ms) -> Vec<(i32, i32)>` — the interpolation loop with position verification. Returns actual positions at each step. |
| `src-tauri/src/mcp_tools.rs` | Register 4 new tools: `take_screenshot_fast`, `servo_move`, `servo_click`, `servo_drag`. Update `take_screenshot` schema with optional `format` and `scale` params. |
| `src-tauri/src/mcp_server.rs` | Add dispatch cases for new tools. Wire JPEG screenshot path in existing `take_screenshot` handler. Apply 1.25x DPI scale to servo tool coordinates. |

### Files NOT Changed

- Frontend (React/TypeScript) — no UI changes needed
- `mcp-bridge.mjs` — protocol unchanged, just new tools
- `mp.mjs` — can add servo commands later as convenience
- Grid system — untouched, still works for target identification

### Dependencies

- `image` crate (already in Cargo.toml) — has JPEG encoder built-in
- `enigo` (already in Cargo.toml) — has `Location` trait for cursor position
- No new crates required

### DPI Scaling

All servo tools apply the same 1.25x DPI correction as existing mouse tools. Coordinates passed by Claude are in screenshot pixel space; the backend multiplies by 1.25 before sending to enigo.

### No Breaking Changes

- `take_screenshot` keeps PNG as default format — callers must explicitly pass `format: "jpeg"` to get JPEG
- All existing tools (`mouse_click`, `mouse_move`, `click_grid`, etc.) remain unchanged
- New tools are purely additive

### Documentation to Update After Implementation

- `D:\Obsidian\LamVault\Areas\Claude Tools\Mission Panel.md` — add new tool entries (`take_screenshot_fast`, `servo_move`, `servo_click`, `servo_drag`) and new `format`/`scale` params on `take_screenshot`

## Usage Patterns

### Before (current)
```
Claude: take_screenshot           → 800ms, 2.5MB PNG
Claude: [processes image, reasons about target]
Claude: mouse_click(640, 400)     → instant teleport, no verification
Claude: take_screenshot           → 800ms to verify
Claude: [target missed by 20px, try again...]
```

### After (with servo)
```
Claude: show_grid(ultra)
Claude: take_screenshot            → 200ms, 300KB JPEG
Claude: [identifies target cell]
Claude: servo_click(640, 400)      → 400ms smooth move + click + auto screenshot
Claude: [verifies from returned screenshot — done in one call]
```

### Quick look pattern
```
Claude: take_screenshot_fast       → <100ms, 80KB JPEG
Claude: [quick situational awareness, low token cost]
```

## Success Criteria

1. `take_screenshot` with `format: "jpeg"` returns in <200ms (vs ~800ms PNG baseline)
2. `take_screenshot_fast` returns in <100ms with <150KB payload
3. `servo_move` completes smooth cursor movement in configurable duration
4. `servo_click` reliably clicks the target with <3px deviation
5. Cursor position verification detects and corrects OS-level interference
6. Final screenshot returned inline — no separate take_screenshot call needed
7. All existing tools continue to work unchanged
