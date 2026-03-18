import { useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

interface PromptBarProps {
  visible: boolean;
  onSubmit: (text: string) => void;
  onClose: () => void;
}

export function PromptBar({ visible, onSubmit, onClose }: PromptBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (visible && inputRef.current) inputRef.current.focus();
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

  const handleMouseEnter = () => invoke("set_click_through", { enabled: false });
  const handleMouseLeave = () => { if (!visible) invoke("set_click_through", { enabled: true }); };

  return (
    <div
      className={`hud-prompt-bar ${visible ? "" : "hidden"}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className="hud-prompt-icon" />
      <input ref={inputRef} type="text" placeholder="Ask Claude anything..." onKeyDown={handleKeyDown} />
    </div>
  );
}
