import React from "react";
import { createRoot } from "react-dom/client";

function App() {
  return <div style={{ width: "100vw", height: "100vh" }} />;
}

createRoot(document.getElementById("root")!).render(<App />);
