import { useState, useEffect, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

interface StatusData {
  state: "idle" | "thinking" | "executing" | "error";
  text: string;
}

export function StatusPill() {
  const [status, setStatus] = useState<StatusData>({ state: "idle", text: "Ready" });
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    const unlisten = listen<StatusData>("status", (event) => {
      setStatus(event.payload);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  const handleClose = useCallback(() => {
    invoke("quit_app");
  }, []);

  // Disable click-through when hovering over the pill so the X button is clickable
  const handleMouseEnter = useCallback(() => {
    setHovered(true);
    invoke("set_click_through", { enabled: false });
  }, []);

  const handleMouseLeave = useCallback(() => {
    setHovered(false);
    invoke("set_click_through", { enabled: true });
  }, []);

  return (
    <div
      className={`hud-status-pill ${hovered ? "hud-status-pill--hovered" : ""}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
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
