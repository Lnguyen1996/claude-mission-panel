#!/usr/bin/env node
// Mission Panel CLI helper — fast MCP calls
// Usage:
//   node mp.mjs ss                    → screenshot saved to D:/tmp/screen.png
//   node mp.mjs at <x> <y>            → click at raw coordinates
//   node mp.mjs pct <x%> <y%>         → click at percentage of screen (e.g., 92 5 = 92% across, 5% down)
//   node mp.mjs grid [density]        → show grid (default: ultra)
//   node mp.mjs ungrid                → hide grid
//   node mp.mjs click <cell>          → click_grid cell (96x54)
//   node mp.mjs type <text>           → keyboard_type
//   node mp.mjs key <key>             → keyboard_press (Return, Tab, Escape, etc.)
//   node mp.mjs shortcut <k1> <k2>    → keyboard_shortcut
//   node mp.mjs scroll <delta>        → mouse_scroll at center (negative = down)
//   node mp.mjs cmd <powershell>      → run_command
//   node mp.mjs raw <tool> [json]     → raw MCP call

import fs from 'fs';

const MCP = 'http://localhost:13456/mcp';
const SS_PATH = 'D:/tmp/screen.png';
// Screen dimensions in Mission Panel raw coordinate space
const SCREEN_W = 1280;
const SCREEN_H = 800;
let reqId = 1;

async function mcp(tool, args = {}) {
  const body = JSON.stringify({
    jsonrpc: '2.0', id: reqId++,
    method: 'tools/call',
    params: { name: tool, arguments: args }
  });
  const res = await fetch(MCP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body
  });
  const data = await res.json();
  return data.result?.content || [];
}

async function screenshot() {
  const content = await mcp('take_screenshot');
  for (const c of content) {
    if (c.type === 'image') {
      fs.mkdirSync('D:/tmp', { recursive: true });
      fs.writeFileSync(SS_PATH, Buffer.from(c.data, 'base64'));
      console.log(SS_PATH);
      return;
    }
  }
  console.log('no image returned');
}

const [,, cmd, ...rest] = process.argv;

switch (cmd) {
  case 'ss':
    await screenshot();
    break;
  case 'at': {
    const x = parseInt(rest[0]);
    const y = parseInt(rest[1]);
    const result = await mcp('mouse_click', { x, y });
    console.log(result.map(c => c.text).join(''));
    break;
  }
  case 'pct': {
    const xPct = parseFloat(rest[0]) / 100;
    const yPct = parseFloat(rest[1]) / 100;
    const x = Math.round(xPct * SCREEN_W);
    const y = Math.round(yPct * SCREEN_H);
    const result = await mcp('mouse_click', { x, y });
    console.log(result.map(c => c.text).join(''));
    break;
  }
  case 'grid':
    await mcp('show_grid', { density: rest[0] || 'ultra' });
    console.log('grid shown');
    break;
  case 'ungrid':
    await mcp('hide_grid');
    console.log('grid hidden');
    break;
  case 'click': {
    const cell = parseInt(rest[0]);
    const result = await mcp('click_grid', { cell, rows: 54, cols: 96 });
    console.log(result.map(c => c.text).join(''));
    break;
  }
  case 'type':
    await mcp('keyboard_type', { text: rest.join(' ') });
    console.log('typed');
    break;
  case 'key':
    await mcp('keyboard_press', { key: rest[0] });
    console.log('pressed ' + rest[0]);
    break;
  case 'shortcut':
    await mcp('keyboard_shortcut', { keys: rest });
    console.log('shortcut ' + rest.join('+'));
    break;
  case 'scroll':
    await mcp('mouse_scroll', { x: 640, y: 400, delta: parseInt(rest[0] || '-500') });
    console.log('scrolled');
    break;
  case 'cmd': {
    const r = await mcp('run_command', { command: rest.join(' ') });
    console.log(r.map(c => c.text).join(''));
    break;
  }
  case 'raw': {
    const tool = rest[0];
    const args = rest[1] ? JSON.parse(rest[1]) : {};
    const out = await mcp(tool, args);
    console.log(JSON.stringify(out, null, 2));
    break;
  }
  default:
    console.log('Usage: node mp.mjs <ss|at|pct|grid|ungrid|click|type|key|shortcut|scroll|cmd|raw> [args]');
}
