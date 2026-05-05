import { execFile } from "node:child_process"
import { randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { promisify } from "node:util"
import { eq } from "drizzle-orm"
import simpleGit from "simple-git"
import { z } from "zod"
import { chats, getDatabase } from "../../db"
import { publicProcedure, router } from "../index"

const execFileAsync = promisify(execFile)

/**
 * Backlot artifact router.
 *
 * The "artifact" is whatever screenplay file the agent edits in place.
 * Convention: each chat (= direction = git worktree) has a primary
 * artifact at <worktreePath>/screenplay.fountain. The agent is steered
 * (via system prompt in claude.ts) to use Edit/Write on this file
 * instead of pasting screenplay content into chat. Backlot's editor
 * pane reads the file and renders the result.
 *
 * Future: support multiple artifacts per direction (act files, character
 * bibles, beat sheets), with a primary marker. v1 does one file per
 * direction to keep the surface tight.
 */

const PRIMARY_ARTIFACT = "screenplay.fountain"
const ARTIFACT_PLACEHOLDER =
  "Title: Untitled\nCredit: Written by\nAuthor: \n\n# Act I\n\nFADE IN:\n\nINT. — — DAY\n\n"

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

function resolveArtifactPath(worktreePath: string): string {
  return join(worktreePath, PRIMARY_ARTIFACT)
}

export const artifactsRouter = router({
  /**
   * Read the primary screenplay artifact for a chat. Returns null content
   * if the chat has no worktree (legacy chats from before worktree
   * isolation) or if the file does not exist yet. Callers should not
   * panic on null — they can call `ensure` to seed an empty artifact.
   */
  read: publicProcedure
    .input(z.object({ chatId: z.string() }))
    .query(async ({ input }) => {
      const lookup = lookupWorktree(input.chatId)
      if (!lookup?.worktreePath) {
        return {
          path: null as string | null,
          relativePath: PRIMARY_ARTIFACT,
          content: null as string | null,
          exists: false,
          mtime: null as number | null,
        }
      }
      const fullPath = resolveArtifactPath(lookup.worktreePath)
      if (!existsSync(fullPath)) {
        return {
          path: fullPath,
          relativePath: PRIMARY_ARTIFACT,
          content: null,
          exists: false,
          mtime: null,
        }
      }
      const [content, stats] = await Promise.all([
        readFile(fullPath, "utf-8"),
        stat(fullPath),
      ])
      return {
        path: fullPath,
        relativePath: PRIMARY_ARTIFACT,
        content,
        exists: true,
        mtime: stats.mtimeMs,
      }
    }),

  /**
   * Ensure the artifact exists. Idempotent — if the file is already there
   * we leave it alone. Used both by the chat pre-flight (so the agent has
   * a real file to Edit on the first turn) and by the renderer when the
   * user opens a fresh direction.
   */
  ensure: publicProcedure
    .input(z.object({ chatId: z.string() }))
    .mutation(async ({ input }) => {
      const lookup = lookupWorktree(input.chatId)
      if (!lookup?.worktreePath) {
        return { path: null, created: false }
      }
      const result = await ensurePrimaryArtifact(lookup.worktreePath)
      return { path: result.path, created: result.created }
    }),

  /**
   * User-side write — for when the user types directly in the editor (the
   * real CodeMirror surface lands in Phase D2). The agent edits via the
   * SDK's Edit/Write tools; this is the parallel path for human edits.
   */
  write: publicProcedure
    .input(
      z.object({
        chatId: z.string(),
        content: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      const lookup = lookupWorktree(input.chatId)
      if (!lookup?.worktreePath) {
        throw new Error(
          "Chat has no worktree. Cannot save the screenplay artifact.",
        )
      }
      const fullPath = resolveArtifactPath(lookup.worktreePath)
      await mkdir(dirname(fullPath), { recursive: true })
      await writeFile(fullPath, input.content, "utf-8")
      const stats = await stat(fullPath)
      return { path: fullPath, mtime: stats.mtimeMs }
    }),

  /**
   * Diff the screenplay artifact against its last committed (HEAD) state.
   * The Cursor-style review surface in the renderer reads this and renders
   * additions / deletions / context as green / red / neutral hunks.
   *
   * Returns:
   *   - status: "untracked" → file is brand-new, no HEAD version yet
   *             "modified"  → file has uncommitted changes against HEAD
   *             "clean"     → file matches HEAD; nothing to review
   *             "missing"   → no worktree or no file at all
   *   - hunks: parsed unified diff (only when status is "modified" or
   *            "untracked"); each hunk is a list of lines with kind
   *            "add" / "del" / "ctx" plus old/new line numbers.
   */
  diff: publicProcedure
    .input(z.object({ chatId: z.string() }))
    .query(async ({ input }) => {
      const lookup = lookupWorktree(input.chatId)
      if (!lookup?.worktreePath) {
        return { status: "missing" as const, hunks: [] as DiffHunk[] }
      }
      const fullPath = resolveArtifactPath(lookup.worktreePath)
      if (!existsSync(fullPath)) {
        return { status: "missing" as const, hunks: [] }
      }

      const git = simpleGit(lookup.worktreePath)

      // Untracked file → synthesize an "all additions" hunk relative to /dev/null.
      let porcelain = ""
      try {
        porcelain = await git.raw(["status", "--porcelain", "--", PRIMARY_ARTIFACT])
      } catch {
        // Not a git repo — treat as untracked.
      }
      const isUntracked = porcelain.trim().startsWith("??")
      if (isUntracked) {
        const content = await readFile(fullPath, "utf-8")
        return {
          status: "untracked" as const,
          hunks: [synthesizeAllAddHunk(content)],
        }
      }
      if (porcelain.trim() === "") {
        return { status: "clean" as const, hunks: [] }
      }

      let unified = ""
      try {
        unified = await git.diff([
          "--no-color",
          "--unified=3",
          "--",
          PRIMARY_ARTIFACT,
        ])
      } catch (err) {
        console.warn("[artifacts.diff] git diff failed:", err)
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
   * Accept the current pending changes — git add + commit. Bumps the
   * "last approved" baseline forward. Returns the new HEAD sha.
   */
  accept: publicProcedure
    .input(
      z.object({
        chatId: z.string(),
        message: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const lookup = lookupWorktree(input.chatId)
      if (!lookup?.worktreePath) {
        throw new Error("Chat has no worktree.")
      }
      const git = simpleGit(lookup.worktreePath)
      await git.add([PRIMARY_ARTIFACT])
      const result = await git.commit(
        input.message?.trim() ||
          `Backlot: accept screenplay edit (${new Date().toISOString()})`,
        [PRIMARY_ARTIFACT],
        ["--allow-empty"],
      )
      return { commitHash: result.commit }
    }),

  /**
   * Reject the current pending changes — discard back to HEAD. For
   * untracked files we just remove them; for modified files we
   * `git checkout HEAD -- <file>`.
   */
  reject: publicProcedure
    .input(z.object({ chatId: z.string() }))
    .mutation(async ({ input }) => {
      const lookup = lookupWorktree(input.chatId)
      if (!lookup?.worktreePath) {
        throw new Error("Chat has no worktree.")
      }
      const git = simpleGit(lookup.worktreePath)
      const fullPath = resolveArtifactPath(lookup.worktreePath)

      let porcelain = ""
      try {
        porcelain = await git.raw([
          "status",
          "--porcelain",
          "--",
          PRIMARY_ARTIFACT,
        ])
      } catch {
        /* not a repo — fall through to the unlink path */
      }
      const isUntracked = porcelain.trim().startsWith("??")

      if (isUntracked) {
        // Brand-new file the agent created. Delete it.
        try {
          await unlink(fullPath)
        } catch (err) {
          console.warn("[artifacts.reject] unlink failed:", err)
        }
        return { reverted: true, kind: "deleted" as const }
      }

      await git.checkout(["HEAD", "--", PRIMARY_ARTIFACT])
      return { reverted: true, kind: "reverted" as const }
    }),

  /**
   * Accept a single hunk. Cursor-style — the user reviewed change N and
   * wants to keep just that one. We regenerate the unified diff, slice
   * the requested hunk + the diff's file headers into a synthetic
   * single-hunk patch, `git apply --cached` to stage just that hunk,
   * then commit. Other hunks stay unstaged in the working tree, ready
   * for their own decision.
   */
  acceptHunk: publicProcedure
    .input(z.object({ chatId: z.string(), hunkIndex: z.number().int().min(0) }))
    .mutation(async ({ input }) => {
      const lookup = lookupWorktree(input.chatId)
      if (!lookup?.worktreePath) {
        throw new Error("Chat has no worktree.")
      }
      const patch = await buildSingleHunkPatch(
        lookup.worktreePath,
        input.hunkIndex,
      )
      const tmp = join(tmpdir(), `backlot-hunk-${randomUUID()}.patch`)
      await writeFile(tmp, patch, "utf-8")
      try {
        await execFileAsync("git", ["apply", "--cached", "--whitespace=nowarn", tmp], {
          cwd: lookup.worktreePath,
        })
        const git = simpleGit(lookup.worktreePath)
        const result = await git.commit(
          `Backlot: accept hunk ${input.hunkIndex + 1} (${new Date().toISOString()})`,
          [PRIMARY_ARTIFACT],
        )
        return { commitHash: result.commit }
      } finally {
        await unlink(tmp).catch(() => {})
      }
    }),

  /**
   * Reject a single hunk. Synthesise the same single-hunk patch as
   * acceptHunk, but apply it `--reverse` to the working tree — the
   * region for that hunk reverts to HEAD while every other hunk stays
   * pending. Untracked files have no HEAD to revert to per-hunk; for
   * those, dismissal is "delete the whole file" (use the global
   * `reject` procedure).
   */
  rejectHunk: publicProcedure
    .input(z.object({ chatId: z.string(), hunkIndex: z.number().int().min(0) }))
    .mutation(async ({ input }) => {
      const lookup = lookupWorktree(input.chatId)
      if (!lookup?.worktreePath) {
        throw new Error("Chat has no worktree.")
      }
      const patch = await buildSingleHunkPatch(
        lookup.worktreePath,
        input.hunkIndex,
      )
      const tmp = join(tmpdir(), `backlot-hunk-${randomUUID()}.patch`)
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

  /**
   * History — list commits that touched the primary screenplay artifact.
   * Powers the "time travel" view: each entry is a snapshot the user can
   * preview or restore.
   *
   * `git log --follow` traces the artifact across renames so a future
   * "rename screenplay.fountain to act-1.fountain" wouldn't cut off the
   * timeline.
   */
  history: publicProcedure
    .input(
      z.object({
        chatId: z.string(),
        limit: z.number().int().min(1).max(200).default(80),
      }),
    )
    .query(async ({ input }) => {
      const lookup = lookupWorktree(input.chatId)
      if (!lookup?.worktreePath) return []
      const git = simpleGit(lookup.worktreePath)

      const sep = "" // unit separator — safe inside commit subjects
      const recordSep = ""
      try {
        const log = await git.raw([
          "log",
          "--follow",
          `--format=%H${sep}%h${sep}%s${sep}%an${sep}%aI${sep}%ar${recordSep}`,
          `-${input.limit}`,
          "--",
          PRIMARY_ARTIFACT,
        ])
        const records = log.split(recordSep).map((s) => s.trim()).filter(Boolean)
        const commits = records.map((r) => {
          const [hash, shortHash, subject, author, isoDate, relativeDate] = r.split(sep)
          return {
            hash,
            shortHash,
            subject,
            author,
            isoDate,
            relativeDate,
            additions: 0,
            deletions: 0,
          }
        })

        // Enrich with +/- numstat per commit. Separate call so the format
        // string stays simple.
        try {
          const numstat = await git.raw([
            "log",
            "--follow",
            "--numstat",
            "--format=__BACKLOT_COMMIT__:%H",
            `-${input.limit}`,
            "--",
            PRIMARY_ARTIFACT,
          ])
          let currentHash = ""
          for (const line of numstat.split("\n")) {
            if (line.startsWith("__BACKLOT_COMMIT__:")) {
              currentHash = line.slice("__BACKLOT_COMMIT__:".length).trim()
            } else {
              const m = /^(\d+|-)\s+(\d+|-)\s+/.exec(line)
              if (m && currentHash) {
                const c = commits.find((c) => c.hash === currentHash)
                if (c) {
                  c.additions = m[1] === "-" ? 0 : parseInt(m[1], 10)
                  c.deletions = m[2] === "-" ? 0 : parseInt(m[2], 10)
                }
              }
            }
          }
        } catch (e) {
          console.warn("[artifacts.history] numstat enrichment failed:", e)
        }
        return commits
      } catch (err) {
        console.warn("[artifacts.history] git log failed:", err)
        return []
      }
    }),

  /**
   * Snapshot of the screenplay at a specific commit. `git show <hash>:path`.
   */
  versionAt: publicProcedure
    .input(z.object({ chatId: z.string(), commitHash: z.string().min(7) }))
    .query(async ({ input }) => {
      const lookup = lookupWorktree(input.chatId)
      if (!lookup?.worktreePath) return { content: null as string | null }
      const git = simpleGit(lookup.worktreePath)
      try {
        const content = await git.raw([
          "show",
          `${input.commitHash}:${PRIMARY_ARTIFACT}`,
        ])
        return { content }
      } catch (err) {
        console.warn("[artifacts.versionAt] git show failed:", err)
        return { content: null }
      }
    }),

  /**
   * Restore the working tree to a historical commit's version of the
   * screenplay. Doesn't auto-commit — the restoration shows up as a
   * pending diff against current HEAD, so the user can review the time
   * travel like any other edit and Accept (which records a new commit
   * pointing back to the snapshot) or Revert (returns to the previous
   * head, dismissing the time travel).
   */
  restore: publicProcedure
    .input(z.object({ chatId: z.string(), commitHash: z.string().min(7) }))
    .mutation(async ({ input }) => {
      const lookup = lookupWorktree(input.chatId)
      if (!lookup?.worktreePath) {
        throw new Error("Chat has no worktree.")
      }
      const git = simpleGit(lookup.worktreePath)
      const content = await git.raw([
        "show",
        `${input.commitHash}:${PRIMARY_ARTIFACT}`,
      ])
      const fullPath = resolveArtifactPath(lookup.worktreePath)
      await writeFile(fullPath, content, "utf-8")
      return { restored: true, commitHash: input.commitHash }
    }),

  /**
   * Dismiss a single line — the finest review granularity.
   *
   * For a "+" line: build a 1-line --unidiff-zero patch describing that
   * line being added at newNo, then `git apply --reverse` removes it.
   * For a "-" line: same shape but describing that line being removed
   * from oldNo; --reverse re-inserts it. Other pending lines stay put.
   *
   * Inputs are the line's oldNo / newNo / text from the most recent
   * artifacts.diff() result — the renderer sends them when the user
   * clicks the per-line × button. The 2s refetchInterval keeps these
   * values fresh; the server doesn't try to validate or re-derive them.
   */
  dismissLine: publicProcedure
    .input(
      z.object({
        chatId: z.string(),
        kind: z.enum(["add", "del"]),
        oldNo: z.number().int().nullable(),
        newNo: z.number().int().nullable(),
        text: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      const lookup = lookupWorktree(input.chatId)
      if (!lookup?.worktreePath) {
        throw new Error("Chat has no worktree.")
      }
      const fileHeader = `--- a/${PRIMARY_ARTIFACT}\n+++ b/${PRIMARY_ARTIFACT}`

      let hunkHeader: string
      let body: string
      if (input.kind === "add") {
        if (input.newNo == null) {
          throw new Error("Add line requires newNo.")
        }
        // -X,0 +Y,1 → "Y is the location of one new added line"
        const oldAnchor = input.oldNo ?? Math.max(0, input.newNo - 1)
        hunkHeader = `@@ -${oldAnchor},0 +${input.newNo},1 @@`
        body = `+${input.text}`
      } else {
        if (input.oldNo == null) {
          throw new Error("Del line requires oldNo.")
        }
        // -X,1 +Y,0 → "X is the location of one removed line"
        const newAnchor = input.newNo ?? Math.max(0, input.oldNo - 1)
        hunkHeader = `@@ -${input.oldNo},1 +${newAnchor},0 @@`
        body = `-${input.text}`
      }

      const patch = `${fileHeader}\n${hunkHeader}\n${body}\n`
      const tmp = join(tmpdir(), `backlot-line-${randomUUID()}.patch`)
      await writeFile(tmp, patch, "utf-8")
      try {
        await execFileAsync(
          "git",
          [
            "apply",
            "--reverse",
            "--unidiff-zero",
            "--whitespace=nowarn",
            tmp,
          ],
          { cwd: lookup.worktreePath },
        )
        return { dismissed: true }
      } finally {
        await unlink(tmp).catch(() => {})
      }
    }),
})

/**
 * Build a synthetic single-hunk patch suitable for `git apply`. We
 * regenerate the unified diff at call time (rather than relying on a
 * stale cached diff from the renderer) so hunk indices match what the
 * user is currently looking at — the screenplay pane refetches every 2s
 * so the index is from the most recent diff render.
 */
async function buildSingleHunkPatch(
  worktreePath: string,
  hunkIndex: number,
): Promise<string> {
  const git = simpleGit(worktreePath)
  const unified = await git.diff([
    "--no-color",
    "--unified=3",
    "--",
    PRIMARY_ARTIFACT,
  ])
  if (!unified.trim()) {
    throw new Error("No pending changes to slice — diff is empty.")
  }

  // Split file-header (everything before the first @@) from hunks. Each
  // hunk starts with `@@ -X,Y +A,B @@` and runs until the next `@@` or
  // end of input.
  const firstHunkAt = unified.indexOf("\n@@")
  if (firstHunkAt < 0) {
    throw new Error("Diff has no hunks.")
  }
  const fileHeader = unified.slice(0, firstHunkAt).trimEnd()
  const hunkBlock = unified.slice(firstHunkAt + 1)

  const hunkStarts: number[] = []
  for (let i = 0; i < hunkBlock.length; i++) {
    if (
      (i === 0 || hunkBlock[i - 1] === "\n") &&
      hunkBlock.startsWith("@@", i)
    ) {
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
    hunkIndex + 1 < hunkStarts.length ? hunkStarts[hunkIndex + 1] : hunkBlock.length
  const singleHunk = hunkBlock.slice(start, end)

  // git apply requires a trailing newline.
  return `${fileHeader}\n${singleHunk}${singleHunk.endsWith("\n") ? "" : "\n"}`
}

// ────────────────────────────────────────────────────────────────────────
// Diff parsing — minimal hand-rolled unified-diff reader for one file.
// We don't pull in 1code's full diff-view stack because the screenplay
// surface needs its own renderer; the structure here is what feeds it.
// ────────────────────────────────────────────────────────────────────────

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
  // Trailing empty after final newline — drop to avoid a phantom blank line.
  const cleaned = lines.length > 0 && lines[lines.length - 1] === ""
    ? lines.slice(0, -1)
    : lines
  return {
    oldStart: 0,
    oldLines: 0,
    newStart: 1,
    newLines: cleaned.length,
    header: "@@ -0,0 +1," + cleaned.length + " @@",
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
    // Skip git diff file headers — we only care about hunk content here.
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
 * Helper used by the chat router (claude.ts) to seed the artifact before
 * a turn fires. Ensures the agent's first Edit call has a real file to
 * land on. Mirrors `ensure` but callable from server code without going
 * through tRPC.
 *
 * Also ensures the worktree is a git repo. The diff/accept/revert review
 * surface needs a HEAD baseline to compare against; without git, every
 * agent edit looks "clean" and the user never sees the green/red hunks.
 * If the directory is not yet a repo we `git init` it, set a local
 * identity (so commits don't fail when user has no global git config),
 * and commit the screenplay artifact as the baseline. Other files in
 * the directory are NOT auto-staged — only screenplay.fountain — so
 * the user's existing tree stays under their control.
 */
export async function ensurePrimaryArtifact(
  worktreePath: string,
): Promise<{ path: string; relativePath: string; created: boolean }> {
  const fullPath = resolveArtifactPath(worktreePath)
  const fileExisted = existsSync(fullPath)

  if (!fileExisted) {
    await mkdir(dirname(fullPath), { recursive: true })
    await writeFile(fullPath, ARTIFACT_PLACEHOLDER, "utf-8")
  }

  try {
    const git = simpleGit(worktreePath)
    let isRepo = await git.checkIsRepo()

    if (!isRepo) {
      console.log(
        `[artifacts] Initialising git repo at ${worktreePath} so the diff review surface has a baseline.`,
      )
      await git.init()
      // Local identity — only used when global config is missing so commits
      // don't fail. Doesn't touch the user's global gitconfig.
      try {
        await git.raw(["config", "--local", "user.email", "backlot@local"])
        await git.raw(["config", "--local", "user.name", "Backlot"])
      } catch {
        /* ignore — identity may already exist globally */
      }
      isRepo = true
    }

    if (isRepo) {
      // Commit screenplay.fountain so HEAD has a baseline. Idempotent —
      // if there's nothing to stage (file unchanged from last commit) we
      // make an --allow-empty commit only when there's no HEAD yet.
      await git.add([PRIMARY_ARTIFACT])
      let hasHead = true
      try {
        await git.raw(["rev-parse", "--verify", "HEAD"])
      } catch {
        hasHead = false
      }
      const status = await git.raw([
        "status",
        "--porcelain",
        "--",
        PRIMARY_ARTIFACT,
      ])
      const hasStaged = status.trim().length > 0
      if (!hasHead || hasStaged) {
        await git.commit(
          fileExisted
            ? "Backlot: baseline screenplay artifact"
            : "Backlot: seed primary screenplay artifact",
          [PRIMARY_ARTIFACT],
          ["--allow-empty"],
        )
      }
    }
  } catch (err) {
    console.warn("[artifacts] git init / baseline commit failed:", err)
  }

  return {
    path: fullPath,
    relativePath: PRIMARY_ARTIFACT,
    created: !fileExisted,
  }
}

export const PRIMARY_ARTIFACT_FILENAME = PRIMARY_ARTIFACT
