import { createHash, randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises"
import { basename, extname, isAbsolute, join, normalize, relative, sep } from "node:path"
import { and, eq } from "drizzle-orm"
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
export const DEFAULT_IMAGE_MODEL = process.env.BACKLOT_CANVAS_IMAGE_MODEL || "gpt-image-2"

export type CanvasNodeType = "prompt" | "image" | "imageGeneration"
export type CanvasAssetKind = "imported" | "generated"

export interface CanvasDocumentSnapshot {
  document: CanvasDocument
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

  return { document, nodes, edges, assets }
}

export function createCanvasNode(worktreeId: string, input: CanvasNodeInput): CanvasNode {
  const document = ensureCanvasDocument(worktreeId)
  const db = getDatabase()
  const id = createId("node")
  const created = now()
  db.insert(canvasNodes)
    .values({
      id,
      canvasId: document.id,
      type: input.type,
      x: input.x ?? 0,
      y: input.y ?? 0,
      width: input.width ?? (input.type === "prompt" ? 520 : 420),
      height: input.height ?? (input.type === "prompt" ? 320 : 300),
      data: stringifyData(input.data),
      locked: input.locked ?? false,
      createdAt: created,
      updatedAt: created,
    })
    .run()
  return db.select().from(canvasNodes).where(eq(canvasNodes.id, id)).get()!
}

export function updateCanvasNode(worktreeId: string, nodeId: string, patch: CanvasNodePatch): CanvasNode {
  const document = ensureCanvasDocument(worktreeId)
  const db = getDatabase()
  const existing = db
    .select()
    .from(canvasNodes)
    .where(and(eq(canvasNodes.id, nodeId), eq(canvasNodes.canvasId, document.id)))
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
    .where(and(eq(canvasNodes.id, nodeId), eq(canvasNodes.canvasId, document.id)))
    .run()

  db.update(canvasDocuments)
    .set({ updatedAt: now() })
    .where(eq(canvasDocuments.id, document.id))
    .run()

  return db.select().from(canvasNodes).where(eq(canvasNodes.id, nodeId)).get()!
}

export function deleteCanvasNode(worktreeId: string, nodeId: string): { deleted: boolean } {
  const document = ensureCanvasDocument(worktreeId)
  const db = getDatabase()
  const result = db
    .delete(canvasNodes)
    .where(and(eq(canvasNodes.id, nodeId), eq(canvasNodes.canvasId, document.id)))
    .run()
  db.update(canvasDocuments)
    .set({ updatedAt: now() })
    .where(eq(canvasDocuments.id, document.id))
    .run()
  return { deleted: result.changes > 0 }
}

export function connectCanvasNodes(worktreeId: string, input: CanvasEdgeInput): CanvasEdge {
  const document = ensureCanvasDocument(worktreeId)
  const db = getDatabase()
  const nodes = db
    .select()
    .from(canvasNodes)
    .where(eq(canvasNodes.canvasId, document.id))
    .all()
  const source = nodes.find((node) => node.id === input.sourceNodeId)
  const target = nodes.find((node) => node.id === input.targetNodeId)
  if (!source || !target) throw new Error("Canvas edge endpoints must exist in the same canvas.")
  validateConnection(source.type as CanvasNodeType, input.sourceHandle, target.type as CanvasNodeType, input.targetHandle)

  const existing = db
    .select()
    .from(canvasEdges)
    .where(
      and(
        eq(canvasEdges.canvasId, document.id),
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
    .values({ id, canvasId: document.id, ...input, createdAt: now() })
    .run()
  db.update(canvasDocuments)
    .set({ updatedAt: now() })
    .where(eq(canvasDocuments.id, document.id))
    .run()
  return db.select().from(canvasEdges).where(eq(canvasEdges.id, id)).get()!
}

export function disconnectCanvasEdge(worktreeId: string, edgeId: string): { deleted: boolean } {
  const document = ensureCanvasDocument(worktreeId)
  const db = getDatabase()
  const result = db
    .delete(canvasEdges)
    .where(and(eq(canvasEdges.id, edgeId), eq(canvasEdges.canvasId, document.id)))
    .run()
  db.update(canvasDocuments)
    .set({ updatedAt: now() })
    .where(eq(canvasDocuments.id, document.id))
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
      createdAt: now(),
    })
    .run()
  const asset = db.select().from(canvasAssets).where(eq(canvasAssets.id, assetId)).get()!
  const node = input.createNode === false
    ? null
    : createCanvasNode(input.worktreeId, {
        type: "image",
        x: input.x,
        y: input.y,
        width: 360,
        height: 260,
        data: {
          assetId: asset.id,
          label: input.label || basename(sourcePath),
          projectRelativePath: asset.projectRelativePath,
          mimeType: asset.mimeType,
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
  const document = ensureCanvasDocument(input.worktreeId)
  const db = getDatabase()
  const node = db
    .select()
    .from(canvasNodes)
    .where(and(eq(canvasNodes.id, input.nodeId), eq(canvasNodes.canvasId, document.id)))
    .get()
  if (!node || node.type !== "imageGeneration") {
    throw new Error("Image generation target must be an imageGeneration node.")
  }

  const { prompt, inputAssetIds } = resolveGenerationInputs(document.id, input.nodeId)
  const model = input.model || String(parseDataJson(node.data).model || DEFAULT_IMAGE_MODEL)
  const runId = createId("run")
  const startedAt = now()
  db.insert(canvasGenerationRuns)
    .values({
      id: runId,
      canvasId: document.id,
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
