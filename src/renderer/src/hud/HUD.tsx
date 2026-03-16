import React, { useState, useEffect, useCallback } from "react";
import { PromptBar } from "./PromptBar";
import { StatusPill } from "./StatusPill";
import "../styles/hud.css";

export function HUD() {
  const [promptVisible, setPromptVisible] = useState(false);

  const togglePrompt = useCallback(() => {
    setPromptVisible((prev) => {
      const next = !prev;
      window.api.setClickThrough(!next);
      return next;
    });
  }, []);

  const hidePrompt = useCallback(() => {
    setPromptVisible(false);
    window.api.setClickThrough(true);
  }, []);

  useEffect(() => {
    window.api.onTogglePrompt(() => {
      togglePrompt();
    });
  }, [togglePrompt]);

  const handleSubmit = (text: string) => {
    window.api.sendPrompt(text);
  };

  return (
    <>
      <StatusPill />
      <PromptBar
        visible={promptVisible}
        onSubmit={handleSubmit}
        onClose={hidePrompt}
      />
    </>
  );
}
