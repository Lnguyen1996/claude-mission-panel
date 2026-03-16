import { exec } from "child_process";

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export function runCommand(
  command: string,
  timeout = 30000
): Promise<CommandResult> {
  return new Promise((resolve) => {
    exec(
      command,
      {
        timeout,
        shell: process.platform === "win32" ? "powershell.exe" : "/bin/zsh",
        maxBuffer: 1024 * 1024, // 1MB
      },
      (error, stdout, stderr) => {
        resolve({
          stdout: stdout?.toString() ?? "",
          stderr: stderr?.toString() ?? "",
          exitCode: error?.code ?? 0,
        });
      }
    );
  });
}
