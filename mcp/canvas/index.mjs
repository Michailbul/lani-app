#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { copyFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises"
import { basename, dirname, extname, isAbsolute, join, normalize, relative } from "node:path"
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

const DEFAULT_CANVAS_PAGE = "main"

// Pull the target page off the tool args. Each Backlot worktree can hold
// many named canvas pages; if the agent doesn't specify one, we land on
// the same "main" page the writer's renderer opens by default. The
// caller can pass it as `page` (preferred) or the legacy `canvasName`.
function pageName(input = {}) {
  const raw = input.page || input.canvasName
  if (typeof raw === "string" && raw.trim()) return raw.trim()
  return DEFAULT_CANVAS_PAGE
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

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
}

function cleanString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function cleanNodeIds(value) {
  if (!Array.isArray(value)) return []
  return [
    ...new Set(
      value
        .filter((id) => typeof id === "string")
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  ]
}

function normalizeNode(node) {
  return node ? { ...node, data: parseData(node.data) } : node
}

function groupDataFromArgs(args) {
  const groupId = cleanString(args.groupId)
  if (!groupId) return {}
  const groupLabel = cleanString(args.groupLabel)
  return {
    groupId,
    ...(groupLabel ? { groupLabel } : {}),
  }
}

function defaultNodeSize(type) {
  switch (type) {
    case "prompt":
      return { width: 520, height: 320 }
    case "imageGeneration":
      return { width: 560, height: 320 }
    case "textBlock":
      return { width: 360, height: 120 }
    case "description":
      return { width: 360, height: 160 }
    case "group":
      return { width: 760, height: 420 }
    default:
      return { width: 420, height: 300 }
  }
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

function ensureCanvas(worktreeId, name = DEFAULT_CANVAS_PAGE) {
  const existing = db
    .prepare("SELECT * FROM canvas_documents WHERE worktree_id = ? AND name = ?")
    .get(worktreeId, name)
  if (existing) return existing
  const canvasId = id("canvas")
  const ts = nowMs()
  db.prepare(
    "INSERT INTO canvas_documents (id, worktree_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  ).run(canvasId, worktreeId, name, ts, ts)
  return db.prepare("SELECT * FROM canvas_documents WHERE id = ?").get(canvasId)
}

function listPages(worktreeId) {
  return db
    .prepare("SELECT * FROM canvas_documents WHERE worktree_id = ? ORDER BY created_at")
    .all(worktreeId)
}

function getNodeRow(nodeId) {
  return db.prepare("SELECT * FROM canvas_nodes WHERE id = ?").get(nodeId)
}

function getEdgeRow(edgeId) {
  return db.prepare("SELECT * FROM canvas_edges WHERE id = ?").get(edgeId)
}

// ─── Page (named canvas document) management ───────────────────────
//
// A worktree can hold many named canvas pages — each one is a separate
// graph. The writer's renderer surfaces these as tabs in the bottom-
// left selector; the agent can target a specific page on any tool by
// passing `page: "<name>"`. If omitted, the default page "main" is used.

function listCanvasPagesTool(args = {}) {
  const worktreeId = activeWorktreeId(args)
  return { pages: listPages(worktreeId) }
}

function createCanvasPage(args = {}) {
  const worktreeId = activeWorktreeId(args)
  const name = cleanString(args.name)
  if (!name) throw new Error("name is required.")
  const existing = db
    .prepare("SELECT * FROM canvas_documents WHERE worktree_id = ? AND name = ?")
    .get(worktreeId, name)
  if (existing) throw new Error(`Page "${name}" already exists.`)
  return ensureCanvas(worktreeId, name)
}

function renameCanvasPage(args = {}) {
  const worktreeId = activeWorktreeId(args)
  const oldName = cleanString(args.name)
  const newName = cleanString(args.newName)
  if (!oldName || !newName) throw new Error("name and newName are required.")
  if (oldName === newName) return ensureCanvas(worktreeId, oldName)
  const collision = db
    .prepare("SELECT id FROM canvas_documents WHERE worktree_id = ? AND name = ?")
    .get(worktreeId, newName)
  if (collision) throw new Error(`Page "${newName}" already exists.`)
  const target = db
    .prepare("SELECT * FROM canvas_documents WHERE worktree_id = ? AND name = ?")
    .get(worktreeId, oldName)
  if (!target) throw new Error(`Canvas page not found: ${oldName}`)
  db.prepare("UPDATE canvas_documents SET name = ?, updated_at = ? WHERE id = ?")
    .run(newName, nowMs(), target.id)
  return db.prepare("SELECT * FROM canvas_documents WHERE id = ?").get(target.id)
}

function deleteCanvasPage(args = {}) {
  const worktreeId = activeWorktreeId(args)
  const name = cleanString(args.name)
  if (!name) throw new Error("name is required.")
  const pages = listPages(worktreeId)
  if (pages.length <= 1) {
    throw new Error("Can't delete the only canvas page — make another first.")
  }
  const target = pages.find((page) => page.name === name)
  if (!target) throw new Error(`Canvas page not found: ${name}`)
  const result = db
    .prepare("DELETE FROM canvas_documents WHERE id = ?")
    .run(target.id)
  return {
    deleted: result.changes > 0,
    remainingPages: pages.filter((page) => page.id !== target.id).map((page) => page.name),
  }
}

function readCanvas(args = {}) {
  const worktreeId = activeWorktreeId(args)
  const canvas = ensureCanvas(worktreeId, pageName(args))
  const nodes = db.prepare("SELECT * FROM canvas_nodes WHERE canvas_id = ?").all(canvas.id)
    .map((node) => ({ ...node, data: parseData(node.data) }))
  const edges = db.prepare("SELECT * FROM canvas_edges WHERE canvas_id = ?").all(canvas.id)
  const assets = db.prepare("SELECT * FROM canvas_assets WHERE worktree_id = ?").all(worktreeId)
  const pages = listPages(worktreeId)
  return { canvas, pages, nodes, edges, assets }
}

function addNode(args) {
  const worktreeId = activeWorktreeId(args)
  const canvas = ensureCanvas(worktreeId, pageName(args))
  const nodeId = id("node")
  const type = args.type
  if (!["prompt", "image", "imageGeneration", "textBlock", "description", "group"].includes(type)) {
    throw new Error("type must be image, imageGeneration, textBlock, description, or group.")
  }
  const defaults = defaultNodeSize(type)
  const width = args.width ?? defaults.width
  const height = args.height ?? defaults.height
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

function boundsForNodes(nodes, padding) {
  if (nodes.length === 0) return null
  const left = Math.min(...nodes.map((node) => node.x))
  const top = Math.min(...nodes.map((node) => node.y))
  const right = Math.max(...nodes.map((node) => node.x + node.width))
  const bottom = Math.max(...nodes.map((node) => node.y + node.height))
  return {
    x: Math.round(left - padding),
    y: Math.round(top - padding - 32),
    width: Math.round(right - left + padding * 2),
    height: Math.round(bottom - top + padding * 2 + 32),
  }
}

function groupNodes(args) {
  const worktreeId = activeWorktreeId(args)
  const page = pageName(args)
  const canvas = ensureCanvas(worktreeId, page)
  const rows = db.prepare("SELECT * FROM canvas_nodes WHERE canvas_id = ?").all(canvas.id)
  const groupId = cleanString(args.groupId)
  let group = groupId ? rows.find((node) => node.id === groupId) : null
  if (group && group.type !== "group") {
    throw new Error(`Canvas node is not a group: ${groupId}`)
  }

  const nodeIds = cleanNodeIds(args.nodeIds).filter((id) => id !== groupId)
  const memberRows = nodeIds
    .map((nodeId) => rows.find((node) => node.id === nodeId))
    .filter((node) => node && node.type !== "group")
  const groupedNodeIds = memberRows.map((node) => node.id)
  const padding = Math.max(0, Math.round(args.padding ?? 32))
  const computedBounds =
    args.autoResize === false ? null : boundsForNodes(memberRows, padding)
  const currentGroupData = group ? parseData(group.data) : {}
  const label =
    cleanString(args.label) ||
    cleanString(currentGroupData.label) ||
    "Group"
  const groupData = {
    ...currentGroupData,
    ...(plainObject(args.data) ? args.data : {}),
    label,
    nodeIds: groupedNodeIds,
  }
  const geometry = {
    x: args.x ?? computedBounds?.x,
    y: args.y ?? computedBounds?.y,
    width: args.width ?? computedBounds?.width,
    height: args.height ?? computedBounds?.height,
  }

  if (group) {
    group = updateNode({
      worktreeId,
      nodeId: group.id,
      ...geometry,
      data: groupData,
    })
  } else {
    group = addNode({
      worktreeId,
      page,
      type: "group",
      ...geometry,
      data: groupData,
    })
  }

  for (const node of memberRows) {
    const data = parseData(node.data)
    updateNode({
      worktreeId,
      nodeId: node.id,
      replaceData: true,
      data: {
        ...data,
        groupId: group.id,
        groupLabel: label,
      },
    })
  }

  return { group: normalizeNode(group), groupedNodeIds }
}

function ungroupNodes(args) {
  const worktreeId = activeWorktreeId(args)
  const canvas = ensureCanvas(worktreeId, pageName(args))
  const groupId = cleanString(args.groupId)
  if (!groupId) throw new Error("groupId is required.")
  const rows = db.prepare("SELECT * FROM canvas_nodes WHERE canvas_id = ?").all(canvas.id)
  const group = rows.find((node) => node.id === groupId)
  if (!group || group.type !== "group") throw new Error(`Canvas group not found: ${groupId}`)
  const groupData = parseData(group.data)
  const memberIds = new Set([
    ...cleanNodeIds(groupData.nodeIds),
    ...rows
      .filter((node) => parseData(node.data).groupId === groupId)
      .map((node) => node.id),
  ])

  for (const node of rows) {
    if (!memberIds.has(node.id) || node.type === "group") continue
    const data = parseData(node.data)
    delete data.groupId
    delete data.groupLabel
    updateNode({
      worktreeId,
      nodeId: node.id,
      replaceData: true,
      data,
    })
  }

  if (args.deleteGroup === true) {
    deleteNode({ worktreeId, nodeId: groupId })
    return { groupId, ungroupedNodeIds: [...memberIds], deletedGroup: true }
  }

  const updated = updateNode({
    worktreeId,
    nodeId: groupId,
    data: { nodeIds: [] },
  })
  return {
    group: normalizeNode(updated),
    ungroupedNodeIds: [...memberIds],
    deletedGroup: false,
  }
}

// Node-id-keyed update — derives canvasId from the row, so the agent
// can update a node on any page without having to name it.
function updateNode(args) {
  activeWorktreeId(args)
  const node = getNodeRow(args.nodeId)
  if (!node) throw new Error(`Canvas node not found: ${args.nodeId}`)
  const canvasId = node.canvas_id
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
    "UPDATE canvas_nodes SET x = ?, y = ?, width = ?, height = ?, data = ?, locked = ?, updated_at = ? WHERE id = ?",
  ).run(next.x, next.y, next.width, next.height, next.data, next.locked, next.updatedAt, args.nodeId)
  db.prepare("UPDATE canvas_documents SET updated_at = ? WHERE id = ?").run(next.updatedAt, canvasId)
  return db.prepare("SELECT * FROM canvas_nodes WHERE id = ?").get(args.nodeId)
}

function deleteNode(args) {
  activeWorktreeId(args)
  const node = getNodeRow(args.nodeId)
  if (!node) return { deleted: false }
  const canvasId = node.canvas_id
  const result = db
    .prepare("DELETE FROM canvas_nodes WHERE id = ?")
    .run(args.nodeId)
  if (node.type === "group" && result.changes > 0) {
    const rows = db.prepare("SELECT * FROM canvas_nodes WHERE canvas_id = ?").all(canvasId)
    for (const row of rows) {
      const data = parseData(row.data)
      if (data.groupId !== args.nodeId) continue
      delete data.groupId
      delete data.groupLabel
      db.prepare("UPDATE canvas_nodes SET data = ?, updated_at = ? WHERE id = ?")
        .run(stringify(data), nowMs(), row.id)
    }
  }
  db.prepare("UPDATE canvas_documents SET updated_at = ? WHERE id = ?").run(nowMs(), canvasId)
  return { deleted: result.changes > 0 }
}

// Bulk geometry/data update — one transaction, one round-trip. Cuts a
// 12-node rearrange from 12 tool calls to 1. Each update entry mirrors
// the canvas_update_node arg shape (nodeId + the same optional fields).
const bulkUpdateNodes = db.transaction((args) => {
  activeWorktreeId(args)
  if (!Array.isArray(args.updates) || args.updates.length === 0) {
    throw new Error("updates must be a non-empty array.")
  }
  const updated = []
  for (const entry of args.updates) {
    if (!entry || typeof entry !== "object") {
      throw new Error("Each update must be an object with nodeId.")
    }
    if (typeof entry.nodeId !== "string" || !entry.nodeId.trim()) {
      throw new Error("Each update needs a nodeId.")
    }
    updated.push(normalizeNode(updateNode({ ...entry, worktreeId: args.worktreeId })))
  }
  return { updated, count: updated.length }
})

// Rename the file on disk that backs a canvas asset. Stays in the same
// subdirectory under assets/canvas/ — the writer's organization (imported
// vs generated vs stitched) is preserved. Updates the asset row and any
// node referencing it via data.projectRelativePath / data.outputPath so
// the canvas keeps rendering after the move.
async function renameAsset(args) {
  const worktreeId = activeWorktreeId(args)
  const assetId = cleanString(args.assetId)
  if (!assetId) throw new Error("assetId is required.")
  const requestedName = cleanString(args.newFilename)
  const newLabel = cleanString(args.newLabel)
  if (!requestedName && !newLabel) {
    throw new Error("Pass newFilename to move the file or newLabel to relabel the node.")
  }
  const asset = db.prepare("SELECT * FROM canvas_assets WHERE id = ?").get(assetId)
  if (!asset || asset.worktree_id !== worktreeId) {
    throw new Error(`Canvas asset not found: ${assetId}`)
  }

  let nextRelPath = asset.project_relative_path
  let movedFile = false

  if (requestedName) {
    if (requestedName.includes("/") || requestedName.includes("\\")) {
      throw new Error("newFilename must be a bare filename, not a path.")
    }
    const sanitized = requestedName.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "")
    if (!sanitized) throw new Error("newFilename is empty after sanitization.")
    const sourceRel = asset.project_relative_path
    const sourceExt = extname(sourceRel).toLowerCase() || ".png"
    const candidateExt = extname(sanitized).toLowerCase()
    const finalName = candidateExt ? sanitized : `${sanitized}${sourceExt}`
    const finalExt = extname(finalName).toLowerCase()
    if (finalExt !== sourceExt) {
      throw new Error(`newFilename extension must stay ${sourceExt} (got ${finalExt}).`)
    }
    nextRelPath = safeRelativePath(join(dirname(sourceRel), finalName))
    if (nextRelPath !== sourceRel) {
      const collision = db
        .prepare("SELECT id FROM canvas_assets WHERE worktree_id = ? AND project_relative_path = ?")
        .get(worktreeId, nextRelPath)
      if (collision) throw new Error(`Another asset already uses ${nextRelPath}.`)
      const root = worktreeForId(worktreeId)
      const src = resolveInsideRoot(root, sourceRel)
      const dest = resolveInsideRoot(root, nextRelPath)
      if (!existsSync(src)) throw new Error(`Asset file missing on disk: ${sourceRel}`)
      if (existsSync(dest)) throw new Error(`File already exists at destination: ${nextRelPath}`)
      await mkdir(dirname(dest), { recursive: true })
      await rename(src, dest)
      movedFile = true
      db.prepare("UPDATE canvas_assets SET project_relative_path = ? WHERE id = ?")
        .run(nextRelPath, assetId)
    }
  }

  // Sync any node pointing at this asset so labels and paths stay
  // accurate. We touch image nodes (data.assetId) and imageGeneration
  // nodes (data.outputAssetId).
  const linkedRows = db.prepare("SELECT * FROM canvas_nodes").all()
  const touchedNodeIds = []
  const touchedCanvasIds = new Set()
  const ts = nowMs()
  for (const row of linkedRows) {
    const data = parseData(row.data)
    let dirty = false
    if (data.assetId === assetId) {
      if (movedFile && data.projectRelativePath !== nextRelPath) {
        data.projectRelativePath = nextRelPath
        dirty = true
      }
      if (newLabel && data.label !== newLabel) {
        data.label = newLabel
        dirty = true
      }
    }
    if (data.outputAssetId === assetId && movedFile && data.outputPath !== nextRelPath) {
      data.outputPath = nextRelPath
      dirty = true
    }
    if (dirty) {
      db.prepare("UPDATE canvas_nodes SET data = ?, updated_at = ? WHERE id = ?")
        .run(stringify(data), ts, row.id)
      touchedNodeIds.push(row.id)
      touchedCanvasIds.add(row.canvas_id)
    }
  }
  for (const canvasId of touchedCanvasIds) {
    db.prepare("UPDATE canvas_documents SET updated_at = ? WHERE id = ?").run(ts, canvasId)
  }

  return {
    asset: db.prepare("SELECT * FROM canvas_assets WHERE id = ?").get(assetId),
    movedFile,
    relabeled: !!newLabel,
    touchedNodeIds,
  }
}

function validateConnection(sourceType, sourceHandle, targetType, targetHandle) {
  const textSource = sourceType === "textBlock" || sourceType === "prompt"
  const valid =
    (textSource &&
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
  activeWorktreeId(args)
  const source = getNodeRow(args.sourceNodeId)
  const target = getNodeRow(args.targetNodeId)
  if (!source || !target) throw new Error("Both edge endpoints must exist.")
  if (source.canvas_id !== target.canvas_id) {
    throw new Error("Canvas edge endpoints must live on the same page.")
  }
  validateConnection(source.type, args.sourceHandle, target.type, args.targetHandle)
  const canvasId = source.canvas_id

  const existing = db.prepare(
    "SELECT * FROM canvas_edges WHERE canvas_id = ? AND source_node_id = ? AND source_handle = ? AND target_node_id = ? AND target_handle = ?",
  ).get(canvasId, args.sourceNodeId, args.sourceHandle, args.targetNodeId, args.targetHandle)
  if (existing) return existing

  const edgeId = id("edge")
  const ts = nowMs()
  db.prepare(
    "INSERT INTO canvas_edges (id, canvas_id, source_node_id, source_handle, target_node_id, target_handle, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(edgeId, canvasId, args.sourceNodeId, args.sourceHandle, args.targetNodeId, args.targetHandle, ts)
  db.prepare("UPDATE canvas_documents SET updated_at = ? WHERE id = ?").run(ts, canvasId)
  return db.prepare("SELECT * FROM canvas_edges WHERE id = ?").get(edgeId)
}

function disconnect(args) {
  activeWorktreeId(args)
  const edge = getEdgeRow(args.edgeId)
  if (!edge) return { deleted: false }
  const result = db
    .prepare("DELETE FROM canvas_edges WHERE id = ?")
    .run(args.edgeId)
  db.prepare("UPDATE canvas_documents SET updated_at = ? WHERE id = ?").run(nowMs(), edge.canvas_id)
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
        page: pageName(args),
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
          ...(cleanString(args.groupId)
            ? {
                groupId: cleanString(args.groupId),
                ...(cleanString(args.groupLabel)
                  ? { groupLabel: cleanString(args.groupLabel) }
                  : {}),
              }
            : {}),
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
    if (
      (source.type === "textBlock" || source.type === "prompt") &&
      edge.target_handle === "prompt" &&
      typeof data.text === "string"
    ) {
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
  const node = getNodeRow(args.nodeId)
  if (!node || node.type !== "imageGeneration") {
    throw new Error("nodeId must point to an imageGeneration node.")
  }
  const canvasId = node.canvas_id
  const { prompt, inputAssetIds } = generationInputs(canvasId, args.nodeId)
  const nodeData = parseData(node.data)
  const model = args.model || nodeData.model || DEFAULT_IMAGE_MODEL
  const runId = id("run")
  const ts = nowMs()
  db.prepare(
    "INSERT INTO canvas_generation_runs (id, canvas_id, node_id, model, status, prompt, input_asset_ids, started_at) VALUES (?, ?, ?, ?, 'running', ?, ?, ?)",
  ).run(runId, canvasId, args.nodeId, model, prompt, JSON.stringify(inputAssetIds), ts)
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
    name: "canvas_list_pages",
    description:
      "List every canvas page on the worktree. Each Backlot worktree can hold many named pages (one graph per page) — the writer's renderer surfaces them as bottom-left tabs. Returns the page name, id, and timestamps; pass the name back as `page` on any other canvas tool to target that page.",
    inputSchema: {
      type: "object",
      properties: { worktreeId: { type: "string" }, chatId: { type: "string" } },
    },
  },
  {
    name: "canvas_create_page",
    description:
      "Create a new canvas page on the worktree under the given name. Errors if a page with the same name already exists. Use this when the writer asks for a new page (e.g. 'a page for Scene 2 storyboard'), then thread that name to subsequent canvas tools as `page`.",
    inputSchema: {
      type: "object",
      properties: {
        worktreeId: { type: "string" },
        chatId: { type: "string" },
        name: { type: "string" },
      },
      required: ["name"],
    },
  },
  {
    name: "canvas_rename_page",
    description:
      "Rename a canvas page. Errors if `newName` collides with another existing page on the same worktree.",
    inputSchema: {
      type: "object",
      properties: {
        worktreeId: { type: "string" },
        chatId: { type: "string" },
        name: { type: "string" },
        newName: { type: "string" },
      },
      required: ["name", "newName"],
    },
  },
  {
    name: "canvas_delete_page",
    description:
      "Delete a canvas page along with every node and edge on it (FK cascade). Refuses to delete the only remaining page — make another first. Asset files on disk are left alone. Destructive: prefer asking the writer first.",
    inputSchema: {
      type: "object",
      properties: {
        worktreeId: { type: "string" },
        chatId: { type: "string" },
        name: { type: "string" },
      },
      required: ["name"],
    },
  },
  {
    name: "canvas_read",
    description:
      "Read a Backlot canvas page. Returns the page document, every page on the worktree, and the nodes/edges/assets for the requested page. Pass `page` to target a specific page (default: \"main\").",
    inputSchema: {
      type: "object",
      properties: {
        worktreeId: { type: "string" },
        chatId: { type: "string" },
        page: { type: "string" },
      },
    },
  },
  {
    name: "canvas_add_prompt",
    description:
      "Add a text-box node carrying a generation prompt. Identical to canvas_add_text but with a larger default size suited to prompts. The text box has a right-side output handle you can wire into an imageGeneration node. For storyboard work, place each shot prompt inside the storyboard group and pass groupId when available. Pass `page` to target a specific page (default: \"main\").",
    inputSchema: {
      type: "object",
      properties: {
        worktreeId: { type: "string" },
        chatId: { type: "string" },
        page: { type: "string" },
        text: { type: "string" },
        x: { type: "number" },
        y: { type: "number" },
        width: { type: "number" },
        height: { type: "number" },
        fontSize: { type: "number" },
        label: { type: "string" },
        groupId: { type: "string" },
        groupLabel: { type: "string" },
      },
      required: ["text"],
    },
  },
  {
    name: "canvas_add_group",
    description:
      "Add a visible group container to the canvas. Use this to hold related nodes, especially storyboard prompt sets. If nodeIds are provided, the group auto-sizes around those nodes and tags them with the group id. Pass `page` to target a specific page (default: \"main\").",
    inputSchema: {
      type: "object",
      properties: {
        worktreeId: { type: "string" },
        chatId: { type: "string" },
        page: { type: "string" },
        label: { type: "string" },
        nodeIds: { type: "array", items: { type: "string" } },
        x: { type: "number" },
        y: { type: "number" },
        width: { type: "number" },
        height: { type: "number" },
        padding: { type: "number" },
        autoResize: { type: "boolean" },
        data: { type: "object" },
      },
    },
  },
  {
    name: "canvas_group_nodes",
    description:
      "Create or update a visible group container around existing canvas nodes. Pass groupId to update an existing group; omit it to create one. The tool stores membership on the group and on each member node. Pass `page` to target a specific page (default: \"main\").",
    inputSchema: {
      type: "object",
      properties: {
        worktreeId: { type: "string" },
        chatId: { type: "string" },
        page: { type: "string" },
        groupId: { type: "string" },
        label: { type: "string" },
        nodeIds: { type: "array", items: { type: "string" } },
        x: { type: "number" },
        y: { type: "number" },
        width: { type: "number" },
        height: { type: "number" },
        padding: { type: "number" },
        autoResize: { type: "boolean" },
        data: { type: "object" },
      },
      required: ["nodeIds"],
    },
  },
  {
    name: "canvas_ungroup",
    description:
      "Remove canvas nodes from a group. Set deleteGroup true to remove the empty group container after clearing membership. Pass `page` to target a specific page (default: \"main\").",
    inputSchema: {
      type: "object",
      properties: {
        worktreeId: { type: "string" },
        chatId: { type: "string" },
        page: { type: "string" },
        groupId: { type: "string" },
        deleteGroup: { type: "boolean" },
      },
      required: ["groupId"],
    },
  },
  {
    name: "canvas_add_text",
    description:
      "Add a freeform text-box node — a lightly bordered, resizable box of plain text. Use it for notes, labels, commentary, or any text you might later wire into image generation. The text box has a right-side output handle that can connect to an imageGeneration node's prompt input. Pass `page` to target a specific page (default: \"main\").",
    inputSchema: {
      type: "object",
      properties: {
        worktreeId: { type: "string" },
        chatId: { type: "string" },
        page: { type: "string" },
        text: { type: "string" },
        x: { type: "number" },
        y: { type: "number" },
        width: { type: "number" },
        height: { type: "number" },
        fontSize: { type: "number" },
        groupId: { type: "string" },
        groupLabel: { type: "string" },
      },
      required: ["text"],
    },
  },
  {
    name: "canvas_add_description",
    description:
      "Add a chrome-free description text node — a borderless block of editorial text used for headings, labels, and contextual descriptions on the board. The node has no input or output handles (it never wires into generation). Carries inline formatting on the node: fontSize, color (default | primary | muted | teal | linen | ember), highlight (none | amber | coral | teal | ember | linen), bold, italic. Pass `page` to target a specific page (default: \"main\").",
    inputSchema: {
      type: "object",
      properties: {
        worktreeId: { type: "string" },
        chatId: { type: "string" },
        page: { type: "string" },
        text: { type: "string" },
        x: { type: "number" },
        y: { type: "number" },
        width: { type: "number" },
        height: { type: "number" },
        fontSize: { type: "number" },
        color: {
          type: "string",
          enum: ["default", "primary", "muted", "teal", "linen", "ember"],
        },
        highlight: {
          type: "string",
          enum: ["none", "amber", "coral", "teal", "ember", "linen"],
        },
        bold: { type: "boolean" },
        italic: { type: "boolean" },
        groupId: { type: "string" },
        groupLabel: { type: "string" },
      },
      required: ["text"],
    },
  },
  {
    name: "canvas_add_image_generation",
    description:
      "Add an image generation node. Connect a prompt node to its prompt handle before generating. Pass `page` to target a specific page (default: \"main\").",
    inputSchema: {
      type: "object",
      properties: {
        worktreeId: { type: "string" },
        chatId: { type: "string" },
        page: { type: "string" },
        x: { type: "number" },
        y: { type: "number" },
        model: { type: "string" },
        groupId: { type: "string" },
        groupLabel: { type: "string" },
      },
    },
  },
  {
    name: "canvas_add_image_from_path",
    description:
      "Import an image file into assets/canvas/imported and add an image node for it. Pass `page` to target a specific page (default: \"main\").",
    inputSchema: {
      type: "object",
      properties: {
        worktreeId: { type: "string" },
        chatId: { type: "string" },
        page: { type: "string" },
        sourcePath: { type: "string" },
        x: { type: "number" },
        y: { type: "number" },
        label: { type: "string" },
        groupId: { type: "string" },
        groupLabel: { type: "string" },
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
    name: "canvas_update_nodes",
    description:
      "Bulk-update many canvas nodes in one transaction. Each entry takes the same shape as canvas_update_node (nodeId plus any optional x/y/width/height/data/replaceData/locked). Use this for rearranging a selection, tidying a layout, or relabeling several nodes at once — much cheaper than looping canvas_update_node.",
    inputSchema: {
      type: "object",
      properties: {
        worktreeId: { type: "string" },
        chatId: { type: "string" },
        updates: {
          type: "array",
          items: {
            type: "object",
            properties: {
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
      },
      required: ["updates"],
    },
  },
  {
    name: "canvas_rename_asset",
    description:
      "Rename a canvas asset — moves the file on disk under assets/canvas/ (preserving its imported/generated/stitched subfolder) and updates every node that references it so the canvas keeps rendering. Pass `newFilename` to rename the file (bare filename only; extension is preserved automatically if omitted). Pass `newLabel` to update the visible label on the linked image node(s). Either or both may be passed.",
    inputSchema: {
      type: "object",
      properties: {
        worktreeId: { type: "string" },
        chatId: { type: "string" },
        assetId: { type: "string" },
        newFilename: { type: "string" },
        newLabel: { type: "string" },
      },
      required: ["assetId"],
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
    description:
      "Connect a text-box (textBlock or legacy prompt) text output, or an image output, to an imageGeneration node's prompt or referenceImage input.",
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
      case "canvas_list_pages":
        result = listCanvasPagesTool(args)
        break
      case "canvas_create_page":
        result = createCanvasPage(args)
        break
      case "canvas_rename_page":
        result = renameCanvasPage(args)
        break
      case "canvas_delete_page":
        result = deleteCanvasPage(args)
        break
      case "canvas_read":
        result = readCanvas(args)
        break
      case "canvas_add_prompt":
        // Prompts and notes share one visual on the canvas now — both land
        // as `textBlock` nodes. The text-box's right-side handle is what
        // wires into an imageGeneration node.
        result = addNode({
          ...args,
          type: "textBlock",
          width: args.width ?? 520,
          height: args.height ?? 320,
          data: {
            text: args.text,
            fontSize: args.fontSize ?? 16,
            ...(args.label ? { label: args.label } : {}),
            ...groupDataFromArgs(args),
          },
        })
        break
      case "canvas_add_group":
      case "canvas_group_nodes":
        result = groupNodes(args)
        break
      case "canvas_ungroup":
        result = ungroupNodes(args)
        break
      case "canvas_add_text":
        result = addNode({
          ...args,
          type: "textBlock",
          width: args.width ?? 360,
          height: args.height ?? 120,
          data: {
            text: args.text ?? "",
            fontSize: args.fontSize ?? 18,
            ...groupDataFromArgs(args),
          },
        })
        break
      case "canvas_add_description":
        result = addNode({
          ...args,
          type: "description",
          width: args.width ?? 360,
          height: args.height ?? 160,
          data: {
            text: args.text ?? "",
            fontSize: args.fontSize ?? 22,
            color: typeof args.color === "string" ? args.color : "default",
            highlight: typeof args.highlight === "string" ? args.highlight : "none",
            bold: args.bold === true,
            italic: args.italic === true,
            ...groupDataFromArgs(args),
          },
        })
        break
      case "canvas_add_image_generation":
        result = addNode({
          ...args,
          type: "imageGeneration",
          width: 560,
          height: 320,
          data: {
            model: args.model || DEFAULT_IMAGE_MODEL,
            status: "idle",
            ...groupDataFromArgs(args),
          },
        })
        break
      case "canvas_add_image_from_path":
        result = await importImage({ ...args, createNode: true })
        break
      case "canvas_update_node":
        result = updateNode(args)
        break
      case "canvas_update_nodes":
        result = bulkUpdateNodes(args)
        break
      case "canvas_rename_asset":
        result = await renameAsset(args)
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
