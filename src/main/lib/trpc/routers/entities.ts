import { existsSync } from "node:fs"
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { eq } from "drizzle-orm"
import simpleGit from "simple-git"
import { z } from "zod"
import { chats, getDatabase } from "../../db"
import { publicProcedure, router } from "../index"

/**
 * Entities router — the backbone of Backlot's project hierarchy.
 *
 * The "AI Screenwriter Super-Weapon" model (see docs/PRD-screenwriter-super-weapon.md):
 *
 *   project-root/
 *     world.md                           — art-direction bible
 *     characters/
 *       <id>.md                          — identity locks
 *     locations/
 *       <id>.md                          — location reference cards
 *     scenes/
 *       <ordered-id>/
 *         scene.fountain                 — this scene's screenplay
 *         shots/
 *           <id>.md                      — shot prompts (start frame, continuation, refs)
 *
 * The filesystem IS the source of truth. No DB tables for entities yet —
 * we walk the worktree on demand and cache cheaply. This keeps the
 * model git-friendly + forkable + matches the existing AI Creatorship
 * OS conventions in laniameda-hq/AI Creatorship/_os/.
 *
 * Once we have data on which entities are read-hot, we can layer a
 * thin DB index on top without changing the filesystem contract.
 */

// ────────────────────────────────────────────────────────────────────────
// Filesystem convention — single source of truth for paths used both
// by the walker (`list`) and the bootstrapper (`bootstrap`). When the
// renderer needs a path (e.g., to send `activeEntityPath` to the agent),
// it MUST construct it via these helpers so we can change the layout
// in one place.
// ────────────────────────────────────────────────────────────────────────

export const ENTITY_PATHS = {
  world: "world.md",
  charactersDir: "characters",
  locationsDir: "locations",
  scenesDir: "scenes",
  shotsSubdir: "shots",
  // Inside a scene folder. Always Fountain — the agent treats it as
  // a screenplay file with the same Edit/diff/accept flow we use for
  // the legacy single-screenplay artifact.
  sceneScript: "scene.fountain",
} as const

export function characterPath(id: string): string {
  return join(ENTITY_PATHS.charactersDir, `${id}.md`)
}
export function locationPath(id: string): string {
  return join(ENTITY_PATHS.locationsDir, `${id}.md`)
}
export function scenePath(id: string): string {
  return join(ENTITY_PATHS.scenesDir, id, ENTITY_PATHS.sceneScript)
}
export function shotPath(sceneId: string, shotId: string): string {
  return join(
    ENTITY_PATHS.scenesDir,
    sceneId,
    ENTITY_PATHS.shotsSubdir,
    `${shotId}.md`,
  )
}

// ────────────────────────────────────────────────────────────────────────
// Entity types returned by `list`. The frontend uses these to drive the
// project tree, the per-entity center pane, and (later) the variants
// strip.
// ────────────────────────────────────────────────────────────────────────

export type EntityKind =
  | "world"
  | "character"
  | "location"
  | "scene"
  | "shot"

export interface WorldEntity {
  kind: "world"
  /** Always "world.md" — there's exactly one world bible per project. */
  path: string
  exists: boolean
}

export interface CharacterEntity {
  kind: "character"
  id: string
  label: string
  /** Relative to worktree root, e.g. "characters/lana.md". */
  path: string
}

export interface LocationEntity {
  kind: "location"
  id: string
  label: string
  path: string
}

export interface ShotEntity {
  kind: "shot"
  id: string
  label: string
  /** Path to the scene this shot belongs to. */
  sceneId: string
  /** Relative path to the shot prompt file. */
  path: string
}

export interface SceneEntity {
  kind: "scene"
  id: string
  label: string
  /** Optional integer extracted from "01-opening" → 1, used for sort + display. */
  order: number | null
  /** Relative path to the scene's screenplay (always Fountain). */
  scriptPath: string
  shots: ShotEntity[]
}

export interface ProjectHierarchy {
  /** True iff the project's filesystem layout exists in some form (any of the dirs / files present). */
  bootstrapped: boolean
  world: WorldEntity
  characters: CharacterEntity[]
  locations: LocationEntity[]
  scenes: SceneEntity[]
}

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

interface WorktreeLookup {
  worktreePath: string | null
}

function lookupWorktree(chatId: string): WorktreeLookup | null {
  const db = getDatabase()
  const row = db
    .select({ worktreePath: chats.worktreePath })
    .from(chats)
    .where(eq(chats.id, chatId))
    .get()
  if (!row) return null
  return { worktreePath: row.worktreePath }
}

/**
 * Convert a filesystem id (e.g. "lana-soto", "01-opening", "shot-03")
 * into a human-readable label.
 *
 *   "lana-soto"      → "Lana Soto"
 *   "01-opening"     → "Opening"          (leading digit-prefix dropped)
 *   "01-warehouse-night" → "Warehouse Night"
 *   "shot-03"        → "Shot 03"          (digit suffix preserved)
 */
function labelFromId(id: string, opts?: { stripLeadingNumber?: boolean }): string {
  const stripLeadingNumber = opts?.stripLeadingNumber ?? false
  const parts = id.split("-")
  let usable = parts
  if (stripLeadingNumber && parts.length > 1 && /^\d+$/.test(parts[0])) {
    usable = parts.slice(1)
  }
  return usable
    .map((p) =>
      // Title-case unless it's all digits (preserve "03").
      /^\d+$/.test(p) ? p : p.charAt(0).toUpperCase() + p.slice(1).toLowerCase(),
    )
    .join(" ")
}

/**
 * Extract a leading numeric prefix from an id (e.g. "01-opening" → 1).
 * Returns null if the id doesn't lead with digits.
 */
function orderFromId(id: string): number | null {
  const m = /^(\d+)-/.exec(id)
  return m ? parseInt(m[1], 10) : null
}

/**
 * List markdown files in a directory, returning their basenames (without
 * extension). Returns [] if the directory doesn't exist. Skips dotfiles
 * and the conventional `.keep` placeholder.
 */
async function listMarkdownIds(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return []
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return []
  }
  return entries
    .filter((name) => name.endsWith(".md") && !name.startsWith(".") && name !== ".keep.md")
    .map((name) => name.slice(0, -".md".length))
    .sort()
}

/**
 * List subdirectories of a path, skipping dotfiles.
 */
async function listSubdirs(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return []
  let entries: string[]
  try {
    entries = await readdir(dir, { withFileTypes: true } as any) as any[]
  } catch {
    return []
  }
  // readdir-with-Dirent returns Dirent[]; readdir-without returns string[].
  // Normalise so we always get { name, isDirectory } shapes.
  const names: string[] = []
  for (const e of entries as any[]) {
    if (typeof e === "string") {
      // Older Node fallback — stat each name.
      try {
        const s = await stat(join(dir, e))
        if (s.isDirectory() && !e.startsWith(".")) names.push(e)
      } catch {
        /* skip */
      }
    } else if (e && typeof e === "object" && "isDirectory" in e) {
      if (e.isDirectory() && !e.name.startsWith(".")) names.push(e.name as string)
    }
  }
  return names.sort()
}

// ────────────────────────────────────────────────────────────────────────
// Bootstrap content — minimal, opinionated starter files. Designed so a
// fresh project has somewhere to land without overwhelming the writer.
// ────────────────────────────────────────────────────────────────────────

const WORLD_PLACEHOLDER = `# World Bible

The art-direction spine of this project. Every prompt eventually
references this — palette, era, lens choices, tone, technology level,
visual references.

Fill in the sections below as the project takes shape.

## Tone

(How does this world *feel*? One paragraph.)

## Visual palette

(Colours, lighting style, material qualities. Reference film stills if
useful.)

## Era + technology

(When + what level of tech?)

## Lens / camera language

(Anamorphic, handheld, locked-off? Default focal length feel?)

## Visual references

(Drag images in here, or reference filenames inside this project.)
`

const CHARACTERS_README = `# Characters

One markdown file per character, named \`<id>.md\`.

Each file is a **lock** — the canonical description that every prompt
referencing this character pastes verbatim. Treat it like a contract:
once locked, don't paraphrase, don't summarise, don't "improve" the
wording — the model reads identical tokens every time so the look stays
consistent.
`

const LOCATIONS_README = `# Locations

One markdown file per location, named \`<id>.md\`.

Each file is a reference card: place name, time-of-day variants,
lighting setup, environment notes, reference images.
`

const SCENES_README = `# Scenes

One folder per scene, named \`<order>-<slug>\` (e.g. \`01-opening\`,
\`02-warehouse-night\`). Inside each scene folder:

- \`scene.fountain\` — the scene's screenplay
- \`shots/<id>.md\` — one prompt thread per shot

The leading number sets the order in the tree.
`

// ────────────────────────────────────────────────────────────────────────
// Router
// ────────────────────────────────────────────────────────────────────────

export const entitiesRouter = router({
  /**
   * Walk the worktree and return the project hierarchy. Cheap — the
   * frontend can poll this freely (it's all readdir + stat, no git
   * operations beyond the implicit worktree resolution).
   */
  list: publicProcedure
    .input(z.object({ chatId: z.string() }))
    .query(async ({ input }): Promise<ProjectHierarchy> => {
      const lookup = lookupWorktree(input.chatId)
      const empty: ProjectHierarchy = {
        bootstrapped: false,
        world: { kind: "world", path: ENTITY_PATHS.world, exists: false },
        characters: [],
        locations: [],
        scenes: [],
      }
      if (!lookup?.worktreePath) return empty

      const root = lookup.worktreePath
      const worldPath = join(root, ENTITY_PATHS.world)
      const charDir = join(root, ENTITY_PATHS.charactersDir)
      const locDir = join(root, ENTITY_PATHS.locationsDir)
      const scenesDir = join(root, ENTITY_PATHS.scenesDir)

      const worldExists = existsSync(worldPath)
      const charIds = await listMarkdownIds(charDir)
      const locIds = await listMarkdownIds(locDir)
      const sceneFolders = await listSubdirs(scenesDir)

      const characters: CharacterEntity[] = charIds.map((id) => ({
        kind: "character",
        id,
        label: labelFromId(id),
        path: characterPath(id),
      }))

      const locations: LocationEntity[] = locIds.map((id) => ({
        kind: "location",
        id,
        label: labelFromId(id),
        path: locationPath(id),
      }))

      const scenes: SceneEntity[] = []
      for (const sceneId of sceneFolders) {
        const sceneFolder = join(scenesDir, sceneId)
        const shotsFolder = join(sceneFolder, ENTITY_PATHS.shotsSubdir)
        const shotIds = await listMarkdownIds(shotsFolder)
        const shots: ShotEntity[] = shotIds.map((shotId) => ({
          kind: "shot",
          id: shotId,
          label: labelFromId(shotId),
          sceneId,
          path: shotPath(sceneId, shotId),
        }))
        scenes.push({
          kind: "scene",
          id: sceneId,
          label: labelFromId(sceneId, { stripLeadingNumber: true }),
          order: orderFromId(sceneId),
          scriptPath: scenePath(sceneId),
          shots,
        })
      }
      // Sort scenes by leading-number prefix; nulls at the end.
      scenes.sort((a, b) => {
        if (a.order != null && b.order != null) return a.order - b.order
        if (a.order != null) return -1
        if (b.order != null) return 1
        return a.id.localeCompare(b.id)
      })

      const bootstrapped =
        worldExists ||
        characters.length > 0 ||
        locations.length > 0 ||
        scenes.length > 0
      return {
        bootstrapped,
        world: { kind: "world", path: ENTITY_PATHS.world, exists: worldExists },
        characters,
        locations,
        scenes,
      }
    }),

  /**
   * Bootstrap the project's filesystem hierarchy. Idempotent — creates
   * any missing folder/file but never overwrites existing content.
   *
   * Commits the resulting layout as a git baseline so subsequent forks
   * have something to base off (matches the auto-init pattern in
   * artifacts.ensurePrimaryArtifact).
   */
  bootstrap: publicProcedure
    .input(z.object({ chatId: z.string() }))
    .mutation(async ({ input }) => {
      const lookup = lookupWorktree(input.chatId)
      if (!lookup?.worktreePath) {
        throw new Error("This chat has no worktree to bootstrap.")
      }
      const root = lookup.worktreePath

      const created: string[] = []
      const ensureFile = async (rel: string, contents: string) => {
        const full = join(root, rel)
        if (existsSync(full)) return
        await mkdir(dirname(full), { recursive: true })
        await writeFile(full, contents, "utf-8")
        created.push(rel)
      }
      const ensureDirReadme = async (relDir: string, readme: string) => {
        const fullDir = join(root, relDir)
        await mkdir(fullDir, { recursive: true })
        const readmePath = join(fullDir, "README.md")
        if (!existsSync(readmePath)) {
          await writeFile(readmePath, readme, "utf-8")
          created.push(join(relDir, "README.md"))
        }
      }

      // World bible — one file at root.
      await ensureFile(ENTITY_PATHS.world, WORLD_PLACEHOLDER)

      // Character / location folders with READMEs that explain the convention.
      await ensureDirReadme(ENTITY_PATHS.charactersDir, CHARACTERS_README)
      await ensureDirReadme(ENTITY_PATHS.locationsDir, LOCATIONS_README)

      // Scenes folder — README only; the user (or the agent) creates
      // scene folders as the script takes shape.
      await ensureDirReadme(ENTITY_PATHS.scenesDir, SCENES_README)

      // Commit as a baseline so forks have a clean root. Mirrors the
      // ensurePrimaryArtifact behaviour: only commits if a HEAD doesn't
      // exist OR there are staged changes for the entity files.
      try {
        const git = simpleGit(root)
        const isRepo = await git.checkIsRepo()
        if (isRepo) {
          // Stage only the files we just created — never blanket-add.
          for (const rel of created) {
            try {
              await git.add([rel])
            } catch {
              /* ignore individual add failures */
            }
          }
          let hasHead = true
          try {
            await git.raw(["rev-parse", "--verify", "HEAD"])
          } catch {
            hasHead = false
          }
          if (created.length > 0 || !hasHead) {
            try {
              await git.raw([
                "commit",
                "--allow-empty",
                "-m",
                "Backlot: bootstrap project hierarchy",
              ])
            } catch (err) {
              console.warn("[entities.bootstrap] commit failed:", err)
            }
          }
        }
      } catch (err) {
        console.warn("[entities.bootstrap] git baseline skipped:", err)
      }

      return { created, count: created.length }
    }),

  /**
   * Read any entity file by relative path. Thin wrapper around fs.readFile
   * scoped to the chat's worktree — the renderer never builds absolute
   * paths, just relative ones returned by `list`.
   */
  read: publicProcedure
    .input(
      z.object({
        chatId: z.string(),
        entityPath: z.string().min(1),
      }),
    )
    .query(async ({ input }) => {
      const lookup = lookupWorktree(input.chatId)
      if (!lookup?.worktreePath) {
        return { exists: false, content: null as string | null }
      }
      const full = join(lookup.worktreePath, input.entityPath)
      // Guard against path-escape attempts. Renderer should only send
      // paths returned by `list`, but a defensive check is cheap.
      if (!full.startsWith(lookup.worktreePath)) {
        throw new Error("Entity path escapes the worktree.")
      }
      if (!existsSync(full)) {
        return { exists: false, content: null }
      }
      const content = await readFile(full, "utf-8")
      return { exists: true, content }
    }),

  /**
   * Write any entity file. Creates parent directories as needed. The
   * renderer hits this for direct user edits to character locks /
   * location cards / world bible / shot prompts. The agent uses the
   * SDK's Edit/Write tools, which write the same files via the same
   * filesystem — both paths converge on git as the version layer.
   */
  write: publicProcedure
    .input(
      z.object({
        chatId: z.string(),
        entityPath: z.string().min(1),
        content: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      const lookup = lookupWorktree(input.chatId)
      if (!lookup?.worktreePath) {
        throw new Error("Chat has no worktree.")
      }
      const full = join(lookup.worktreePath, input.entityPath)
      if (!full.startsWith(lookup.worktreePath)) {
        throw new Error("Entity path escapes the worktree.")
      }
      await mkdir(dirname(full), { recursive: true })
      await writeFile(full, input.content, "utf-8")
      return { written: true, path: input.entityPath }
    }),
})
