#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.join(__dirname, "..")

const replacements = [
  {
    file: "node_modules/@mcpc-tech/acp-ai-provider/index.mjs",
    from: `function formatToolError(toolResult) {
  if (!toolResult || toolResult.length === 0) return "Unknown tool error";
  const parts = [];
  for (const blk of toolResult) {`,
    to: `function formatToolError(toolResult) {
  if (!toolResult) return "Unknown tool error";
  const blocks = Array.isArray(toolResult) ? toolResult : [toolResult];
  if (blocks.length === 0) return "Unknown tool error";
  const parts = [];
  for (const blk of blocks) {`,
  },
  {
    file: "node_modules/@mcpc-tech/acp-ai-provider/index.cjs",
    from: `function formatToolError(toolResult) {
  if (!toolResult || toolResult.length === 0) return "Unknown tool error";
  const parts = [];
  for (const blk of toolResult) {`,
    to: `function formatToolError(toolResult) {
  if (!toolResult) return "Unknown tool error";
  const blocks = Array.isArray(toolResult) ? toolResult : [toolResult];
  if (blocks.length === 0) return "Unknown tool error";
  const parts = [];
  for (const blk of blocks) {`,
  },
]

let patchedAny = false

for (const replacement of replacements) {
  const filePath = path.join(rootDir, replacement.file)
  if (!fs.existsSync(filePath)) {
    continue
  }

  const source = fs.readFileSync(filePath, "utf8")
  if (source.includes(replacement.to)) {
    continue
  }

  if (!source.includes(replacement.from)) {
    throw new Error(`Patch target changed: ${replacement.file}`)
  }

  fs.writeFileSync(
    filePath,
    source.replace(replacement.from, replacement.to),
  )
  patchedAny = true
}

if (patchedAny) {
  console.log("Patched @mcpc-tech/acp-ai-provider tool error formatting")
}
