use base64::{Engine as _, engine::general_purpose::STANDARD};
use xcap::Monitor;
use std::io::Cursor;
use image::ImageFormat;

pub fn capture_screen() -> Result<String, String> {
    let monitors = Monitor::all().map_err(|e| format!("Failed to list monitors: {}", e))?;
    let monitor = monitors.into_iter().next().ok_or("No monitor found")?;

    let image = monitor.capture_image().map_err(|e| format!("Capture failed: {}", e))?;

    let mut buf = Cursor::new(Vec::new());
    image.write_to(&mut buf, ImageFormat::Png)
        .map_err(|e| format!("PNG encode failed: {}", e))?;

    Ok(STANDARD.encode(buf.into_inner()))
}

pub fn capture_region(x: u32, y: u32, width: u32, height: u32) -> Result<String, String> {
    let monitors = Monitor::all().map_err(|e| format!("Failed to list monitors: {}", e))?;
    let monitor = monitors.into_iter().next().ok_or("No monitor found")?;

    let image = monitor.capture_image().map_err(|e| format!("Capture failed: {}", e))?;
    let cropped = image::imageops::crop_imm(&image, x, y, width, height).to_image();

    let mut buf = Cursor::new(Vec::new());
    cropped.write_to(&mut buf, ImageFormat::Png)
        .map_err(|e| format!("PNG encode failed: {}", e))?;

    Ok(STANDARD.encode(buf.into_inner()))
}
