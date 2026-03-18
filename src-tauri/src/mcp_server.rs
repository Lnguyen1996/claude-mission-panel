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
            let tool_name = params["name"].as_str().unwrap_or("");
            let args = params["arguments"].clone();
            execute_tool(tool_name, &args, &state.app_handle).await
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
            match screenshot::capture_screen() {
                Ok(b64) => serde_json::json!({
                    "content": [{ "type": "image", "data": b64, "mimeType": "image/png" }]
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

    let listener = tokio::net::TcpListener::bind("127.0.0.1:13456").await.unwrap();
    println!("[MCP] Server listening on http://127.0.0.1:13456/mcp");
    axum::serve(listener, app).await.unwrap();
}
