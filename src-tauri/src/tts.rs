use std::process::Command;

pub fn speak(text: &str) {
    let sanitized: String = text.chars().filter(|c| *c != '"' && *c != '\\' && *c != '$').collect();

    #[cfg(target_os = "macos")]
    {
        let _ = Command::new("say").arg(&sanitized).spawn();
    }

    #[cfg(target_os = "windows")]
    {
        let escaped = sanitized.replace('\'', "''");
        let _ = Command::new("powershell")
            .args(["-Command", &format!(
                "Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak('{}')",
                escaped
            )])
            .spawn();
    }

    #[cfg(target_os = "linux")]
    {
        let _ = Command::new("espeak").arg(&sanitized).spawn();
    }
}
