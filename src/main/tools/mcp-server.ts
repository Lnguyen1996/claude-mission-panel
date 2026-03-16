import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod/v4";
import { captureScreen } from "./screenshot";
import { click, move, scroll, drag } from "./mouse";
import { typeText, shortcut } from "./keyboard";
import { runCommand } from "./command";
import { speak } from "../voice/tts";

export function createMissionTools(
  sendToOverlay: (channel: string, data: any) => void
) {
  const screenshotTool = tool(
    "screenshot",
    "Capture the entire screen and return as a base64 PNG image. Always call this first to see what's on screen before taking any action.",
    {},
    async () => {
      const base64 = await captureScreen();
      return {
        content: [{ type: "image" as const, data: base64, mimeType: "image/png" as const }],
      };
    }
  );

  const mouseClickTool = tool(
    "mouse_click",
    "Click at specific screen coordinates. Use 'left' for normal click, 'right' for context menu, 'double' for double-click.",
    {
      x: z.number().describe("X coordinate on screen"),
      y: z.number().describe("Y coordinate on screen"),
      button: z.enum(["left", "right", "double"]).optional().describe("Click type"),
    },
    async ({ x, y, button }) => {
      await click(x, y, button ?? "left");
      return { content: [{ type: "text" as const, text: `Clicked ${button ?? "left"} at (${x}, ${y})` }] };
    }
  );

  const mouseMoveTool = tool(
    "mouse_move",
    "Move the mouse cursor to specific screen coordinates without clicking.",
    {
      x: z.number().describe("X coordinate"),
      y: z.number().describe("Y coordinate"),
    },
    async ({ x, y }) => {
      await move(x, y);
      return { content: [{ type: "text" as const, text: `Moved mouse to (${x}, ${y})` }] };
    }
  );

  const mouseScrollTool = tool(
    "mouse_scroll",
    "Scroll the mouse wheel up or down.",
    {
      direction: z.enum(["up", "down"]).describe("Scroll direction"),
      amount: z.number().optional().describe("Number of scroll units (default 3)"),
    },
    async ({ direction, amount }) => {
      await scroll(direction, amount ?? 3);
      return { content: [{ type: "text" as const, text: `Scrolled ${direction} ${amount ?? 3} units` }] };
    }
  );

  const mouseDragTool = tool(
    "mouse_drag",
    "Click and drag from one point to another.",
    {
      x1: z.number().describe("Start X"),
      y1: z.number().describe("Start Y"),
      x2: z.number().describe("End X"),
      y2: z.number().describe("End Y"),
    },
    async ({ x1, y1, x2, y2 }) => {
      await drag(x1, y1, x2, y2);
      return { content: [{ type: "text" as const, text: `Dragged from (${x1}, ${y1}) to (${x2}, ${y2})` }] };
    }
  );

  const keyboardTypeTool = tool(
    "keyboard_type",
    "Type text using the keyboard. Types each character sequentially.",
    {
      text: z.string().describe("Text to type"),
    },
    async ({ text }) => {
      await typeText(text);
      return { content: [{ type: "text" as const, text: `Typed: "${text}"` }] };
    }
  );

  const keyboardShortcutTool = tool(
    "keyboard_shortcut",
    "Press a keyboard shortcut combination. Keys are pressed in order and released in reverse. Examples: ['cmd', 'c'] for copy, ['cmd', 'shift', 'space'] for Spotlight.",
    {
      keys: z.array(z.string()).describe("Array of key names to press together"),
    },
    async ({ keys }) => {
      await shortcut(keys);
      return { content: [{ type: "text" as const, text: `Pressed shortcut: ${keys.join("+")}` }] };
    }
  );

  const runCommandTool = tool(
    "run_command",
    "Execute a shell command and return stdout/stderr/exit code. Uses zsh on macOS, PowerShell on Windows. Has a 30 second timeout by default.",
    {
      command: z.string().describe("Shell command to execute"),
      timeout: z.number().optional().describe("Timeout in milliseconds (default 30000)"),
    },
    async ({ command, timeout }) => {
      sendToOverlay("status", { state: "executing", text: `Running: ${command.slice(0, 40)}...` });
      const result = await runCommand(command, timeout ?? 30000);
      const output = [
        result.stdout ? `stdout:\n${result.stdout}` : "",
        result.stderr ? `stderr:\n${result.stderr}` : "",
        `exit code: ${result.exitCode}`,
      ].filter(Boolean).join("\n");
      return { content: [{ type: "text" as const, text: output }] };
    }
  );

  const drawAnnotationTool = tool(
    "draw_annotation",
    "Draw a visual annotation on the screen overlay to show the user what you're about to interact with. Types: circle (pulsing target indicator), arrow (pointing from one point to another), highlight (rectangular highlight region), label (text label at a point).",
    {
      type: z.enum(["circle", "arrow", "highlight", "label"]).describe("Annotation type"),
      x: z.number().describe("X coordinate"),
      y: z.number().describe("Y coordinate"),
      x2: z.number().optional().describe("End X (for arrows/highlights)"),
      y2: z.number().optional().describe("End Y (for arrows/highlights)"),
      color: z.string().optional().describe("Color (CSS color string, default red)"),
      text: z.string().optional().describe("Text content (for labels)"),
      pulse: z.boolean().optional().describe("Enable pulse animation (default true for circles)"),
      fadeMs: z.number().optional().describe("Auto-fade duration in ms (default 5000)"),
    },
    async (args) => {
      sendToOverlay("annotation", {
        action: "add",
        ...args,
        id: crypto.randomUUID(),
      });
      return { content: [{ type: "text" as const, text: `Drew ${args.type} at (${args.x}, ${args.y})` }] };
    }
  );

  const clearAnnotationsTool = tool(
    "clear_annotations",
    "Remove all annotations from the screen overlay.",
    {},
    async () => {
      sendToOverlay("annotation", { action: "clear" });
      return { content: [{ type: "text" as const, text: "Annotations cleared" }] };
    }
  );

  const speakTool = tool(
    "speak",
    "Speak text aloud using text-to-speech. Use for brief status updates and responses. Keep messages short and concise.",
    {
      text: z.string().describe("Text to speak aloud"),
    },
    async ({ text }) => {
      sendToOverlay("speak", { text });
      await speak(text);
      return { content: [{ type: "text" as const, text: `Spoke: "${text}"` }] };
    }
  );

  const waitTool = tool(
    "wait",
    "Wait for a specified number of milliseconds. Useful for waiting for animations, page loads, etc.",
    {
      ms: z.number().describe("Milliseconds to wait"),
    },
    async ({ ms }) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      return { content: [{ type: "text" as const, text: `Waited ${ms}ms` }] };
    }
  );

  return createSdkMcpServer({
    name: "mission-panel-tools",
    tools: [
      screenshotTool,
      mouseClickTool,
      mouseMoveTool,
      mouseScrollTool,
      mouseDragTool,
      keyboardTypeTool,
      keyboardShortcutTool,
      runCommandTool,
      drawAnnotationTool,
      clearAnnotationsTool,
      speakTool,
      waitTool,
    ],
  });
}
