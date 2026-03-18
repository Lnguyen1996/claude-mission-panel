use base64::{Engine as _, engine::general_purpose::STANDARD};
use xcap::Monitor;
use std::io::Cursor;
use image::ImageFormat;
use image::codecs::jpeg::JpegEncoder;

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

pub fn capture_screen_jpeg(quality: u8, scale: f32) -> Result<(String, String), String> {
    let monitors = Monitor::all().map_err(|e| format!("Failed to list monitors: {}", e))?;
    let monitor = monitors.into_iter().next().ok_or("No monitor found")?;

    let rgba_img = monitor.capture_image().map_err(|e| format!("Capture failed: {}", e))?;

    // Convert RGBA to RGB (JPEG doesn't support alpha)
    let rgb_img = image::DynamicImage::ImageRgba8(rgba_img).to_rgb8();

    // Downscale if scale < 1.0
    let final_img = if scale < 1.0 {
        let new_w = (rgb_img.width() as f32 * scale) as u32;
        let new_h = (rgb_img.height() as f32 * scale) as u32;
        image::imageops::resize(&rgb_img, new_w, new_h, image::imageops::FilterType::Triangle)
    } else {
        rgb_img
    };

    // Encode as JPEG with explicit quality
    let mut buf = Cursor::new(Vec::new());
    let encoder = JpegEncoder::new_with_quality(&mut buf, quality);
    final_img.write_with_encoder(encoder)
        .map_err(|e| format!("JPEG encode failed: {}", e))?;

    Ok((STANDARD.encode(buf.into_inner()), "image/jpeg".to_string()))
}
