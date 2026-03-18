# Servo Movement & Fast Screenshots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add JPEG screenshot support (5-10x smaller payloads) and server-side servo cursor movement with position verification and inline screenshots.

**Architecture:** Two complementary features — (A) JPEG encoding in `screenshot.rs` with optional downscaling, (B) smooth cursor interpolation in `input.rs` with position verification via enigo `Location`. All servo math runs in Rust inside `spawn_blocking`; MCP tools convert between screenshot-space and enigo-space (1.25x DPI factor). New tools are purely additive — no breaking changes to existing tools.

**Tech Stack:** Rust, Tauri 2.0, `image` crate (JPEG encoder + resize), `enigo` (cursor position reading), `axum` (MCP server), `tokio::task::spawn_blocking`.

**Spec:** `docs/superpowers/specs/2026-03-18-servo-movement-fast-screenshots-design.md`

---

## File Structure

| File | Responsibility | Change Type |
|------|---------------|-------------|
| `src-tauri/src/screenshot.rs` | Add `capture_screen_jpeg(quality, scale)` function | Modify |
| `src-tauri/src/input.rs` | Add `get_cursor_position()` and `mouse_move_smooth()` functions | Modify |
| `src-tauri/src/mcp_tools.rs` | Register 4 new tools + update `take_screenshot` schema | Modify |
| `src-tauri/src/mcp_server.rs` | Add dispatch cases for new tools, coordinate conversion | Modify |

No new files. No frontend changes. No dependency changes (both `image` and `enigo` already in `Cargo.toml`).

---

### Task 1: JPEG Screenshot Support in `screenshot.rs`

**Files:**
- Modify: `src-tauri/src/screenshot.rs`

**What:** Add a new function `capture_screen_jpeg` that captures the screen, optionally downscales, encodes as JPEG, and returns base64. The existing `capture_screen()` stays untouched.

- [ ] **Step 1: Add the `capture_screen_jpeg` function**

Add this function after the existing `capture_region` function in `src-tauri/src/screenshot.rs`:

```rust
pub fn capture_screen_jpeg(quality: u8, scale: f32) -> Result<(String, String), String> {
    let monitors = Monitor::all().map_err(|e| format!("Failed to list monitors: {}", e))?;
    let monitor = monitors.into_iter().next().ok_or("No monitor found")?;

    let img = monitor.capture_image().map_err(|e| format!("Capture failed: {}", e))?;

    // Downscale if scale < 1.0
    let final_img = if scale < 1.0 {
        let new_w = (img.width() as f32 * scale) as u32;
        let new_h = (img.height() as f32 * scale) as u32;
        image::imageops::resize(&img, new_w, new_h, image::imageops::FilterType::Triangle)
    } else {
        img
    };

    // Encode as JPEG
    let mut buf = Cursor::new(Vec::new());
    final_img.write_to(&mut buf, ImageFormat::Jpeg)
        .map_err(|e| format!("JPEG encode failed: {}", e))?;

    Ok((STANDARD.encode(buf.into_inner()), "image/jpeg".to_string()))
}
```

**Notes:**
- Returns `(base64_data, mime_type)` tuple — the mime type makes the MCP response code cleaner.
- `FilterType::Triangle` is fast bilinear interpolation — good balance of speed vs quality.
- Quality parameter comes from the caller (85 for `take_screenshot format:jpeg`, 70 for `take_screenshot_fast`).
- If performance profiling later shows capture latency dominates (>150ms), switch to `FilterType::Nearest` for downscaling — but start with Triangle.

- [ ] **Step 2: Verify it compiles**

Run from project root:
```bash
cd D:/Repos/claude-mission-panel && cargo build 2>&1 | tail -5
```
Expected: `Finished` with no errors. If `ImageFormat::Jpeg` is not recognized, check the `image` crate version supports JPEG encoding (0.25 does via the `jpeg` feature which is enabled by default).

- [ ] **Step 3: Commit**

```bash
cd D:/Repos/claude-mission-panel && git add src-tauri/src/screenshot.rs && git commit -m "feat(screenshot): add JPEG capture with optional downscaling"
```

---

### Task 2: Cursor Position Reading and Smooth Movement in `input.rs`

**Files:**
- Modify: `src-tauri/src/input.rs`

**What:** Add two new public functions: (1) `get_cursor_position()` that reads current cursor coords via enigo, (2) `mouse_move_smooth()` that interpolates cursor movement with position verification and trajectory correction.

- [ ] **Step 1: Add `get_cursor_position` function**

Add after the `mouse_move` function (after line 13) in `src-tauri/src/input.rs`:

```rust
pub fn get_cursor_position() -> Result<(i32, i32), String> {
    let enigo = ENIGO.lock().map_err(|e| e.to_string())?;
    let (x, y) = enigo.location().map_err(|e| format!("Failed to get cursor position: {}", e))?;
    Ok((x, y))
}
```

**Note:** `enigo::Mouse::location()` returns `(i32, i32)` in enigo-space coordinates. The enigo Mutex must be locked for this call.

- [ ] **Step 2: Add `mouse_move_smooth` function**

Add after `get_cursor_position` in the same file:

```rust
pub fn mouse_move_smooth(
    target_x: i32,
    target_y: i32,
    steps: u32,
    duration_ms: u64,
) -> Result<SmoothMoveResult, String> {
    let step_delay = std::time::Duration::from_millis(duration_ms / steps as u64);
    let deviation_threshold: f64 = 6.0; // pixels in enigo-space

    let mut enigo = ENIGO.lock().map_err(|e| e.to_string())?;

    // Read current position
    let (mut cur_x, mut cur_y) = enigo.location()
        .map_err(|e| format!("Failed to get cursor position: {}", e))?;

    let mut corrected = false;

    for i in 1..=steps {
        // Linear interpolation from current trajectory start to target
        let progress = i as f64 / steps as f64;
        let expected_x = cur_x as f64 + (target_x as f64 - cur_x as f64) * progress;
        let expected_y = cur_y as f64 + (target_y as f64 - cur_y as f64) * progress;

        enigo.move_mouse(expected_x as i32, expected_y as i32, Coordinate::Abs)
            .map_err(|e| format!("Move failed: {}", e))?;

        std::thread::sleep(step_delay);

        // Read actual position and check for deviation
        let (actual_x, actual_y) = enigo.location()
            .map_err(|e| format!("Position check failed: {}", e))?;

        let dx = (actual_x as f64 - expected_x).abs();
        let dy = (actual_y as f64 - expected_y).abs();
        let deviation = (dx * dx + dy * dy).sqrt();

        if deviation > deviation_threshold && i < steps {
            // OS interference detected — recalculate from actual position
            cur_x = actual_x;
            cur_y = actual_y;
            corrected = true;
        }
    }

    // Final position read
    let (final_x, final_y) = enigo.location()
        .map_err(|e| format!("Final position check failed: {}", e))?;

    let final_deviation = (((final_x - target_x) as f64).powi(2) + ((final_y - target_y) as f64).powi(2)).sqrt();

    Ok(SmoothMoveResult {
        final_x,
        final_y,
        target_x,
        target_y,
        deviation_px: final_deviation,
        steps_taken: steps,
        corrected,
    })
}
```

- [ ] **Step 3: Add the `SmoothMoveResult` struct**

Add at the top of `src-tauri/src/input.rs`, right after the `use` statements (before the `lazy_static` block):

```rust
#[derive(serde::Serialize)]
pub struct SmoothMoveResult {
    pub final_x: i32,
    pub final_y: i32,
    pub target_x: i32,
    pub target_y: i32,
    pub deviation_px: f64,
    pub steps_taken: u32,
    pub corrected: bool,
}
```

- [ ] **Step 4: Verify it compiles**

```bash
cd D:/Repos/claude-mission-panel && cargo build 2>&1 | tail -5
```
Expected: `Finished` with no errors. If `enigo::Mouse::location` doesn't exist, check the enigo version — `0.3` supports it via the `Mouse` trait's `location()` method.

- [ ] **Step 5: Commit**

```bash
cd D:/Repos/claude-mission-panel && git add src-tauri/src/input.rs && git commit -m "feat(input): add cursor position reading and smooth interpolated movement"
```

---

### Task 3: Register New MCP Tool Definitions in `mcp_tools.rs`

**Files:**
- Modify: `src-tauri/src/mcp_tools.rs`

**What:** Add 4 new tool definitions (`take_screenshot_fast`, `servo_move`, `servo_click`, `servo_drag`) and update the existing `take_screenshot` schema to accept optional `format` and `scale` parameters.

- [ ] **Step 1: Update `take_screenshot` schema**

In `src-tauri/src/mcp_tools.rs`, replace the existing `take_screenshot` ToolDef (lines 13-19) with:

```rust
        ToolDef {
            name: "take_screenshot".into(),
            description: "Capture the entire screen. Default: PNG. Pass format:'jpeg' for 5-10x smaller payload. Optional scale (0.1-1.0) downscales before encoding.".into(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "format": { "type": "string", "enum": ["png", "jpeg"], "default": "png", "description": "Image format. JPEG is 5-10x smaller." },
                    "scale": { "type": "number", "minimum": 0.1, "maximum": 1.0, "default": 1.0, "description": "Downscale factor (0.1-1.0). Lower = smaller/faster." }
                },
                "required": []
            }),
        },
```

- [ ] **Step 2: Add `take_screenshot_fast` tool definition**

Add after the `take_screenshot` ToolDef (before `mouse_click`):

```rust
        ToolDef {
            name: "take_screenshot_fast".into(),
            description: "Quick screenshot for situational awareness. JPEG quality 70, half-scale. ~50-100KB vs 2-3MB full PNG. Use for quick glances during interaction.".into(),
            input_schema: serde_json::json!({
                "type": "object", "properties": {}, "required": []
            }),
        },
```

- [ ] **Step 3: Add `servo_move` tool definition**

Add after the `click_grid` ToolDef (at the end of the vec, before the closing `]`):

```rust
        ToolDef {
            name: "servo_move".into(),
            description: "Smoothly move cursor to target with position verification. Returns final position + screenshot. Coordinates in screenshot pixels.".into(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "x": { "type": "integer", "description": "Target X in screenshot pixels" },
                    "y": { "type": "integer", "description": "Target Y in screenshot pixels" },
                    "steps": { "type": "integer", "default": 15, "description": "Interpolation steps (5-50)" },
                    "duration_ms": { "type": "integer", "default": 400, "description": "Movement duration in ms (100-5000)" }
                },
                "required": ["x", "y"]
            }),
        },
```

- [ ] **Step 4: Add `servo_click` tool definition**

Add after `servo_move`:

```rust
        ToolDef {
            name: "servo_click".into(),
            description: "Servo move to target, then click. Returns final position + screenshot. Combines smooth movement + click + verification in one call.".into(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "x": { "type": "integer", "description": "Target X in screenshot pixels" },
                    "y": { "type": "integer", "description": "Target Y in screenshot pixels" },
                    "button": { "type": "string", "enum": ["left", "right", "double"], "default": "left" },
                    "steps": { "type": "integer", "default": 15, "description": "Interpolation steps (5-50)" },
                    "duration_ms": { "type": "integer", "default": 400, "description": "Movement duration in ms (100-5000)" }
                },
                "required": ["x", "y"]
            }),
        },
```

- [ ] **Step 5: Add `servo_drag` tool definition**

Add after `servo_click`:

```rust
        ToolDef {
            name: "servo_drag".into(),
            description: "Servo move to start, press, servo move to end, release. Returns screenshot after drag. Always left button.".into(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "x1": { "type": "integer", "description": "Drag start X (screenshot pixels)" },
                    "y1": { "type": "integer", "description": "Drag start Y (screenshot pixels)" },
                    "x2": { "type": "integer", "description": "Drag end X (screenshot pixels)" },
                    "y2": { "type": "integer", "description": "Drag end Y (screenshot pixels)" },
                    "steps": { "type": "integer", "default": 15, "description": "Steps per movement segment (5-50)" },
                    "duration_ms": { "type": "integer", "default": 400, "description": "Duration per segment in ms (100-5000)" }
                },
                "required": ["x1", "y1", "x2", "y2"]
            }),
        },
```

- [ ] **Step 6: Verify it compiles**

```bash
cd D:/Repos/claude-mission-panel && cargo build 2>&1 | tail -5
```
Expected: `Finished` with no errors.

- [ ] **Step 7: Commit**

```bash
cd D:/Repos/claude-mission-panel && git add src-tauri/src/mcp_tools.rs && git commit -m "feat(tools): register servo_move, servo_click, servo_drag, and take_screenshot_fast tool defs"
```

---

### Task 4: Wire `take_screenshot` JPEG Path and `take_screenshot_fast` in `mcp_server.rs`

**Files:**
- Modify: `src-tauri/src/mcp_server.rs`

**What:** Update the existing `take_screenshot` dispatch to handle optional `format` and `scale` params. Add new `take_screenshot_fast` dispatch case.

- [ ] **Step 1: Update `take_screenshot` handler**

In `src-tauri/src/mcp_server.rs`, replace the existing `"take_screenshot"` match arm (lines 144-151) with:

```rust
        "take_screenshot" => {
            let format = args.get("format").and_then(|f| f.as_str()).unwrap_or("png");
            let scale = args.get("scale").and_then(|s| s.as_f64()).unwrap_or(1.0) as f32;
            let scale = scale.clamp(0.1, 1.0);

            if format == "jpeg" {
                match screenshot::capture_screen_jpeg(85, scale) {
                    Ok((b64, mime)) => serde_json::json!({
                        "content": [{ "type": "image", "data": b64, "mimeType": mime }]
                    }),
                    Err(e) => tool_error(&e),
                }
            } else {
                match screenshot::capture_screen() {
                    Ok(b64) => serde_json::json!({
                        "content": [{ "type": "image", "data": b64, "mimeType": "image/png" }]
                    }),
                    Err(e) => tool_error(&e),
                }
            }
        }
```

- [ ] **Step 2: Add `take_screenshot_fast` handler**

Add a new match arm right after the `"take_screenshot"` arm:

```rust
        "take_screenshot_fast" => {
            match screenshot::capture_screen_jpeg(70, 0.5) {
                Ok((b64, mime)) => serde_json::json!({
                    "content": [{ "type": "image", "data": b64, "mimeType": mime }]
                }),
                Err(e) => tool_error(&e),
            }
        }
```

- [ ] **Step 3: Verify it compiles**

```bash
cd D:/Repos/claude-mission-panel && cargo build 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
cd D:/Repos/claude-mission-panel && git add src-tauri/src/mcp_server.rs && git commit -m "feat(server): wire JPEG path for take_screenshot and add take_screenshot_fast handler"
```

---

### Task 5: Wire `servo_move` Dispatch in `mcp_server.rs`

**Files:**
- Modify: `src-tauri/src/mcp_server.rs`

**What:** Add the `servo_move` match arm. This is the core servo tool — converts screenshot-space to enigo-space, calls the smooth movement function inside `spawn_blocking`, captures a JPEG screenshot, and returns the result with both text metadata and inline image.

- [ ] **Step 1: Add `servo_move` handler**

Add a new match arm after `"take_screenshot_fast"` (or anywhere in the match block — order doesn't matter for match arms):

```rust
        "servo_move" => {
            let raw_x = args["x"].as_i64().unwrap_or(0) as f64;
            let raw_y = args["y"].as_i64().unwrap_or(0) as f64;
            let target_x = (raw_x * dpi_scale) as i32;
            let target_y = (raw_y * dpi_scale) as i32;
            let steps = args.get("steps").and_then(|s| s.as_u64()).unwrap_or(15) as u32;
            let steps = steps.clamp(5, 50);
            let duration_ms = args.get("duration_ms").and_then(|d| d.as_u64()).unwrap_or(400);
            let duration_ms = duration_ms.clamp(100, 5000);

            // Run servo loop in spawn_blocking to avoid blocking the async runtime
            let move_result = tokio::task::spawn_blocking(move || {
                input::mouse_move_smooth(target_x, target_y, steps, duration_ms)
            }).await;

            match move_result {
                Ok(Ok(result)) => {
                    // Convert final position back to screenshot-space
                    let ss_final_x = (result.final_x as f64 / dpi_scale) as i32;
                    let ss_final_y = (result.final_y as f64 / dpi_scale) as i32;

                    // Capture JPEG screenshot
                    let screenshot_result = screenshot::capture_screen_jpeg(85, 1.0);

                    let text_json = serde_json::json!({
                        "final_x": ss_final_x,
                        "final_y": ss_final_y,
                        "target_x": raw_x as i32,
                        "target_y": raw_y as i32,
                        "deviation_px": result.deviation_px / dpi_scale,
                        "steps_taken": result.steps_taken,
                        "corrected": result.corrected
                    });

                    match screenshot_result {
                        Ok((b64, mime)) => serde_json::json!({
                            "content": [
                                { "type": "text", "text": text_json.to_string() },
                                { "type": "image", "data": b64, "mimeType": mime }
                            ]
                        }),
                        Err(e) => serde_json::json!({
                            "content": [
                                { "type": "text", "text": text_json.to_string() },
                                { "type": "text", "text": format!("Screenshot failed: {}", e) }
                            ]
                        }),
                    }
                }
                Ok(Err(e)) => tool_error(&format!("Servo move failed: {}", e)),
                Err(e) => tool_error(&format!("Servo task panicked: {}", e)),
            }
        }
```

**Key design decisions:**
- `spawn_blocking` wraps the entire smooth move — the interpolation loop uses `std::thread::sleep` which would block tokio.
- Screenshot capture happens AFTER the blocking move completes, back on the async runtime. `capture_screen_jpeg` is fast enough (~200ms) to run synchronously.
- Deviation is converted back to screenshot-space by dividing by `dpi_scale`.
- If the screenshot fails, we still return the movement metadata (text-only fallback).

- [ ] **Step 2: Verify it compiles**

```bash
cd D:/Repos/claude-mission-panel && cargo build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
cd D:/Repos/claude-mission-panel && git add src-tauri/src/mcp_server.rs && git commit -m "feat(server): wire servo_move dispatch with spawn_blocking and inline screenshot"
```

---

### Task 6: Wire `servo_click` Dispatch in `mcp_server.rs`

**Files:**
- Modify: `src-tauri/src/mcp_server.rs`

**What:** Add the `servo_click` match arm. Calls servo_move internally, then pauses, clicks, pauses again, captures screenshot.

- [ ] **Step 1: Add `servo_click` handler**

Add after the `"servo_move"` match arm:

```rust
        "servo_click" => {
            let raw_x = args["x"].as_i64().unwrap_or(0) as f64;
            let raw_y = args["y"].as_i64().unwrap_or(0) as f64;
            let target_x = (raw_x * dpi_scale) as i32;
            let target_y = (raw_y * dpi_scale) as i32;
            let button = args.get("button").and_then(|b| b.as_str()).unwrap_or("left").to_string();
            let steps = args.get("steps").and_then(|s| s.as_u64()).unwrap_or(15) as u32;
            let steps = steps.clamp(5, 50);
            let duration_ms = args.get("duration_ms").and_then(|d| d.as_u64()).unwrap_or(400);
            let duration_ms = duration_ms.clamp(100, 5000);

            // Run servo move + click in spawn_blocking
            let click_result = tokio::task::spawn_blocking(move || {
                // 1. Smooth move to target
                let move_result = input::mouse_move_smooth(target_x, target_y, steps, duration_ms)?;

                // 2. Settle pause
                std::thread::sleep(std::time::Duration::from_millis(50));

                // 3. Click at current position (already there from servo move)
                input::mouse_click(move_result.final_x, move_result.final_y, &button)?;

                // 4. UI response pause
                std::thread::sleep(std::time::Duration::from_millis(100));

                Ok::<_, String>(move_result)
            }).await;

            match click_result {
                Ok(Ok(result)) => {
                    let ss_final_x = (result.final_x as f64 / dpi_scale) as i32;
                    let ss_final_y = (result.final_y as f64 / dpi_scale) as i32;

                    let screenshot_result = screenshot::capture_screen_jpeg(85, 1.0);

                    let text_json = serde_json::json!({
                        "final_x": ss_final_x,
                        "final_y": ss_final_y,
                        "target_x": raw_x as i32,
                        "target_y": raw_y as i32,
                        "deviation_px": result.deviation_px / dpi_scale,
                        "steps_taken": result.steps_taken,
                        "corrected": result.corrected,
                        "clicked": true
                    });

                    match screenshot_result {
                        Ok((b64, mime)) => serde_json::json!({
                            "content": [
                                { "type": "text", "text": text_json.to_string() },
                                { "type": "image", "data": b64, "mimeType": mime }
                            ]
                        }),
                        Err(e) => serde_json::json!({
                            "content": [
                                { "type": "text", "text": text_json.to_string() },
                                { "type": "text", "text": format!("Screenshot failed: {}", e) }
                            ]
                        }),
                    }
                }
                Ok(Err(e)) => tool_error(&format!("Servo click failed: {}", e)),
                Err(e) => tool_error(&format!("Servo task panicked: {}", e)),
            }
        }
```

**Note:** The click happens at `move_result.final_x/final_y` (the actual cursor position after servo move), not the original target. This is more reliable since it clicks where the cursor actually is.

- [ ] **Step 2: Verify it compiles**

```bash
cd D:/Repos/claude-mission-panel && cargo build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
cd D:/Repos/claude-mission-panel && git add src-tauri/src/mcp_server.rs && git commit -m "feat(server): wire servo_click dispatch with settle/response pauses"
```

---

### Task 7: Wire `servo_drag` Dispatch in `mcp_server.rs`

**Files:**
- Modify: `src-tauri/src/mcp_server.rs`

**What:** Add the `servo_drag` match arm. Servo moves to start, presses, servo moves to end, releases. Always left button.

- [ ] **Step 1: Add `servo_drag` handler**

Add after the `"servo_click"` match arm:

```rust
        "servo_drag" => {
            let raw_x1 = args["x1"].as_i64().unwrap_or(0) as f64;
            let raw_y1 = args["y1"].as_i64().unwrap_or(0) as f64;
            let raw_x2 = args["x2"].as_i64().unwrap_or(0) as f64;
            let raw_y2 = args["y2"].as_i64().unwrap_or(0) as f64;
            let start_x = (raw_x1 * dpi_scale) as i32;
            let start_y = (raw_y1 * dpi_scale) as i32;
            let end_x = (raw_x2 * dpi_scale) as i32;
            let end_y = (raw_y2 * dpi_scale) as i32;
            let steps = args.get("steps").and_then(|s| s.as_u64()).unwrap_or(15) as u32;
            let steps = steps.clamp(5, 50);
            let duration_ms = args.get("duration_ms").and_then(|d| d.as_u64()).unwrap_or(400);
            let duration_ms = duration_ms.clamp(100, 5000);

            let drag_result = tokio::task::spawn_blocking(move || {
                // 1. Servo move to start position
                let start_result = input::mouse_move_smooth(start_x, start_y, steps, duration_ms)?;

                // 2. Press left mouse button at start
                {
                    let mut enigo = crate::input::enigo_lock()?;
                    enigo.button(enigo::Button::Left, enigo::Direction::Press)
                        .map_err(|e| format!("Press failed: {}", e))?;
                }
                std::thread::sleep(std::time::Duration::from_millis(50));

                // 3. Servo move to end position
                let end_result = input::mouse_move_smooth(end_x, end_y, steps, duration_ms)?;

                // 4. Release
                std::thread::sleep(std::time::Duration::from_millis(50));
                {
                    let mut enigo = crate::input::enigo_lock()?;
                    enigo.button(enigo::Button::Left, enigo::Direction::Release)
                        .map_err(|e| format!("Release failed: {}", e))?;
                }

                Ok::<_, String>((start_result, end_result))
            }).await;

            match drag_result {
                Ok(Ok((start_result, end_result))) => {
                    let ss_start_x = (start_result.final_x as f64 / dpi_scale) as i32;
                    let ss_start_y = (start_result.final_y as f64 / dpi_scale) as i32;
                    let ss_end_x = (end_result.final_x as f64 / dpi_scale) as i32;
                    let ss_end_y = (end_result.final_y as f64 / dpi_scale) as i32;

                    let screenshot_result = screenshot::capture_screen_jpeg(85, 1.0);

                    let text_json = serde_json::json!({
                        "start_x": ss_start_x,
                        "start_y": ss_start_y,
                        "end_x": ss_end_x,
                        "end_y": ss_end_y,
                        "target_start": [raw_x1 as i32, raw_y1 as i32],
                        "target_end": [raw_x2 as i32, raw_y2 as i32],
                        "steps_taken": end_result.steps_taken,
                        "corrected": start_result.corrected || end_result.corrected
                    });

                    match screenshot_result {
                        Ok((b64, mime)) => serde_json::json!({
                            "content": [
                                { "type": "text", "text": text_json.to_string() },
                                { "type": "image", "data": b64, "mimeType": mime }
                            ]
                        }),
                        Err(e) => serde_json::json!({
                            "content": [
                                { "type": "text", "text": text_json.to_string() },
                                { "type": "text", "text": format!("Screenshot failed: {}", e) }
                            ]
                        }),
                    }
                }
                Ok(Err(e)) => tool_error(&format!("Servo drag failed: {}", e)),
                Err(e) => tool_error(&format!("Servo task panicked: {}", e)),
            }
        }
```

**Note:** `servo_drag` needs direct enigo access for press/release (the `mouse_move_smooth` function handles only movement). This requires exposing the enigo Mutex from `input.rs`.

- [ ] **Step 2: Add `enigo_lock` helper to `input.rs`**

Add this public function to `src-tauri/src/input.rs` (after the `lazy_static` block, before `mouse_move`):

```rust
/// Expose the enigo Mutex for direct access by servo_drag.
/// Returns a MutexGuard — caller must drop it before calling other input functions.
pub fn enigo_lock() -> Result<std::sync::MutexGuard<'static, Enigo>, String> {
    ENIGO.lock().map_err(|e| e.to_string())
}
```

- [ ] **Step 3: Verify it compiles**

```bash
cd D:/Repos/claude-mission-panel && cargo build 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
cd D:/Repos/claude-mission-panel && git add src-tauri/src/input.rs src-tauri/src/mcp_server.rs && git commit -m "feat(server): wire servo_drag dispatch with press/move/release sequence"
```

---

### Task 8: Build, Test, and Verify

**Files:** None (testing only)

**What:** Build the complete app, run it, and verify all new tools work via curl against the MCP server.

- [ ] **Step 1: Full release build**

```bash
cd D:/Repos/claude-mission-panel && cargo build 2>&1
```
Expected: `Finished` with no errors and no warnings about unused imports.

- [ ] **Step 2: Start the app**

```bash
cd D:/Repos/claude-mission-panel && cargo tauri dev &
```
Wait for `[MCP] Server listening on http://127.0.0.1:13456/mcp`

- [ ] **Step 3: Test `take_screenshot` with JPEG format**

```bash
curl -s -X POST http://localhost:13456/mcp -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"take_screenshot","arguments":{"format":"jpeg","scale":1.0}}}' | python -c "import sys,json; r=json.load(sys.stdin); c=r['result']['content'][0]; print(f'type={c[\"type\"]}, mime={c[\"mimeType\"]}, size={len(c[\"data\"])} chars')"
```
Expected: `type=image, mime=image/jpeg, size=<number>` where size is significantly smaller than PNG (~50K-400K chars of base64 vs ~3M+ for PNG).

- [ ] **Step 4: Test `take_screenshot_fast`**

```bash
curl -s -X POST http://localhost:13456/mcp -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"take_screenshot_fast","arguments":{}}}' | python -c "import sys,json; r=json.load(sys.stdin); c=r['result']['content'][0]; print(f'type={c[\"type\"]}, mime={c[\"mimeType\"]}, size={len(c[\"data\"])} chars')"
```
Expected: `type=image, mime=image/jpeg, size=<number>` — should be even smaller (half-scale).

- [ ] **Step 5: Test `take_screenshot` default (PNG, backward compat)**

```bash
curl -s -X POST http://localhost:13456/mcp -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"take_screenshot","arguments":{}}}' | python -c "import sys,json; r=json.load(sys.stdin); c=r['result']['content'][0]; print(f'type={c[\"type\"]}, mime={c[\"mimeType\"]}, size={len(c[\"data\"])} chars')"
```
Expected: `type=image, mime=image/png` — same as before, no regression.

- [ ] **Step 6: Test `servo_move`**

```bash
curl -s -X POST http://localhost:13456/mcp -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"servo_move","arguments":{"x":640,"y":400}}}' | python -c "import sys,json; r=json.load(sys.stdin); content=r['result']['content']; text=json.loads(content[0]['text']); print(f'final=({text[\"final_x\"]},{text[\"final_y\"]}), target=({text[\"target_x\"]},{text[\"target_y\"]}), dev={text[\"deviation_px\"]:.1f}px, corrected={text[\"corrected\"]}'); print(f'screenshot: type={content[1][\"type\"]}, mime={content[1][\"mimeType\"]}')"
```
Expected: `final=(~640,~400), target=(640,400), dev=<3px, corrected=false` plus screenshot.

- [ ] **Step 7: Test `servo_click`**

```bash
curl -s -X POST http://localhost:13456/mcp -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"servo_click","arguments":{"x":640,"y":400,"button":"left"}}}' | python -c "import sys,json; r=json.load(sys.stdin); content=r['result']['content']; text=json.loads(content[0]['text']); print(f'clicked={text[\"clicked\"]}, final=({text[\"final_x\"]},{text[\"final_y\"]})')"
```
Expected: `clicked=true, final=(~640,~400)`

- [ ] **Step 8: Test `tools/list` includes new tools**

```bash
curl -s -X POST http://localhost:13456/mcp -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":6,"method":"tools/list","params":{}}' | python -c "import sys,json; tools=[t['name'] for t in json.load(sys.stdin)['result']['tools']]; new=['take_screenshot_fast','servo_move','servo_click','servo_drag']; print(f'Total tools: {len(tools)}'); [print(f'  {t}: {\"FOUND\" if t in tools else \"MISSING\"}') for t in new]"
```
Expected: All 4 new tools FOUND, total tools = 20 (was 16).

- [ ] **Step 9: Commit final state (if any test-driven fixes were needed)**

```bash
cd D:/Repos/claude-mission-panel && git add -A && git status
```
If there are changes from test-driven fixes, commit them. If not, skip.

---

### Task 9: Update Obsidian Tool Documentation

**Files:**
- Modify: `D:\Obsidian\LamVault\Areas\Claude Tools\Mission Panel.md`

**What:** Add the new tools to the Mission Panel tool reference doc so future Claude sessions know about them.

- [ ] **Step 1: Add new tools to the Mission Panel doc**

Add a new section `### Fast Screenshots` under the `### See` section:

```markdown
### Fast Screenshots
- `take_screenshot({'format': 'jpeg'})` — JPEG screenshot, 5-10x smaller
- `take_screenshot({'format': 'jpeg', 'scale': 0.5})` — JPEG + half-scale
- `take_screenshot_fast` — preset: JPEG q70, half-scale (~50-100KB)
```

Add a new section `### Servo Movement` after `### Click`:

```markdown
### Servo Movement
- `servo_move({'x': N, 'y': N})` — smooth move to target + screenshot
- `servo_click({'x': N, 'y': N})` — smooth move + click + screenshot
- `servo_click({'x': N, 'y': N, 'button': 'right'})` — right-click variant
- `servo_drag({'x1':, 'y1':, 'x2':, 'y2':})` — smooth drag + screenshot
- All servo tools return inline JPEG screenshot — no need for separate take_screenshot
- Optional params: `steps` (5-50, default 15), `duration_ms` (100-5000, default 400)
```

- [ ] **Step 2: Commit (if in git-tracked location) or just save**

The Obsidian vault is not git-tracked from this repo, so this is just a file write. No commit needed.
