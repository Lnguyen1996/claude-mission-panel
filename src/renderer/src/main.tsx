import React from "react";
import { createRoot } from "react-dom/client";
import { HUD } from "./hud/HUD";

function App() {
  return (
    <div style={{ width: "100vw", height: "100vh" }}>
      <HUD />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
