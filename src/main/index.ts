import { app, globalShortcut, ipcMain } from "electron";
import { OverlayManager } from "./overlay";
import { AgentSession } from "./agent";
import { startRecording, stopRecording, transcribe, getRecordingState } from "./voice/whisper";
import { startWakeWordDetection, stopWakeWordDetection, isWakeWordActive } from "./voice/wakeword";

const overlayManager = new OverlayManager();
let agentSession: AgentSession | null = null;
let isPushToTalkActive = false;

app.whenReady().then(() => {
  overlayManager.create();
  overlayManager.loadContent();

  // Create agent session
  agentSession = new AgentSession((channel, data) => {
    overlayManager.sendToRenderer(channel, data);
  });

  // Listen for prompts from the renderer
  ipcMain.on("prompt", async (_event, text: string) => {
    if (agentSession) {
      await agentSession.execute(text);
    }
  });

  // Register global hotkey: Cmd+Shift+Space to toggle prompt bar
  globalShortcut.register("CommandOrControl+Shift+Space", () => {
    overlayManager.sendToRenderer("toggle-prompt", {});
  });

  // Register push-to-talk hotkey: Cmd+Shift+V
  // Press to start recording, release to stop and transcribe
  globalShortcut.register("CommandOrControl+Shift+V", () => {
    if (!isPushToTalkActive) {
      // Start recording
      isPushToTalkActive = true;
      overlayManager.sendToRenderer("status", { state: "executing", text: "Listening..." });
      startRecording();
      console.log("[PTT] Push-to-talk started");
    }
  });

  // Since globalShortcut doesn't have key-up events, we use a toggle approach:
  // First press starts recording, second press stops and transcribes.
  // We also set a max recording timeout.
  const PTT_MAX_DURATION = 15000; // 15 seconds max

  // Override the PTT shortcut to act as toggle
  globalShortcut.unregister("CommandOrControl+Shift+V");
  globalShortcut.register("CommandOrControl+Shift+V", async () => {
    if (!isPushToTalkActive) {
      // Start recording
      isPushToTalkActive = true;
      overlayManager.sendToRenderer("status", { state: "executing", text: "Listening... (press Cmd+Shift+V again to stop)" });
      startRecording();
      console.log("[PTT] Recording started");

      // Auto-stop after max duration
      setTimeout(async () => {
        if (isPushToTalkActive) {
          await finishPushToTalk();
        }
      }, PTT_MAX_DURATION);
    } else {
      // Stop recording and transcribe
      await finishPushToTalk();
    }
  });

  // Start wake word detection ("hey claude")
  startWakeWordDetection(async (command: string) => {
    console.log("[WakeWord] Executing command:", command);
    overlayManager.sendToRenderer("status", { state: "thinking", text: `Voice: "${command}"` });
    if (agentSession) {
      await agentSession.execute(command);
    }
  });

  console.log("[MissionPanel] Ready. Hotkeys: Cmd+Shift+Space (prompt), Cmd+Shift+V (push-to-talk)");
  console.log("[MissionPanel] Wake word detection active. Say 'Hey Claude' to activate.");
});

/**
 * Finish push-to-talk: stop recording, transcribe, and execute.
 */
async function finishPushToTalk(): Promise<void> {
  if (!isPushToTalkActive) return;
  isPushToTalkActive = false;

  try {
    overlayManager.sendToRenderer("status", { state: "thinking", text: "Transcribing..." });
    const audioPath = await stopRecording();
    const text = await transcribe(audioPath);

    if (text.trim()) {
      console.log("[PTT] Transcribed:", text);
      overlayManager.sendToRenderer("status", { state: "thinking", text: `Voice: "${text}"` });
      if (agentSession) {
        await agentSession.execute(text);
      }
    } else {
      console.log("[PTT] No speech detected");
      overlayManager.sendToRenderer("status", { state: "idle", text: "No speech detected" });
    }
  } catch (error) {
    console.error("[PTT] Error:", error);
    overlayManager.sendToRenderer("status", {
      state: "error",
      text: `Voice error: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  stopWakeWordDetection();
});

app.on("window-all-closed", () => app.quit());

export { overlayManager };
