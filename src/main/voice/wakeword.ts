/**
 * Wake word detection module.
 *
 * Continuously listens for "hey claude" by recording short audio buffers
 * and running them through speech recognition. When the wake word is detected,
 * it triggers a callback and begins capturing the full command utterance.
 *
 * Detection approach:
 * - Records 3-second audio windows on a rolling basis
 * - Transcribes each window looking for the wake phrase
 * - When detected, records a longer window (up to silence or max duration)
 *   for the actual command and passes it to the agent
 */

import { startRecording, stopRecording, transcribe, getRecordingState } from "./whisper";

const WAKE_PHRASES = [
  "hey claude",
  "hey cloud",     // common misrecognition
  "hey clod",      // common misrecognition
  "a claude",      // common misrecognition
  "hey claud",     // partial match
];

const LISTEN_WINDOW_MS = 3000;   // 3s listening windows for wake word
const COMMAND_DURATION_MS = 8000; // 8s max for command after wake word
const COOLDOWN_MS = 1000;        // 1s cooldown between listen cycles

export type WakeWordCallback = (transcription: string) => void;

let isListening = false;
let onWakeWord: WakeWordCallback | null = null;
let listenCycleTimeout: ReturnType<typeof setTimeout> | null = null;

/**
 * Check if a transcription contains the wake word.
 */
function containsWakeWord(text: string): boolean {
  const lower = text.toLowerCase().trim();
  return WAKE_PHRASES.some((phrase) => lower.includes(phrase));
}

/**
 * Extract the command portion after the wake word.
 * E.g., "Hey Claude, open Safari" -> "open Safari"
 */
function extractCommand(text: string): string {
  const lower = text.toLowerCase();
  for (const phrase of WAKE_PHRASES) {
    const idx = lower.indexOf(phrase);
    if (idx !== -1) {
      // Get everything after the wake phrase
      let command = text.substring(idx + phrase.length).trim();
      // Remove leading comma if present
      if (command.startsWith(",")) {
        command = command.substring(1).trim();
      }
      return command;
    }
  }
  return text.trim();
}

/**
 * Run a single listen cycle: record a short window and check for wake word.
 */
async function listenCycle(): Promise<void> {
  if (!isListening) return;

  try {
    // Record a short audio window
    startRecording();
    await new Promise((resolve) => setTimeout(resolve, LISTEN_WINDOW_MS));

    if (!isListening) return;

    const audioPath = await stopRecording();
    const text = await transcribe(audioPath);

    if (!isListening) return;

    if (containsWakeWord(text)) {
      console.log("[WakeWord] Wake word detected in:", text);

      // Extract any command that was in the same utterance
      const immediateCommand = extractCommand(text);

      if (immediateCommand.length > 2) {
        // Wake word + command in same utterance
        console.log("[WakeWord] Command in same utterance:", immediateCommand);
        onWakeWord?.(immediateCommand);
      } else {
        // Wake word only — record longer for the command
        console.log("[WakeWord] Listening for command...");
        startRecording();
        await new Promise((resolve) => setTimeout(resolve, COMMAND_DURATION_MS));

        if (!isListening) return;

        const cmdAudioPath = await stopRecording();
        const commandText = await transcribe(cmdAudioPath);

        if (commandText.trim()) {
          console.log("[WakeWord] Command captured:", commandText);
          onWakeWord?.(commandText.trim());
        }
      }

      // Cooldown after processing
      await new Promise((resolve) => setTimeout(resolve, COOLDOWN_MS));
    }
  } catch (error) {
    console.warn("[WakeWord] Listen cycle error:", error);
    // Brief pause before retrying
    await new Promise((resolve) => setTimeout(resolve, COOLDOWN_MS));
  }

  // Continue listening
  if (isListening) {
    listenCycleTimeout = setTimeout(listenCycle, 100);
  }
}

/**
 * Start listening for the wake word.
 * Calls the callback with the transcribed command when "hey claude" is detected.
 */
export function startWakeWordDetection(callback: WakeWordCallback): void {
  if (isListening) {
    console.warn("[WakeWord] Already listening");
    return;
  }

  console.log("[WakeWord] Starting wake word detection...");
  isListening = true;
  onWakeWord = callback;
  listenCycle();
}

/**
 * Stop listening for the wake word.
 */
export function stopWakeWordDetection(): void {
  console.log("[WakeWord] Stopping wake word detection");
  isListening = false;
  onWakeWord = null;

  if (listenCycleTimeout) {
    clearTimeout(listenCycleTimeout);
    listenCycleTimeout = null;
  }

  // Stop any active recording
  if (getRecordingState()) {
    stopRecording().catch(() => {});
  }
}

/**
 * Check if wake word detection is currently active.
 */
export function isWakeWordActive(): boolean {
  return isListening;
}
