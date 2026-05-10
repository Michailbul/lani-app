import { execFile } from "node:child_process"
import { randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, relative, resolve, sep } from "node:path"
import { promisify } from "node:util"
import { eq } from "drizzle-orm"
import simpleGit from "simple-git"
import { z } from "zod"
import { chats, getDatabase } from "../../db"
import { publicProcedure, router } from "../index"

const execFileAsync = promisify(execFile)

/**
 * Paths router — Cursor-style git diff review for ANY file the agent
 * touches in the chat's working tree.
 *
 * The screenplay-specific artifacts router (artifacts.ts) is locked to
 * one path (main-script.fountain). This router parameterises every
 * procedure by `{ chatId, relPath }` so the entity editor can present
 * a diff layer on top of any file the agent edits — characters,
 * locations, scenes, briefs, anything in the worktree.
 *
 * Diff parsing helpers (parseUnifiedDiff, synthesizeAllAddHunk,
 * buildSingleHunkPatch) are intentionally duplicated from artifacts.ts
 * rather than centralised — keeping the screenplay flow stable while
 * this generalisation matures. We can DRY later once the surfaces
 * have settled.
 */

interface WorktreeLookup {
  worktreePath: string | null
  chatName: string | null
}

function lookupWorktree(chatId: string): WorktreeLookup | null {
  const db = getDatabase()
  const row = db
    .select({
      worktreePath: chats.worktreePath,
      name: chats.name,
    })
    .from(chats)
    .where(eq(chats.id, chatId))
    .get()
  if (!row) return null
  return { worktreePath: row.worktreePath, chatName: row.name }
}

/**
 * Resolve a user-provided relative path inside the worktree, refusing
 * any value that would escape the root (`..` traversal, absolute paths,
 * symlinks targeting outside the tree). Returns the absolute path on
 * success.
 */
function resolveRelPath(worktreePath: string, relPath: string): string {
  const trimmed = relPath.trim().replace(/^\/+/, "")
  if (!trimmed) {
    throw new Error("Empty path is not allowed.")
  }
  const abs = resolve(worktreePath, trimmed)
  const wtAbs = resolve(worktreePath)
  if (abs !== wtAbs && !abs.startsWith(wtAbs + sep)) {
    throw new Error(`Path escapes the worktree: ${relPath}`)
  }
  return abs
}

/**
 * Normalise the `git status --porcelain` line for a given path. Possible
 * outcomes (Cursor-equivalent letters):
 *   "modified" — index or working-tree change vs HEAD (M / MM / AM / ...)
 *   "added"    — staged-add of a previously untracked file (A)
 *   "untracked"— "??" — never seen by git
 *   "deleted"  — D (the file was removed)
 *   "renamed"  — R (rename, treated as modified for review purposes)
 *   "clean"    — no porcelain output for this path
 */
type FileStatus =
  | "modified"
  | "added"
  | "untracked"
  | "deleted"
  | "renamed"
  | "clean"

function parsePorcelainStatus(line: string): FileStatus {
  if (!line) return "clean"
  // Porcelain v1 format: XY <path> where X is index status, Y is worktree.
  if (line.startsWith("??")) return "untracked"
  const xy = line.slice(0, 2)
  if (xy.includes("D")) return "deleted"
  if (xy.includes("R")) return "renamed"
  if (xy.includes("A")) return "added"
  if (xy.includes("M")) return "modified"
  return "modified"
}

export interface DiffLine {
  kind: "add" | "del" | "ctx"
  text: string
  oldNo: number | null
  newNo: number | null
}

export interface DiffHunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  header: string
  lines: DiffLine[]
}

function synthesizeAllAddHunk(content: string): DiffHunk {
  const lines = content.split("\n")
  const cleaned =
    lines.length > 0 && lines[lines.length - 1] === "" ? lines.slice(0, -1) : lines
  return {
    oldStart: 0,
    oldLines: 0,
    newStart: 1,
    newLines: cleaned.length,
    header: `@@ -0,0 +1,${cleaned.length} @@`,
    lines: cleaned.map((text, i) => ({
      kind: "add" as const,
      text,
      oldNo: null,
      newNo: i + 1,
    })),
  }
}

function parseUnifiedDiff(unified: string): DiffHunk[] {
  const lines = unified.split("\n")
  const hunks: DiffHunk[] = []
  let current: DiffHunk | null = null
  let oldNo = 0
  let newNo = 0

  for (const line of lines) {
    if (
      line.startsWith("diff --git") ||
      line.startsWith("index ") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ") ||
      line.startsWith("\\ No newline at end of file")
    ) {
      continue
    }
    const hunkMatch = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line)
    if (hunkMatch) {
      if (current) hunks.push(current)
      const oldStart = parseInt(hunkMatch[1], 10)
      const oldLines = hunkMatch[2] ? parseInt(hunkMatch[2], 10) : 1
      const newStart = parseInt(hunkMatch[3], 10)
      const newLines = hunkMatch[4] ? parseInt(hunkMatch[4], 10) : 1
      current = {
        oldStart,
        oldLines,
        newStart,
        newLines,
        header: line,
        lines: [],
      }
      oldNo = oldStart
      newNo = newStart
      continue
    }
    if (!current) continue
    if (line.startsWith("+")) {
      current.lines.push({
        kind: "add",
        text: line.slice(1),
        oldNo: null,
        newNo: newNo++,
      })
    } else if (line.startsWith("-")) {
      current.lines.push({
        kind: "del",
        text: line.slice(1),
        oldNo: oldNo++,
        newNo: null,
      })
    } else if (line.startsWith(" ")) {
      current.lines.push({
        kind: "ctx",
        text: line.slice(1),
        oldNo: oldNo++,
        newNo: newNo++,
      })
    }
  }
  if (current) hunks.push(current)
  return hunks
}

/**
 * Build a synthetic single-hunk patch for `git apply`. We re-run
 * `git diff` at call time so hunk indices match the renderer's most
 * recent render (the EntityEditor refetches every 2s).
 */
async function buildSingleHunkPatch(
  worktreePath: string,
  relPath: string,
  hunkIndex: number,
): Promise<string> {
  const git = simpleGit(worktreePath)
  const unified = await git.diff([
    "--no-color",
    "--unified=3",
    "--",
    relPath,
  ])
  if (!unified.trim()) {
    throw new Error("No pending changes to slice — diff is empty.")
  }

  const firstHunkAt = unified.indexOf("\n@@")
  if (firstHunkAt < 0) {
    throw new Error("Diff has no hunks.")
  }
  const fileHeader = unified.slice(0, firstHunkAt).trimEnd()
  const hunkBlock = unified.slice(firstHunkAt + 1)

  const hunkStarts: number[] = []
  for (let i = 0; i < hunkBlock.length; i++) {
    if ((i === 0 || hunkBlock[i - 1] === "\n") && hunkBlock.startsWith("@@", i)) {
      hunkStarts.push(i)
    }
  }
  if (hunkIndex < 0 || hunkIndex >= hunkStarts.length) {
    throw new Error(
      `Hunk index ${hunkIndex} out of range (${hunkStarts.length} hunks).`,
    )
  }
  const start = hunkStarts[hunkIndex]
  const end =
    hunkIndex + 1 < hunkStarts.length
      ? hunkStarts[hunkIndex + 1]
      : hunkBlock.length
  const singleHunk = hunkBlock.slice(start, end)

  return `${fileHeader}\n${singleHunk}${singleHunk.endsWith("\n") ? "" : "\n"}`
}

export const pathsRouter = router({
  /**
   * Status + diff for a single file in the chat's working tree.
   * Status values mirror the screenplay artifact router so the same
   * UI components can consume both shapes.
   */
  diff: publicProcedure
    .input(z.object({ chatId: z.string(), relPath: z.string() }))
    .query(async ({ input }) => {
      const lookup = lookupWorktree(input.chatId)
      if (!lookup?.worktreePath) {
        return { status: "missing" as const, hunks: [] as DiffHunk[] }
      }

      let abs: string
      try {
        abs = resolveRelPath(lookup.worktreePath, input.relPath)
      } catch {
        return { status: "missing" as const, hunks: [] }
      }
      const fileExists = existsSync(abs)

      const git = simpleGit(lookup.worktreePath)
      let porcelain = ""
      try {
        porcelain = await git.raw([
          "status",
          "--porcelain",
          "--",
          input.relPath,
        ])
      } catch {
        // Not a git repo at all — there's nothing to diff against.
        if (fileExists) {
          const content = await readFile(abs, "utf-8")
          return {
            status: "untracked" as const,
            hunks: [synthesizeAllAddHunk(content)],
          }
        }
        return { status: "missing" as const, hunks: [] }
      }

      const trimmed = porcelain.trim()
      if (trimmed === "") {
        return fileExists
          ? { status: "clean" as const, hunks: [] }
          : { status: "missing" as const, hunks: [] }
      }

      const status = parsePorcelainStatus(trimmed)
      if (status === "untracked" && fileExists) {
        const content = await readFile(abs, "utf-8")
        return {
          status: "untracked" as const,
          hunks: [synthesizeAllAddHunk(content)],
        }
      }
      if (status === "deleted") {
        return { status: "deleted" as const, hunks: [] }
      }

      let unified = ""
      try {
        unified = await git.diff([
          "--no-color",
          "--unified=3",
          "--",
          input.relPath,
        ])
      } catch (err) {
        console.warn("[paths.diff] git diff failed:", err)
        return { status: "clean" as const, hunks: [] }
      }
      if (!unified.trim()) {
        return { status: "clean" as const, hunks: [] }
      }
      return {
        status: "modified" as const,
        hunks: parseUnifiedDiff(unified),
      }
    }),

  /**
   * List every file with pending changes (vs HEAD) in the chat's
   * working tree. Powers the file-tree status badges so the user
   * can spot at a glance which files have been touched.
   *
   * Heavy filtering is intentional — only the entries we care to
   * show: modified / added / untracked / deleted / renamed.
   */
  changedFiles: publicProcedure
    .input(z.object({ chatId: z.string() }))
    .query(async ({ input }) => {
      const lookup = lookupWorktree(input.chatId)
      if (!lookup?.worktreePath) return [] as { relPath: string; status: FileStatus }[]

      const git = simpleGit(lookup.worktreePath)
      let porcelain = ""
      try {
        porcelain = await git.raw(["status", "--porcelain"])
      } catch {
        return []
      }

      const out: { relPath: string; status: FileStatus }[] = []
      for (const raw of porcelain.split("\n")) {
        if (!raw) continue
        const status = parsePorcelainStatus(raw)
        // Porcelain format:  "XY <path>" or  "XY <path> -> <newpath>"
        // The first 3 chars are "XY " (status + space). Strip it.
        const rest = raw.slice(3)
        const rel = status === "renamed" ? rest.split(" -> ").pop()! : rest
        // Strip surrounding quotes if git quoted the path (special chars).
        const cleaned = rel.startsWith('"') && rel.endsWith('"')
          ? rel.slice(1, -1).replace(/\\\\/g, "\\").replace(/\\"/g, '"')
          : rel
        out.push({ relPath: cleaned, status })
      }
      return out
    }),

  /**
   * Accept a file's pending changes — `git add <path>` + commit. The
   * working tree continues; only this one file is committed.
   */
  accept: publicProcedure
    .input(
      z.object({
        chatId: z.string(),
        relPath: z.string(),
        message: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const lookup = lookupWorktree(input.chatId)
      if (!lookup?.worktreePath) throw new Error("Chat has no worktree.")
      // Validate path stays inside the worktree.
      resolveRelPath(lookup.worktreePath, input.relPath)
      const git = simpleGit(lookup.worktreePath)
      await git.add([input.relPath])
      const result = await git.commit(
        input.message?.trim() ||
          `Backlot: accept ${input.relPath} (${new Date().toISOString()})`,
        [input.relPath],
        ["--allow-empty"],
      )
      return { commitHash: result.commit }
    }),

  /**
   * Reject a file's pending changes — discard back to HEAD. Untracked
   * files are unlinked outright; modified files get
   * `git checkout HEAD -- <path>`.
   */
  reject: publicProcedure
    .input(z.object({ chatId: z.string(), relPath: z.string() }))
    .mutation(async ({ input }) => {
      const lookup = lookupWorktree(input.chatId)
      if (!lookup?.worktreePath) throw new Error("Chat has no worktree.")
      const abs = resolveRelPath(lookup.worktreePath, input.relPath)
      const git = simpleGit(lookup.worktreePath)

      let porcelain = ""
      try {
        porcelain = await git.raw([
          "status",
          "--porcelain",
          "--",
          input.relPath,
        ])
      } catch {
        /* not a repo — fall through to unlink */
      }
      const isUntracked = porcelain.trim().startsWith("??")
      if (isUntracked) {
        try {
          await unlink(abs)
        } catch (err) {
          console.warn("[paths.reject] unlink failed:", err)
        }
        return { reverted: true, kind: "deleted" as const }
      }

      await git.checkout(["HEAD", "--", input.relPath])
      return { reverted: true, kind: "reverted" as const }
    }),

  /**
   * Accept a single hunk — synthesise a single-hunk patch, stage it,
   * commit. Other hunks stay pending in the working tree.
   */
  acceptHunk: publicProcedure
    .input(
      z.object({
        chatId: z.string(),
        relPath: z.string(),
        hunkIndex: z.number().int().min(0),
      }),
    )
    .mutation(async ({ input }) => {
      const lookup = lookupWorktree(input.chatId)
      if (!lookup?.worktreePath) throw new Error("Chat has no worktree.")
      resolveRelPath(lookup.worktreePath, input.relPath)
      const patch = await buildSingleHunkPatch(
        lookup.worktreePath,
        input.relPath,
        input.hunkIndex,
      )
      const tmp = join(tmpdir(), `backlot-pathhunk-${randomUUID()}.patch`)
      await writeFile(tmp, patch, "utf-8")
      try {
        await execFileAsync(
          "git",
          ["apply", "--cached", "--whitespace=nowarn", tmp],
          { cwd: lookup.worktreePath },
        )
        const git = simpleGit(lookup.worktreePath)
        const result = await git.commit(
          `Backlot: accept hunk ${input.hunkIndex + 1} of ${input.relPath} (${new Date().toISOString()})`,
          [input.relPath],
        )
        return { commitHash: result.commit }
      } finally {
        await unlink(tmp).catch(() => {})
      }
    }),

  /**
   * Reject a single hunk — apply the patch in reverse against the
   * working tree. Region reverts to HEAD; other hunks stay pending.
   * Untracked files have no HEAD baseline; for those, dismissal is
   * "delete the whole file" via the `reject` procedure.
   */
  rejectHunk: publicProcedure
    .input(
      z.object({
        chatId: z.string(),
        relPath: z.string(),
        hunkIndex: z.number().int().min(0),
      }),
    )
    .mutation(async ({ input }) => {
      const lookup = lookupWorktree(input.chatId)
      if (!lookup?.worktreePath) throw new Error("Chat has no worktree.")
      resolveRelPath(lookup.worktreePath, input.relPath)
      const patch = await buildSingleHunkPatch(
        lookup.worktreePath,
        input.relPath,
        input.hunkIndex,
      )
      const tmp = join(tmpdir(), `backlot-pathhunk-${randomUUID()}.patch`)
      await writeFile(tmp, patch, "utf-8")
      try {
        await execFileAsync(
          "git",
          ["apply", "--reverse", "--whitespace=nowarn", tmp],
          { cwd: lookup.worktreePath },
        )
        return { reverted: true }
      } finally {
        await unlink(tmp).catch(() => {})
      }
    }),
})

export type PathsRouter = typeof pathsRouter
