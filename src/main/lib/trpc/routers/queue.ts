import { existsSync } from "node:fs"
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises"
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
  normalizeQueue,
  QUEUE_ARCHIVE_RELPATH,
  QUEUE_FIELD_DESCRIPTIONS,
  QUEUE_FILE_RELPATH,
  QUEUE_MEDIA_DIR,
  type QueueItem,
  type QueueSourceMode,
  type SubmissionQueue,
} from "../../../../shared/queue-types"
import { publicProcedure, router } from "../index"

type RootInput = {
  chatId?: string | null
  projectId?: string | null
}

function resolveRoot(input: RootInput): {
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

function resolveInside(root: string, relPath: string): string {
  const full = resolve(root, relPath)
  const rel = relative(root, full)
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error("Queue path escapes the project root.")
  }
  return full
}

/** Which queue file an operation targets. */
function fileFor(archived: boolean | undefined): string {
  return archived ? QUEUE_ARCHIVE_RELPATH : QUEUE_FILE_RELPATH
}

async function isPathClean(root: string, relPath: string): Promise<boolean> {
  try {
    const git = simpleGit(root)
    if (!(await git.checkIsRepo())) return false
    const porcelain = await git.raw(["status", "--porcelain", "--", relPath])
    return !porcelain.trim()
  } catch {
    return false
  }
}

/** Commit the given queue files (and any media folders) as one checkpoint. */
async function settleQueueEdit(
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
    await git.commit("Lani: update queue", paths)
  } catch (err) {
    console.warn("[queue] edit settlement skipped:", err)
  }
}

const VIDEO_EXTENSIONS = ["mp4", "mov", "webm", "m4v", "ogv"]

const rootInput = {
  chatId: z.string().optional(),
  projectId: z.string().optional(),
}

const EMPTY_QUEUE: SubmissionQueue = { schemaVersion: 1, items: [], updatedAt: "" }

/** Read + normalize one queue file; an empty queue if it is absent. */
async function loadQueueFile(
  root: string,
  relPath: string,
): Promise<SubmissionQueue> {
  const fullPath = resolveInside(root, relPath)
  if (!existsSync(fullPath)) return { ...EMPTY_QUEUE }
  try {
    const raw = await readFile(fullPath, "utf-8")
    return normalizeQueue(JSON.parse(raw))
  } catch {
    return { ...EMPTY_QUEUE }
  }
}

/**
 * Write one or more queue files, then checkpoint them. A file is only
 * committed when it was clean before the write — so an agent's
 * in-progress edit is never auto-committed out from under it.
 */
async function persistQueueFiles(
  root: string,
  writes: { relPath: string; queue: SubmissionQueue }[],
  extraPaths: string[] = [],
): Promise<void> {
  const cleanPaths: string[] = []
  for (const w of writes) {
    if (await isPathClean(root, w.relPath)) cleanPaths.push(w.relPath)
  }
  for (const w of writes) {
    const fullPath = resolveInside(root, w.relPath)
    await mkdir(dirname(fullPath), { recursive: true })
    await writeFile(
      fullPath,
      JSON.stringify(w.queue, null, 2) + "\n",
      "utf-8",
    )
  }
  if (cleanPaths.length > 0) {
    await settleQueueEdit(root, [...cleanPaths, ...extraPaths])
  }
}

function stamp<T extends SubmissionQueue>(queue: T): T {
  return {
    ...queue,
    fieldDescriptions: { ...QUEUE_FIELD_DESCRIPTIONS },
    updatedAt: new Date().toISOString(),
  }
}

/**
 * One-time migration: earlier builds kept archived items inside
 * `queue.lani.json` with an `archivedAt` field. Move any such stray
 * items into the archive file so the two documents are clean. Idempotent
 * — a no-op once the split has happened.
 */
async function ensureSplit(root: string): Promise<void> {
  const active = await loadQueueFile(root, QUEUE_FILE_RELPATH)
  const strays = active.items.filter((i) => i.archivedAt)
  if (strays.length === 0) return
  const archive = await loadQueueFile(root, QUEUE_ARCHIVE_RELPATH)
  await persistQueueFiles(root, [
    {
      relPath: QUEUE_FILE_RELPATH,
      queue: stamp({
        ...active,
        items: active.items.filter((i) => !i.archivedAt),
      }),
    },
    {
      relPath: QUEUE_ARCHIVE_RELPATH,
      queue: stamp({ ...archive, items: [...archive.items, ...strays] }),
    },
  ])
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

/**
 * Mint a descriptive item id from its source — also the name of the
 * item's `queue-media/<id>/` folder. We want this folder to read like
 * a story location in the file explorer (`01-cafe-talk-part-3`),
 * not a hash (`q-mfqxoo28abc`). Falls back to a timestamp slug when the
 * source carries no scene id at all. Disambiguates against `taken`
 * with `-2`, `-3`… so a re-queued or restored item never collides.
 */
function mintItemId(
  source: { mode: QueueSourceMode; sceneId: string; partLabel?: string },
  taken: Set<string>,
): string {
  const sceneSlug = slugify(source.sceneId ?? "")

  let base: string
  if (source.mode === "manual") {
    base = `manual-${Date.now().toString(36)}`
  } else if (sceneSlug) {
    if (source.mode === "shotlist") {
      const partMatch = source.partLabel?.match(/Part\s+0*(\d+)/i)
      if (partMatch) {
        base = `${sceneSlug}-part-${partMatch[1]}`
      } else {
        const partSlug = slugify(source.partLabel ?? "")
        base = partSlug ? `${sceneSlug}-${partSlug}` : `${sceneSlug}-part`
      }
    } else {
      base = `${sceneSlug}-multishot`
    }
  } else {
    base = `q-${Date.now().toString(36)}${Math.random()
      .toString(36)
      .slice(2, 6)}`
  }

  let id = base
  let n = 2
  while (taken.has(id)) {
    id = `${base}-${n}`
    n += 1
  }
  return id
}

export const queueRouter = router({
  /** Read the active submission queue. */
  read: publicProcedure
    .input(z.object({ ...rootInput }))
    .query(async ({ input }) => {
      const { root } = resolveRoot(input)
      if (!root) {
        return { exists: false as const, queue: null as SubmissionQueue | null }
      }
      await ensureSplit(root)
      const fullPath = resolveInside(root, QUEUE_FILE_RELPATH)
      if (!existsSync(fullPath)) {
        return { exists: false as const, queue: null }
      }
      return {
        exists: true as const,
        queue: await loadQueueFile(root, QUEUE_FILE_RELPATH),
      }
    }),

  /** Read the archive — past submissions kept as history. */
  readArchive: publicProcedure
    .input(z.object({ ...rootInput }))
    .query(async ({ input }) => {
      const { root } = resolveRoot(input)
      if (!root) return { queue: null as SubmissionQueue | null }
      await ensureSplit(root)
      return { queue: await loadQueueFile(root, QUEUE_ARCHIVE_RELPATH) }
    }),

  /** Persist the active queue after an in-place edit. */
  write: publicProcedure
    .input(z.object({ ...rootInput, queue: z.custom<SubmissionQueue>() }))
    .mutation(async ({ input }) => {
      const { root } = resolveRoot(input)
      if (!root) throw new Error("No project root or worktree resolved.")
      await persistQueueFiles(root, [
        { relPath: QUEUE_FILE_RELPATH, queue: stamp(input.queue) },
      ])
      return { written: true as const }
    }),

  /** Persist the archive after an in-place edit. */
  writeArchive: publicProcedure
    .input(z.object({ ...rootInput, queue: z.custom<SubmissionQueue>() }))
    .mutation(async ({ input }) => {
      const { root } = resolveRoot(input)
      if (!root) throw new Error("No project root or worktree resolved.")
      await persistQueueFiles(root, [
        { relPath: QUEUE_ARCHIVE_RELPATH, queue: stamp(input.queue) },
      ])
      return { written: true as const }
    }),

  /**
   * Add a prompt to the active queue. Reference images are copied into
   * the new item's `queue-media/<id>/` folder so the item is
   * self-contained. `sourceImages` are project-relative paths.
   */
  addItem: publicProcedure
    .input(
      z.object({
        ...rootInput,
        prompt: z.string(),
        zh: z.string().optional(),
        sourceImages: z.array(z.string()).default([]),
        scriptExcerpt: z.string().optional(),
        source: z.object({
          mode: z.enum(["multishot", "shotlist"]),
          sceneId: z.string(),
          label: z.string(),
          sceneName: z.string().optional(),
          partLabel: z.string().optional(),
        }),
      }),
    )
    .mutation(async ({ input }) => {
      const { root } = resolveRoot(input)
      if (!root) throw new Error("No project root or worktree resolved.")

      // Load both queue files up front so id minting can dedupe across
      // active + archive (a restored item could collide with a re-queue).
      const queue = await loadQueueFile(root, QUEUE_FILE_RELPATH)
      const archive = await loadQueueFile(root, QUEUE_ARCHIVE_RELPATH)
      const takenIds = new Set<string>([
        ...queue.items.map((i) => i.id),
        ...archive.items.map((i) => i.id),
      ])

      // If an active queue item already exists for the same scene part,
      // add the new prompt as a new version on that item rather than
      // creating a separate row. (Computed early so we can skip minting
      // a new id when this is a re-version on an existing row.)
      const existingIdx = input.source.partLabel
        ? queue.items.findIndex(
            (i) =>
              i.source.sceneId === input.source.sceneId &&
              i.source.partLabel === input.source.partLabel &&
              !i.archivedAt,
          )
        : -1

      const id =
        existingIdx >= 0
          ? queue.items[existingIdx]!.id
          : mintItemId(input.source, takenIds)
      const mediaRel = join(QUEUE_MEDIA_DIR, id)
      const mediaDir = resolveInside(root, mediaRel)

      const referenceImages: string[] = []
      const sources = input.sourceImages.filter((p) => p.trim().length > 0)
      if (sources.length > 0) {
        await mkdir(mediaDir, { recursive: true })
        for (const sourceRel of sources) {
          let sourceFull: string
          try {
            sourceFull = resolveInside(root, sourceRel)
          } catch {
            continue
          }
          if (!existsSync(sourceFull)) continue
          const ext = extname(sourceFull).toLowerCase().replace(/^\./, "")
          if (!IMAGE_EXTENSIONS.includes(ext)) continue
          const destination = uniqueDestination(mediaDir, basename(sourceFull))
          await copyFile(sourceFull, destination)
          referenceImages.push(relative(root, destination))
        }
      }

      const now = new Date().toISOString()
      const zhTrimmed = input.zh && input.zh.trim() ? input.zh.trim() : undefined

      // Re-queuing the same scene part overrides the existing row's
      // prompt, ZH translation, and reference images. The queue holds
      // one draft per item — the latest one wins.
      if (existingIdx >= 0) {
        const existing = queue.items[existingIdx]!
        const next: QueueItem = {
          ...existing,
          prompt: input.prompt,
          referenceImages,
          updatedAt: now,
        }
        if (zhTrimmed) next.zh = zhTrimmed
        else delete next.zh
        queue.items[existingIdx] = next

        await persistQueueFiles(
          root,
          [{ relPath: QUEUE_FILE_RELPATH, queue: stamp(queue) }],
          referenceImages.length > 0 ? [mediaRel] : [],
        )
        return { added: true as const, item: queue.items[existingIdx]! }
      }

      // No matching item — create a new queue row.
      const item: QueueItem = {
        id,
        prompt: input.prompt,
        ...(zhTrimmed ? { zh: zhTrimmed } : {}),
        referenceImages,
        status: "pending",
        submissionCount: 0,
        source: {
          mode: input.source.mode,
          sceneId: input.source.sceneId,
          label: input.source.label,
          ...(input.source.sceneName ? { sceneName: input.source.sceneName } : {}),
          ...(input.source.partLabel ? { partLabel: input.source.partLabel } : {}),
        },
        ...(input.scriptExcerpt && input.scriptExcerpt.trim()
          ? { scriptExcerpt: input.scriptExcerpt.trim() }
          : {}),
        addedAt: now,
        updatedAt: now,
        liked: false,
      }

      queue.items.push(item)
      await persistQueueFiles(
        root,
        [{ relPath: QUEUE_FILE_RELPATH, queue: stamp(queue) }],
        referenceImages.length > 0 ? [mediaRel] : [],
      )
      return { added: true as const, item }
    }),

  /**
   * Create a blank queue row from the Queue surface itself — no
   * multishot/shotlist origin. The writer fills the prompt directly on
   * the row. Initial `prompt` defaults to "" so the row lands as an
   * editable draft.
   */
  addManualItem: publicProcedure
    .input(
      z.object({
        ...rootInput,
        prompt: z.string().optional(),
        zh: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const { root } = resolveRoot(input)
      if (!root) throw new Error("No project root or worktree resolved.")

      const queue = await loadQueueFile(root, QUEUE_FILE_RELPATH)
      const archive = await loadQueueFile(root, QUEUE_ARCHIVE_RELPATH)
      const takenIds = new Set<string>([
        ...queue.items.map((i) => i.id),
        ...archive.items.map((i) => i.id),
      ])

      const id = mintItemId(
        { mode: "manual", sceneId: "" },
        takenIds,
      )

      const prompt = input.prompt ?? ""
      const zh = input.zh?.trim() || undefined

      const now = new Date().toISOString()
      const item: QueueItem = {
        id,
        prompt,
        ...(zh ? { zh } : {}),
        referenceImages: [],
        status: "pending",
        submissionCount: 0,
        source: {
          mode: "manual",
          sceneId: "",
          label: "Manual entry",
        },
        addedAt: now,
        updatedAt: now,
        liked: false,
      }

      queue.items.push(item)
      await persistQueueFiles(root, [
        { relPath: QUEUE_FILE_RELPATH, queue: stamp(queue) },
      ])
      return { added: true as const, item }
    }),

  /** Move an item from the active queue into the archive. */
  archiveItem: publicProcedure
    .input(z.object({ ...rootInput, itemId: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const { root } = resolveRoot(input)
      if (!root) throw new Error("No project root or worktree resolved.")

      const active = await loadQueueFile(root, QUEUE_FILE_RELPATH)
      const item = active.items.find((i) => i.id === input.itemId)
      if (!item) return { archived: false as const }
      const archive = await loadQueueFile(root, QUEUE_ARCHIVE_RELPATH)

      await persistQueueFiles(root, [
        {
          relPath: QUEUE_FILE_RELPATH,
          queue: stamp({
            ...active,
            items: active.items.filter((i) => i.id !== input.itemId),
          }),
        },
        {
          relPath: QUEUE_ARCHIVE_RELPATH,
          queue: stamp({
            ...archive,
            items: [
              ...archive.items,
              { ...item, archivedAt: new Date().toISOString() },
            ],
          }),
        },
      ])
      return { archived: true as const }
    }),

  /** Move an item from the archive back into the active queue. */
  restoreItem: publicProcedure
    .input(z.object({ ...rootInput, itemId: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const { root } = resolveRoot(input)
      if (!root) throw new Error("No project root or worktree resolved.")

      const archive = await loadQueueFile(root, QUEUE_ARCHIVE_RELPATH)
      const item = archive.items.find((i) => i.id === input.itemId)
      if (!item) return { restored: false as const }
      const active = await loadQueueFile(root, QUEUE_FILE_RELPATH)

      const restored = { ...item }
      delete restored.archivedAt
      restored.updatedAt = new Date().toISOString()

      await persistQueueFiles(root, [
        {
          relPath: QUEUE_ARCHIVE_RELPATH,
          queue: stamp({
            ...archive,
            items: archive.items.filter((i) => i.id !== input.itemId),
          }),
        },
        {
          relPath: QUEUE_FILE_RELPATH,
          queue: stamp({ ...active, items: [...active.items, restored] }),
        },
      ])
      return { restored: true as const }
    }),

  /**
   * Copy dropped images into a queue item's `queue-media/<id>/` folder
   * and append them to its `referenceImages`. `archived` picks which
   * file the item lives in.
   */
  addReferenceImages: publicProcedure
    .input(
      z.object({
        ...rootInput,
        itemId: z.string().min(1),
        sourcePaths: z.array(z.string()).min(1),
        archived: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const { root } = resolveRoot(input)
      if (!root) throw new Error("No project root or worktree resolved.")

      const relPath = fileFor(input.archived)
      const queue = await loadQueueFile(root, relPath)
      const item = queue.items.find((i) => i.id === input.itemId)
      if (!item) throw new Error("Queue item not found.")

      const mediaRel = join(QUEUE_MEDIA_DIR, input.itemId)
      const mediaDir = resolveInside(root, mediaRel)
      await mkdir(mediaDir, { recursive: true })

      const added: string[] = []
      for (const src of input.sourcePaths) {
        if (!isAbsolute(src) || !existsSync(src)) continue
        const ext = extname(src).toLowerCase().replace(/^\./, "")
        if (!IMAGE_EXTENSIONS.includes(ext)) continue
        const destination = uniqueDestination(mediaDir, basename(src))
        await copyFile(src, destination)
        added.push(relative(root, destination))
      }
      if (added.length === 0) return { added: [] as string[] }

      item.referenceImages = [...item.referenceImages, ...added]
      item.updatedAt = new Date().toISOString()
      await persistQueueFiles(root, [{ relPath, queue: stamp(queue) }], [
        mediaRel,
      ])
      return { added }
    }),

  /** Drop a reference image from a queue item and delete the file. */
  removeReferenceImage: publicProcedure
    .input(
      z.object({
        ...rootInput,
        itemId: z.string().min(1),
        path: z.string().min(1),
        archived: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const { root } = resolveRoot(input)
      if (!root) throw new Error("No project root or worktree resolved.")

      const relPath = fileFor(input.archived)
      const queue = await loadQueueFile(root, relPath)
      const item = queue.items.find((i) => i.id === input.itemId)
      if (!item || !item.referenceImages.includes(input.path)) {
        return { removed: false as const }
      }

      try {
        await rm(resolveInside(root, input.path), { force: true })
      } catch (err) {
        console.warn("[queue.removeReferenceImage] cleanup skipped:", err)
      }

      item.referenceImages = item.referenceImages.filter(
        (p) => p !== input.path,
      )
      item.updatedAt = new Date().toISOString()
      await persistQueueFiles(root, [{ relPath, queue: stamp(queue) }], [
        join(QUEUE_MEDIA_DIR, input.itemId),
      ])
      return { removed: true as const }
    }),

  /**
   * Link a result video (the generated clip) to a queue item. The
   * dropped file is copied into the item's `queue-media/<id>/` folder;
   * a previously linked video is replaced. `archived` picks the file.
   */
  linkResultVideo: publicProcedure
    .input(
      z.object({
        ...rootInput,
        itemId: z.string().min(1),
        sourcePath: z.string().min(1),
        archived: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const { root } = resolveRoot(input)
      if (!root) throw new Error("No project root or worktree resolved.")
      if (!isAbsolute(input.sourcePath) || !existsSync(input.sourcePath)) {
        throw new Error("Dropped file could not be found.")
      }
      const ext = extname(input.sourcePath).toLowerCase().replace(/^\./, "")
      if (!VIDEO_EXTENSIONS.includes(ext)) {
        throw new Error("Only a video file can be linked as the result.")
      }

      const relPath = fileFor(input.archived)
      const queue = await loadQueueFile(root, relPath)
      const item = queue.items.find((i) => i.id === input.itemId)
      if (!item) throw new Error("Queue item not found.")

      const mediaRel = join(QUEUE_MEDIA_DIR, input.itemId)
      const mediaDir = resolveInside(root, mediaRel)
      await mkdir(mediaDir, { recursive: true })

      if (item.resultVideo) {
        try {
          await rm(resolveInside(root, item.resultVideo), { force: true })
        } catch (err) {
          console.warn("[queue.linkResultVideo] old clip cleanup skipped:", err)
        }
      }

      const destination = uniqueDestination(
        mediaDir,
        basename(input.sourcePath),
      )
      await copyFile(input.sourcePath, destination)
      const rel = relative(root, destination)

      item.resultVideo = rel
      item.updatedAt = new Date().toISOString()
      await persistQueueFiles(root, [{ relPath, queue: stamp(queue) }], [
        mediaRel,
      ])
      return { linked: true as const, resultVideo: rel }
    }),

  /** Unlink a queue item's result video and delete the copied file. */
  clearResultVideo: publicProcedure
    .input(
      z.object({
        ...rootInput,
        itemId: z.string().min(1),
        archived: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const { root } = resolveRoot(input)
      if (!root) throw new Error("No project root or worktree resolved.")

      const relPath = fileFor(input.archived)
      const queue = await loadQueueFile(root, relPath)
      const item = queue.items.find((i) => i.id === input.itemId)
      if (!item || !item.resultVideo) return { cleared: false as const }

      try {
        await rm(resolveInside(root, item.resultVideo), { force: true })
      } catch (err) {
        console.warn("[queue.clearResultVideo] clip cleanup skipped:", err)
      }

      delete item.resultVideo
      item.updatedAt = new Date().toISOString()
      await persistQueueFiles(root, [{ relPath, queue: stamp(queue) }], [
        join(QUEUE_MEDIA_DIR, input.itemId),
      ])
      return { cleared: true as const }
    }),

  /** Remove an item for good and delete its media folder. */
  removeItem: publicProcedure
    .input(
      z.object({
        ...rootInput,
        itemId: z.string().min(1),
        archived: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const { root } = resolveRoot(input)
      if (!root) throw new Error("No project root or worktree resolved.")

      const relPath = fileFor(input.archived)
      const queue = await loadQueueFile(root, relPath)
      const next = queue.items.filter((i) => i.id !== input.itemId)
      if (next.length === queue.items.length) {
        return { removed: false as const }
      }

      const mediaRel = join(QUEUE_MEDIA_DIR, input.itemId)
      try {
        await rm(resolveInside(root, mediaRel), { recursive: true, force: true })
      } catch (err) {
        console.warn("[queue.removeItem] media cleanup skipped:", err)
      }

      await persistQueueFiles(
        root,
        [{ relPath, queue: stamp({ ...queue, items: next }) }],
        [mediaRel],
      )
      return { removed: true as const }
    }),
})
