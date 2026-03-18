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
    println!("[Prompt] {}", text);
}

fn main() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
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

            // Register Ctrl+Shift+Space hotkey (non-fatal if already taken)
            let shortcut: Shortcut = "CmdOrCtrl+Shift+Space".parse().unwrap();
            if let Err(e) = app.global_shortcut().register(shortcut) {
                eprintln!("[MissionPanel] Warning: Could not register hotkey: {}", e);
            }

            // Start MCP server in background thread
            let app_handle = app.handle().clone();
            std::thread::spawn(move || {
                let rt = tokio::runtime::Runtime::new().unwrap();
                rt.block_on(mcp_server::start(app_handle));
            });

            println!("[MissionPanel] Ready.");
            println!("[MissionPanel] Hotkey: Ctrl+Shift+Space (prompt bar)");
            println!("[MissionPanel] MCP server: http://localhost:13456/mcp");
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
