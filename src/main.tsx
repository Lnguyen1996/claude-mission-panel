import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { HUD } from "./hud/HUD";
import { StatusPill } from "./hud/StatusPill";

function App() {
  const [windowLabel, setWindowLabel] = useState<string | null>(null);

  useEffect(() => {
    setWindowLabel(getCurrentWebviewWindow().label);
  }, []);

  if (!windowLabel) return null;

  if (windowLabel === "pill") {
    return <StatusPill />;
  }

  return <HUD />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
