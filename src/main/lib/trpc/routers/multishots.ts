import { existsSync } from "node:fs"
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises"
import {
  invalidateCachedNormalizedJson,
  readCachedNormalizedJson,
} from "../../lani-json-cache"
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path"
import { BrowserWindow, dialog } from "electron"
import { eq } from "drizzle-orm"
import simpleGit from "simple-git"
import { z } from "zod"
import { chats, getDatabase, projects } from "../../db"
import {
  normalizeMultishot,
  type SceneMultishot,
} from "../../../../shared/multishot-types"
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
    throw new Error("Multishot path escapes the project root.")
  }
  return full
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

/**
 * Commit a settled user edit. Each manual edit from a clean state becomes
 * one creative checkpoint in the scene's history.
 */
async function settleUserEdit(root: string, relPath: string): Promise<void> {
  try {
    const git = simpleGit(root)
    if (!(await git.checkIsRepo())) return
    const porcelain = await git.raw(["status", "--porcelain", "--", relPath])
    if (!porcelain.trim()) return
    await git.add([relPath])
    await git.commit(`Lani: update multishot (${relPath})`, [relPath])
  } catch (err) {
    console.warn("[multishots.write] user edit settlement skipped:", err)
  }
}

const rootInput = {
  chatId: z.string().optional(),
  projectId: z.string().optional(),
}

const REFERENCE_IMAGE_EXTENSIONS = [
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "avif",
  "bmp",
]

/** A non-overwriting destination — suffixes "-2", "-3"… on collision. */
function uniqueDestination(dir: string, fileName: string): string {
  const ext = extname(fileName)
  const stem = basename(fileName, ext)
  let candidate = join(dir, fileName)
  let n = 2
  while (existsSync(candidate)) {
    candidate = join(dir, `${stem}-${n}${ext}`)
    n += 1
  }
  return candidate
}

export const multishotsRouter = router({
  /** Read a scene's multishot file. `relPath` points at multishot.lani.json. */
  read: publicProcedure
    .input(z.object({ ...rootInput, relPath: z.string().min(1) }))
    .query(async ({ input }) => {
      const { root } = resolveRoot(input)
      if (!root) {
        return {
          exists: false as const,
          multishot: null as SceneMultishot | null,
        }
      }
      const fullPath = resolveInside(root, input.relPath)
      if (!existsSync(fullPath)) {
        return { exists: false as const, multishot: null }
      }
      try {
        // The agent can author this file directly with the Write tool, so
        // normalize on read — fill missing versions/status/schemaVersion so
        // a near-miss write still renders. Invalid JSON still fails here.
        // Cached by (mtimeMs, size) so idle polls don't re-parse.
        const multishot = await readCachedNormalizedJson(fullPath, (raw) =>
          normalizeMultishot(raw),
        )
        return { exists: true as const, multishot }
      } catch {
        return { exists: false as const, multishot: null }
      }
    }),

  /** Persist a scene's multishot after an in-place edit, and checkpoint it. */
  write: publicProcedure
    .input(
      z.object({
        ...rootInput,
        relPath: z.string().min(1),
        multishot: z.custom<SceneMultishot>(),
      }),
    )
    .mutation(async ({ input }) => {
      const { root, kind } = resolveRoot(input)
      if (!root) throw new Error("No project root or worktree resolved.")
      const fullPath = resolveInside(root, input.relPath)
      const shouldSettle =
        kind === "worktree" &&
        !!input.chatId &&
        (await isPathClean(root, input.relPath))
      await mkdir(dirname(fullPath), { recursive: true })
      await writeFile(
        fullPath,
        JSON.stringify(input.multishot, null, 2) + "\n",
        "utf-8",
      )
      invalidateCachedNormalizedJson(fullPath)
      if (shouldSettle) {
        await settleUserEdit(root, input.relPath)
      }
      return { written: true, relPath: input.relPath }
    }),

  /**
   * Open a native picker, copy the chosen images into the scene's
   * `references/` folder, and return their project-relative paths. The
   * Multishot surface appends these to the doc's `referenceImages`.
   * `relPath` points at the scene's `multishot.lani.json`.
   */
  addReferenceImages: publicProcedure
    .input(z.object({ ...rootInput, relPath: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const { root } = resolveRoot(input)
      if (!root) throw new Error("No project root or worktree resolved.")

      const window = ctx.getWindow?.() ?? BrowserWindow.getFocusedWindow()
      if (!window) return { added: [] as string[] }
      if (!window.isFocused()) {
        window.focus()
        await new Promise((r) => setTimeout(r, 100))
      }

      const picked = await dialog.showOpenDialog(window, {
        properties: ["openFile", "multiSelections"],
        title: "Add reference images",
        buttonLabel: "Add references",
        filters: [{ name: "Images", extensions: REFERENCE_IMAGE_EXTENSIONS }],
      })
      if (picked.canceled || picked.filePaths.length === 0) {
        return { added: [] as string[] }
      }

      const multishotFull = resolveInside(root, input.relPath)
      const refsDir = join(dirname(multishotFull), "references")
      await mkdir(refsDir, { recursive: true })

      const added: string[] = []
      for (const source of picked.filePaths) {
        const ext = extname(source).toLowerCase().replace(/^\./, "")
        if (!REFERENCE_IMAGE_EXTENSIONS.includes(ext)) continue
        const destination = uniqueDestination(refsDir, basename(source))
        await copyFile(source, destination)
        added.push(relative(root, destination))
      }
      return { added }
    }),

  /**
   * Read a scene's screenplay text — used to seed the multishot's working
   * copy and to re-import it. `relPath` points at the scene's `.fountain`.
   * Read-only — the multishot surface never writes the screenplay file.
   */
  readScript: publicProcedure
    .input(z.object({ ...rootInput, relPath: z.string().min(1) }))
    .query(async ({ input }) => {
      const { root } = resolveRoot(input)
      if (!root) return { exists: false as const, text: "" }
      const fullPath = resolveInside(root, input.relPath)
      if (!existsSync(fullPath)) return { exists: false as const, text: "" }
      try {
        return { exists: true as const, text: await readFile(fullPath, "utf-8") }
      } catch {
        return { exists: false as const, text: "" }
      }
    }),
})
