import React, { useRef, useEffect } from "react";

declare global {
  interface Window {
    api: {
      onAnnotation: (cb: (data: any) => void) => void;
      onStatus: (cb: (data: any) => void) => void;
      onSpeak: (cb: (data: any) => void) => void;
      onTogglePrompt: (cb: () => void) => void;
      sendPrompt: (text: string) => void;
      setClickThrough: (enabled: boolean) => void;
    };
  }
}

interface PromptBarProps {
  visible: boolean;
  onSubmit: (text: string) => void;
  onClose: () => void;
}

export function PromptBar({ visible, onSubmit, onClose }: PromptBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (visible && inputRef.current) {
      inputRef.current.focus();
    }
  }, [visible]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && inputRef.current?.value.trim()) {
      const text = inputRef.current.value.trim();
      inputRef.current.value = "";
      onSubmit(text);
      onClose();
    } else if (e.key === "Escape") {
      if (inputRef.current) inputRef.current.value = "";
      onClose();
    }
  };

  const handleMouseEnter = () => {
    window.api.setClickThrough(false);
  };

  const handleMouseLeave = () => {
    if (!visible) {
      window.api.setClickThrough(true);
    }
  };

  return (
    <div
      className={`hud-prompt-bar ${visible ? "" : "hidden"}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className="hud-prompt-icon" />
      <input
        ref={inputRef}
        type="text"
        placeholder="Ask Claude anything..."
        onKeyDown={handleKeyDown}
      />
    </div>
  );
}
