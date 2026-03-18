use axum::{
    Router, Json,
    routing::{post, get},
    extract::State,
    response::IntoResponse,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tower_http::cors::CorsLayer;
use uuid::Uuid;
use tokio::sync::watch;

use enigo::Mouse;
use crate::{screenshot, input, command, tts, mcp_tools};

struct McpState {
    app_handle: AppHandle,
}

/// Shutdown signal sender — stored globally so the app can trigger shutdown on close
static SHUTDOWN_TX: std::sync::OnceLock<watch::Sender<bool>> = std::sync::OnceLock::new();

#[derive(Deserialize)]
struct JsonRpcRequest {
    #[allow(dead_code)]
    jsonrpc: String,
    id: Option<Value>,
    method: String,
    params: Option<Value>,
}

#[derive(Serialize)]
struct JsonRpcResponse {
    jsonrpc: String,
    id: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
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
                "capabilities": { "tools": {} },
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
            let params = req.params.clone().unwrap_or_default();
            let tool_name = params["name"].as_str().unwrap_or("").to_string();
            let args = params["arguments"].clone();

            // Emit activity log: tool call started
            let _ = state.app_handle.emit("activity-log", serde_json::json!({
                "type": "tool_start",
                "tool": tool_name,
                "args": &args,
                "timestamp": chrono_now(),
            }));
            let _ = state.app_handle.emit("status", serde_json::json!({
                "state": "executing",
                "text": format!("{}", tool_name)
            }));

            let result = execute_tool(&tool_name, &args, &state.app_handle).await;

            // Emit activity log: tool call completed
            let is_error = result.get("isError").and_then(|v| v.as_bool()).unwrap_or(false);
            let result_text = result.get("content")
                .and_then(|c| c.as_array())
                .and_then(|arr| arr.first())
                .and_then(|item| item.get("text"))
                .and_then(|t| t.as_str())
                .unwrap_or("")
                .to_string();

            let _ = state.app_handle.emit("activity-log", serde_json::json!({
                "type": if is_error { "tool_error" } else { "tool_done" },
                "tool": tool_name,
                "result": if result_text.len() > 200 { format!("{}...", &result_text[..200]) } else { result_text },
                "timestamp": chrono_now(),
            }));
            let _ = state.app_handle.emit("status", serde_json::json!({
                "state": if is_error { "error" } else { "idle" },
                "text": if is_error { format!("{} failed", tool_name) } else { "Ready".to_string() }
            }));

            result
        }
        "notifications/initialized" => {
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
    // DPI scale correction: screenshot pixels → enigo logical coords
    // Detected empirically: enigo(500,200) → cursor at physical(400,160), ratio=0.8
    // So to click at screenshot coord (X,Y), send enigo(X/0.8, Y/0.8) = (X*1.25, Y*1.25)
    let dpi_scale: f64 = 1.25;

    match name {
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
        "take_screenshot_fast" => {
            match screenshot::capture_screen_jpeg(70, 0.5) {
                Ok((b64, mime)) => serde_json::json!({
                    "content": [{ "type": "image", "data": b64, "mimeType": mime }]
                }),
                Err(e) => tool_error(&e),
            }
        }
        "mouse_click" => {
            let raw_x = args["x"].as_i64().unwrap_or(0) as f64;
            let raw_y = args["y"].as_i64().unwrap_or(0) as f64;
            let x = (raw_x * dpi_scale) as i32;
            let y = (raw_y * dpi_scale) as i32;
            let button = args["button"].as_str().unwrap_or("left");
            match input::mouse_click(x, y, button) {
                Ok(()) => tool_text(&format!("Clicked {} at ({}, {}) [raw: ({}, {})]", button, x, y, raw_x as i32, raw_y as i32)),
                Err(e) => tool_error(&e),
            }
        }
        "mouse_move" => {
            let raw_x = args["x"].as_i64().unwrap_or(0) as f64;
            let raw_y = args["y"].as_i64().unwrap_or(0) as f64;
            let x = (raw_x * dpi_scale) as i32;
            let y = (raw_y * dpi_scale) as i32;
            match input::mouse_move(x, y) {
                Ok(()) => tool_text(&format!("Moved to ({}, {}) [raw: ({}, {})]", x, y, raw_x as i32, raw_y as i32)),
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
            let raw_x1 = args["x1"].as_i64().unwrap_or(0) as f64;
            let raw_y1 = args["y1"].as_i64().unwrap_or(0) as f64;
            let raw_x2 = args["x2"].as_i64().unwrap_or(0) as f64;
            let raw_y2 = args["y2"].as_i64().unwrap_or(0) as f64;
            let x1 = (raw_x1 * dpi_scale) as i32;
            let y1 = (raw_y1 * dpi_scale) as i32;
            let x2 = (raw_x2 * dpi_scale) as i32;
            let y2 = (raw_y2 * dpi_scale) as i32;
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
            let _ = app_handle.emit("status", serde_json::json!({
                "state": "executing",
                "text": format!("Running: {}...", &cmd[..cmd.len().min(40)])
            }));
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
            if let Some(obj) = payload.as_object_mut() {
                obj.insert("action".into(), serde_json::json!("add"));
                obj.insert("id".into(), serde_json::json!(id));
            }
            let _ = app_handle.emit("annotation", &payload);
            tool_text(&format!("Drew {} at ({}, {})", args["type"].as_str().unwrap_or("?"), args["x"], args["y"]))
        }
        "clear_annotations" => {
            let _ = app_handle.emit("annotation", serde_json::json!({ "action": "clear" }));
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
        "show_grid" => {
            let density = args.get("density")
                .and_then(|d| d.as_str())
                .unwrap_or("normal");
            let (cols, rows) = match density {
                "dense" => (32u32, 18u32),
                "fine" => (48u32, 27u32),
                "ultra" => (96u32, 54u32),
                _ => (16u32, 9u32),
            };
            let _ = app_handle.emit("grid", serde_json::json!({
                "action": "show",
                "cols": cols,
                "rows": rows
            }));
            tool_text(&format!("Grid overlay shown ({}x{}, {} cells, density: {})", cols, rows, cols*rows, density))
        }
        "hide_grid" => {
            let _ = app_handle.emit("grid", serde_json::json!({ "action": "hide" }));
            tool_text("Grid overlay hidden")
        }
        "click_grid" => {
            let cell = args["cell"].as_u64().unwrap_or(0) as u32;
            let cols = args.get("cols").and_then(|c| c.as_u64()).unwrap_or(16) as u32;
            let rows = args.get("rows").and_then(|r| r.as_u64()).unwrap_or(9) as u32;
            let screen_w: u32 = 3072;
            let screen_h: u32 = 1728;
            let cell_w = screen_w / cols;
            let cell_h = screen_h / rows;
            let col = cell % cols;
            let row = cell / cols;
            if cell >= cols * rows {
                return tool_error(&format!("Cell {} out of range (0-{})", cell, cols * rows - 1));
            }
            let center_x = (col * cell_w + cell_w / 2) as i32;
            let center_y = (row * cell_h + cell_h / 2) as i32;
            // Apply DPI scale (1.25x) like other mouse tools
            let enigo_x = (center_x as f64 * dpi_scale) as i32;
            let enigo_y = (center_y as f64 * dpi_scale) as i32;
            match input::mouse_click(enigo_x, enigo_y, "left") {
                Ok(()) => tool_text(&format!("Clicked grid cell {} (row {}, col {}) at ({}, {})", cell, row, col, center_x, center_y)),
                Err(e) => tool_error(&e),
            }
        }
        "servo_move" => {
            let raw_x = args["x"].as_i64().unwrap_or(0) as f64;
            let raw_y = args["y"].as_i64().unwrap_or(0) as f64;
            let target_x = (raw_x * dpi_scale) as i32;
            let target_y = (raw_y * dpi_scale) as i32;
            let steps = args.get("steps").and_then(|s| s.as_u64()).unwrap_or(15) as u32;
            let steps = steps.clamp(5, 50);
            let duration_ms = args.get("duration_ms").and_then(|d| d.as_u64()).unwrap_or(400);
            let duration_ms = duration_ms.clamp(100, 5000);

            let move_result = tokio::task::spawn_blocking(move || {
                input::mouse_move_smooth(target_x, target_y, steps, duration_ms)
            }).await;

            match move_result {
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

            let click_result = tokio::task::spawn_blocking(move || {
                let move_result = input::mouse_move_smooth(target_x, target_y, steps, duration_ms)?;
                std::thread::sleep(std::time::Duration::from_millis(50));
                input::mouse_click(move_result.final_x, move_result.final_y, &button)?;
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
                let start_result = input::mouse_move_smooth(start_x, start_y, steps, duration_ms)?;
                {
                    let mut enigo = input::enigo_lock()?;
                    enigo.button(enigo::Button::Left, enigo::Direction::Press)
                        .map_err(|e| format!("Press failed: {}", e))?;
                }
                std::thread::sleep(std::time::Duration::from_millis(50));
                let end_result = input::mouse_move_smooth(end_x, end_y, steps, duration_ms)?;
                std::thread::sleep(std::time::Duration::from_millis(50));
                {
                    let mut enigo = input::enigo_lock()?;
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
        _ => tool_error(&format!("Unknown tool: {}", name)),
    }
}

fn tool_text(text: &str) -> Value {
    serde_json::json!({ "content": [{ "type": "text", "text": text }] })
}

fn tool_error(msg: &str) -> Value {
    serde_json::json!({ "content": [{ "type": "text", "text": msg }], "isError": true })
}

/// Health check endpoint so clients can verify the server is alive
async fn health_check() -> impl IntoResponse {
    "ok"
}

/// Simple timestamp string (no chrono crate needed)
fn chrono_now() -> String {
    let duration = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = duration.as_secs();
    // Return ISO-ish format: just the unix timestamp for simplicity
    format!("{}", secs)
}

/// Signal the MCP server to shut down (called from Tauri on app close)
pub fn signal_shutdown() {
    if let Some(tx) = SHUTDOWN_TX.get() {
        let _ = tx.send(true);
        println!("[MCP] Shutdown signal sent");
    }
}

pub async fn start(app_handle: AppHandle) {
    let state = Arc::new(McpState { app_handle });

    let app = Router::new()
        .route("/mcp", post(handle_mcp))
        .route("/health", get(health_check))
        .layer(CorsLayer::permissive())
        .with_state(state);

    // Create shutdown channel
    let (tx, rx) = watch::channel(false);
    let _ = SHUTDOWN_TX.set(tx);

    // Retry binding with exponential backoff — handles port still in TIME_WAIT from previous run
    let mut attempts = 0;
    let listener = loop {
        match tokio::net::TcpListener::bind("127.0.0.1:13456").await {
            Ok(listener) => break listener,
            Err(e) => {
                attempts += 1;
                if attempts > 10 {
                    eprintln!("[MCP] Failed to bind port 13456 after 10 attempts: {}", e);
                    return;
                }
                eprintln!("[MCP] Port 13456 busy (attempt {}), retrying in {}s... ({})", attempts, attempts, e);
                tokio::time::sleep(std::time::Duration::from_secs(attempts)).await;
            }
        }
    };

    println!("[MCP] Server listening on http://127.0.0.1:13456/mcp");

    // Serve with graceful shutdown
    let mut shutdown_rx = rx.clone();
    axum::serve(listener, app)
        .with_graceful_shutdown(async move {
            // Wait until shutdown signal is sent
            while !*shutdown_rx.borrow_and_update() {
                if shutdown_rx.changed().await.is_err() {
                    break;
                }
            }
            println!("[MCP] Server shutting down gracefully");
        })
        .await
        .unwrap_or_else(|e| eprintln!("[MCP] Server error: {}", e));

    println!("[MCP] Server stopped");
}
