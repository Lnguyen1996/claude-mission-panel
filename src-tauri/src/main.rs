#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod screenshot;
mod input;
mod command;
mod tts;
mod mcp_server;
mod mcp_tools;

use tauri::{Manager, Emitter, PhysicalPosition};
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

#[tauri::command]
fn quit_app(app_handle: tauri::AppHandle) {
    println!("[MissionPanel] Quit requested via UI");
    // Signal the MCP server to shut down gracefully first
    mcp_server::signal_shutdown();
    // Give the MCP server a moment to close, then exit
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(200));
        app_handle.exit(0);
    });
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
            // Overlay window: fully click-through for annotations/grid
            let overlay = app.get_webview_window("overlay").unwrap();
            let _ = overlay.set_ignore_cursor_events(true);

            // Pill window: always interactive (draggable, closable)
            if let Some(pill) = app.get_webview_window("pill") {
                // Position pill in the top-right of the primary monitor
                if let Ok(Some(monitor)) = pill.primary_monitor() {
                    let screen = monitor.size();
                    let x = screen.width as i32 - 240;
                    let _ = pill.set_position(PhysicalPosition::new(x, 20));
                }
            }

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
            quit_app,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
