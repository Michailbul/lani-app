import { existsSync } from "node:fs"
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises"
import {
  invalidateCachedNormalizedJson,
  readCachedNormalizedJson,
} from "../../lani-json-cache"
import {
  basename,
  dirname,
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
  IMAGE_EXTENSIONS,
  isSupportedImagePath,
  uniqueDestination,
} from "../../media-utils"
import {
  normalizeShotlist,
  type SceneShotlist,
} from "../../../../shared/shotlist-types"
import { publicProcedure, router } from "../index"

/** Scene-level flat folder where Part reference images live. */
const SCENE_REFERENCES_DIRNAME = "references"

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
    throw new Error("Shotlist path escapes the project root.")
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
    await git.commit(`Lani: update shotlist (${relPath})`, [relPath])
  } catch (err) {
    console.warn("[shotlists.write] user edit settlement skipped:", err)
  }
}


const rootInput = {
  chatId: z.string().optional(),
  projectId: z.string().optional(),
}

export const shotlistsRouter = router({
  /** Read a single scene's shotlist file. `relPath` points at shotlist.lani.json. */
  read: publicProcedure
    .input(z.object({ ...rootInput, relPath: z.string().min(1) }))
    .query(async ({ input }) => {
      const { root } = resolveRoot(input)
      if (!root) {
        return { exists: false as const, shotlist: null as SceneShotlist | null }
      }
      const fullPath = resolveInside(root, input.relPath)
      if (!existsSync(fullPath)) {
        return { exists: false as const, shotlist: null }
      }
      try {
        // The agent authors this file directly with the Write tool, so
        // normalize on read — fill missing ids/status/schemaVersion so a
        // near-miss write still renders. Invalid JSON still fails here.
        // Cached by (mtimeMs, size) so idle polls don't re-parse.
        const shotlist = await readCachedNormalizedJson(fullPath, (raw) =>
          normalizeShotlist(raw),
        )
        return { exists: true as const, shotlist }
      } catch {
        return { exists: false as const, shotlist: null }
      }
    }),

  /** Persist a scene's shotlist after an in-place edit, and checkpoint it. */
  write: publicProcedure
    .input(
      z.object({
        ...rootInput,
        relPath: z.string().min(1),
        shotlist: z.custom<SceneShotlist>(),
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
        JSON.stringify(input.shotlist, null, 2) + "\n",
        "utf-8",
      )
      invalidateCachedNormalizedJson(fullPath)
      if (shouldSettle) {
        await settleUserEdit(root, input.relPath)
      }
      return { written: true, relPath: input.relPath }
    }),

  /**
   * Read a scene's screenplay text for side-by-side reference while
   * writing shot prompts. `relPath` points at the scene's `.fountain`.
   * Read-only — the shotlist surface never writes the screenplay.
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

  /**
   * Copy reference images into the scene's flat `references/` folder
   * and return their project-relative paths. The Shotlist surface
   * appends these to the active Part's `referenceImages` and saves the
   * doc through the normal `write` mutation — so an in-flight edit is
   * never clobbered.
   *
   * When `sourcePaths` is provided (drag-and-drop), those paths are
   * used directly. When absent, a native file picker opens. Files that
   * aren't supported images or don't exist are skipped silently; the
   * response lists only the paths actually copied.
   *
   * Filename collisions resolve via `-2`, `-3`… suffixes — the original
   * descriptive filename is preserved so the same image can serve more
   * than one Part as the shotlist is re-cut.
   */
  addPartReferenceImages: publicProcedure
    .input(
      z.object({
        ...rootInput,
        relPath: z.string().min(1),
        sourcePaths: z.array(z.string()).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { root } = resolveRoot(input)
      if (!root) throw new Error("No project root or worktree resolved.")

      let sources = (input.sourcePaths ?? []).filter(
        (p) => isAbsolute(p) && existsSync(p),
      )

      if (sources.length === 0) {
        const window =
          (ctx as { getWindow?: () => BrowserWindow | null }).getWindow?.() ??
          BrowserWindow.getFocusedWindow()
        if (!window) return { added: [] as string[] }
        if (!window.isFocused()) {
          window.focus()
          await new Promise((r) => setTimeout(r, 100))
        }
        const picked = await dialog.showOpenDialog(window, {
          properties: ["openFile", "multiSelections"],
          title: "Add reference images",
          buttonLabel: "Add references",
          filters: [{ name: "Images", extensions: IMAGE_EXTENSIONS }],
        })
        if (picked.canceled || picked.filePaths.length === 0) {
          return { added: [] as string[] }
        }
        sources = picked.filePaths
      }

      const sceneFolderRel = dirname(input.relPath)
      const mediaRel = join(sceneFolderRel, SCENE_REFERENCES_DIRNAME)
      const mediaDir = resolveInside(root, mediaRel)
      await mkdir(mediaDir, { recursive: true })

      const added: string[] = []
      for (const src of sources) {
        if (!isSupportedImagePath(src)) continue
        const destination = uniqueDestination(mediaDir, basename(src))
        await copyFile(src, destination)
        added.push(relative(root, destination))
      }
      return { added }
    }),
})
