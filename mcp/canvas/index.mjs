#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises"
import { basename, extname, isAbsolute, join, normalize, relative } from "node:path"
import Database from "better-sqlite3"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"

const DEFAULT_IMAGE_MODEL = process.env.BACKLOT_CANVAS_IMAGE_MODEL || "gpt-image-2"
const DEFAULT_WORKTREE_ID = process.env.BACKLOT_CANVAS_WORKTREE_ID || process.env.BACKLOT_CANVAS_CHAT_ID || ""
const DB_PATH = process.env.BACKLOT_DB_PATH || ""
const DEFAULT_WORKTREE_PATH = process.env.BACKLOT_WORKTREE_PATH || ""

if (!DB_PATH) {
  console.error("[backlot-canvas-mcp] BACKLOT_DB_PATH is required")
  process.exit(1)
}

const db = new Database(DB_PATH)
db.pragma("foreign_keys = ON")

function id(prefix) {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 18)}`
}

function nowMs() {
  return Date.now()
}

function activeWorktreeId(input = {}) {
  const worktreeId = input.worktreeId || input.chatId || DEFAULT_WORKTREE_ID
  if (!worktreeId) throw new Error("worktreeId is required.")
  return worktreeId
}

function parseData(value) {
  try {
    const parsed = JSON.parse(value || "{}")
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function stringify(value) {
  return JSON.stringify(value || {})
}

function worktreeForId(worktreeId) {
  const row = db.prepare("SELECT worktree_path FROM worktrees WHERE id = ?").get(worktreeId)
  const worktreePath = row?.worktree_path || DEFAULT_WORKTREE_PATH
  if (!worktreePath) throw new Error("Active worktree has no filesystem path.")
  return worktreePath
}

function safeRelativePath(path) {
  const normalized = normalize(path).replace(/\\/g, "/")
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.startsWith("/") ||
    normalized.includes("\0")
  ) {
    throw new Error(`Unsafe project-relative path: ${path}`)
  }
  return normalized
}

function resolveInsideRoot(root, path) {
  const safe = safeRelativePath(path)
  const full = join(root, safe)
  const rel = relative(root, full)
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`Path escapes project root: ${path}`)
  }
  return full
}

function mimeTypeFromPath(filePath) {
  switch (extname(filePath).toLowerCase()) {
    case ".png":
      return "image/png"
    case ".jpg":
    case ".jpeg":
      return "image/jpeg"
    case ".webp":
      return "image/webp"
    case ".gif":
      return "image/gif"
    default:
      return "application/octet-stream"
  }
}

function ensureCanvas(worktreeId) {
  const existing = db
    .prepare("SELECT * FROM canvas_documents WHERE worktree_id = ? AND name = 'main'")
    .get(worktreeId)
  if (existing) return existing
  const canvasId = id("canvas")
  const ts = nowMs()
  db.prepare(
    "INSERT INTO canvas_documents (id, worktree_id, name, created_at, updated_at) VALUES (?, ?, 'main', ?, ?)",
  ).run(canvasId, worktreeId, ts, ts)
  return db.prepare("SELECT * FROM canvas_documents WHERE id = ?").get(canvasId)
}

function readCanvas(args = {}) {
  const worktreeId = activeWorktreeId(args)
  const canvas = ensureCanvas(worktreeId)
  const nodes = db.prepare("SELECT * FROM canvas_nodes WHERE canvas_id = ?").all(canvas.id)
    .map((node) => ({ ...node, data: parseData(node.data) }))
  const edges = db.prepare("SELECT * FROM canvas_edges WHERE canvas_id = ?").all(canvas.id)
  const assets = db.prepare("SELECT * FROM canvas_assets WHERE worktree_id = ?").all(worktreeId)
  return { canvas, nodes, edges, assets }
}

function addNode(args) {
  const worktreeId = activeWorktreeId(args)
  const canvas = ensureCanvas(worktreeId)
  const nodeId = id("node")
  const type = args.type
  if (!["prompt", "image", "imageGeneration"].includes(type)) {
    throw new Error("type must be prompt, image, or imageGeneration.")
  }
  const width = args.width ?? (type === "prompt" ? 520 : 420)
  const height = args.height ?? (type === "prompt" ? 320 : 300)
  const ts = nowMs()
  db.prepare(
    "INSERT INTO canvas_nodes (id, canvas_id, type, x, y, width, height, data, locked, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    nodeId,
    canvas.id,
    type,
    args.x ?? 0,
    args.y ?? 0,
    width,
    height,
    stringify(args.data),
    args.locked ? 1 : 0,
    ts,
    ts,
  )
  db.prepare("UPDATE canvas_documents SET updated_at = ? WHERE id = ?").run(ts, canvas.id)
  return db.prepare("SELECT * FROM canvas_nodes WHERE id = ?").get(nodeId)
}

function updateNode(args) {
  const worktreeId = activeWorktreeId(args)
  const canvas = ensureCanvas(worktreeId)
  const node = db
    .prepare("SELECT * FROM canvas_nodes WHERE id = ? AND canvas_id = ?")
    .get(args.nodeId, canvas.id)
  if (!node) throw new Error(`Canvas node not found: ${args.nodeId}`)
  const currentData = parseData(node.data)
  const nextData = args.data
    ? args.replaceData
      ? args.data
      : { ...currentData, ...args.data }
    : currentData
  const next = {
    x: args.x ?? node.x,
    y: args.y ?? node.y,
    width: args.width ?? node.width,
    height: args.height ?? node.height,
    data: stringify(nextData),
    locked: args.locked === undefined ? node.locked : args.locked ? 1 : 0,
    updatedAt: nowMs(),
  }
  db.prepare(
    "UPDATE canvas_nodes SET x = ?, y = ?, width = ?, height = ?, data = ?, locked = ?, updated_at = ? WHERE id = ? AND canvas_id = ?",
  ).run(next.x, next.y, next.width, next.height, next.data, next.locked, next.updatedAt, args.nodeId, canvas.id)
  db.prepare("UPDATE canvas_documents SET updated_at = ? WHERE id = ?").run(next.updatedAt, canvas.id)
  return db.prepare("SELECT * FROM canvas_nodes WHERE id = ?").get(args.nodeId)
}

function deleteNode(args) {
  const worktreeId = activeWorktreeId(args)
  const canvas = ensureCanvas(worktreeId)
  const result = db
    .prepare("DELETE FROM canvas_nodes WHERE id = ? AND canvas_id = ?")
    .run(args.nodeId, canvas.id)
  db.prepare("UPDATE canvas_documents SET updated_at = ? WHERE id = ?").run(nowMs(), canvas.id)
  return { deleted: result.changes > 0 }
}

function validateConnection(sourceType, sourceHandle, targetType, targetHandle) {
  const valid =
    (sourceType === "prompt" &&
      sourceHandle === "text" &&
      targetType === "imageGeneration" &&
      targetHandle === "prompt") ||
    (sourceType === "image" &&
      sourceHandle === "image" &&
      targetType === "imageGeneration" &&
      targetHandle === "referenceImage")
  if (!valid) {
    throw new Error(
      `Unsupported canvas connection: ${sourceType}.${sourceHandle} -> ${targetType}.${targetHandle}`,
    )
  }
}

function connect(args) {
  const worktreeId = activeWorktreeId(args)
  const canvas = ensureCanvas(worktreeId)
  const source = db
    .prepare("SELECT * FROM canvas_nodes WHERE id = ? AND canvas_id = ?")
    .get(args.sourceNodeId, canvas.id)
  const target = db
    .prepare("SELECT * FROM canvas_nodes WHERE id = ? AND canvas_id = ?")
    .get(args.targetNodeId, canvas.id)
  if (!source || !target) throw new Error("Both edge endpoints must exist.")
  validateConnection(source.type, args.sourceHandle, target.type, args.targetHandle)

  const existing = db.prepare(
    "SELECT * FROM canvas_edges WHERE canvas_id = ? AND source_node_id = ? AND source_handle = ? AND target_node_id = ? AND target_handle = ?",
  ).get(canvas.id, args.sourceNodeId, args.sourceHandle, args.targetNodeId, args.targetHandle)
  if (existing) return existing

  const edgeId = id("edge")
  const ts = nowMs()
  db.prepare(
    "INSERT INTO canvas_edges (id, canvas_id, source_node_id, source_handle, target_node_id, target_handle, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(edgeId, canvas.id, args.sourceNodeId, args.sourceHandle, args.targetNodeId, args.targetHandle, ts)
  db.prepare("UPDATE canvas_documents SET updated_at = ? WHERE id = ?").run(ts, canvas.id)
  return db.prepare("SELECT * FROM canvas_edges WHERE id = ?").get(edgeId)
}

function disconnect(args) {
  const worktreeId = activeWorktreeId(args)
  const canvas = ensureCanvas(worktreeId)
  const result = db
    .prepare("DELETE FROM canvas_edges WHERE id = ? AND canvas_id = ?")
    .run(args.edgeId, canvas.id)
  return { deleted: result.changes > 0 }
}

async function importImage(args) {
  const worktreeId = activeWorktreeId(args)
  const root = worktreeForId(worktreeId)
  const source = isAbsolute(args.sourcePath)
    ? args.sourcePath
    : resolveInsideRoot(root, args.sourcePath)
  if (!existsSync(source)) throw new Error(`Image file not found: ${args.sourcePath}`)
  const mimeType = mimeTypeFromPath(source)
  if (!mimeType.startsWith("image/")) throw new Error("sourcePath must point to an image file.")

  const bytes = await readFile(source)
  const sha256 = createHash("sha256").update(bytes).digest("hex")
  const ext = extname(source).toLowerCase() || ".png"
  const stem = basename(source, ext).replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 80) || "image"
  const relPath = safeRelativePath(join("assets", "canvas", "imported", `${sha256.slice(0, 12)}--${stem}${ext}`))
  const dest = resolveInsideRoot(root, relPath)
  await mkdir(join(root, "assets", "canvas", "imported"), { recursive: true })
  if (!existsSync(dest)) await copyFile(source, dest)
  const fileStat = await stat(dest)

  const assetId = id("asset")
  db.prepare(
    "INSERT INTO canvas_assets (id, worktree_id, kind, project_relative_path, source_path, mime_type, byte_size, sha256, created_at) VALUES (?, ?, 'imported', ?, ?, ?, ?, ?, ?)",
  ).run(assetId, worktreeId, relPath.replaceAll("\\", "/"), source, mimeType, fileStat.size, sha256, nowMs())
  const asset = db.prepare("SELECT * FROM canvas_assets WHERE id = ?").get(assetId)
  const node = args.createNode === false
    ? null
    : addNode({
        worktreeId,
        type: "image",
        x: args.x,
        y: args.y,
        width: 360,
        height: 260,
        data: {
          assetId: asset.id,
          label: args.label || basename(source),
          projectRelativePath: asset.project_relative_path,
          mimeType: asset.mime_type,
        },
      })
  return { asset, node }
}

function generationInputs(canvasId, nodeId) {
  const edges = db
    .prepare("SELECT * FROM canvas_edges WHERE canvas_id = ? AND target_node_id = ?")
    .all(canvasId, nodeId)
  const nodes = db.prepare("SELECT * FROM canvas_nodes WHERE canvas_id = ?").all(canvasId)
  const promptParts = []
  const inputAssetIds = []
  for (const edge of edges) {
    const source = nodes.find((node) => node.id === edge.source_node_id)
    if (!source) continue
    const data = parseData(source.data)
    if (source.type === "prompt" && edge.target_handle === "prompt" && typeof data.text === "string") {
      promptParts.push(data.text.trim())
    }
    if (source.type === "image" && edge.target_handle === "referenceImage" && typeof data.assetId === "string") {
      inputAssetIds.push(data.assetId)
    }
  }
  return { prompt: promptParts.filter(Boolean).join("\n\n"), inputAssetIds }
}

async function callOpenAIImage({ model, prompt, size, quality }) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set.")
  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      prompt,
      n: 1,
      size: size || "1024x1024",
      ...(quality ? { quality } : {}),
    }),
  })
  const json = await response.json()
  if (!response.ok) {
    throw new Error(json.error?.message || `OpenAI image generation failed: ${response.status}`)
  }
  const first = json.data?.[0]
  if (first?.b64_json) return Buffer.from(first.b64_json, "base64")
  if (first?.url) {
    const imageResponse = await fetch(first.url)
    if (!imageResponse.ok) throw new Error(`Failed to download generated image: ${imageResponse.status}`)
    return Buffer.from(await imageResponse.arrayBuffer())
  }
  throw new Error("OpenAI image generation returned no image.")
}

async function generateImage(args) {
  const worktreeId = activeWorktreeId(args)
  const root = worktreeForId(worktreeId)
  const canvas = ensureCanvas(worktreeId)
  const node = db
    .prepare("SELECT * FROM canvas_nodes WHERE id = ? AND canvas_id = ?")
    .get(args.nodeId, canvas.id)
  if (!node || node.type !== "imageGeneration") {
    throw new Error("nodeId must point to an imageGeneration node.")
  }
  const { prompt, inputAssetIds } = generationInputs(canvas.id, args.nodeId)
  const nodeData = parseData(node.data)
  const model = args.model || nodeData.model || DEFAULT_IMAGE_MODEL
  const runId = id("run")
  const ts = nowMs()
  db.prepare(
    "INSERT INTO canvas_generation_runs (id, canvas_id, node_id, model, status, prompt, input_asset_ids, started_at) VALUES (?, ?, ?, ?, 'running', ?, ?, ?)",
  ).run(runId, canvas.id, args.nodeId, model, prompt, JSON.stringify(inputAssetIds), ts)
  updateNode({ worktreeId, nodeId: args.nodeId, data: { status: "running", model, lastRunId: runId, error: null } })

  try {
    if (!prompt.trim()) throw new Error("Connect a prompt node before running image generation.")
    const image = await callOpenAIImage({ model, prompt, size: args.size, quality: args.quality })
    const sha256 = createHash("sha256").update(image).digest("hex")
    const relPath = safeRelativePath(
      join("assets", "canvas", "generated", `${new Date().toISOString().replace(/[:.]/g, "-")}--${args.nodeId}.png`),
    )
    const outputPath = resolveInsideRoot(root, relPath)
    await mkdir(join(root, "assets", "canvas", "generated"), { recursive: true })
    await writeFile(outputPath, image)
    const fileStat = await stat(outputPath)
    const assetId = id("asset")
    db.prepare(
      "INSERT INTO canvas_assets (id, worktree_id, kind, project_relative_path, mime_type, byte_size, sha256, created_at) VALUES (?, ?, 'generated', ?, 'image/png', ?, ?, ?)",
    ).run(assetId, worktreeId, relPath.replaceAll("\\", "/"), fileStat.size, sha256, nowMs())
    db.prepare(
      "UPDATE canvas_generation_runs SET status = 'succeeded', output_asset_id = ?, completed_at = ? WHERE id = ?",
    ).run(assetId, nowMs(), runId)
    const asset = db.prepare("SELECT * FROM canvas_assets WHERE id = ?").get(assetId)
    updateNode({
      worktreeId,
      nodeId: args.nodeId,
      data: {
        status: "succeeded",
        outputAssetId: asset.id,
        outputPath: asset.project_relative_path,
        error: null,
      },
    })
    return { runId, status: "succeeded", outputAsset: asset, error: null }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    db.prepare(
      "UPDATE canvas_generation_runs SET status = 'failed', error = ?, completed_at = ? WHERE id = ?",
    ).run(message, nowMs(), runId)
    updateNode({ worktreeId, nodeId: args.nodeId, data: { status: "failed", error: message } })
    return { runId, status: "failed", outputAsset: null, error: message }
  }
}

const tools = [
  {
    name: "canvas_read",
    description: "Read the active Backlot canvas graph, including nodes, edges, and image assets.",
    inputSchema: {
      type: "object",
      properties: { worktreeId: { type: "string" }, chatId: { type: "string" } },
    },
  },
  {
    name: "canvas_add_prompt",
    description: "Add a text prompt node to the canvas.",
    inputSchema: {
      type: "object",
      properties: {
        worktreeId: { type: "string" },
        chatId: { type: "string" },
        text: { type: "string" },
        x: { type: "number" },
        y: { type: "number" },
        label: { type: "string" },
      },
      required: ["text"],
    },
  },
  {
    name: "canvas_add_image_generation",
    description: "Add an image generation node. Connect a prompt node to its prompt handle before generating.",
    inputSchema: {
      type: "object",
      properties: {
        worktreeId: { type: "string" },
        chatId: { type: "string" },
        x: { type: "number" },
        y: { type: "number" },
        model: { type: "string" },
      },
    },
  },
  {
    name: "canvas_add_image_from_path",
    description: "Import an image file into assets/canvas/imported and add an image node for it.",
    inputSchema: {
      type: "object",
      properties: {
        worktreeId: { type: "string" },
        chatId: { type: "string" },
        sourcePath: { type: "string" },
        x: { type: "number" },
        y: { type: "number" },
        label: { type: "string" },
      },
      required: ["sourcePath"],
    },
  },
  {
    name: "canvas_update_node",
    description: "Update node geometry or data. Data is shallow-merged unless replaceData is true.",
    inputSchema: {
      type: "object",
      properties: {
        worktreeId: { type: "string" },
        chatId: { type: "string" },
        nodeId: { type: "string" },
        x: { type: "number" },
        y: { type: "number" },
        width: { type: "number" },
        height: { type: "number" },
        data: { type: "object" },
        replaceData: { type: "boolean" },
        locked: { type: "boolean" },
      },
      required: ["nodeId"],
    },
  },
  {
    name: "canvas_delete_node",
    description: "Delete a canvas node and its connected edges.",
    inputSchema: {
      type: "object",
      properties: { worktreeId: { type: "string" }, chatId: { type: "string" }, nodeId: { type: "string" } },
      required: ["nodeId"],
    },
  },
  {
    name: "canvas_connect",
    description: "Connect prompt.text or image.image to an imageGeneration node.",
    inputSchema: {
      type: "object",
      properties: {
        worktreeId: { type: "string" },
        chatId: { type: "string" },
        sourceNodeId: { type: "string" },
        sourceHandle: { type: "string", enum: ["text", "image"] },
        targetNodeId: { type: "string" },
        targetHandle: { type: "string", enum: ["prompt", "referenceImage"] },
      },
      required: ["sourceNodeId", "sourceHandle", "targetNodeId", "targetHandle"],
    },
  },
  {
    name: "canvas_disconnect",
    description: "Delete a canvas edge.",
    inputSchema: {
      type: "object",
      properties: { worktreeId: { type: "string" }, chatId: { type: "string" }, edgeId: { type: "string" } },
      required: ["edgeId"],
    },
  },
  {
    name: "canvas_generate_image",
    description: "Run OpenAI image generation for an imageGeneration node and save the output under assets/canvas/generated.",
    inputSchema: {
      type: "object",
      properties: {
        worktreeId: { type: "string" },
        chatId: { type: "string" },
        nodeId: { type: "string" },
        model: { type: "string" },
        size: { type: "string" },
        quality: { type: "string" },
      },
      required: ["nodeId"],
    },
  },
]

const server = new Server(
  { name: "backlot-canvas", version: "0.0.1" },
  { capabilities: { tools: {} } },
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const args = request.params.arguments || {}
  try {
    let result
    switch (request.params.name) {
      case "canvas_read":
        result = readCanvas(args)
        break
      case "canvas_add_prompt":
        result = addNode({
          ...args,
          type: "prompt",
          width: 520,
          height: 320,
          data: { text: args.text, label: args.label || "Prompt" },
        })
        break
      case "canvas_add_image_generation":
        result = addNode({
          ...args,
          type: "imageGeneration",
          width: 560,
          height: 320,
          data: { model: args.model || DEFAULT_IMAGE_MODEL, status: "idle" },
        })
        break
      case "canvas_add_image_from_path":
        result = await importImage({ ...args, createNode: true })
        break
      case "canvas_update_node":
        result = updateNode(args)
        break
      case "canvas_delete_node":
        result = deleteNode(args)
        break
      case "canvas_connect":
        result = connect(args)
        break
      case "canvas_disconnect":
        result = disconnect(args)
        break
      case "canvas_generate_image":
        result = await generateImage(args)
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
