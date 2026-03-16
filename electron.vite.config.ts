import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin({
        // Don't externalize these — they are ESM-only and must be bundled
        exclude: [
          "@anthropic-ai/claude-agent-sdk",
          "zod",
        ],
      }),
    ],
    build: {
      rollupOptions: {
        output: {
          format: "cjs",
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    plugins: [react()],
  },
});
