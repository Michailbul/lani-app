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
 * Lani artifact router.
 *
 * The "artifact" is whatever screenplay file the agent edits in place.
 * Convention: each chat (= direction = git worktree) has a primary
 * artifact at <worktreePath>/screenplay.fountain. The agent is steered
 * (via system prompt in claude.ts) to use Edit/Write on this file
 * instead of pasting screenplay content into chat. Lani's editor
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
          `Lani: accept screenplay edit (${new Date().toISOString()})`,
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
      const tmp = join(tmpdir(), `lani-hunk-${randomUUID()}.patch`)
      await writeFile(tmp, patch, "utf-8")
      try {
        await execFileAsync("git", ["apply", "--cached", "--whitespace=nowarn", tmp], {
          cwd: lookup.worktreePath,
        })
        const git = simpleGit(lookup.worktreePath)
        const result = await git.commit(
          `Lani: accept hunk ${input.hunkIndex + 1} (${new Date().toISOString()})`,
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
      const tmp = join(tmpdir(), `lani-hunk-${randomUUID()}.patch`)
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
            "--format=__LANI_COMMIT__:%H",
            `-${input.limit}`,
            "--",
            PRIMARY_ARTIFACT,
          ])
          let currentHash = ""
          for (const line of numstat.split("\n")) {
            if (line.startsWith("__LANI_COMMIT__:")) {
              currentHash = line.slice("__LANI_COMMIT__:".length).trim()
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
   * Fountain outline — parse the current screenplay into a tree of
   * sections (`#`, `##`, `###`) and scenes (`INT./EXT.` headings, plus
   * forced `.` headings per the Fountain spec).
   *
   * The frontend uses this to render an expand-button next to every
   * section / scene header. Each node carries its 1-indexed line range
   * (startLine inclusive → endLine inclusive) so `partHistory` /
   * `restorePart` can locate the part both in the current working tree
   * and across historical commits.
   *
   * Identity across commits is by (kind, label, occurrence) — the
   * `occurrence` field disambiguates two parts that share a heading
   * (two `INT. CAR - DAY`, two `# Act I`, etc).
   */
  outline: publicProcedure
    .input(z.object({ chatId: z.string() }))
    .query(async ({ input }) => {
      const lookup = lookupWorktree(input.chatId)
      if (!lookup?.worktreePath) {
        return { tree: [] as OutlineNode[], flat: [] as OutlineNode[] }
      }
      const fullPath = resolveArtifactPath(lookup.worktreePath)
      if (!existsSync(fullPath)) {
        return { tree: [], flat: [] }
      }
      const content = await readFile(fullPath, "utf-8")
      return parseFountainOutline(content)
    }),

  /**
   * Part history — git versioning at the section/scene/range level.
   *
   * For `kind: "section" | "scene"` the matcher is content-based: at
   * each commit we re-parse the file and find the part with the same
   * (label, occurrence) pair. This means the trail follows the part
   * through unrelated edits to the rest of the screenplay — you can
   * scroll the history of "Scene 3: INT. WAREHOUSE - NIGHT" without
   * polluting it with revisions to other scenes. The trade-off: if the
   * heading text was renamed, the trail breaks at that commit (v1
   * limitation; doc'd in CLAUDE).
   *
   * For `kind: "range"` we slice the same line range out of each
   * historical snapshot. Naive — line numbers shift across commits —
   * but useful for "what did these lines look like before?" when the
   * range doesn't align with a section/scene boundary. Out-of-range
   * snapshots are skipped.
   *
   * Dedupe: consecutive commits where the part's content is identical
   * collapse to a single entry, and we keep the OLDEST commit in each
   * run (the one that actually introduced that state). So the user
   * sees one revision per real change to that part, not one revision
   * per file commit.
   *
   * Returns newest-first.
   */
  partHistory: publicProcedure
    .input(
      z.object({
        chatId: z.string(),
        kind: z.enum(["section", "scene", "range"]),
        label: z.string().optional(),
        occurrence: z.number().int().min(0).default(0),
        startLine: z.number().int().min(1).optional(),
        endLine: z.number().int().min(1).optional(),
        limit: z.number().int().min(1).max(200).default(50),
      }),
    )
    .query(async ({ input }) => {
      const lookup = lookupWorktree(input.chatId)
      if (!lookup?.worktreePath) return [] as PartRevision[]
      const git = simpleGit(lookup.worktreePath)

      const SEP = "" // unit separator
      let log = ""
      try {
        log = await git.raw([
          "log",
          "--follow",
          `--format=%H${SEP}%h${SEP}%s${SEP}%an${SEP}%aI${SEP}%ar`,
          // Pull more than `limit` so we can dedupe runs of identical
          // content and still return up to `limit` real changes. 4× is
          // plenty for screenplays where most commits touch *some*
          // part — we can always raise.
          `-${input.limit * 4}`,
          "--",
          PRIMARY_ARTIFACT,
        ])
      } catch (err) {
        console.warn("[artifacts.partHistory] git log failed:", err)
        return []
      }

      interface CommitRow {
        hash: string
        shortHash: string
        subject: string
        author: string
        isoDate: string
        relativeDate: string
      }
      const commits: CommitRow[] = log
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [hash, shortHash, subject, author, isoDate, relativeDate] =
            line.split(SEP)
          return { hash, shortHash, subject, author, isoDate, relativeDate }
        })

      const raw: PartRevision[] = []

      for (const commit of commits) {
        let snapshot: string
        try {
          snapshot = await git.raw([
            "show",
            `${commit.hash}:${PRIMARY_ARTIFACT}`,
          ])
        } catch {
          // File didn't exist at this commit — skip.
          continue
        }

        let partContent: string | null = null
        let pStartLine = 0
        let pEndLine = 0
        let labelMatched: "exact" | "fallback" | null = null

        if (input.kind === "range") {
          if (input.startLine == null || input.endLine == null) continue
          const snapLines = snapshot.split("\n")
          if (input.startLine > snapLines.length) continue
          const start = Math.max(1, Math.min(input.startLine, snapLines.length))
          const end = Math.max(start, Math.min(input.endLine, snapLines.length))
          partContent = snapLines.slice(start - 1, end).join("\n")
          pStartLine = start
          pEndLine = end
        } else {
          const { flat } = parseFountainOutline(snapshot)
          const sameKind = flat.filter(
            (p) => p.kind === input.kind && p.label === input.label,
          )
          if (sameKind.length === 0) continue
          // Prefer same occurrence index; fall back to first match if the
          // occurrence shifted (e.g. an earlier scene of the same name was
          // deleted/inserted before this one). Mark fallback so the UI can
          // hint at the uncertainty.
          const exact = sameKind[input.occurrence]
          const match = exact ?? sameKind[0]
          const snapLines = snapshot.split("\n")
          partContent = snapLines
            .slice(match.startLine - 1, match.endLine)
            .join("\n")
          pStartLine = match.startLine
          pEndLine = match.endLine
          labelMatched = exact ? "exact" : "fallback"
        }

        if (partContent == null) continue

        raw.push({
          hash: commit.hash,
          shortHash: commit.shortHash,
          subject: commit.subject,
          author: commit.author,
          isoDate: commit.isoDate,
          relativeDate: commit.relativeDate,
          content: partContent,
          startLine: pStartLine,
          endLine: pEndLine,
          match: labelMatched,
        })
      }

      // Dedupe runs of identical content — keep the OLDEST commit in each
      // run (the one that introduced that version of the part). Walking
      // newest-first: drop entry i if entry i+1 (older) has the same
      // content; the older entry will represent the run.
      const deduped: PartRevision[] = []
      for (let i = 0; i < raw.length; i++) {
        const next = raw[i + 1]
        if (next && next.content === raw[i].content) continue
        deduped.push(raw[i])
        if (deduped.length >= input.limit) break
      }
      return deduped
    }),

  /**
   * Restore a historical version of a part into the working tree.
   *
   * Splice surgery: replace lines [startLine..endLine] (1-indexed
   * inclusive — the part's CURRENT line range in the working tree) with
   * the supplied content. Doesn't auto-commit; the change shows up as a
   * normal pending diff so the user reviews the time-travel via the
   * existing per-line review surface and accepts/dismisses like any
   * other edit.
   *
   * Caller is responsible for sourcing `content` from `partHistory`.
   * `startLine` / `endLine` should be the part's range in the *current*
   * working tree (NOT the historical snapshot's range — those line
   * numbers wouldn't line up with the current file).
   */
  restorePart: publicProcedure
    .input(
      z.object({
        chatId: z.string(),
        startLine: z.number().int().min(1),
        endLine: z.number().int().min(1),
        content: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      const lookup = lookupWorktree(input.chatId)
      if (!lookup?.worktreePath) {
        throw new Error("Chat has no worktree.")
      }
      const fullPath = resolveArtifactPath(lookup.worktreePath)
      const wtRaw = await readFile(fullPath, "utf-8")
      const wtLines = wtRaw.split("\n")
      const start = Math.max(1, Math.min(input.startLine, wtLines.length + 1))
      const end = Math.max(start, Math.min(input.endLine, wtLines.length))

      const replacement = input.content.split("\n")
      const before = wtLines.slice(0, start - 1)
      const after = wtLines.slice(end)
      const next = [...before, ...replacement, ...after].join("\n")
      await writeFile(fullPath, next, "utf-8")
      return {
        restored: true,
        startLine: start,
        endLine: start + replacement.length - 1,
      }
    }),

  /**
   * Dismiss a single line — the finest review granularity.
   *
   * Direct working-tree string surgery rather than `git apply
   * --unidiff-zero`. The patch-and-apply path was brittle: the renderer
   * supplies oldNo/newNo from a diff snapshot, but every successful
   * dismiss shifts subsequent line numbers in the working tree, so a
   * second click within the 2 s refetch window would silently fail
   * because git couldn't locate the patch's anchor.
   *
   * The surgery is text-based and content-anchored:
   *   - Verify the line exists at the expected line-number first.
   *   - If not, fall back to a content match (text equality, trimmed)
   *     so a stale line number can still find its target.
   *   - For "add" dismiss: splice the line out of the working tree.
   *   - For "del" dismiss: insert HEAD's deleted line back into the
   *     working tree at a position derived from the surrounding HEAD
   *     context that still matches the working tree.
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
      const fullPath = resolveArtifactPath(lookup.worktreePath)
      const wtRaw = await readFile(fullPath, "utf-8")
      const wtLines = wtRaw.split("\n")

      if (input.kind === "add") {
        if (input.newNo == null) {
          throw new Error("Add-line dismissal requires newNo.")
        }
        // First try the diff's reported position; fall back to content
        // match if line numbers have shifted since the diff was fetched.
        const expectedIdx = input.newNo - 1
        let targetIdx = -1
        if (
          expectedIdx >= 0 &&
          expectedIdx < wtLines.length &&
          wtLines[expectedIdx] === input.text
        ) {
          targetIdx = expectedIdx
        } else {
          targetIdx = wtLines.findIndex((l) => l === input.text)
          if (targetIdx < 0) {
            // Last resort: trimmed match (handles whitespace-only diffs).
            targetIdx = wtLines.findIndex(
              (l) => l.trim() === input.text.trim() && l.trim().length > 0,
            )
          }
        }
        if (targetIdx < 0) {
          throw new Error(
            "Could not locate the added line in the working tree — it may have already been dismissed or modified.",
          )
        }
        wtLines.splice(targetIdx, 1)
        await writeFile(fullPath, wtLines.join("\n"), "utf-8")
        return { dismissed: true, kind: "removed-add" as const }
      }

      // kind === "del" → restore the deleted line back into the working tree.
      if (input.oldNo == null) {
        throw new Error("Del-line dismissal requires oldNo.")
      }
      const git = simpleGit(lookup.worktreePath)
      let headContent: string
      try {
        headContent = await git.raw([
          "show",
          `HEAD:${PRIMARY_ARTIFACT}`,
        ])
      } catch (err) {
        throw new Error(`Could not read HEAD version of the artifact: ${err}`)
      }
      const headLines = headContent.split("\n")
      const expectedHeadIdx = input.oldNo - 1
      if (
        expectedHeadIdx < 0 ||
        expectedHeadIdx >= headLines.length ||
        (headLines[expectedHeadIdx] !== input.text &&
          headLines[expectedHeadIdx].trim() !== input.text.trim())
      ) {
        throw new Error(
          "HEAD content has drifted — could not verify the deleted line's source position. Refresh the diff and try again.",
        )
      }

      // Insertion point in the working tree: walk HEAD forward from the
      // deleted line, find the first subsequent HEAD line that still
      // exists in the working tree (a stable anchor), and insert before
      // that anchor's working-tree position. Falls back to end-of-file.
      let insertAt = wtLines.length
      for (let i = expectedHeadIdx + 1; i < headLines.length; i++) {
        const candidate = headLines[i]
        if (!candidate.trim()) continue // skip blank-line anchors (ambiguous)
        const wtIdx = wtLines.indexOf(candidate)
        if (wtIdx >= 0) {
          insertAt = wtIdx
          break
        }
      }
      wtLines.splice(insertAt, 0, input.text)
      await writeFile(fullPath, wtLines.join("\n"), "utf-8")
      return { dismissed: true, kind: "restored-del" as const }
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
// We don't pull in the upstream full diff-view stack because the screenplay
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
        await git.raw(["config", "--local", "user.email", "lani@local"])
        await git.raw(["config", "--local", "user.name", "Lani"])
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
            ? "Lani: baseline screenplay artifact"
            : "Lani: seed primary screenplay artifact",
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

// ────────────────────────────────────────────────────────────────────────
// Fountain outline parser — sections (`#`/`##`/`###`) and scenes
// (`INT./EXT./EST./I/E.` and forced `.HEADING`). Returns both a tree
// (sections nest, scenes attach to their containing section) and a flat
// list (every part in document order, with line ranges) — the renderer
// gutter uses the tree, the partHistory matcher uses the flat list.
//
// We deliberately avoid dragging in a full Fountain parser: the OS app
// already does title-page + dialogue rendering; here we only need part
// boundaries for the history feature. Keep the surface narrow.
// ────────────────────────────────────────────────────────────────────────

export interface OutlineNode {
  /** Stable id for React keys + history queries: `<kind>:<label>:<occurrence>`. */
  id: string
  kind: "section" | "scene"
  /** Heading text without the `#`/`##`/`###` prefix (or leading `.` for forced scenes). */
  label: string
  /** Original heading line, raw — useful for the gutter UI. */
  rawHeading: string
  /** 1/2/3 for sections; 0 for scenes. */
  depth: number
  /** 1-indexed line number of the heading. */
  startLine: number
  /** 1-indexed last line of this part (inclusive). */
  endLine: number
  /** 0-based index of this (kind, label) within the document. */
  occurrence: number
  /** Sections nest by depth; scenes are leaves attached to the deepest containing section (or root). */
  children: OutlineNode[]
}

interface FountainOutline {
  tree: OutlineNode[]
  /** Same nodes as the tree, depth-first / document-order — easy iteration for matchers. */
  flat: OutlineNode[]
}

const SCENE_PREFIX_RE = /^(INT\.\/EXT\.|I\/E\.|INT\.|EXT\.|EST\.)/i

function parseFountainOutline(content: string): FountainOutline {
  const lines = content.split("\n")

  interface RawHeading {
    lineIdx: number // 0-indexed
    kind: "section" | "scene"
    depth: number
    label: string
    raw: string
  }
  const headings: RawHeading[] = []

  // Skip the title-page block — `Key: Value` lines until first blank.
  // We only enter this mode if the first line is a recognised Fountain
  // title-page key, otherwise lines like `FADE IN:` would be eaten as
  // title-page entries.
  let i = 0
  const TITLE_PAGE_KEY_RE =
    /^(Title|Credit|Author|Authors|Source|Notes|Draft date|Date|Contact|Copyright|Revision):/i
  if (lines.length > 0 && TITLE_PAGE_KEY_RE.test(lines[0])) {
    while (i < lines.length && lines[i].trim() !== "") i++
  }

  for (; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    const sec = /^(#{1,3})\s+(.+?)\s*$/.exec(line)
    if (sec) {
      headings.push({
        lineIdx: i,
        kind: "section",
        depth: sec[1].length,
        label: sec[2].trim(),
        raw: line,
      })
      continue
    }

    if (SCENE_PREFIX_RE.test(trimmed)) {
      headings.push({
        lineIdx: i,
        kind: "scene",
        depth: 0,
        label: trimmed,
        raw: line,
      })
      continue
    }

    // Forced scene heading per the Fountain spec: a line starting with `.`
    // (but not `..` which is a synopsis marker for sections — and also not
    // a line that's just dots).
    if (
      trimmed.startsWith(".") &&
      !trimmed.startsWith("..") &&
      trimmed.length > 1
    ) {
      headings.push({
        lineIdx: i,
        kind: "scene",
        depth: 0,
        label: trimmed.slice(1).trim(),
        raw: line,
      })
      continue
    }
  }

  // Compute end-lines (1-indexed inclusive).
  //   - Scene: ends on the line before the next heading of any kind, or EOF.
  //   - Section: ends on the line before the next section at depth ≤ self,
  //     or EOF. Subordinate sections + scenes nested inside stay inside.
  const occMap = new Map<string, number>()
  const flat: OutlineNode[] = headings.map((h, idx) => {
    let endLineExclusive: number // 0-indexed, exclusive
    if (h.kind === "scene") {
      const next = headings[idx + 1]
      endLineExclusive = next ? next.lineIdx : lines.length
    } else {
      let bound = lines.length
      for (let j = idx + 1; j < headings.length; j++) {
        const hj = headings[j]
        if (hj.kind === "section" && hj.depth <= h.depth) {
          bound = hj.lineIdx
          break
        }
      }
      endLineExclusive = bound
    }
    const endLine = Math.max(h.lineIdx + 1, endLineExclusive) // 1-indexed inclusive

    const key = `${h.kind}:${h.label}`
    const occurrence = occMap.get(key) ?? 0
    occMap.set(key, occurrence + 1)

    return {
      id: `${h.kind}:${h.label}:${occurrence}`,
      kind: h.kind,
      label: h.label,
      rawHeading: h.raw,
      depth: h.depth,
      startLine: h.lineIdx + 1,
      endLine,
      occurrence,
      children: [],
    }
  })

  // Build the tree. Sections nest by depth; scenes attach to the deepest
  // containing section in the stack (or root if none).
  const tree: OutlineNode[] = []
  const stack: OutlineNode[] = []
  for (const node of flat) {
    if (node.kind === "section") {
      while (stack.length > 0) {
        const top = stack[stack.length - 1]
        if (top.kind === "section" && top.depth < node.depth) break
        stack.pop()
      }
      ;(stack.length === 0 ? tree : stack[stack.length - 1].children).push(node)
      stack.push(node)
    } else {
      // Scene — attach to deepest containing section (or root).
      let parent: OutlineNode | null = null
      for (let s = stack.length - 1; s >= 0; s--) {
        if (stack[s].kind === "section") {
          parent = stack[s]
          break
        }
      }
      ;(parent ? parent.children : tree).push(node)
      // Don't push scenes onto the stack — they don't contain sections.
    }
  }

  return { tree, flat }
}

// ────────────────────────────────────────────────────────────────────────
// Part history — one revision of a part at a single commit.
// ────────────────────────────────────────────────────────────────────────

export interface PartRevision {
  hash: string
  shortHash: string
  subject: string
  author: string
  isoDate: string
  relativeDate: string
  /** The part's content at this commit (lines joined by `\n`, no trailing newline). */
  content: string
  /** Where the part lived in this commit's snapshot — informational. */
  startLine: number
  endLine: number
  /** "exact" if (label, occurrence) matched directly; "fallback" if only label matched; null for ranges. */
  match: "exact" | "fallback" | null
}
