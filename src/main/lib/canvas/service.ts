import { createHash, randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises"
import { basename, extname, isAbsolute, join, normalize, relative, sep } from "node:path"
import { and, eq } from "drizzle-orm"
import { readImageDimensions, type ImageDimensions } from "./image-dimensions"
import {
  canvasAssets,
  canvasDocuments,
  canvasEdges,
  canvasGenerationRuns,
  canvasNodes,
  getDatabase,
  worktrees,
  type CanvasAsset,
  type CanvasDocument,
  type CanvasEdge,
  type CanvasNode,
} from "../db"

export const DEFAULT_CANVAS_NAME = "main"
export const DEFAULT_IMAGE_MODEL = process.env.LANI_CANVAS_IMAGE_MODEL || "gpt-image-2"

// `prompt` is a legacy node type — new prompts land as `textBlock`.
// Kept in the union so existing rows in the DB still type-check on read.
export type CanvasNodeType =
  | "prompt"
  | "image"
  | "imageGeneration"
  | "textBlock"
  | "description"
  | "group"
export type CanvasAssetKind = "imported" | "generated" | "stitched" | "cropped"

export interface CanvasDocumentSnapshot {
  document: CanvasDocument
  // Absolute worktree path — the renderer joins it with an asset's
  // projectRelativePath to build a `lani-asset://` preview URL.
  worktreePath: string | null
  nodes: Array<CanvasNode & { dataJson: Record<string, unknown> }>
  edges: CanvasEdge[]
  assets: CanvasAsset[]
}

export interface CanvasNodeInput {
  type: CanvasNodeType
  x?: number
  y?: number
  width?: number
  height?: number
  data?: Record<string, unknown>
  locked?: boolean
}

export interface CanvasNodePatch {
  x?: number
  y?: number
  width?: number
  height?: number
  data?: Record<string, unknown>
  replaceData?: boolean
  locked?: boolean
}

export interface CanvasEdgeInput {
  sourceNodeId: string
  sourceHandle: string
  targetNodeId: string
  targetHandle: string
}

export interface CanvasGroupInput {
  label?: string
  nodeIds?: string[]
  x?: number
  y?: number
  width?: number
  height?: number
  padding?: number
  autoResize?: boolean
  data?: Record<string, unknown>
}

export interface CanvasGroupResult {
  group: CanvasNode
  groupedNodeIds: string[]
}

interface WorktreeLookup {
  worktreeId: string
  worktreePath: string
}

function now(): Date {
  return new Date()
}

function createId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 18)}`
}

function parseDataJson(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {}
  } catch {
    return {}
  }
}

function stringifyData(value: Record<string, unknown> | undefined): string {
  return JSON.stringify(value ?? {})
}

function defaultNodeSize(type: CanvasNodeType): { width: number; height: number } {
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
    case "image":
    default:
      return { width: 420, height: 300 }
  }
}

function mimeTypeFromPath(filePath: string): string {
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

function assertSafeRelativePath(path: string): string {
  const normalized = normalize(path).replace(/\\/g, "/")
  if (
    normalized === "." ||
    normalized.startsWith("../") ||
    normalized === ".." ||
    normalized.startsWith("/") ||
    normalized.includes("\0")
  ) {
    throw new Error(`Unsafe project-relative path: ${path}`)
  }
  return normalized
}

function resolveInsideRoot(root: string, projectRelativePath: string): string {
  const safePath = assertSafeRelativePath(projectRelativePath)
  const fullPath = join(root, safePath)
  const rel = relative(root, fullPath)
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`Path escapes the project root: ${projectRelativePath}`)
  }
  return fullPath
}

function lookupWorktree(worktreeId: string): WorktreeLookup {
  const db = getDatabase()
  const row = db
    .select({ id: worktrees.id, worktreePath: worktrees.worktreePath })
    .from(worktrees)
    .where(eq(worktrees.id, worktreeId))
    .get()
  if (!row?.worktreePath) {
    throw new Error("Worktree has no filesystem path. Canvas assets need a project worktree.")
  }
  return { worktreeId: row.id, worktreePath: row.worktreePath }
}

function getDocument(worktreeId: string, name = DEFAULT_CANVAS_NAME): CanvasDocument | null {
  const db = getDatabase()
  return db
    .select()
    .from(canvasDocuments)
    .where(and(eq(canvasDocuments.worktreeId, worktreeId), eq(canvasDocuments.name, name)))
    .get() ?? null
}

export function ensureCanvasDocument(worktreeId: string, name = DEFAULT_CANVAS_NAME): CanvasDocument {
  const existing = getDocument(worktreeId, name)
  if (existing) return existing

  const db = getDatabase()
  const id = createId("canvas")
  const created = now()
  db.insert(canvasDocuments)
    .values({ id, worktreeId, name, createdAt: created, updatedAt: created })
    .run()

  const inserted = getDocument(worktreeId, name)
  if (!inserted) throw new Error("Failed to create canvas document.")
  return inserted
}

export function readCanvasDocument(worktreeId: string, name = DEFAULT_CANVAS_NAME): CanvasDocumentSnapshot | null {
  const document = getDocument(worktreeId, name)
  if (!document) return null

  const db = getDatabase()
  const nodes = db
    .select()
    .from(canvasNodes)
    .where(eq(canvasNodes.canvasId, document.id))
    .all()
    .map((node) => ({ ...node, dataJson: parseDataJson(node.data) }))
  const edges = db
    .select()
    .from(canvasEdges)
    .where(eq(canvasEdges.canvasId, document.id))
    .all()
  const assets = db
    .select()
    .from(canvasAssets)
    .where(eq(canvasAssets.worktreeId, worktreeId))
    .all()

  const worktreeRow = db
    .select({ worktreePath: worktrees.worktreePath })
    .from(worktrees)
    .where(eq(worktrees.id, worktreeId))
    .get()

  return {
    document,
    worktreePath: worktreeRow?.worktreePath ?? null,
    nodes,
    edges,
    assets,
  }
}

/**
 * List all canvas pages (documents) for a worktree. The "main" page is
 * lazy-created the first time the canvas is opened; this query returns
 * the empty list before that, and the renderer ensures "main" exists
 * when it loads the canvas view.
 */
export function listCanvasPages(worktreeId: string): CanvasDocument[] {
  const db = getDatabase()
  return db
    .select()
    .from(canvasDocuments)
    .where(eq(canvasDocuments.worktreeId, worktreeId))
    .all()
}

/**
 * Create a new canvas page. Throws if a page with the same name already
 * exists in this worktree — the renderer auto-suffixes "Page N" before
 * calling so the conflict path is rare and human-meaningful.
 */
export function createCanvasPage(worktreeId: string, name: string): CanvasDocument {
  const trimmed = name.trim()
  if (!trimmed) throw new Error("Page name cannot be empty.")
  const existing = getDocument(worktreeId, trimmed)
  if (existing) throw new Error(`Page "${trimmed}" already exists.`)
  return ensureCanvasDocument(worktreeId, trimmed)
}

/**
 * Delete a canvas page. Refuses to delete the last remaining page — the
 * worktree always has at least one canvas (which the renderer will
 * recreate as "main" on next open). The FK cascade clears nodes and
 * edges in the same step; asset files on disk stay (assets are
 * worktree-scoped, not page-scoped, and may be referenced elsewhere).
 */
export function deleteCanvasPage(
  worktreeId: string,
  name: string,
): { deleted: boolean; remainingPages: string[] } {
  const pages = listCanvasPages(worktreeId)
  if (pages.length <= 1) {
    throw new Error("Can't delete the only canvas page — make another first.")
  }
  const target = pages.find((page) => page.name === name)
  if (!target) throw new Error(`Canvas page not found: ${name}`)
  const db = getDatabase()
  const result = db
    .delete(canvasDocuments)
    .where(eq(canvasDocuments.id, target.id))
    .run()
  return {
    deleted: result.changes > 0,
    remainingPages: pages.filter((page) => page.id !== target.id).map((page) => page.name),
  }
}

/**
 * Rename a canvas page. Refuses if the new name is empty, identical to
 * the old one (no-op), or collides with another page in the same
 * worktree. Returns the updated row.
 */
export function renameCanvasPage(
  worktreeId: string,
  oldName: string,
  newName: string,
): CanvasDocument {
  const trimmedNew = newName.trim()
  if (!trimmedNew) throw new Error("Page name cannot be empty.")
  if (trimmedNew === oldName) {
    const existing = getDocument(worktreeId, oldName)
    if (!existing) throw new Error(`Canvas page not found: ${oldName}`)
    return existing
  }
  const collision = getDocument(worktreeId, trimmedNew)
  if (collision) throw new Error(`Page "${trimmedNew}" already exists.`)
  const target = getDocument(worktreeId, oldName)
  if (!target) throw new Error(`Canvas page not found: ${oldName}`)
  const db = getDatabase()
  db.update(canvasDocuments)
    .set({ name: trimmedNew, updatedAt: now() })
    .where(eq(canvasDocuments.id, target.id))
    .run()
  return db.select().from(canvasDocuments).where(eq(canvasDocuments.id, target.id)).get()!
}

export function createCanvasNode(
  worktreeId: string,
  input: CanvasNodeInput,
  name = DEFAULT_CANVAS_NAME,
): CanvasNode {
  const document = ensureCanvasDocument(worktreeId, name)
  const db = getDatabase()
  const id = createId("node")
  const created = now()
  const defaultSize = defaultNodeSize(input.type)
  db.insert(canvasNodes)
    .values({
      id,
      canvasId: document.id,
      type: input.type,
      x: input.x ?? 0,
      y: input.y ?? 0,
      width: input.width ?? defaultSize.width,
      height: input.height ?? defaultSize.height,
      data: stringifyData(input.data),
      locked: input.locked ?? false,
      createdAt: created,
      updatedAt: created,
    })
    .run()
  return db.select().from(canvasNodes).where(eq(canvasNodes.id, id)).get()!
}

function uniqueNodeIds(nodeIds: string[] | undefined): string[] {
  return [
    ...new Set(
      (nodeIds ?? [])
        .map((id) => id.trim())
        .filter((id) => id.length > 0),
    ),
  ]
}

function boundsForNodes(
  nodes: CanvasNode[],
  padding: number,
): { x: number; y: number; width: number; height: number } | null {
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

export function groupCanvasNodes(
  worktreeId: string,
  input: CanvasGroupInput & { groupId?: string },
  name = DEFAULT_CANVAS_NAME,
): CanvasGroupResult {
  const document = ensureCanvasDocument(worktreeId, name)
  const db = getDatabase()
  const padding = Math.max(0, Math.round(input.padding ?? 32))
  const requestedNodeIds = uniqueNodeIds(input.nodeIds).filter(
    (id) => id !== input.groupId,
  )
  const allNodes = db
    .select()
    .from(canvasNodes)
    .where(eq(canvasNodes.canvasId, document.id))
    .all()
  const memberNodes = requestedNodeIds
    .map((id) => allNodes.find((node) => node.id === id))
    .filter((node): node is CanvasNode => Boolean(node))
    .filter((node) => node.type !== "group")
  const groupedNodeIds = memberNodes.map((node) => node.id)

  let group = input.groupId
    ? allNodes.find((node) => node.id === input.groupId)
    : undefined
  if (group && group.type !== "group") {
    throw new Error(`Canvas node is not a group: ${input.groupId}`)
  }

  const computedBounds =
    input.autoResize === false ? null : boundsForNodes(memberNodes, padding)
  const groupLabel =
    input.label ??
    ((group ? String(parseDataJson(group.data).label || "") : "") || "Group")
  const groupData = {
    ...(group ? parseDataJson(group.data) : {}),
    ...(input.data ?? {}),
    label: groupLabel,
    nodeIds: groupedNodeIds,
  }
  const geometry = {
    x: input.x ?? computedBounds?.x,
    y: input.y ?? computedBounds?.y,
    width: input.width ?? computedBounds?.width,
    height: input.height ?? computedBounds?.height,
  }

  if (group) {
    group = updateCanvasNode(worktreeId, group.id, {
      ...geometry,
      data: groupData,
    })
  } else {
    group = createCanvasNode(
      worktreeId,
      {
        type: "group",
        x: geometry.x,
        y: geometry.y,
        width: geometry.width,
        height: geometry.height,
        data: groupData,
      },
      name,
    )
  }

  for (const node of memberNodes) {
    const existingData = parseDataJson(node.data)
    updateCanvasNode(worktreeId, node.id, {
      data: {
        ...existingData,
        groupId: group.id,
        groupLabel,
      },
      replaceData: true,
    })
  }

  return { group, groupedNodeIds }
}

// Node-id-keyed update — works on whichever page the node lives on
// (looks up the canvasId from the node itself, no page name needed).
// The unused `worktreeId` stays for call-site symmetry with the rest of
// the service; we don't need it to find the node.
export function updateCanvasNode(_worktreeId: string, nodeId: string, patch: CanvasNodePatch): CanvasNode {
  const db = getDatabase()
  const existing = db
    .select()
    .from(canvasNodes)
    .where(eq(canvasNodes.id, nodeId))
    .get()
  if (!existing) throw new Error(`Canvas node not found: ${nodeId}`)

  const existingData = parseDataJson(existing.data)
  const nextData = patch.data
    ? patch.replaceData
      ? patch.data
      : { ...existingData, ...patch.data }
    : existingData

  db.update(canvasNodes)
    .set({
      ...(patch.x !== undefined ? { x: patch.x } : {}),
      ...(patch.y !== undefined ? { y: patch.y } : {}),
      ...(patch.width !== undefined ? { width: patch.width } : {}),
      ...(patch.height !== undefined ? { height: patch.height } : {}),
      ...(patch.locked !== undefined ? { locked: patch.locked } : {}),
      data: stringifyData(nextData),
      updatedAt: now(),
    })
    .where(eq(canvasNodes.id, nodeId))
    .run()

  db.update(canvasDocuments)
    .set({ updatedAt: now() })
    .where(eq(canvasDocuments.id, existing.canvasId))
    .run()

  return db.select().from(canvasNodes).where(eq(canvasNodes.id, nodeId)).get()!
}

export interface CanvasSnapshotInput {
  nodes: Array<{
    id: string
    type: CanvasNodeType
    x: number
    y: number
    width: number
    height: number
    data: Record<string, unknown>
    locked: boolean
  }>
  edges: Array<{
    id: string
    sourceNodeId: string
    sourceHandle: string
    targetNodeId: string
    targetHandle: string
  }>
}

/**
 * Replace the canvas graph with a snapshot — the primitive that powers
 * undo/redo on the canvas. Edges drop first to dodge the FK constraint,
 * nodes drop next, then everything from the snapshot is re-inserted with
 * its original ids so existing references (selection, drag state, focus)
 * still resolve after the swap. Asset rows and files on disk are left
 * alone: a crop's old asset is still on disk, so restoring the node's
 * pre-crop data simply repoints to it.
 */
export function applyCanvasSnapshot(
  worktreeId: string,
  snapshot: CanvasSnapshotInput,
  name = DEFAULT_CANVAS_NAME,
): CanvasDocumentSnapshot {
  const document = ensureCanvasDocument(worktreeId, name)
  const db = getDatabase()
  const ts = now()
  db.transaction((tx) => {
    tx.delete(canvasEdges).where(eq(canvasEdges.canvasId, document.id)).run()
    tx.delete(canvasNodes).where(eq(canvasNodes.canvasId, document.id)).run()
    for (const node of snapshot.nodes) {
      tx.insert(canvasNodes)
        .values({
          id: node.id,
          canvasId: document.id,
          type: node.type,
          x: node.x,
          y: node.y,
          width: node.width,
          height: node.height,
          data: stringifyData(node.data),
          locked: node.locked,
          createdAt: ts,
          updatedAt: ts,
        })
        .run()
    }
    for (const edge of snapshot.edges) {
      tx.insert(canvasEdges)
        .values({
          id: edge.id,
          canvasId: document.id,
          sourceNodeId: edge.sourceNodeId,
          sourceHandle: edge.sourceHandle,
          targetNodeId: edge.targetNodeId,
          targetHandle: edge.targetHandle,
          createdAt: ts,
        })
        .run()
    }
    tx.update(canvasDocuments)
      .set({ updatedAt: ts })
      .where(eq(canvasDocuments.id, document.id))
      .run()
  })
  return readCanvasDocument(worktreeId, name) as CanvasDocumentSnapshot
}

export function deleteCanvasNode(_worktreeId: string, nodeId: string): { deleted: boolean } {
  const db = getDatabase()
  const existing = db
    .select()
    .from(canvasNodes)
    .where(eq(canvasNodes.id, nodeId))
    .get()
  if (!existing) return { deleted: false }
  const canvasId = existing.canvasId
  const result = db
    .delete(canvasNodes)
    .where(eq(canvasNodes.id, nodeId))
    .run()
  if (existing.type === "group" && result.changes > 0) {
    const nodes = db
      .select()
      .from(canvasNodes)
      .where(eq(canvasNodes.canvasId, canvasId))
      .all()
    for (const node of nodes) {
      const data = parseDataJson(node.data)
      if (data.groupId !== nodeId) continue
      delete data.groupId
      delete data.groupLabel
      db.update(canvasNodes)
        .set({ data: stringifyData(data), updatedAt: now() })
        .where(eq(canvasNodes.id, node.id))
        .run()
    }
  }
  db.update(canvasDocuments)
    .set({ updatedAt: now() })
    .where(eq(canvasDocuments.id, canvasId))
    .run()
  return { deleted: result.changes > 0 }
}

export function connectCanvasNodes(_worktreeId: string, input: CanvasEdgeInput): CanvasEdge {
  const db = getDatabase()
  const source = db
    .select()
    .from(canvasNodes)
    .where(eq(canvasNodes.id, input.sourceNodeId))
    .get()
  const target = db
    .select()
    .from(canvasNodes)
    .where(eq(canvasNodes.id, input.targetNodeId))
    .get()
  if (!source || !target) throw new Error("Canvas edge endpoints must exist.")
  if (source.canvasId !== target.canvasId) {
    throw new Error("Canvas edge endpoints must live on the same page.")
  }
  validateConnection(source.type as CanvasNodeType, input.sourceHandle, target.type as CanvasNodeType, input.targetHandle)

  const canvasId = source.canvasId
  const existing = db
    .select()
    .from(canvasEdges)
    .where(
      and(
        eq(canvasEdges.canvasId, canvasId),
        eq(canvasEdges.sourceNodeId, input.sourceNodeId),
        eq(canvasEdges.sourceHandle, input.sourceHandle),
        eq(canvasEdges.targetNodeId, input.targetNodeId),
        eq(canvasEdges.targetHandle, input.targetHandle),
      ),
    )
    .get()
  if (existing) return existing

  const id = createId("edge")
  db.insert(canvasEdges)
    .values({ id, canvasId, ...input, createdAt: now() })
    .run()
  db.update(canvasDocuments)
    .set({ updatedAt: now() })
    .where(eq(canvasDocuments.id, canvasId))
    .run()
  return db.select().from(canvasEdges).where(eq(canvasEdges.id, id)).get()!
}

export function disconnectCanvasEdge(_worktreeId: string, edgeId: string): { deleted: boolean } {
  const db = getDatabase()
  const existing = db.select().from(canvasEdges).where(eq(canvasEdges.id, edgeId)).get()
  if (!existing) return { deleted: false }
  const result = db
    .delete(canvasEdges)
    .where(eq(canvasEdges.id, edgeId))
    .run()
  db.update(canvasDocuments)
    .set({ updatedAt: now() })
    .where(eq(canvasDocuments.id, existing.canvasId))
    .run()
  return { deleted: result.changes > 0 }
}

function validateConnection(
  sourceType: CanvasNodeType,
  sourceHandle: string,
  targetType: CanvasNodeType,
  targetHandle: string,
): void {
  const valid =
    sourceType === "prompt" &&
    sourceHandle === "text" &&
    targetType === "imageGeneration" &&
    targetHandle === "prompt"
      ? true
      : sourceType === "image" &&
          sourceHandle === "image" &&
          targetType === "imageGeneration" &&
          targetHandle === "referenceImage"

  if (!valid) {
    throw new Error(
      `Unsupported canvas connection: ${sourceType}.${sourceHandle} -> ${targetType}.${targetHandle}`,
    )
  }
}

export async function importCanvasImage(input: {
  worktreeId: string
  sourcePath: string
  x?: number
  y?: number
  label?: string
  createNode?: boolean
  page?: string
}): Promise<{ asset: CanvasAsset; node: CanvasNode | null }> {
  const { worktreePath } = lookupWorktree(input.worktreeId)
  const sourcePath = isAbsolute(input.sourcePath)
    ? input.sourcePath
    : resolveInsideRoot(worktreePath, input.sourcePath)
  if (!existsSync(sourcePath)) throw new Error(`Image file not found: ${input.sourcePath}`)

  const mimeType = mimeTypeFromPath(sourcePath)
  if (!mimeType.startsWith("image/")) {
    throw new Error(`Canvas image import only accepts image files. Got: ${sourcePath}`)
  }

  const buffer = await readFile(sourcePath)
  const sha256 = createHash("sha256").update(buffer).digest("hex")
  const ext = extname(sourcePath).toLowerCase() || ".png"
  const safeBase = basename(sourcePath, ext).replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 80) || "image"
  const relativePath = assertSafeRelativePath(
    join("assets", "canvas", "imported", `${sha256.slice(0, 12)}--${safeBase}${ext}`),
  )
  const destPath = resolveInsideRoot(worktreePath, relativePath)
  await mkdir(join(worktreePath, "assets", "canvas", "imported"), { recursive: true })
  if (!existsSync(destPath)) {
    await copyFile(sourcePath, destPath)
  }
  const fileStat = await stat(destPath)

  // Pull pixel dimensions off the file so the node matches the source
  // aspect — otherwise every imported image snaps to the same default
  // rectangle and visibly crops to fit.
  const dimensions = readImageDimensions(buffer)
  const nodeSize = computeImageNodeSize(dimensions)

  const db = getDatabase()
  const assetId = createId("asset")
  db.insert(canvasAssets)
    .values({
      id: assetId,
      worktreeId: input.worktreeId,
      kind: "imported",
      projectRelativePath: relativePath.split(sep).join("/"),
      sourcePath,
      mimeType,
      byteSize: fileStat.size,
      sha256,
      width: dimensions?.width ?? null,
      height: dimensions?.height ?? null,
      createdAt: now(),
    })
    .run()
  const asset = db.select().from(canvasAssets).where(eq(canvasAssets.id, assetId)).get()!
  const node = input.createNode === false
    ? null
    : createCanvasNode(
        input.worktreeId,
        {
          type: "image",
          x: input.x,
          y: input.y,
          width: nodeSize.width,
          height: nodeSize.height,
          data: {
            assetId: asset.id,
            label: input.label || basename(sourcePath),
            projectRelativePath: asset.projectRelativePath,
            mimeType: asset.mimeType,
            ...(dimensions
              ? { naturalWidth: dimensions.width, naturalHeight: dimensions.height }
              : {}),
          },
        },
        input.page ?? DEFAULT_CANVAS_NAME,
      )

  return { asset, node }
}

// Canvas-display sizing for a freshly-imported image: keep the source
// aspect, cap the long edge at 420px (so a huge screenshot doesn't blow
// up the board), and add a label-row allowance on top of the image
// body. Falls back to a square-ish default when dimensions are unknown.
const IMAGE_NODE_MAX_EDGE = 420
const IMAGE_NODE_HEADER_HEIGHT = 26
const IMAGE_NODE_MIN_EDGE = 180

function computeImageNodeSize(
  dimensions: ImageDimensions | null,
): { width: number; height: number } {
  if (!dimensions || dimensions.width <= 0 || dimensions.height <= 0) {
    return { width: 360, height: 260 }
  }
  const aspect = dimensions.width / dimensions.height
  let bodyWidth: number
  let bodyHeight: number
  if (aspect >= 1) {
    bodyWidth = Math.min(IMAGE_NODE_MAX_EDGE, dimensions.width)
    bodyHeight = Math.max(IMAGE_NODE_MIN_EDGE * 0.6, Math.round(bodyWidth / aspect))
  } else {
    bodyHeight = Math.min(IMAGE_NODE_MAX_EDGE, dimensions.height)
    bodyWidth = Math.max(IMAGE_NODE_MIN_EDGE, Math.round(bodyHeight * aspect))
  }
  return {
    width: Math.round(bodyWidth),
    height: Math.round(bodyHeight) + IMAGE_NODE_HEADER_HEIGHT,
  }
}

/**
 * Write a renderer-generated PNG (stitch, crop, etc.) to disk and
 * record the asset row. Returns the asset along with the pixel
 * dimensions read straight from the file's bytes.
 */
async function writeDerivedCanvasAsset(input: {
  worktreeId: string
  base64Png: string
  kind: "stitched" | "cropped"
  subdir: string
  filenameSuffix: string
}): Promise<{ asset: CanvasAsset; dimensions: ImageDimensions | null }> {
  const { worktreePath } = lookupWorktree(input.worktreeId)
  const buffer = Buffer.from(input.base64Png, "base64")
  if (buffer.byteLength === 0) {
    throw new Error(`${input.kind === "stitched" ? "Stitched" : "Cropped"} image is empty.`)
  }
  const sha256 = createHash("sha256").update(buffer).digest("hex")
  const relativePath = assertSafeRelativePath(
    join(
      "assets",
      "canvas",
      input.subdir,
      `${sha256.slice(0, 12)}--${input.filenameSuffix}`,
    ),
  )
  const destPath = resolveInsideRoot(worktreePath, relativePath)
  await mkdir(join(worktreePath, "assets", "canvas", input.subdir), {
    recursive: true,
  })
  if (!existsSync(destPath)) {
    await writeFile(destPath, buffer)
  }
  const fileStat = await stat(destPath)
  const dimensions = readImageDimensions(buffer)

  const db = getDatabase()
  const assetId = createId("asset")
  db.insert(canvasAssets)
    .values({
      id: assetId,
      worktreeId: input.worktreeId,
      kind: input.kind,
      projectRelativePath: relativePath.split(sep).join("/"),
      mimeType: "image/png",
      byteSize: fileStat.size,
      sha256,
      width: dimensions?.width ?? null,
      height: dimensions?.height ?? null,
      createdAt: now(),
    })
    .run()
  const asset = db.select().from(canvasAssets).where(eq(canvasAssets.id, assetId)).get()!
  return { asset, dimensions }
}

/**
 * Persist a stitched image. The renderer composites the selected image
 * nodes into a single PNG with a `<canvas>` and hands the base64 bytes
 * here; this writes the file under `assets/canvas/stitched/`, records a
 * `stitched` asset row, and drops a plain image node onto the canvas.
 */
export async function saveStitchedImage(input: {
  worktreeId: string
  base64Png: string
  x?: number
  y?: number
  width: number
  height: number
  label?: string
  page?: string
}): Promise<{ asset: CanvasAsset; node: CanvasNode }> {
  const { asset, dimensions } = await writeDerivedCanvasAsset({
    worktreeId: input.worktreeId,
    base64Png: input.base64Png,
    kind: "stitched",
    subdir: "stitched",
    filenameSuffix: "stitch.png",
  })
  const node = createCanvasNode(
    input.worktreeId,
    {
      type: "image",
      x: input.x,
      y: input.y,
      width: input.width,
      height: input.height,
      data: {
        assetId: asset.id,
        label: input.label || "Stitched image",
        projectRelativePath: asset.projectRelativePath,
        mimeType: asset.mimeType,
        stitched: true,
        ...(dimensions
          ? { naturalWidth: dimensions.width, naturalHeight: dimensions.height }
          : {}),
      },
    },
    input.page ?? DEFAULT_CANVAS_NAME,
  )
  return { asset, node }
}

/**
 * Replace the image on an existing image node — drives two operations
 * from the canvas crop overlay:
 *
 * - **crop** (default): keep the pixels inside the selection. The
 *   renderer trims to a chosen region; this writes the trimmed PNG
 *   under `assets/canvas/cropped/`, repoints the node at the new
 *   asset, and resizes the node to the new aspect.
 * - **cutout** (`mode === "cutout"`): keep the pixels outside the
 *   selection. The renderer erases the selection from the original
 *   so the resulting PNG has the same outer dimensions but a hole.
 *   This writes under `assets/canvas/cutout/`, repoints the node, and
 *   leaves the node's width/height untouched — the user often resizes
 *   image nodes by hand and a cutout shouldn't unwind that.
 *
 * Either way the previous asset stays on disk (it's referenced by
 * history and may be the source for other nodes).
 */
export async function replaceImageOnNode(input: {
  worktreeId: string
  nodeId: string
  base64Png: string
  label?: string
  mode?: "crop" | "cutout"
}): Promise<{ asset: CanvasAsset; node: CanvasNode }> {
  const db = getDatabase()
  const existingNode = db
    .select()
    .from(canvasNodes)
    .where(eq(canvasNodes.id, input.nodeId))
    .get()
  if (!existingNode || existingNode.type !== "image") {
    throw new Error(`Image node not found: ${input.nodeId}`)
  }
  const existingData = parseDataJson(existingNode.data)
  const sourceAssetId =
    typeof existingData.assetId === "string" ? existingData.assetId : undefined
  const carriedLabel =
    typeof existingData.label === "string" ? existingData.label : undefined
  const isCutout = input.mode === "cutout"

  const { asset, dimensions } = await writeDerivedCanvasAsset({
    worktreeId: input.worktreeId,
    base64Png: input.base64Png,
    kind: "cropped",
    subdir: isCutout ? "cutout" : "cropped",
    filenameSuffix: isCutout ? "cutout.png" : "crop.png",
  })

  // Crop snaps the node to the trimmed image's aspect (no letterbox).
  // Cutout keeps the existing node size — the image dimensions are
  // unchanged and a manual resize the user did before the crop must
  // survive the operation.
  const nodeSize = isCutout
    ? { width: existingNode.width, height: existingNode.height }
    : computeImageNodeSize(dimensions)
  const node = updateCanvasNode(input.worktreeId, input.nodeId, {
    width: nodeSize.width,
    height: nodeSize.height,
    replaceData: true,
    data: {
      assetId: asset.id,
      label:
        input.label ??
        carriedLabel ??
        (isCutout ? "Cut-out image" : "Cropped image"),
      projectRelativePath: asset.projectRelativePath,
      mimeType: asset.mimeType,
      ...(isCutout ? { cutout: true } : { cropped: true }),
      ...(sourceAssetId ? { sourceAssetId } : {}),
      ...(dimensions
        ? { naturalWidth: dimensions.width, naturalHeight: dimensions.height }
        : {}),
    },
  })

  return { asset, node }
}

export async function generateCanvasImage(input: {
  worktreeId: string
  nodeId: string
  model?: string
  size?: string
  quality?: string
}): Promise<{ runId: string; status: "succeeded" | "failed"; outputAsset: CanvasAsset | null; error: string | null }> {
  const { worktreePath } = lookupWorktree(input.worktreeId)
  const db = getDatabase()
  const node = db
    .select()
    .from(canvasNodes)
    .where(eq(canvasNodes.id, input.nodeId))
    .get()
  if (!node || node.type !== "imageGeneration") {
    throw new Error("Image generation target must be an imageGeneration node.")
  }
  const canvasId = node.canvasId

  const { prompt, inputAssetIds } = resolveGenerationInputs(canvasId, input.nodeId)
  const model = input.model || String(parseDataJson(node.data).model || DEFAULT_IMAGE_MODEL)
  const runId = createId("run")
  const startedAt = now()
  db.insert(canvasGenerationRuns)
    .values({
      id: runId,
      canvasId,
      nodeId: input.nodeId,
      model,
      status: "running",
      prompt,
      inputAssetIds: JSON.stringify(inputAssetIds),
      startedAt,
    })
    .run()
  updateCanvasNode(input.worktreeId, input.nodeId, {
    data: { status: "running", model, lastRunId: runId, error: null },
  })

  try {
    if (!prompt.trim()) {
      throw new Error("Connect a prompt node before running image generation.")
    }
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not set.")
    }

    const imageBuffer = await callOpenAIImageGeneration({
      apiKey,
      model,
      prompt,
      size: input.size,
      quality: input.quality,
    })
    const sha256 = createHash("sha256").update(imageBuffer).digest("hex")
    const relativePath = assertSafeRelativePath(
      join("assets", "canvas", "generated", `${new Date().toISOString().replace(/[:.]/g, "-")}--${input.nodeId}.png`),
    )
    const outputPath = resolveInsideRoot(worktreePath, relativePath)
    await mkdir(join(worktreePath, "assets", "canvas", "generated"), { recursive: true })
    await writeFile(outputPath, imageBuffer)
    const fileStat = await stat(outputPath)

    const assetId = createId("asset")
    db.insert(canvasAssets)
      .values({
        id: assetId,
        worktreeId: input.worktreeId,
        kind: "generated",
        projectRelativePath: relativePath.split(sep).join("/"),
        mimeType: "image/png",
        byteSize: fileStat.size,
        sha256,
        createdAt: now(),
      })
      .run()
    const outputAsset = db.select().from(canvasAssets).where(eq(canvasAssets.id, assetId)).get()!
    db.update(canvasGenerationRuns)
      .set({ status: "succeeded", outputAssetId: outputAsset.id, completedAt: now() })
      .where(eq(canvasGenerationRuns.id, runId))
      .run()
    updateCanvasNode(input.worktreeId, input.nodeId, {
      data: {
        status: "succeeded",
        outputAssetId: outputAsset.id,
        outputPath: outputAsset.projectRelativePath,
        error: null,
      },
    })
    return { runId, status: "succeeded", outputAsset, error: null }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    db.update(canvasGenerationRuns)
      .set({ status: "failed", error: message, completedAt: now() })
      .where(eq(canvasGenerationRuns.id, runId))
      .run()
    updateCanvasNode(input.worktreeId, input.nodeId, {
      data: { status: "failed", error: message },
    })
    return { runId, status: "failed", outputAsset: null, error: message }
  }
}

function resolveGenerationInputs(canvasId: string, nodeId: string): {
  prompt: string
  inputAssetIds: string[]
} {
  const db = getDatabase()
  const incoming = db
    .select()
    .from(canvasEdges)
    .where(and(eq(canvasEdges.canvasId, canvasId), eq(canvasEdges.targetNodeId, nodeId)))
    .all()
  const nodes = db
    .select()
    .from(canvasNodes)
    .where(eq(canvasNodes.canvasId, canvasId))
    .all()

  const promptParts: string[] = []
  const inputAssetIds: string[] = []
  for (const edge of incoming) {
    const source = nodes.find((candidate) => candidate.id === edge.sourceNodeId)
    if (!source) continue
    const data = parseDataJson(source.data)
    if (source.type === "prompt" && edge.targetHandle === "prompt") {
      const text = typeof data.text === "string" ? data.text : ""
      if (text.trim()) promptParts.push(text.trim())
    }
    if (source.type === "image" && edge.targetHandle === "referenceImage") {
      const assetId = typeof data.assetId === "string" ? data.assetId : null
      if (assetId) inputAssetIds.push(assetId)
    }
  }

  return { prompt: promptParts.join("\n\n"), inputAssetIds }
}

async function callOpenAIImageGeneration(input: {
  apiKey: string
  model: string
  prompt: string
  size?: string
  quality?: string
}): Promise<Buffer> {
  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: input.model,
      prompt: input.prompt,
      n: 1,
      size: input.size || "1024x1024",
      ...(input.quality ? { quality: input.quality } : {}),
    }),
  })
  const json = await response.json() as {
    data?: Array<{ b64_json?: string; url?: string }>
    error?: { message?: string }
  }
  if (!response.ok) {
    throw new Error(json.error?.message || `OpenAI image generation failed: ${response.status}`)
  }
  const first = json.data?.[0]
  if (first?.b64_json) {
    return Buffer.from(first.b64_json, "base64")
  }
  if (first?.url) {
    const imageResponse = await fetch(first.url)
    if (!imageResponse.ok) {
      throw new Error(`Failed to download generated image: ${imageResponse.status}`)
    }
    return Buffer.from(await imageResponse.arrayBuffer())
  }
  throw new Error("OpenAI image generation returned no image.")
}
