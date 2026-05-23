#!/usr/bin/env node
import { randomUUID } from "node:crypto"
import { mkdir, rename, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"

const REQUEST_PATH =
  process.env.BACKLOT_HARNESS_REQUEST_PATH ||
  join(homedir(), ".backlot", "harness-open-request.json")

function cleanString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

async function openHarnessEditor(args = {}) {
  const request = {
    id: randomUUID(),
    createdAt: Date.now(),
    reason: cleanString(args.reason),
    summary: cleanString(args.summary),
    proposedContent: cleanString(args.proposedContent),
  }

  await mkdir(dirname(REQUEST_PATH), { recursive: true })
  const tempPath = `${REQUEST_PATH}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tempPath, JSON.stringify(request, null, 2), "utf-8")
  await rename(tempPath, REQUEST_PATH)

  return {
    opened: true,
    requestId: request.id,
    message:
      "Backlot opened the Harness editor. The user must review and save any proposed change; it applies on the next agent turn.",
  }
}

const tools = [
  {
    name: "harness_open_editor",
    description:
      "Open Backlot's Harness editor in the app so the user can review harness/system-prompt changes. Use this when the user asks to update, inspect, or revise the harness. Do not edit ~/.backlot/harness-prompt.md directly.",
    inputSchema: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "Short reason for opening the harness editor.",
        },
        summary: {
          type: "string",
          description:
            "One-sentence summary of the proposed harness change.",
        },
        proposedContent: {
          type: "string",
          description:
            "Optional full harness draft to load into the editor for user review. Use only when you have prepared the complete replacement text.",
        },
      },
    },
  },
]

const server = new Server(
  { name: "backlot-harness", version: "0.0.1" },
  { capabilities: { tools: {} } },
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const args = request.params.arguments || {}
  try {
    let result
    switch (request.params.name) {
      case "harness_open_editor":
        result = await openHarnessEditor(args)
        break
      default:
        throw new Error(`Unknown tool: ${request.params.name}`)
    }
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    }
  } catch (error) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: error instanceof Error ? error.message : String(error),
        },
      ],
    }
  }
})

const transport = new StdioServerTransport()
await server.connect(transport)
