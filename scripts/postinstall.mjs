#!/usr/bin/env node
import { execFileSync } from "node:child_process"
import process from "node:process"

execFileSync(process.execPath, ["scripts/patch-acp-ai-provider.mjs"], {
  stdio: "inherit",
})

if (!process.env.VERCEL) {
  execFileSync(
    "electron-rebuild",
    ["-f", "-w", "better-sqlite3,node-pty"],
    { stdio: "inherit" },
  )
}
