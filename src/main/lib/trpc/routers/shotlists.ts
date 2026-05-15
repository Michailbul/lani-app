import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, isAbsolute, relative, resolve } from "node:path"
import { eq } from "drizzle-orm"
import simpleGit from "simple-git"
import { z } from "zod"
import { chats, getDatabase, projects } from "../../db"
import type { SceneShotlist } from "../../../../shared/shotlist-types"
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
    await git.commit(`Backlot: update shotlist (${relPath})`, [relPath])
  } catch (err) {
    console.warn("[shotlists.write] user edit settlement skipped:", err)
  }
}

const rootInput = {
  chatId: z.string().optional(),
  projectId: z.string().optional(),
}

export const shotlistsRouter = router({
  /** Read a single scene's shotlist file. `relPath` points at shotlist.backlot.json. */
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
        const raw = await readFile(fullPath, "utf-8")
        return { exists: true as const, shotlist: JSON.parse(raw) as SceneShotlist }
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
      if (shouldSettle) {
        await settleUserEdit(root, input.relPath)
      }
      return { written: true, relPath: input.relPath }
    }),
})
