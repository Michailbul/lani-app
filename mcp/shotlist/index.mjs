#!/usr/bin/env node
/**
 * Backlot shotlist MCP server.
 *
 * Lets the in-app agent author a per-scene shotlist directly into the
 * writer's worktree. Each scene has its own shotlist file living next to
 * its screenplay: `<scene folder>/shotlist.backlot.json`.
 *
 * The agent addresses a shotlist by the scene's `scriptPath` (the same
 * scene.fountain it is reading). Every tool is an atomic read-modify-write
 * of that JSON file — no database. The Backlot "Shotlist" tab polls the
 * file and renders the agent's work live.
 *
 * The connection back to the screenplay is the shot `number`: the agent
 * also writes that number into scene.fountain as a plain-text marker.
 */
import { existsSync } from "node:fs"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"

const WORKTREE_PATH = process.env.BACKLOT_WORKTREE_PATH || process.cwd()
const SHOTLIST_FILENAME = "shotlist.backlot.json"

/** Resolve a scene's shotlist file from its scriptPath (scene.fountain). */
function resolveScene(scriptPath) {
  if (!scriptPath || !scriptPath.trim()) {
    throw new Error("scriptPath is required (the scene's scene.fountain).")
  }
  const rel = scriptPath.trim()
  if (isAbsolute(rel)) {
    throw new Error(`scriptPath must be project-relative: ${rel}`)
  }
  const sceneDirRel = dirname(rel)
  const shotlistRel = join(sceneDirRel, SHOTLIST_FILENAME)
  const fullPath = resolve(WORKTREE_PATH, shotlistRel)
  const inside = relative(WORKTREE_PATH, fullPath)
  if (inside.startsWith("..") || isAbsolute(inside)) {
    throw new Error(`Scene path escapes the project root: ${rel}`)
  }
  return {
    sceneId: basename(sceneDirRel) || "scene",
    scriptPath: rel,
    shotlistRel,
    fullPath,
  }
}

async function readDoc(fullPath) {
  if (!existsSync(fullPath)) return null
  try {
    return JSON.parse(await readFile(fullPath, "utf-8"))
  } catch (err) {
    throw new Error(`Could not parse shotlist JSON at ${fullPath}: ${err.message}`)
  }
}

async function writeDoc(fullPath, doc) {
  doc.updatedAt = new Date().toISOString()
  await mkdir(dirname(fullPath), { recursive: true })
  const tmp = `${fullPath}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(doc, null, 2) + "\n", "utf-8")
  await rename(tmp, fullPath)
}

function nextShotNumber(doc) {
  let max = 0
  for (const shot of doc.shots) {
    const n = Number.parseInt(shot.number, 10)
    if (Number.isFinite(n) && n > max) max = n
  }
  return String(max + 1)
}

/** Load a scene's shotlist, requiring it to exist. */
async function requireDoc(scene) {
  const doc = await readDoc(scene.fullPath)
  if (!doc) {
    throw new Error(
      `No shotlist for ${scene.scriptPath}. Call shotlist_init first.`,
    )
  }
  return doc
}

// --- Tool implementations -------------------------------------------------

async function shotlistRead(args) {
  const scene = resolveScene(args.scriptPath)
  const doc = await readDoc(scene.fullPath)
  return { exists: Boolean(doc), shotlistPath: scene.shotlistRel, shotlist: doc }
}

async function shotlistInit(args) {
  const scene = resolveScene(args.scriptPath)
  const existing = await readDoc(scene.fullPath)
  const doc = existing || {
    schemaVersion: 1,
    sceneId: scene.sceneId,
    sceneNumber: "",
    heading: "",
    scriptPath: scene.scriptPath,
    shots: [],
    updatedAt: new Date().toISOString(),
  }
  doc.sceneId = scene.sceneId
  doc.scriptPath = scene.scriptPath
  if (args.sceneNumber !== undefined) doc.sceneNumber = String(args.sceneNumber)
  if (args.heading !== undefined) doc.heading = args.heading
  if (args.synopsis !== undefined) doc.synopsis = args.synopsis || undefined
  await writeDoc(scene.fullPath, doc)
  return {
    shotlistPath: scene.shotlistRel,
    created: !existing,
    shotlist: doc,
  }
}

async function shotlistAddShot(args) {
  const scene = resolveScene(args.scriptPath)
  const doc = await requireDoc(scene)
  if (!args.action || !String(args.action).trim()) {
    throw new Error("A shot needs an `action` describing what happens.")
  }
  const number =
    args.number !== undefined && String(args.number).trim()
      ? String(args.number)
      : nextShotNumber(doc)
  const shot = {
    id: `shot-${doc.shots.length + 1}-${Date.now().toString(36)}`,
    number,
    plan: args.plan || "",
    camera: args.camera || "",
    action: String(args.action),
    scriptRef: args.scriptRef || "",
    text: args.text || "",
    tag: args.tag || "",
    status: "draft",
    updatedAt: new Date().toISOString(),
  }
  doc.shots.push(shot)
  await writeDoc(scene.fullPath, doc)
  return { shotlistPath: scene.shotlistRel, shotId: shot.id, shot }
}

async function shotlistUpdateShot(args) {
  const scene = resolveScene(args.scriptPath)
  const doc = await requireDoc(scene)
  const shot = doc.shots.find((s) => s.id === args.shotId)
  if (!shot) {
    throw new Error(`Shot not found in ${scene.scriptPath}: ${args.shotId}`)
  }
  for (const field of [
    "number",
    "plan",
    "camera",
    "action",
    "scriptRef",
    "text",
    "tag",
    "status",
  ]) {
    if (args[field] !== undefined) shot[field] = String(args[field])
  }
  shot.updatedAt = new Date().toISOString()
  await writeDoc(scene.fullPath, doc)
  return { shotlistPath: scene.shotlistRel, shot }
}

async function shotlistRemoveShot(args) {
  const scene = resolveScene(args.scriptPath)
  const doc = await requireDoc(scene)
  const before = doc.shots.length
  doc.shots = doc.shots.filter((s) => s.id !== args.shotId)
  await writeDoc(scene.fullPath, doc)
  return { shotlistPath: scene.shotlistRel, removed: before !== doc.shots.length }
}

// --- Tool registry --------------------------------------------------------

const SCRIPT_PATH_PROP = {
  scriptPath: {
    type: "string",
    description:
      "Project-relative path to the scene's scene.fountain. The shotlist is stored next to it.",
  },
}

const tools = [
  {
    name: "shotlist_read",
    description:
      "Read a scene's shotlist (its ordered shots and prompts). Call this before editing so you build on existing state.",
    inputSchema: {
      type: "object",
      properties: { ...SCRIPT_PATH_PROP },
      required: ["scriptPath"],
    },
  },
  {
    name: "shotlist_init",
    description:
      "Create the shotlist for a scene, or update its scene-level metadata if it already exists. Existing shots are kept. Run this once before adding shots.",
    inputSchema: {
      type: "object",
      properties: {
        ...SCRIPT_PATH_PROP,
        sceneNumber: {
          type: "string",
          description:
            "The scene number. Write the same number into the .fountain so the two stay cross-referenced.",
        },
        heading: {
          type: "string",
          description: "Scene heading, e.g. 'INT. CAFE — DAY'.",
        },
        synopsis: { type: "string", description: "Optional one-line scene synopsis." },
      },
      required: ["scriptPath", "sceneNumber"],
    },
  },
  {
    name: "shotlist_add_shot",
    description:
      "Append a shot to a scene's shotlist. Each shot carries its own generation prompt. The shot `number` is the connection to the screenplay — write the same number into scene.fountain as a plain-text marker.",
    inputSchema: {
      type: "object",
      properties: {
        ...SCRIPT_PATH_PROP,
        number: {
          type: "string",
          description: "Shot number. Omit to auto-assign the next integer.",
        },
        plan: { type: "string", description: "Shot size, e.g. WS, MS, CU, ECU." },
        camera: {
          type: "string",
          description: "Lens + camera move, e.g. '35mm — slow push, handheld'.",
        },
        action: { type: "string", description: "What happens in this shot." },
        scriptRef: {
          type: "string",
          description: "The screenplay beat this shot covers (plain text, for context).",
        },
        text: { type: "string", description: "The generation prompt for this shot." },
        tag: {
          type: "string",
          description: "Short label, e.g. '15s · 21:9'.",
        },
      },
      required: ["scriptPath", "action"],
    },
  },
  {
    name: "shotlist_update_shot",
    description:
      "Update fields on an existing shot — including its prompt `text` and `status` (draft/ready/submitted/generated/approved).",
    inputSchema: {
      type: "object",
      properties: {
        ...SCRIPT_PATH_PROP,
        shotId: { type: "string" },
        number: { type: "string" },
        plan: { type: "string" },
        camera: { type: "string" },
        action: { type: "string" },
        scriptRef: { type: "string" },
        text: { type: "string" },
        tag: { type: "string" },
        status: {
          type: "string",
          enum: ["draft", "ready", "submitted", "generated", "approved"],
        },
      },
      required: ["scriptPath", "shotId"],
    },
  },
  {
    name: "shotlist_remove_shot",
    description: "Remove a shot from a scene's shotlist.",
    inputSchema: {
      type: "object",
      properties: { ...SCRIPT_PATH_PROP, shotId: { type: "string" } },
      required: ["scriptPath", "shotId"],
    },
  },
]

const handlers = {
  shotlist_read: shotlistRead,
  shotlist_init: shotlistInit,
  shotlist_add_shot: shotlistAddShot,
  shotlist_update_shot: shotlistUpdateShot,
  shotlist_remove_shot: shotlistRemoveShot,
}

const server = new Server(
  { name: "backlot-shotlist", version: "0.0.2" },
  { capabilities: { tools: {} } },
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const handler = handlers[request.params.name]
  if (!handler) {
    return {
      isError: true,
      content: [{ type: "text", text: `Unknown tool: ${request.params.name}` }],
    }
  }
  try {
    const result = await handler(request.params.arguments || {})
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }
  } catch (error) {
    return {
      isError: true,
      content: [
        { type: "text", text: error instanceof Error ? error.message : String(error) },
      ],
    }
  }
})

const transport = new StdioServerTransport()
await server.connect(transport)
