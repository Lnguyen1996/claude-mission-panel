import { useState, useCallback, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { PromptBar } from "./PromptBar";
import { StatusPill } from "./StatusPill";
import { AnnotationLayer } from "../canvas/AnnotationLayer";
import "../styles/hud.css";

export function HUD() {
  const [promptVisible, setPromptVisible] = useState(false);

  const togglePrompt = useCallback(() => {
    setPromptVisible((prev) => {
      const next = !prev;
      invoke("set_click_through", { enabled: !next });
      return next;
    });
  }, []);

  const hidePrompt = useCallback(() => {
    setPromptVisible(false);
    invoke("set_click_through", { enabled: true });
  }, []);

  useEffect(() => {
    const unlisten = listen("toggle-prompt", () => togglePrompt());
    return () => { unlisten.then((fn) => fn()); };
  }, [togglePrompt]);

  const handleSubmit = (text: string) => {
    invoke("handle_prompt", { text });
  };

  return (
    <>
      <AnnotationLayer />
      <StatusPill />
      <PromptBar visible={promptVisible} onSubmit={handleSubmit} onClose={hidePrompt} />
    </>
  );
}
