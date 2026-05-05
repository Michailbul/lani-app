import { existsSync } from "node:fs"
import { mkdir, readFile, stat, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { eq } from "drizzle-orm"
import simpleGit from "simple-git"
import { z } from "zod"
import { chats, getDatabase } from "../../db"
import { publicProcedure, router } from "../index"

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
          await import("node:fs/promises").then((fs) => fs.unlink(fullPath))
        } catch (err) {
          console.warn("[artifacts.reject] unlink failed:", err)
        }
        return { reverted: true, kind: "deleted" as const }
      }

      await git.checkout(["HEAD", "--", PRIMARY_ARTIFACT])
      return { reverted: true, kind: "reverted" as const }
    }),
})

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
