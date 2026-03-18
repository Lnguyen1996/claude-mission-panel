use std::process::Command;
use serde::Serialize;

#[derive(Serialize, Clone)]
pub struct CommandResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

pub fn run_command(cmd: &str, _timeout_ms: u64) -> Result<CommandResult, String> {
    let shell = if cfg!(target_os = "windows") { "powershell" } else { "zsh" };
    let shell_flag = if cfg!(target_os = "windows") { "-Command" } else { "-c" };

    let output = Command::new(shell)
        .args([shell_flag, cmd])
        .output()
        .map_err(|e| format!("Failed to execute: {}", e))?;

    Ok(CommandResult {
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        exit_code: output.status.code().unwrap_or(-1),
    })
}

pub fn run_command_background(cmd: &str) -> Result<u32, String> {
    let shell = if cfg!(target_os = "windows") { "powershell" } else { "zsh" };
    let shell_flag = if cfg!(target_os = "windows") { "-Command" } else { "-c" };

    let child = Command::new(shell)
        .args([shell_flag, cmd])
        .spawn()
        .map_err(|e| format!("Failed to spawn: {}", e))?;

    Ok(child.id())
}
