import { exec } from "child_process";

export function speak(text: string): Promise<void> {
  return new Promise((resolve) => {
    // Sanitize text to prevent command injection
    const sanitized = text.replace(/[\\"`$]/g, "");

    if (process.platform === "darwin") {
      exec(`say "${sanitized}"`, () => resolve());
    } else if (process.platform === "win32") {
      const escaped = sanitized.replace(/'/g, "''");
      exec(
        `powershell -Command "Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak('${escaped}')"`,
        () => resolve()
      );
    } else {
      // Linux fallback: espeak
      exec(`espeak "${sanitized}"`, () => resolve());
    }
  });
}
