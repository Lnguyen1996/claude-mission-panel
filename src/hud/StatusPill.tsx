import { useState, useEffect, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import "../styles/hud.css";

interface StatusData {
  state: "idle" | "thinking" | "executing" | "error";
  text: string;
}

export function StatusPill() {
  const [status, setStatus] = useState<StatusData>({ state: "idle", text: "Ready" });

  useEffect(() => {
    const unlisten = listen<StatusData>("status", (event) => {
      setStatus(event.payload);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  const handleClose = useCallback(() => {
    invoke("quit_app");
  }, []);

  const handleDrag = useCallback((e: React.MouseEvent) => {
    // Don't start drag if clicking the close button
    if ((e.target as HTMLElement).closest(".hud-close-btn")) return;
    getCurrentWebviewWindow().startDragging();
  }, []);

  return (
    <div
      className="hud-status-pill hud-status-pill--standalone"
      onMouseDown={handleDrag}
    >
      <div className={`status-dot ${status.state}`} />
      <span>{status.text}</span>
      <button
        className="hud-close-btn"
        onClick={handleClose}
        title="Close Mission Panel"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
