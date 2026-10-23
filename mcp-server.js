#!/usr/bin/env node
// MySMEBox — Model Context Protocol (MCP) Stdio Bridge Server
// เชื่อมต่อ AI ตัวอื่น (Claude Desktop, Cursor, ChatGPT, Gemini, Antigravity) เข้ากับระบบแม่ค้าออนไลน์ MySMEBox
// วิธีตั้งค่าใน claude_desktop_config.json หรือ .mcp.json:
// {
//   "mcpServers": {
//     "mysmebox": {
//       "command": "node",
//       "args": ["d:/mysmebox/mcp-server.js"],
//       "env": {
//         "MYSMEBOX_API_URL": "https://www.mysmebox.com/api/mcp",
//         "MYSMEBOX_USER_EMAIL": "owner.mysmebox@gmail.com"
//       }
//     }
//   }
// }

const readline = require("readline");

const API_URL = process.env.MYSMEBOX_API_URL || "https://www.mysmebox.com/api/mcp";
const USER_EMAIL = process.env.MYSMEBOX_USER_EMAIL || "owner.mysmebox@gmail.com";

const rl = readline.createInterface({
  input: process.stdin,
  terminal: false
});

rl.on("line", async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let reqObj;
  try {
    reqObj = JSON.parse(trimmed);
  } catch {
    return;
  }

  try {
    const resp = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-email": USER_EMAIL
      },
      body: JSON.stringify(reqObj)
    });
    const result = await resp.json();
    if (reqObj.id !== undefined) {
      process.stdout.write(JSON.stringify(result) + "\n");
    }
  } catch (err) {
    if (reqObj.id !== undefined) {
      process.stdout.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: reqObj.id,
          error: { code: -32000, message: err.message }
        }) + "\n"
      );
    }
  }
});
