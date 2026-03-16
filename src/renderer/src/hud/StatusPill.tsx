import React, { useState, useEffect } from "react";

interface StatusData {
  state: "idle" | "thinking" | "executing" | "error";
  text: string;
}

export function StatusPill() {
  const [status, setStatus] = useState<StatusData>({ state: "idle", text: "Ready" });

  useEffect(() => {
    window.api.onStatus((data: StatusData) => {
      setStatus(data);
    });
  }, []);

  return (
    <div className="hud-status-pill">
      <div className={`status-dot ${status.state}`} />
      <span>{status.text}</span>
    </div>
  );
}
