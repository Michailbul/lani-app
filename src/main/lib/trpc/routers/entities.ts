import { existsSync } from "node:fs"
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { eq } from "drizzle-orm"
import simpleGit from "simple-git"
import { z } from "zod"
import { chats, getDatabase, projects } from "../../db"
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
  brief: "brief.md",
  world: "world.md",
  // The writer's canonical full screenplay. Edited over time. Independent
  // of any per-scene breakdown — the user can keep both, or just one.
  mainScript: "main-script.fountain",
  // Backwards compat: older Backlot projects used screenplay.fountain.
  // Walker reads either.
  legacyMainScript: "screenplay.fountain",
  charactersDir: "characters",
  locationsDir: "locations",
  // Acts are OPTIONAL — projects may have no acts at all (just flat
  // scenes/), one default act, or many. The walker reports whichever
  // shape exists; the UI never forces creation.
  actsDir: "acts",
  scenesDir: "scenes",
  shotsSubdir: "shots",
  sceneScript: "scene.fountain",
  actNotes: "act.md",
} as const

export function characterPath(id: string): string {
  return join(ENTITY_PATHS.charactersDir, `${id}.md`)
}
export function locationPath(id: string): string {
  return join(ENTITY_PATHS.locationsDir, `${id}.md`)
}
/** Path to a flat scene (no act parent). */
export function scenePath(id: string): string {
  return join(ENTITY_PATHS.scenesDir, id, ENTITY_PATHS.sceneScript)
}
/** Path to a scene inside an act. */
export function sceneInActPath(actId: string, sceneId: string): string {
  return join(
    ENTITY_PATHS.actsDir,
    actId,
    ENTITY_PATHS.scenesDir,
    sceneId,
    ENTITY_PATHS.sceneScript,
  )
}
export function actPath(id: string): string {
  return join(ENTITY_PATHS.actsDir, id, ENTITY_PATHS.actNotes)
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
  | "brief"
  | "world"
  | "main-script"
  | "character"
  | "location"
  | "act"
  | "scene"
  | "shot"

export interface SingletonEntity {
  /** Stable kind for the renderer's switch. */
  kind: "brief" | "world" | "main-script"
  /** Relative path from the worktree root. */
  path: string
  exists: boolean
}

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
  /** When the scene lives under an act: the parent act's id. null = flat (scenes/...). */
  actId: string | null
  shots: ShotEntity[]
}

export interface ActEntity {
  kind: "act"
  id: string
  label: string
  order: number | null
  /** Path to the act's notes file (act.md inside the act folder). */
  notesPath: string
  /** True if the notes file actually exists; false if the folder exists with no act.md yet. */
  notesExist: boolean
}

export interface ProjectHierarchy {
  /** True iff the project's filesystem layout exists in some form (any of the dirs / files present). */
  bootstrapped: boolean
  brief: SingletonEntity
  world: SingletonEntity
  mainScript: SingletonEntity
  characters: CharacterEntity[]
  locations: LocationEntity[]
  /** Acts present in the project. Empty when the user hasn't grouped scenes into acts. */
  acts: ActEntity[]
  /** Every scene in the project — flat or under an act. Caller groups by `actId`. */
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
 * Resolve the filesystem root that an entity-router procedure should
 * operate against. Two flavours:
 *
 *   1. **Chat-scoped** (`chatId`) — the chat's worktree. Edits go to
 *      the per-chat fork; the agent and the user work on the same tree.
 *      Default mode while a chat is active.
 *
 *   2. **Project-scoped** (`projectId`) — the canonical project at
 *      `~/.backlot/projects/<slug>/`. Used when no chat has been
 *      started yet (the user is browsing the project home view) and
 *      we still want the file tree + editor to work. Edits land
 *      directly on the canonical project.
 *
 * Exactly one of `chatId` / `projectId` must be supplied. Returns
 * `{ root: null }` when neither resolves; callers decide whether to
 * surface that as an empty tree, a placeholder, or an error.
 */
interface RootLookup {
  root: string | null
  kind: "worktree" | "project" | null
}

function resolveRoot(input: {
  chatId?: string | null
  projectId?: string | null
}): RootLookup {
  if (input.chatId) {
    const lookup = lookupWorktree(input.chatId)
    return {
      root: lookup?.worktreePath ?? null,
      kind: lookup?.worktreePath ? "worktree" : null,
    }
  }
  if (input.projectId) {
    const db = getDatabase()
    const row = db
      .select({ path: projects.path })
      .from(projects)
      .where(eq(projects.id, input.projectId))
      .get()
    return { root: row?.path ?? null, kind: row?.path ? "project" : null }
  }
  return { root: null, kind: null }
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
    .filter(
      (name) =>
        name.endsWith(".md") &&
        !name.startsWith(".") &&
        name !== ".keep.md" &&
        // README.md is folder-level documentation, not an entity. Same for
        // any case-variant that the bootstrap or the user might create.
        name.toLowerCase() !== "readme.md",
    )
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
      const emptySingleton = (kind: "brief" | "world" | "main-script", path: string): SingletonEntity => ({
        kind,
        path,
        exists: false,
      })
      const empty: ProjectHierarchy = {
        bootstrapped: false,
        brief: emptySingleton("brief", ENTITY_PATHS.brief),
        world: emptySingleton("world", ENTITY_PATHS.world),
        mainScript: emptySingleton("main-script", ENTITY_PATHS.mainScript),
        characters: [],
        locations: [],
        acts: [],
        scenes: [],
      }
      if (!lookup?.worktreePath) return empty

      const root = lookup.worktreePath

      // Singletons at root.
      const briefPath = join(root, ENTITY_PATHS.brief)
      const worldPath = join(root, ENTITY_PATHS.world)
      const mainScriptPath = join(root, ENTITY_PATHS.mainScript)
      const legacyMainScriptPath = join(root, ENTITY_PATHS.legacyMainScript)

      // Prefer main-script.fountain if present; otherwise fall back to
      // the legacy screenplay.fountain so older projects still surface
      // their full screenplay in the tree without forcing a rename.
      let mainScriptResolvedPath: string = ENTITY_PATHS.mainScript
      let mainScriptExists = existsSync(mainScriptPath)
      if (!mainScriptExists && existsSync(legacyMainScriptPath)) {
        mainScriptResolvedPath = ENTITY_PATHS.legacyMainScript
        mainScriptExists = true
      }

      const charDir = join(root, ENTITY_PATHS.charactersDir)
      const locDir = join(root, ENTITY_PATHS.locationsDir)

      const briefExists = existsSync(briefPath)
      const worldExists = existsSync(worldPath)
      const charIds = await listMarkdownIds(charDir)
      const locIds = await listMarkdownIds(locDir)

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

      // Walk acts/ if it exists. Each act is a folder under acts/; inside
      // each act folder, scenes live at scenes/<sceneId>/scene.fountain.
      const actsDir = join(root, ENTITY_PATHS.actsDir)
      const actFolders = await listSubdirs(actsDir)
      const acts: ActEntity[] = []
      const scenes: SceneEntity[] = []

      for (const actId of actFolders) {
        const actFolder = join(actsDir, actId)
        const actNotesPath = join(actFolder, ENTITY_PATHS.actNotes)
        acts.push({
          kind: "act",
          id: actId,
          label: labelFromId(actId, { stripLeadingNumber: true }),
          order: orderFromId(actId),
          notesPath: actPath(actId),
          notesExist: existsSync(actNotesPath),
        })
        const actScenesDir = join(actFolder, ENTITY_PATHS.scenesDir)
        const actSceneFolders = await listSubdirs(actScenesDir)
        for (const sceneId of actSceneFolders) {
          const sceneFolder = join(actScenesDir, sceneId)
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
            scriptPath: sceneInActPath(actId, sceneId),
            actId,
            shots,
          })
        }
      }

      // Walk flat scenes/ (no act parent).
      const flatScenesDir = join(root, ENTITY_PATHS.scenesDir)
      const flatSceneFolders = await listSubdirs(flatScenesDir)
      for (const sceneId of flatSceneFolders) {
        const sceneFolder = join(flatScenesDir, sceneId)
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
          actId: null,
          shots,
        })
      }

      // Sort: scenes by leading-number prefix within each act/flat group.
      scenes.sort((a, b) => {
        // Same group (same actId or both null) → order by number then id
        if (a.actId === b.actId) {
          if (a.order != null && b.order != null) return a.order - b.order
          if (a.order != null) return -1
          if (b.order != null) return 1
          return a.id.localeCompare(b.id)
        }
        // Otherwise stable — caller groups by actId before rendering anyway
        return 0
      })
      acts.sort((a, b) => {
        if (a.order != null && b.order != null) return a.order - b.order
        if (a.order != null) return -1
        if (b.order != null) return 1
        return a.id.localeCompare(b.id)
      })

      const bootstrapped =
        briefExists ||
        worldExists ||
        mainScriptExists ||
        characters.length > 0 ||
        locations.length > 0 ||
        acts.length > 0 ||
        scenes.length > 0
      return {
        bootstrapped,
        brief: { kind: "brief", path: ENTITY_PATHS.brief, exists: briefExists },
        world: { kind: "world", path: ENTITY_PATHS.world, exists: worldExists },
        mainScript: {
          kind: "main-script",
          path: mainScriptResolvedPath,
          exists: mainScriptExists,
        },
        characters,
        locations,
        acts,
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
        chatId: z.string().optional(),
        projectId: z.string().optional(),
        entityPath: z.string().min(1),
      }),
    )
    .query(async ({ input }) => {
      const { root } = resolveRoot(input)
      if (!root) {
        return { exists: false, content: null as string | null }
      }
      const full = join(root, input.entityPath)
      // Guard against path-escape attempts. Renderer should only send
      // paths returned by `list`, but a defensive check is cheap.
      if (!full.startsWith(root)) {
        throw new Error("Entity path escapes the root.")
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
        chatId: z.string().optional(),
        projectId: z.string().optional(),
        entityPath: z.string().min(1),
        content: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      const { root } = resolveRoot(input)
      if (!root) {
        throw new Error("No worktree or project root resolved.")
      }
      const full = join(root, input.entityPath)
      if (!full.startsWith(root)) {
        throw new Error("Entity path escapes the root.")
      }
      await mkdir(dirname(full), { recursive: true })
      await writeFile(full, input.content, "utf-8")
      return { written: true, path: input.entityPath }
    }),

  /**
   * Walk the worktree and return a recursive folder/file tree, skipping
   * developer noise (.git, node_modules, build artefacts). The renderer
   * uses this for the Cursor-style ProjectFileTree — generic, not
   * coupled to the canonical schema. Files keep their full names with
   * extensions so the tree reads exactly like what's on disk.
   *
   * Folders sort alphabetically before files; everything is sorted by
   * leading-numeric prefix where present (so "01-opening" comes before
   * "02-cafe-talk") then by name.
   */
  listTree: publicProcedure
    .input(
      z.object({
        chatId: z.string().optional(),
        projectId: z.string().optional(),
      }),
    )
    .query(async ({ input }): Promise<TreeNode | null> => {
      const { root } = resolveRoot(input)
      if (!root) return null
      return walkTree(root, "")
    }),

  /**
   * Create a new empty file (or with starter content) at an arbitrary
   * relative path inside the worktree. Refuses if the target already
   * exists — frontends should append "-2" / "-copy" themselves to
   * avoid silent overwrites. Parent directories are created as needed.
   */
  createFile: publicProcedure
    .input(
      z.object({
        chatId: z.string().optional(),
        projectId: z.string().optional(),
        path: z.string().min(1),
        content: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const { root } = resolveRoot(input)
      if (!root) {
        throw new Error("No worktree or project root resolved.")
      }
      const full = join(root, input.path)
      if (!full.startsWith(root)) {
        throw new Error("Path escapes the root.")
      }
      if (existsSync(full)) {
        throw new Error(`File already exists: ${input.path}`)
      }
      await mkdir(dirname(full), { recursive: true })
      await writeFile(full, input.content ?? "", "utf-8")
      return { created: true, path: input.path }
    }),

  /**
   * Create a new folder at an arbitrary relative path. Adds a `.keep`
   * placeholder file so the empty folder is committable (git ignores
   * truly-empty folders). The placeholder is conventional in this
   * codebase — the walker skips files starting with a dot.
   */
  createFolder: publicProcedure
    .input(
      z.object({
        chatId: z.string().optional(),
        projectId: z.string().optional(),
        path: z.string().min(1),
      }),
    )
    .mutation(async ({ input }) => {
      const { root } = resolveRoot(input)
      if (!root) {
        throw new Error("No worktree or project root resolved.")
      }
      const full = join(root, input.path)
      if (!full.startsWith(root)) {
        throw new Error("Path escapes the root.")
      }
      if (existsSync(full)) {
        throw new Error(`Folder already exists: ${input.path}`)
      }
      await mkdir(full, { recursive: true })
      // Placeholder so git can track the otherwise-empty folder.
      await writeFile(join(full, ".keep"), "", "utf-8")
      return { created: true, path: input.path }
    }),

  /**
   * Delete a file or folder under the project/worktree root. Folders
   * are removed recursively. The root itself is refused (path === "")
   * so a stray empty input can't wipe the project. Anything outside
   * the resolved root is refused too.
   */
  delete: publicProcedure
    .input(
      z.object({
        chatId: z.string().optional(),
        projectId: z.string().optional(),
        path: z.string().min(1),
      }),
    )
    .mutation(async ({ input }) => {
      const { root } = resolveRoot(input)
      if (!root) {
        throw new Error("No worktree or project root resolved.")
      }
      const full = join(root, input.path)
      if (!full.startsWith(root) || full === root) {
        throw new Error("Path escapes the root.")
      }
      if (!existsSync(full)) {
        throw new Error(`Path does not exist: ${input.path}`)
      }
      await rm(full, { recursive: true, force: true })
      return { deleted: true, path: input.path }
    }),
})

// ────────────────────────────────────────────────────────────────────────
// Tree walker — generic file-system view used by the Cursor-style
// ProjectFileTree on the renderer. Lives down here so the public
// router stays the visual focus of the file.
// ────────────────────────────────────────────────────────────────────────

export interface TreeNode {
  kind: "folder" | "file"
  /** Display name (basename). Files keep their extension. */
  name: string
  /** Path relative to the worktree root. The root itself is "". */
  path: string
  /** Only present on folders. Sorted: folders before files, then by leading-numeric prefix, then by name. */
  children?: TreeNode[]
}

/** Names the walker NEVER descends into / NEVER lists. Mirrors the import allowlist. */
const TREE_EXCLUDE = new Set([
  ".git",
  ".DS_Store",
  "node_modules",
  ".next",
  ".turbo",
  ".cache",
  "dist",
  "build",
  "out",
  ".venv",
  "venv",
  "__pycache__",
  ".pytest_cache",
  "target",
  ".gradle",
])

/**
 * Sort entries: folders before files, then by leading-numeric prefix
 * ("01-foo" → 1) so scene folders read in story order, then by name.
 */
function sortTreeEntries(a: TreeNode, b: TreeNode): number {
  if (a.kind !== b.kind) {
    return a.kind === "folder" ? -1 : 1
  }
  const orderA = orderFromId(a.name)
  const orderB = orderFromId(b.name)
  if (orderA !== null && orderB !== null && orderA !== orderB) {
    return orderA - orderB
  }
  if (orderA !== null && orderB === null) return -1
  if (orderA === null && orderB !== null) return 1
  return a.name.localeCompare(b.name)
}

async function walkTree(absRoot: string, relPath: string): Promise<TreeNode> {
  const absPath = relPath ? join(absRoot, relPath) : absRoot
  const name = relPath ? relPath.split("/").pop()! : ""

  let entries: Array<{ name: string; isDir: boolean }> = []
  try {
    const raw = await readdir(absPath, { withFileTypes: true } as any) as any[]
    entries = raw
      .map((e: any) => {
        if (typeof e === "string") {
          // Older Node fallback — should be rare on Electron 39.
          return { name: e, isDir: false }
        }
        return { name: e.name as string, isDir: e.isDirectory() }
      })
      .filter((e) => !TREE_EXCLUDE.has(e.name))
      // Hide dotfiles by convention (matches Cursor / VS Code's "show hidden" off).
      .filter((e) => !e.name.startsWith("."))
  } catch {
    return { kind: "folder", name, path: relPath, children: [] }
  }

  const children: TreeNode[] = []
  for (const e of entries) {
    const childRel = relPath ? `${relPath}/${e.name}` : e.name
    if (e.isDir) {
      children.push(await walkTree(absRoot, childRel))
    } else {
      children.push({ kind: "file", name: e.name, path: childRel })
    }
  }
  children.sort(sortTreeEntries)

  return { kind: "folder", name, path: relPath, children }
}
