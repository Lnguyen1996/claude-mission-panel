use serde::Serialize;
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
                "type": "object", "properties": {}, "required": []
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
                    "timeout": { "type": "integer", "default": 30000 }
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
                "properties": { "text": { "type": "string" } },
                "required": ["text"]
            }),
        },
        ToolDef {
            name: "wait".into(),
            description: "Wait for specified milliseconds.".into(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": { "ms": { "type": "integer" } },
                "required": ["ms"]
            }),
        },
        ToolDef {
            name: "show_grid".into(),
            description: "Show a numbered grid overlay. Use with click_grid to click by cell number instead of pixel coordinates. Density: normal=16x9 (144 cells), dense=32x18 (576 cells), fine=48x27 (1296 cells), ultra=96x54 (5184 cells, ~32px precision).".into(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "density": {
                        "type": "string",
                        "enum": ["normal", "dense", "fine", "ultra"],
                        "default": "normal",
                        "description": "Grid density: normal (16x9, 144 cells), dense (32x18, 576 cells), fine (48x27, 1296 cells), ultra (96x54, 5184 cells)"
                    }
                },
                "required": []
            }),
        },
        ToolDef {
            name: "hide_grid".into(),
            description: "Hide the numbered grid overlay.".into(),
            input_schema: serde_json::json!({
                "type": "object", "properties": {}, "required": []
            }),
        },
        ToolDef {
            name: "click_grid".into(),
            description: "Click the center of a numbered grid cell. Call show_grid first to see cell numbers on screen. Pass cols/rows to match the current grid density (default: 16x9).".into(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "cell": { "type": "integer", "description": "Cell number (0-based, left-to-right top-to-bottom)" },
                    "cols": { "type": "integer", "default": 16, "description": "Number of grid columns (must match show_grid density)" },
                    "rows": { "type": "integer", "default": 9, "description": "Number of grid rows (must match show_grid density)" }
                },
                "required": ["cell"]
            }),
        },
    ]
}
