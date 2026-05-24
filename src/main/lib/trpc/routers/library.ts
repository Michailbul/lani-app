/**
 * Library router — folder-scan, two-tier (studio + project).
 *
 * Each entry is a folder. There is no JSON index. The router scans
 *
 *   ~/.lani/library/<id>/                  (studio, project-agnostic)
 *   <project|worktree>/library-media/<id>/    (project-scoped)
 *
 * Reads each folder's `workflow.md`, parses the YAML frontmatter for
 * the entry's metadata, and lists the remaining image files as
 * reference examples. Cover defaults to the frontmatter `cover:`
 * field, or the first image alphabetically when absent.
 *
 * When an id collides across tiers the project entry wins — the
 * studio version is silently hidden as long as a project shadow
 * exists.
 */

import { existsSync } from "node:fs"
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import { homedir } from "node:os"
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path"
import { eq } from "drizzle-orm"
import simpleGit from "simple-git"
import { z } from "zod"
import { chats, getDatabase, projects } from "../../db"
import { IMAGE_EXTENSIONS, uniqueDestination } from "../../media-utils"
import {
  buildMarkdownBody,
  LIBRARY_IMAGE_EXTENSIONS,
  LIBRARY_MARKDOWN_FILE,
  LIBRARY_PROJECT_DIR,
  parseLibraryFrontmatter,
  type LibraryItem,
  type LibraryItemKind,
  type LibrarySource,
} from "../../../../shared/library-types"
import { publicProcedure, router } from "../index"

type RootInput = {
  chatId?: string | null
  projectId?: string | null
}

// Absolute filesystem location of the studio (global) library.
const STUDIO_LIBRARY_DIR = join(homedir(), ".lani", "library")
// Absolute filesystem location of the global skill library used by
// the "promote to skill" flow.
const SKILLS_DIR = join(homedir(), ".lani", "skills")

function resolveProjectRoot(input: RootInput): {
  root: string | null
  kind: "worktree" | "project" | null
} {
  const db = getDatabase()
  if (input.chatId) {
    const row = db
      .select({ worktreePath: chats.worktreePath })
      .from(chats)
      .where(eq(chats.id, input.chatId))
      .get()
    return {
      root: row?.worktreePath ?? null,
      kind: row?.worktreePath ? "worktree" : null,
    }
  }
  if (input.projectId) {
    const row = db
      .select({ path: projects.path })
      .from(projects)
      .where(eq(projects.id, input.projectId))
      .get()
    return { root: row?.path ?? null, kind: row?.path ? "project" : null }
  }
  return { root: null, kind: null }
}

/** Where a given tier lives on disk for this caller. */
function tierDir(source: LibrarySource, projectRoot: string | null): string | null {
  if (source === "studio") return STUDIO_LIBRARY_DIR
  if (!projectRoot) return null
  return join(projectRoot, LIBRARY_PROJECT_DIR)
}

/** Map an arbitrary string id to a safe slug. Used for new entries. */
function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

/** Mint a folder name that doesn't collide with existing ids in `taken`. */
function mintId(title: string, taken: Set<string>): string {
  const slug = slugify(title) || `lib-${Date.now().toString(36)}`
  let id = slug
  let n = 2
  while (taken.has(id)) {
    id = `${slug}-${n}`
    n += 1
  }
  return id
}

/** True if a filename's extension marks it as a library image. */
function isLibraryImage(name: string): boolean {
  const ext = extname(name).toLowerCase().replace(/^\./, "")
  return (LIBRARY_IMAGE_EXTENSIONS as readonly string[]).includes(ext)
}

const VALID_KINDS: readonly LibraryItemKind[] = [
  "workflow",
  "character-sheet",
  "prompt",
]

/**
 * Scan one tier directory and return its entries. Silently returns
 * an empty list when the tier directory is absent — both tiers are
 * lazy-created (only on first add). Per-entry parse errors are
 * caught and surface as "this folder is on disk but has no
 * workflow.md", which the gallery hides.
 */
async function scanTier(
  source: LibrarySource,
  dir: string,
): Promise<LibraryItem[]> {
  if (!existsSync(dir)) return []
  let names: string[]
  try {
    names = await readdir(dir, { withFileTypes: true }).then((entries) =>
      entries.filter((e) => e.isDirectory()).map((e) => e.name),
    )
  } catch {
    return []
  }
  const items: LibraryItem[] = []
  for (const id of names) {
    if (id.startsWith(".")) continue
    const folderPath = join(dir, id)
    const markdownPath = join(folderPath, LIBRARY_MARKDOWN_FILE)
    if (!existsSync(markdownPath)) continue
    try {
      const raw = await readFile(markdownPath, "utf-8")
      const { data } = parseLibraryFrontmatter(raw)
      const kind =
        typeof data.kind === "string" &&
        VALID_KINDS.includes(data.kind as LibraryItemKind)
          ? (data.kind as LibraryItemKind)
          : "workflow"
      const title =
        (typeof data.title === "string" && data.title.trim()) || id
      const subtitle =
        typeof data.subtitle === "string" && data.subtitle.trim()
          ? data.subtitle.trim()
          : undefined
      const tags = Array.isArray(data.tags)
        ? (data.tags as unknown[])
            .map((t) => String(t).trim())
            .filter((t) => t.length > 0)
        : []

      // Discover image files in the folder.
      const folderEntries = await readdir(folderPath, { withFileTypes: true })
      const referenceImages = folderEntries
        .filter((e) => e.isFile())
        .map((e) => e.name)
        .filter((n) => !n.startsWith(".") && isLibraryImage(n))
        .sort((a, b) => a.localeCompare(b))

      const frontmatterCover =
        typeof data.cover === "string" ? data.cover.trim() : ""
      const coverImage = referenceImages.includes(frontmatterCover)
        ? frontmatterCover
        : referenceImages[0]

      const folderStat = await stat(folderPath)
      const fileStat = await stat(markdownPath)

      items.push({
        source,
        id,
        kind,
        title,
        ...(subtitle ? { subtitle } : {}),
        tags,
        ...(coverImage ? { coverImage } : {}),
        referenceImages,
        folderPath,
        markdownPath,
        addedAt: folderStat.birthtime.toISOString(),
        updatedAt: fileStat.mtime.toISOString(),
      })
    } catch (err) {
      console.warn(`[library] failed to read ${markdownPath}:`, err)
      continue
    }
  }
  return items
}

/**
 * Apply the "project shadows studio" precedence rule. When the
 * project tier carries an entry with the same id as the studio
 * tier, drop the studio copy from the merged list.
 */
function mergeTiers(
  studio: LibraryItem[],
  project: LibraryItem[],
): LibraryItem[] {
  const projectIds = new Set(project.map((i) => i.id))
  return [
    ...studio.filter((i) => !projectIds.has(i.id)),
    ...project,
  ].sort((a, b) => a.title.localeCompare(b.title))
}

/** Settle a folder edit as a git commit on the relevant tier. */
async function settleProjectEdit(
  root: string,
  paths: string[],
): Promise<void> {
  if (paths.length === 0) return
  try {
    const git = simpleGit(root)
    if (!(await git.checkIsRepo())) return
    const porcelain = await git.raw(["status", "--porcelain", "--", ...paths])
    if (!porcelain.trim()) return
    await git.add(paths)
    await git.commit("Lani: update library", paths)
  } catch (err) {
    console.warn("[library] edit settlement skipped:", err)
  }
}

/** Resolve and verify a tier directory, throwing if unset. */
function resolveTier(input: RootInput, source: LibrarySource): string {
  const { root } = resolveProjectRoot(input)
  const dir = tierDir(source, root)
  if (!dir) {
    throw new Error(
      source === "studio"
        ? "Studio library directory unavailable."
        : "No project root or worktree resolved.",
    )
  }
  return dir
}

const rootInput = {
  chatId: z.string().optional(),
  projectId: z.string().optional(),
}
const sourceSchema = z.enum(["studio", "project"])

/**
 * Copy one or more source images into an entry's folder. Returns
 * the filenames that landed in the folder.
 */
async function copyImagesInto(
  folder: string,
  sources: string[],
): Promise<string[]> {
  if (sources.length === 0) return []
  await mkdir(folder, { recursive: true })
  const copied: string[] = []
  for (const src of sources) {
    if (!src.trim()) continue
    if (!isAbsolute(src)) continue
    if (!existsSync(src)) continue
    const ext = extname(src).toLowerCase().replace(/^\./, "")
    if (!IMAGE_EXTENSIONS.includes(ext)) continue
    const destination = uniqueDestination(folder, basename(src))
    await copyFile(src, destination)
    copied.push(basename(destination))
  }
  return copied
}

/**
 * Update the `cover:` frontmatter field of an entry's workflow.md
 * without otherwise touching the file. No-op when the frontmatter
 * already matches; ensures the field is created when absent.
 */
async function setFrontmatterCover(
  markdownPath: string,
  cover: string | null,
): Promise<void> {
  if (!existsSync(markdownPath)) return
  const content = await readFile(markdownPath, "utf-8")
  const { data, body } = parseLibraryFrontmatter(content)
  if (cover === null) {
    delete (data as Record<string, unknown>).cover
  } else {
    ;(data as Record<string, unknown>).cover = cover
  }

  // Re-emit a clean frontmatter block in our shipped key order.
  const ORDER = ["id", "kind", "title", "subtitle", "tags", "cover"]
  const lines: string[] = ["---"]
  for (const key of ORDER) {
    if (data[key] === undefined) continue
    const value = data[key]
    if (Array.isArray(value)) {
      lines.push(
        `${key}: [${value
          .map((v) => formatYamlValue(String(v)))
          .join(", ")}]`,
      )
    } else {
      lines.push(`${key}: ${formatYamlValue(String(value))}`)
    }
  }
  for (const [key, value] of Object.entries(data)) {
    if (ORDER.includes(key)) continue
    if (Array.isArray(value)) {
      lines.push(
        `${key}: [${value
          .map((v) => formatYamlValue(String(v)))
          .join(", ")}]`,
      )
    } else if (value !== undefined && value !== null) {
      lines.push(`${key}: ${formatYamlValue(String(value))}`)
    }
  }
  lines.push("---")
  const next = `${lines.join("\n")}\n\n${body.trimStart()}`
  await writeFile(markdownPath, next, "utf-8")
}

function formatYamlValue(value: string): string {
  if (/^[A-Za-z0-9 _\-]+$/.test(value)) return value
  return `"${value.replace(/"/g, '\\"')}"`
}

export const libraryRouter = router({
  /**
   * List all entries the caller can see: studio entries the local
   * machine has, plus project-scoped entries (when a project root
   * was resolved). Project entries shadow studio entries with the
   * same id.
   */
  list: publicProcedure
    .input(z.object({ ...rootInput }))
    .query(async ({ input }) => {
      const { root } = resolveProjectRoot(input)
      const studio = await scanTier("studio", STUDIO_LIBRARY_DIR)
      const project = root
        ? await scanTier("project", join(root, LIBRARY_PROJECT_DIR))
        : []
      return {
        items: mergeTiers(studio, project),
        studioPath: STUDIO_LIBRARY_DIR,
        ...(root ? { projectLibraryPath: join(root, LIBRARY_PROJECT_DIR) } : {}),
      }
    }),

  /** Read one entry's markdown body. */
  readMarkdown: publicProcedure
    .input(
      z.object({
        ...rootInput,
        source: sourceSchema,
        itemId: z.string().min(1),
      }),
    )
    .query(async ({ input }) => {
      const dir = tierDir(input.source, resolveProjectRoot(input).root)
      if (!dir) return { exists: false as const, body: null as string | null }
      const markdownPath = join(dir, input.itemId, LIBRARY_MARKDOWN_FILE)
      if (!existsSync(markdownPath)) {
        return { exists: false as const, body: null }
      }
      try {
        const body = await readFile(markdownPath, "utf-8")
        return { exists: true as const, body }
      } catch {
        return { exists: false as const, body: null }
      }
    }),

  /** Write an entry's markdown body verbatim. */
  writeMarkdown: publicProcedure
    .input(
      z.object({
        ...rootInput,
        source: sourceSchema,
        itemId: z.string().min(1),
        body: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      const { root } = resolveProjectRoot(input)
      const dir = tierDir(input.source, root)
      if (!dir) throw new Error("Tier directory unavailable.")
      const folder = join(dir, input.itemId)
      const markdownPath = join(folder, LIBRARY_MARKDOWN_FILE)
      await mkdir(folder, { recursive: true })
      await writeFile(markdownPath, input.body, "utf-8")
      if (input.source === "project" && root) {
        await settleProjectEdit(root, [
          join(LIBRARY_PROJECT_DIR, input.itemId),
        ])
      }
      return { written: true as const }
    }),

  /** Add a new entry to the chosen tier. */
  addEntry: publicProcedure
    .input(
      z.object({
        ...rootInput,
        source: sourceSchema,
        kind: z.enum(["workflow", "character-sheet", "prompt"]),
        title: z.string().min(1),
        subtitle: z.string().optional(),
        description: z.string().optional(),
        agentInstructions: z.string().optional(),
        characterSheetPrompt: z.string().optional(),
        seedancePrompt: z.string().optional(),
        notes: z.string().optional(),
        tags: z.array(z.string()).default([]),
        sourceImages: z.array(z.string()).default([]),
        coverIndex: z.number().int().nonnegative().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const { root } = resolveProjectRoot(input)
      const dir = tierDir(input.source, root)
      if (!dir) throw new Error("Tier directory unavailable.")
      await mkdir(dir, { recursive: true })

      // Mint an id that doesn't collide with existing entries.
      const existing = await readdir(dir, { withFileTypes: true }).then(
        (entries) => entries.filter((e) => e.isDirectory()).map((e) => e.name),
      ).catch(() => [] as string[])
      const id = mintId(input.title, new Set(existing))
      const folder = join(dir, id)
      await mkdir(folder, { recursive: true })

      // Copy in any reference images.
      const referenceImages = await copyImagesInto(
        folder,
        input.sourceImages.filter((p) => p.trim().length > 0),
      )
      const coverIdx =
        input.coverIndex !== undefined && input.coverIndex < referenceImages.length
          ? input.coverIndex
          : 0
      const cover = referenceImages[coverIdx]

      const tags = input.tags
        .map((t) => t.trim())
        .filter((t) => t.length > 0)

      // Seed the workflow.md.
      const body = buildMarkdownBody({
        id,
        kind: input.kind,
        title: input.title.trim(),
        ...(input.subtitle && input.subtitle.trim()
          ? { subtitle: input.subtitle.trim() }
          : {}),
        ...(input.description && input.description.trim()
          ? { description: input.description.trim() }
          : {}),
        ...(input.agentInstructions && input.agentInstructions.trim()
          ? { agentInstructions: input.agentInstructions.trim() }
          : {}),
        ...(input.characterSheetPrompt && input.characterSheetPrompt.trim()
          ? { characterSheetPrompt: input.characterSheetPrompt.trim() }
          : {}),
        ...(input.seedancePrompt && input.seedancePrompt.trim()
          ? { seedancePrompt: input.seedancePrompt.trim() }
          : {}),
        ...(input.notes && input.notes.trim() ? { notes: input.notes.trim() } : {}),
        tags,
        ...(cover ? { cover } : {}),
      })
      const markdownPath = join(folder, LIBRARY_MARKDOWN_FILE)
      await writeFile(markdownPath, body, "utf-8")

      if (input.source === "project" && root) {
        await settleProjectEdit(root, [join(LIBRARY_PROJECT_DIR, id)])
      }
      return { added: true as const, id, source: input.source }
    }),

  /** Drag-in reference images for an existing entry. */
  addReferenceImages: publicProcedure
    .input(
      z.object({
        ...rootInput,
        source: sourceSchema,
        itemId: z.string().min(1),
        sourcePaths: z.array(z.string()).min(1),
      }),
    )
    .mutation(async ({ input }) => {
      const { root } = resolveProjectRoot(input)
      const dir = tierDir(input.source, root)
      if (!dir) throw new Error("Tier directory unavailable.")
      const folder = join(dir, input.itemId)
      if (!existsSync(folder)) throw new Error("Library entry not found.")
      const added = await copyImagesInto(folder, input.sourcePaths)
      if (added.length > 0 && input.source === "project" && root) {
        await settleProjectEdit(root, [join(LIBRARY_PROJECT_DIR, input.itemId)])
      }
      return { added }
    }),

  /** Remove one reference image. */
  removeReferenceImage: publicProcedure
    .input(
      z.object({
        ...rootInput,
        source: sourceSchema,
        itemId: z.string().min(1),
        filename: z.string().min(1),
      }),
    )
    .mutation(async ({ input }) => {
      const { root } = resolveProjectRoot(input)
      const dir = tierDir(input.source, root)
      if (!dir) throw new Error("Tier directory unavailable.")
      const folder = join(dir, input.itemId)
      const target = join(folder, input.filename)
      // Guard against escaping the folder.
      const rel = relative(folder, resolve(target))
      if (rel.startsWith("..") || isAbsolute(rel)) {
        throw new Error("Reference path escapes the entry folder.")
      }
      if (!existsSync(target)) return { removed: false as const }
      await rm(target, { force: true })

      // If the removed file was the cover, clear the frontmatter pointer.
      const markdownPath = join(folder, LIBRARY_MARKDOWN_FILE)
      if (existsSync(markdownPath)) {
        const content = await readFile(markdownPath, "utf-8")
        const { data } = parseLibraryFrontmatter(content)
        if (data.cover === input.filename) {
          await setFrontmatterCover(markdownPath, null)
        }
      }

      if (input.source === "project" && root) {
        await settleProjectEdit(root, [join(LIBRARY_PROJECT_DIR, input.itemId)])
      }
      return { removed: true as const }
    }),

  /** Promote one image to the entry's cover (frontmatter field). */
  setCoverImage: publicProcedure
    .input(
      z.object({
        ...rootInput,
        source: sourceSchema,
        itemId: z.string().min(1),
        filename: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      const { root } = resolveProjectRoot(input)
      const dir = tierDir(input.source, root)
      if (!dir) throw new Error("Tier directory unavailable.")
      const folder = join(dir, input.itemId)
      const markdownPath = join(folder, LIBRARY_MARKDOWN_FILE)
      if (!existsSync(markdownPath)) throw new Error("Library entry not found.")
      const value = input.filename.trim()
      if (value && !existsSync(join(folder, value))) {
        throw new Error("Cover image is not in the entry's folder.")
      }
      await setFrontmatterCover(markdownPath, value || null)
      if (input.source === "project" && root) {
        await settleProjectEdit(root, [join(LIBRARY_PROJECT_DIR, input.itemId)])
      }
      return { set: true as const }
    }),

  /** Patch an entry's metadata — title / subtitle / kind / tags. */
  updateMetadata: publicProcedure
    .input(
      z.object({
        ...rootInput,
        source: sourceSchema,
        itemId: z.string().min(1),
        patch: z.object({
          kind: z.enum(["workflow", "character-sheet", "prompt"]).optional(),
          title: z.string().optional(),
          subtitle: z.string().optional(),
          tags: z.array(z.string()).optional(),
        }),
      }),
    )
    .mutation(async ({ input }) => {
      const { root } = resolveProjectRoot(input)
      const dir = tierDir(input.source, root)
      if (!dir) throw new Error("Tier directory unavailable.")
      const markdownPath = join(dir, input.itemId, LIBRARY_MARKDOWN_FILE)
      if (!existsSync(markdownPath)) throw new Error("Library entry not found.")

      const raw = await readFile(markdownPath, "utf-8")
      const { data, body } = parseLibraryFrontmatter(raw)
      if (input.patch.kind !== undefined) data.kind = input.patch.kind
      if (input.patch.title !== undefined) {
        const v = input.patch.title.trim()
        if (v) data.title = v
      }
      if (input.patch.subtitle !== undefined) {
        const v = input.patch.subtitle.trim()
        if (v) data.subtitle = v
        else delete (data as Record<string, unknown>).subtitle
      }
      if (input.patch.tags !== undefined) {
        const v = input.patch.tags.map((t) => t.trim()).filter((t) => t.length > 0)
        if (v.length > 0) data.tags = v
        else delete (data as Record<string, unknown>).tags
      }

      const ORDER = ["id", "kind", "title", "subtitle", "tags", "cover"]
      const lines: string[] = ["---"]
      for (const key of ORDER) {
        if (data[key] === undefined) continue
        const value = data[key]
        if (Array.isArray(value)) {
          lines.push(
            `${key}: [${value
              .map((v) => formatYamlValue(String(v)))
              .join(", ")}]`,
          )
        } else {
          lines.push(`${key}: ${formatYamlValue(String(value))}`)
        }
      }
      for (const [key, value] of Object.entries(data)) {
        if (ORDER.includes(key)) continue
        if (value === undefined || value === null) continue
        if (Array.isArray(value)) {
          lines.push(
            `${key}: [${value
              .map((v) => formatYamlValue(String(v)))
              .join(", ")}]`,
          )
        } else {
          lines.push(`${key}: ${formatYamlValue(String(value))}`)
        }
      }
      lines.push("---")
      const next = `${lines.join("\n")}\n\n${body.trimStart()}`
      await writeFile(markdownPath, next, "utf-8")
      if (input.source === "project" && root) {
        await settleProjectEdit(root, [join(LIBRARY_PROJECT_DIR, input.itemId)])
      }
      return { updated: true as const }
    }),

  /** Remove an entry — nukes the whole folder. */
  removeEntry: publicProcedure
    .input(
      z.object({
        ...rootInput,
        source: sourceSchema,
        itemId: z.string().min(1),
      }),
    )
    .mutation(async ({ input }) => {
      const { root } = resolveProjectRoot(input)
      const dir = tierDir(input.source, root)
      if (!dir) throw new Error("Tier directory unavailable.")
      const folder = join(dir, input.itemId)
      if (!existsSync(folder)) return { removed: false as const }
      try {
        await rm(folder, { recursive: true, force: true })
      } catch (err) {
        console.warn("[library.removeEntry] cleanup failed:", err)
        throw new Error("Could not remove the library entry.")
      }
      if (input.source === "project" && root) {
        await settleProjectEdit(root, [join(LIBRARY_PROJECT_DIR, input.itemId)])
      }
      return { removed: true as const }
    }),

  /**
   * Clone a studio entry into the active project's library so the
   * writer can tune it for this film. The original studio entry
   * stays untouched. If the project library already has an entry
   * with this id, the clone gets a `-fork` suffix.
   */
  forkIntoProject: publicProcedure
    .input(z.object({ ...rootInput, studioId: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const { root } = resolveProjectRoot(input)
      if (!root) throw new Error("No project root or worktree resolved.")
      const studioFolder = join(STUDIO_LIBRARY_DIR, input.studioId)
      if (!existsSync(studioFolder)) {
        throw new Error("Studio entry not found.")
      }
      const projectDir = join(root, LIBRARY_PROJECT_DIR)
      await mkdir(projectDir, { recursive: true })
      const existing = await readdir(projectDir, { withFileTypes: true })
        .then((entries) => entries.filter((e) => e.isDirectory()).map((e) => e.name))
        .catch(() => [] as string[])
      const taken = new Set(existing)
      let id = input.studioId
      if (taken.has(id)) {
        id = `${id}-fork`
        let n = 2
        while (taken.has(id)) {
          id = `${input.studioId}-fork-${n}`
          n += 1
        }
      }
      const dst = join(projectDir, id)
      await copyDirectoryRecursive(studioFolder, dst)

      // Rewrite the id inside the cloned workflow.md frontmatter.
      const markdownPath = join(dst, LIBRARY_MARKDOWN_FILE)
      if (existsSync(markdownPath)) {
        const raw = await readFile(markdownPath, "utf-8")
        const { data, body } = parseLibraryFrontmatter(raw)
        data.id = id
        const next = `${rebuildFrontmatter(data)}\n\n${body.trimStart()}`
        await writeFile(markdownPath, next, "utf-8")
      }

      await settleProjectEdit(root, [join(LIBRARY_PROJECT_DIR, id)])
      return { forked: true as const, id }
    }),

  /**
   * Extract a tuned project entry into the studio library so future
   * projects can re-use it. The original project entry stays in
   * place. If the studio library already has the id, the extraction
   * lands with a `-studio` suffix.
   */
  saveAsStudioPreset: publicProcedure
    .input(z.object({ ...rootInput, projectId: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const { root } = resolveProjectRoot(input)
      if (!root) throw new Error("No project root or worktree resolved.")
      const projectFolder = join(root, LIBRARY_PROJECT_DIR, input.projectId)
      if (!existsSync(projectFolder)) {
        throw new Error("Project entry not found.")
      }
      await mkdir(STUDIO_LIBRARY_DIR, { recursive: true })
      const existing = await readdir(STUDIO_LIBRARY_DIR, { withFileTypes: true })
        .then((entries) => entries.filter((e) => e.isDirectory()).map((e) => e.name))
        .catch(() => [] as string[])
      const taken = new Set(existing)
      let id = input.projectId
      if (taken.has(id)) {
        id = `${id}-studio`
        let n = 2
        while (taken.has(id)) {
          id = `${input.projectId}-studio-${n}`
          n += 1
        }
      }
      const dst = join(STUDIO_LIBRARY_DIR, id)
      await copyDirectoryRecursive(projectFolder, dst)

      const markdownPath = join(dst, LIBRARY_MARKDOWN_FILE)
      if (existsSync(markdownPath)) {
        const raw = await readFile(markdownPath, "utf-8")
        const { data, body } = parseLibraryFrontmatter(raw)
        data.id = id
        const next = `${rebuildFrontmatter(data)}\n\n${body.trimStart()}`
        await writeFile(markdownPath, next, "utf-8")
      }
      return { extracted: true as const, id }
    }),

  /**
   * Promote a library entry into the user's skill library at
   * `~/.lani/skills/<slug>/SKILL.md`. The entry's workflow.md
   * becomes the skill body; reference images come along. A minimal
   * skill frontmatter is generated from the entry's metadata — the
   * user (or the agent) tunes the description-trigger afterwards.
   */
  promoteToSkill: publicProcedure
    .input(
      z.object({
        ...rootInput,
        source: sourceSchema,
        itemId: z.string().min(1),
      }),
    )
    .mutation(async ({ input }) => {
      const dir = tierDir(input.source, resolveProjectRoot(input).root)
      if (!dir) throw new Error("Tier directory unavailable.")
      const folder = join(dir, input.itemId)
      if (!existsSync(folder)) throw new Error("Library entry not found.")
      const markdownPath = join(folder, LIBRARY_MARKDOWN_FILE)
      const raw = existsSync(markdownPath)
        ? await readFile(markdownPath, "utf-8")
        : ""
      const { data, body } = parseLibraryFrontmatter(raw)

      await mkdir(SKILLS_DIR, { recursive: true })
      const existing = await readdir(SKILLS_DIR, { withFileTypes: true })
        .then((entries) => entries.filter((e) => e.isDirectory()).map((e) => e.name))
        .catch(() => [] as string[])
      const taken = new Set(existing)
      let skillName = String(data.id ?? input.itemId)
      if (taken.has(skillName)) {
        let n = 2
        while (taken.has(`${skillName}-${n}`)) n += 1
        skillName = `${skillName}-${n}`
      }
      const skillFolder = join(SKILLS_DIR, skillName)
      await mkdir(skillFolder, { recursive: true })

      // Copy images.
      const folderEntries = await readdir(folder, { withFileTypes: true })
      for (const entry of folderEntries) {
        if (!entry.isFile()) continue
        if (entry.name === LIBRARY_MARKDOWN_FILE) continue
        if (entry.name.startsWith(".")) continue
        if (!isLibraryImage(entry.name)) continue
        await copyFile(join(folder, entry.name), join(skillFolder, entry.name))
      }

      // Build the SKILL.md frontmatter. Skills use `name` + `description`
      // (trigger text). Take the title + subtitle as the description seed;
      // the user can refine later.
      const now = new Date().toISOString().slice(0, 10)
      const description = [data.subtitle, data.title]
        .filter((s) => typeof s === "string" && s.length > 0)
        .join(" — ") || String(data.title ?? skillName)
      const skillFrontmatter = [
        "---",
        `name: ${skillName}`,
        `description: ${formatYamlValue(String(description))}`,
        "version: 1.0.0",
        "status: draft",
        `created: ${now}`,
        `updated: ${now}`,
        Array.isArray(data.tags) && data.tags.length > 0
          ? `tags: [${(data.tags as unknown[])
              .map((t) => formatYamlValue(String(t)))
              .join(", ")}]`
          : null,
        "---",
        "",
      ]
        .filter((s): s is string => s !== null)
        .join("\n")
      await writeFile(
        join(skillFolder, "SKILL.md"),
        `${skillFrontmatter}\n${body.trim()}\n`,
        "utf-8",
      )
      return { promoted: true as const, skillName, skillPath: skillFolder }
    }),
})

/** Recursive copy of a folder (the standard fs/promises lacks one). */
async function copyDirectoryRecursive(src: string, dst: string) {
  await mkdir(dst, { recursive: true })
  const entries = await readdir(src, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue
    const s = join(src, entry.name)
    const d = join(dst, entry.name)
    if (entry.isDirectory()) {
      await copyDirectoryRecursive(s, d)
    } else if (entry.isFile()) {
      await copyFile(s, d)
    }
  }
}

/** Re-emit a frontmatter block in our shipped key order from a flat dict. */
function rebuildFrontmatter(data: Record<string, unknown>): string {
  const ORDER = ["id", "kind", "title", "subtitle", "tags", "cover"]
  const lines: string[] = ["---"]
  for (const key of ORDER) {
    if (data[key] === undefined) continue
    const value = data[key]
    if (Array.isArray(value)) {
      lines.push(
        `${key}: [${value
          .map((v) => formatYamlValue(String(v)))
          .join(", ")}]`,
      )
    } else {
      lines.push(`${key}: ${formatYamlValue(String(value))}`)
    }
  }
  for (const [key, value] of Object.entries(data)) {
    if (ORDER.includes(key)) continue
    if (value === undefined || value === null) continue
    if (Array.isArray(value)) {
      lines.push(
        `${key}: [${value
          .map((v) => formatYamlValue(String(v)))
          .join(", ")}]`,
      )
    } else {
      lines.push(`${key}: ${formatYamlValue(String(value))}`)
    }
  }
  lines.push("---")
  return lines.join("\n")
}

// Re-suppress an unused-helper warning the imports table now spotlights.
void dirname
void rename
