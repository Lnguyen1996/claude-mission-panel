import { useState, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";

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

  return (
    <div className="hud-status-pill">
      <div className={`status-dot ${status.state}`} />
      <span>{status.text}</span>
    </div>
  );
}
