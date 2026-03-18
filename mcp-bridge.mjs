#!/usr/bin/env node
// Stdio-to-HTTP MCP bridge for Claude Mission Panel
// Claude Code spawns this as a stdio MCP server.
// It forwards all JSON-RPC requests to the Mission Panel HTTP endpoint.

import { createInterface } from 'readline';

const MCP_URL = 'http://localhost:13456/mcp';

const rl = createInterface({ input: process.stdin, terminal: false });

rl.on('line', async (line) => {
  try {
    const request = JSON.parse(line);

    // Forward to HTTP MCP server
    const response = await fetch(MCP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });

    const result = await response.json();
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch (err) {
    // If the MCP server isn't running, return an error
    const request = JSON.parse(line).id ?? null;
    const errorResponse = {
      jsonrpc: '2.0',
      id: request,
      error: {
        code: -32603,
        message: `Mission Panel bridge error: ${err.message}. Is the Tauri app running?`,
      },
    };
    process.stdout.write(JSON.stringify(errorResponse) + '\n');
  }
});

process.stderr.write('[MCP Bridge] Connected to Mission Panel at ' + MCP_URL + '\n');
