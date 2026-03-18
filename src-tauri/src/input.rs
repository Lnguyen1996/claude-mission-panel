use enigo::{Enigo, Mouse, Keyboard, Settings, Button, Coordinate, Direction, Key};
use std::sync::Mutex;

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

lazy_static::lazy_static! {
    static ref ENIGO: Mutex<Enigo> = Mutex::new(
        Enigo::new(&Settings::default()).expect("Failed to create Enigo")
    );
}

/// Expose the enigo Mutex for direct access by servo_drag.
pub fn enigo_lock() -> Result<std::sync::MutexGuard<'static, Enigo>, String> {
    ENIGO.lock().map_err(|e| e.to_string())
}

pub fn mouse_move(x: i32, y: i32) -> Result<(), String> {
    let mut enigo = ENIGO.lock().map_err(|e| e.to_string())?;
    enigo.move_mouse(x, y, Coordinate::Abs).map_err(|e| format!("Move failed: {}", e))
}

pub fn get_cursor_position() -> Result<(i32, i32), String> {
    let enigo = ENIGO.lock().map_err(|e| e.to_string())?;
    let (x, y) = enigo.location().map_err(|e| format!("Failed to get cursor position: {}", e))?;
    Ok((x, y))
}

pub fn mouse_move_smooth(
    target_x: i32,
    target_y: i32,
    steps: u32,
    duration_ms: u64,
) -> Result<SmoothMoveResult, String> {
    let step_delay = std::time::Duration::from_millis(duration_ms / steps as u64);
    let deviation_threshold: f64 = 6.0;

    let mut enigo = ENIGO.lock().map_err(|e| e.to_string())?;

    let (start_x, start_y) = enigo.location()
        .map_err(|e| format!("Failed to get cursor position: {}", e))?;

    let mut corrected = false;

    for i in 1..=steps {
        let progress = i as f64 / steps as f64;
        let expected_x = start_x as f64 + (target_x as f64 - start_x as f64) * progress;
        let expected_y = start_y as f64 + (target_y as f64 - start_y as f64) * progress;

        enigo.move_mouse(expected_x as i32, expected_y as i32, Coordinate::Abs)
            .map_err(|e| format!("Move failed: {}", e))?;

        std::thread::sleep(step_delay);

        let (actual_x, actual_y) = enigo.location()
            .map_err(|e| format!("Position check failed: {}", e))?;

        let dx = (actual_x as f64 - expected_x).abs();
        let dy = (actual_y as f64 - expected_y).abs();
        let deviation = (dx * dx + dy * dy).sqrt();

        if deviation > deviation_threshold && i < steps {
            corrected = true;
        }
    }

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

pub fn mouse_click(x: i32, y: i32, button: &str) -> Result<(), String> {
    let mut enigo = ENIGO.lock().map_err(|e| e.to_string())?;
    enigo.move_mouse(x, y, Coordinate::Abs).map_err(|e| format!("Move failed: {}", e))?;

    if button == "double" {
        enigo.button(Button::Left, Direction::Click).map_err(|e| e.to_string())?;
        std::thread::sleep(std::time::Duration::from_millis(50));
        enigo.button(Button::Left, Direction::Click).map_err(|e| e.to_string())?;
    } else {
        let btn = match button {
            "right" => Button::Right,
            "middle" => Button::Middle,
            _ => Button::Left,
        };
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

pub fn keyboard_type(text: &str) -> Result<(), String> {
    let mut enigo = ENIGO.lock().map_err(|e| e.to_string())?;
    enigo.text(text).map_err(|e| format!("Type failed: {}", e))
}

pub fn keyboard_shortcut(keys: &[String]) -> Result<(), String> {
    let mut enigo = ENIGO.lock().map_err(|e| e.to_string())?;
    let resolved: Vec<Key> = keys.iter().map(|k| resolve_key(k)).collect::<Result<_, _>>()?;

    for key in &resolved {
        enigo.key(*key, Direction::Press).map_err(|e| e.to_string())?;
    }
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
