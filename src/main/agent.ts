import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { createMissionTools } from "./tools/mcp-server";

const SYSTEM_PROMPT = `You are JARVIS, an AI assistant that controls the user's computer screen through a transparent HUD overlay.

Rules:
- Always call screenshot first to see the current screen state before acting
- Call draw_annotation to show the user what you're about to do (draw a circle on the target element)
- Then perform the action (click, type, etc.)
- Call screenshot again to verify the action succeeded
- Call speak to give brief status updates ("Clicking Settings", "Done")
- For terminal tasks, use run_command and report results via speak
- If unsure about a destructive action, call speak to warn the user before proceeding
- Be concise. Speak in short phrases, not paragraphs.
- When identifying UI elements from screenshots, be precise about coordinates.
- Clear annotations after completing each step to keep the overlay clean.`;

export class AgentSession {
  private sendToOverlay: (channel: string, data: any) => void;
  private currentQuery: ReturnType<typeof query> | null = null;

  constructor(sendToOverlay: (channel: string, data: any) => void) {
    this.sendToOverlay = sendToOverlay;
  }

  async execute(prompt: string): Promise<void> {
    this.sendToOverlay("status", { state: "thinking", text: "Thinking..." });

    const mcpServer = createMissionTools(this.sendToOverlay);

    try {
      this.currentQuery = query({
        prompt,
        options: {
          systemPrompt: SYSTEM_PROMPT,
          mcpServers: { "mission-tools": mcpServer },
          permissionMode: "bypassPermissions",
          allowDangerouslySkipPermissions: true,
          maxTurns: 50,
          tools: [],
          persistSession: false,
        },
      });

      for await (const message of this.currentQuery) {
        this.handleMessage(message);
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error("Agent error:", errMsg);
      this.sendToOverlay("status", { state: "error", text: `Error: ${errMsg.slice(0, 50)}` });
    } finally {
      this.currentQuery = null;
      this.sendToOverlay("status", { state: "idle", text: "Ready" });
    }
  }

  private handleMessage(message: SDKMessage): void {
    switch (message.type) {
      case "assistant":
        // Update status to show the agent is working
        this.sendToOverlay("status", { state: "executing", text: "Executing..." });
        break;

      case "result":
        if (message.subtype === "success") {
          this.sendToOverlay("status", { state: "idle", text: "Done" });
        } else {
          this.sendToOverlay("status", {
            state: "error",
            text: `Error: ${message.subtype}`,
          });
        }
        break;
    }
  }

  abort(): void {
    this.currentQuery?.close();
    this.currentQuery = null;
    this.sendToOverlay("status", { state: "idle", text: "Cancelled" });
  }
}
