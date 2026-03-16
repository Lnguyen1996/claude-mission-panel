/**
 * Speech-to-Text module
 *
 * Uses a layered approach:
 * 1. Primary: macOS native SFSpeechRecognizer via a Swift helper script
 * 2. Fallback: whisper-node with local Whisper model (if available)
 * 3. Last resort: macOS `say` dictation via AppleScript
 *
 * Audio recording uses sox/rec (installed via homebrew) to capture from the mic.
 */

import { exec, execFile, spawn, ChildProcess } from "child_process";
import { tmpdir } from "os";
import path from "path";
import fs from "fs";

const TEMP_DIR = tmpdir();
const AUDIO_FILE = path.join(TEMP_DIR, "claude-mission-panel-audio.wav");

// Recording state
let recordingProcess: ChildProcess | null = null;
let isRecording = false;

/**
 * Start recording audio from the microphone.
 * Uses sox/rec to capture audio in WAV format suitable for speech recognition.
 */
export function startRecording(): void {
  if (isRecording) return;

  // Clean up previous recording
  try {
    if (fs.existsSync(AUDIO_FILE)) {
      fs.unlinkSync(AUDIO_FILE);
    }
  } catch {
    // ignore
  }

  if (process.platform === "darwin") {
    // Use rec (from sox) on macOS — records 16kHz mono WAV, ideal for speech recognition
    recordingProcess = spawn("rec", [
      AUDIO_FILE,
      "rate", "16000",    // 16kHz sample rate (required by Whisper)
      "channels", "1",    // Mono
      "bits", "16",       // 16-bit
    ], {
      stdio: "ignore",
    });
  } else if (process.platform === "win32") {
    // Windows: use PowerShell with NAudio or ffmpeg
    recordingProcess = spawn("powershell", [
      "-Command",
      `ffmpeg -f dshow -i audio="Microphone" -ar 16000 -ac 1 -acodec pcm_s16le "${AUDIO_FILE}" -y`,
    ], {
      stdio: "ignore",
    });
  } else {
    // Linux: use arecord
    recordingProcess = spawn("arecord", [
      "-f", "S16_LE",
      "-r", "16000",
      "-c", "1",
      AUDIO_FILE,
    ], {
      stdio: "ignore",
    });
  }

  isRecording = true;
  console.log("[STT] Recording started");
}

/**
 * Stop recording and return the path to the audio file.
 */
export function stopRecording(): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!isRecording || !recordingProcess) {
      reject(new Error("Not currently recording"));
      return;
    }

    recordingProcess.on("close", () => {
      isRecording = false;
      recordingProcess = null;

      if (fs.existsSync(AUDIO_FILE)) {
        resolve(AUDIO_FILE);
      } else {
        reject(new Error("Audio file not created"));
      }
    });

    // Send SIGINT to gracefully stop recording (sox writes WAV header on close)
    recordingProcess.kill("SIGINT");

    // Safety timeout
    setTimeout(() => {
      if (isRecording && recordingProcess) {
        recordingProcess.kill("SIGTERM");
        isRecording = false;
        recordingProcess = null;
      }
    }, 3000);
  });
}

/**
 * Check if currently recording
 */
export function getRecordingState(): boolean {
  return isRecording;
}

/**
 * Transcribe audio using macOS native SFSpeechRecognizer.
 * This is the primary transcription method — no model download required.
 */
function transcribeWithNativeMacOS(audioPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // Use a Swift one-liner via swift CLI to invoke SFSpeechRecognizer
    const swiftCode = `
import Foundation
import Speech

let semaphore = DispatchSemaphore(value: 0)

SFSpeechRecognizer.requestAuthorization { status in
    guard status == .authorized else {
        print("ERROR:Speech recognition not authorized (status: \\(status.rawValue))")
        semaphore.signal()
        return
    }

    let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))!
    let url = URL(fileURLWithPath: "${audioPath.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}")
    let request = SFSpeechURLRecognitionRequest(url: url)
    request.shouldReportPartialResults = false

    recognizer.recognitionTask(with: request) { result, error in
        if let error = error {
            print("ERROR:\\(error.localizedDescription)")
            semaphore.signal()
            return
        }
        if let result = result, result.isFinal {
            print(result.bestTranscription.formattedString)
            semaphore.signal()
        }
    }
}

semaphore.wait()
`;

    const swiftFile = path.join(TEMP_DIR, "claude-stt.swift");
    fs.writeFileSync(swiftFile, swiftCode);

    execFile("swift", [swiftFile], { timeout: 30000 }, (error, stdout, stderr) => {
      // Clean up
      try { fs.unlinkSync(swiftFile); } catch { /* ignore */ }

      const output = stdout.trim();

      if (output.startsWith("ERROR:")) {
        reject(new Error(output.substring(6)));
        return;
      }

      if (error && !output) {
        reject(new Error(`Swift STT failed: ${stderr || error.message}`));
        return;
      }

      resolve(output);
    });
  });
}

/**
 * Transcribe audio using whisper-node (local Whisper model).
 * Requires the model to be downloaded first.
 */
async function transcribeWithWhisper(audioPath: string): Promise<string> {
  try {
    // Dynamic import since whisper-node may not be available
    const { default: whisper } = await import("whisper-node");

    const result = await whisper(audioPath, {
      modelName: "base.en",
      whisperOptions: {
        language: "en",
        gen_file_txt: false,
        gen_file_subtitle: false,
        gen_file_vtt: false,
        word_timestamps: false,
      },
    });

    if (!result || result.length === 0) {
      throw new Error("Whisper returned empty result");
    }

    return result.map((r: { speech: string }) => r.speech).join(" ").trim();
  } catch (error) {
    throw new Error(`Whisper transcription failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Transcribe audio to text.
 * Tries macOS native first, then whisper-node as fallback.
 */
export async function transcribe(audioPath?: string): Promise<string> {
  const filePath = audioPath || AUDIO_FILE;

  if (!fs.existsSync(filePath)) {
    throw new Error(`Audio file not found: ${filePath}`);
  }

  // Try macOS native SFSpeechRecognizer first (best quality, no model needed)
  if (process.platform === "darwin") {
    try {
      const result = await transcribeWithNativeMacOS(filePath);
      if (result) {
        console.log("[STT] Transcribed via macOS native:", result);
        return result;
      }
    } catch (error) {
      console.warn("[STT] macOS native STT failed, trying whisper fallback:", error);
    }
  }

  // Fallback: whisper-node
  try {
    const result = await transcribeWithWhisper(filePath);
    console.log("[STT] Transcribed via Whisper:", result);
    return result;
  } catch (error) {
    console.warn("[STT] Whisper fallback also failed:", error);
    throw new Error("All speech-to-text methods failed. Make sure microphone permissions are granted.");
  }
}

/**
 * Record for a specific duration and transcribe.
 * Useful for wake word detection buffers.
 */
export function recordAndTranscribe(durationMs: number): Promise<string> {
  return new Promise(async (resolve, reject) => {
    startRecording();

    setTimeout(async () => {
      try {
        const audioPath = await stopRecording();
        const text = await transcribe(audioPath);
        resolve(text);
      } catch (error) {
        reject(error);
      }
    }, durationMs);
  });
}
