import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, isAbsolute, relative, resolve } from "node:path"
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
    await git.commit(`Backlot: update multishot (${relPath})`, [relPath])
  } catch (err) {
    console.warn("[multishots.write] user edit settlement skipped:", err)
  }
}

const rootInput = {
  chatId: z.string().optional(),
  projectId: z.string().optional(),
}

export const multishotsRouter = router({
  /** Read a scene's multishot file. `relPath` points at multishot.backlot.json. */
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
        const raw = await readFile(fullPath, "utf-8")
        // The agent can author this file directly with the Write tool, so
        // normalize on read — fill missing versions/status/schemaVersion so
        // a near-miss write still renders. Invalid JSON still fails here.
        return {
          exists: true as const,
          multishot: normalizeMultishot(JSON.parse(raw)),
        }
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
      if (shouldSettle) {
        await settleUserEdit(root, input.relPath)
      }
      return { written: true, relPath: input.relPath }
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
