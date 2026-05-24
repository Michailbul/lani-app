/**
 * Skill Workbench router — backs the Skill Workbench mode.
 *
 * The workbench browses and edits the Lani skill library at
 * `~/.lani/skills/`. A skill is a folder (SKILL.md + optional
 * resources), so this router exposes the folder tree, not just
 * SKILL.md. Path containment is enforced on every read/write: a
 * resolved path must stay inside the library root.
 */

import * as fs from "node:fs/promises"
import * as path from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { z } from "zod"
import { publicProcedure, router } from "../index"
import {
  LANI_SKILLS_DIR,
  createSkill,
  listLaniSkills,
} from "../../skills/library"

const execFileAsync = promisify(execFile)

/** Files/dirs the tree never surfaces — OS noise and VCS metadata. */
const TREE_IGNORE = new Set([".git", ".DS_Store", "node_modules"])

type SkillFileStatus = "clean" | "modified" | "untracked" | "deleted" | "added"

interface SkillStatusEntry {
  status: SkillFileStatus
  porcelain: string
}

interface SkillReviewHunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: Array<{ kind: "context" | "added" | "removed"; text: string }>
}

/** Resolve a skill directory and assert it lives under the library root. */
function resolveSkillDir(skillDir: string): string {
  const resolved = path.resolve(skillDir)
  if (path.dirname(resolved) !== LANI_SKILLS_DIR) {
    throw new Error("Skill directory must live under ~/.lani/skills")
  }
  return resolved
}

/** Resolve `relPath` inside a skill dir, rejecting any escape via `..`. */
function resolveFileInSkill(skillDir: string, relPath: string): string {
  const resolved = path.resolve(skillDir, relPath)
  if (resolved !== skillDir && !resolved.startsWith(skillDir + path.sep)) {
    throw new Error("File path escapes the skill directory")
  }
  return resolved
}

function toGitPath(absOrRel: string): string {
  return absOrRel.split(path.sep).join("/")
}

function relToLibrary(abs: string): string {
  const rel = path.relative(LANI_SKILLS_DIR, abs)
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("File path escapes the skill library")
  }
  return toGitPath(rel)
}

async function git(
  args: string[],
  options: { allowFailure?: boolean } = {},
): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd: LANI_SKILLS_DIR,
      maxBuffer: 20 * 1024 * 1024,
    })
    return stdout
  } catch (err) {
    if (options.allowFailure) {
      const failed = err as { stdout?: string | Buffer }
      return typeof failed.stdout === "string"
        ? failed.stdout
        : Buffer.isBuffer(failed.stdout)
          ? failed.stdout.toString("utf-8")
          : ""
    }
    const message =
      err instanceof Error && err.message ? err.message : "Git command failed"
    throw new Error(message)
  }
}

async function hasCommit(): Promise<boolean> {
  try {
    await git(["rev-parse", "--verify", "HEAD"])
    return true
  } catch {
    return false
  }
}

/**
 * Git is the review ledger for skills. First use creates a local repo
 * in `~/.lani/skills` and commits the current library as the baseline;
 * subsequent edits stay visible as pending changes until the user saves
 * or discards them from Skill Workbench.
 *
 * Memoized: the workbench page fires several tRPC queries in parallel,
 * and concurrent `git config` writes race on `.git/config.lock`. We do
 * the setup once per process and reuse the resolved promise after that.
 */
let skillsRepoReady: Promise<void> | null = null

async function initSkillsGitRepo(): Promise<void> {
  await fs.mkdir(LANI_SKILLS_DIR, { recursive: true })
  try {
    await git(["rev-parse", "--is-inside-work-tree"])
  } catch {
    await git(["init", "-b", "main"])
  }
  const name = (await git(["config", "user.name"], { allowFailure: true })).trim()
  if (name !== "Lani") {
    await git(["config", "user.name", "Lani"])
  }
  const email = (await git(["config", "user.email"], { allowFailure: true })).trim()
  if (email !== "lani@local") {
    await git(["config", "user.email", "lani@local"])
  }
  if (await hasCommit()) return

  await git(["add", "-A", "--", "."])
  await git(["commit", "--allow-empty", "-m", "Baseline skill library"])
}

async function ensureSkillsGitRepo(): Promise<void> {
  if (!skillsRepoReady) {
    skillsRepoReady = initSkillsGitRepo().catch((err) => {
      skillsRepoReady = null
      throw err
    })
  }
  return skillsRepoReady
}

function statusFromPorcelain(code: string): SkillFileStatus {
  if (code === "??") return "untracked"
  if (code.includes("D")) return "deleted"
  if (code.includes("A")) return "added"
  return "modified"
}

async function readStatusMap(): Promise<Map<string, SkillStatusEntry>> {
  await ensureSkillsGitRepo()
  const raw = await git(["status", "--porcelain=v1", "-z", "--", "."])
  const entries = raw.split("\0").filter(Boolean)
  const map = new Map<string, SkillStatusEntry>()
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i]
    const code = entry.slice(0, 2)
    const file = entry.slice(3)
    if (!file) continue
    if (code.includes("R") || code.includes("C")) i += 1
    map.set(file, { status: statusFromPorcelain(code), porcelain: code })
  }
  return map
}

function fileStatus(
  map: Map<string, SkillStatusEntry>,
  relPath: string,
): SkillFileStatus {
  return map.get(toGitPath(relPath))?.status ?? "clean"
}

function descendantCount(
  map: Map<string, SkillStatusEntry>,
  relPath: string,
): number {
  const prefix = relPath ? `${toGitPath(relPath)}/` : ""
  let count = 0
  for (const file of map.keys()) {
    if (!prefix || file.startsWith(prefix)) count += 1
  }
  return count
}

async function readBaseContent(relPath: string): Promise<string | null> {
  if (!(await hasCommit())) return null
  const raw = await git(["show", `HEAD:${relPath}`], { allowFailure: true })
  return raw === "" ? null : raw
}

function parseUnifiedDiff(diffText: string): SkillReviewHunk[] {
  const hunks: SkillReviewHunk[] = []
  let current: SkillReviewHunk | null = null
  for (const line of diffText.split("\n")) {
    const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/)
    if (match) {
      current = {
        oldStart: Number(match[1]),
        oldLines: Number(match[2] ?? "1"),
        newStart: Number(match[3]),
        newLines: Number(match[4] ?? "1"),
        lines: [],
      }
      hunks.push(current)
      continue
    }
    if (!current) continue
    if (line.startsWith("+") && !line.startsWith("+++")) {
      current.lines.push({ kind: "added", text: line.slice(1) })
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      current.lines.push({ kind: "removed", text: line.slice(1) })
    } else if (line.startsWith(" ")) {
      current.lines.push({ kind: "context", text: line.slice(1) })
    }
  }
  return hunks
}

async function diffForPath(relPath: string): Promise<string> {
  await ensureSkillsGitRepo()
  const status = (await readStatusMap()).get(relPath)?.status ?? "clean"
  if (status === "untracked") {
    return git(
      [
        "diff",
        "--no-index",
        "--",
        "/dev/null",
        path.join(LANI_SKILLS_DIR, relPath),
      ],
      { allowFailure: true },
    )
  }
  if (status === "added") {
    return git(["diff", "--cached", "--", relPath], { allowFailure: true })
  }
  return git(["diff", "--", relPath], { allowFailure: true })
}

interface SkillTreeNode {
  kind: "file" | "folder"
  name: string
  relPath: string
  status?: SkillFileStatus
  changedDescendantCount?: number
  children?: SkillTreeNode[]
}

async function walkSkillTree(
  absDir: string,
  skillDir: string,
  statusMap: Map<string, SkillStatusEntry>,
): Promise<SkillTreeNode[]> {
  let entries: import("node:fs").Dirent[]
  try {
    entries = await fs.readdir(absDir, { withFileTypes: true })
  } catch {
    return []
  }
  const nodes: SkillTreeNode[] = []
  for (const entry of entries) {
    if (TREE_IGNORE.has(entry.name)) continue
    const abs = path.join(absDir, entry.name)
    const relPath = path.relative(skillDir, abs)
    if (entry.isDirectory()) {
      const rootRel = relToLibrary(abs)
      nodes.push({
        kind: "folder",
        name: entry.name,
        relPath,
        changedDescendantCount: descendantCount(statusMap, rootRel),
        children: await walkSkillTree(abs, skillDir, statusMap),
      })
    } else if (entry.isFile()) {
      nodes.push({
        kind: "file",
        name: entry.name,
        relPath,
        status: fileStatus(statusMap, relToLibrary(abs)),
      })
    }
  }
  nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  return nodes
}

export const skillWorkbenchRouter = router({
  /**
   * The Lani skill library — a flat, alphabetical list. Each entry
   * carries its absolute folder path and on/off state.
   */
  list: publicProcedure.query(async () => {
    const skills = await listLaniSkills()
    const statusMap = await readStatusMap()
    return skills
      .slice()
      .sort((a, b) => a.slug.localeCompare(b.slug))
      .map((s) => ({
        name: s.slug,
        label: s.name,
        dir: s.dir,
        description: s.description,
        enabled: s.enabled,
        imported: s.imported,
        installed: true,
        changedDescendantCount: descendantCount(statusMap, s.slug),
      }))
  }),

  /**
   * Scaffold a new skill — a folder + starter `SKILL.md` — and return
   * its slug and absolute path so the renderer can open it.
   */
  create: publicProcedure
    .input(z.object({ name: z.string().min(1).max(64) }))
    .mutation(async ({ input }) => {
      return createSkill(input.name)
    }),

  /** The file tree of one skill folder. */
  tree: publicProcedure
    .input(z.object({ skillDir: z.string().min(1) }))
    .query(async ({ input }) => {
      const dir = resolveSkillDir(input.skillDir)
      const statusMap = await readStatusMap()
      return walkSkillTree(dir, dir, statusMap)
    }),

  /** Read one file inside a skill folder. */
  readFile: publicProcedure
    .input(
      z.object({
        skillDir: z.string().min(1),
        relPath: z.string().min(1),
      }),
    )
    .query(async ({ input }) => {
      const dir = resolveSkillDir(input.skillDir)
      const abs = resolveFileInSkill(dir, input.relPath)
      const rel = relToLibrary(abs)
      const content = await fs.readFile(abs, "utf-8")
      const statusMap = await readStatusMap()
      const status = statusMap.get(rel)?.status ?? "clean"
      const diffText = status === "clean" ? "" : await diffForPath(rel)
      return {
        content,
        status,
        diffText,
        hunks: parseUnifiedDiff(diffText),
        baseContent: status === "clean" ? content : await readBaseContent(rel),
      }
    }),

  /** Write one file inside a skill folder. The pending change is git-visible. */
  writeFile: publicProcedure
    .input(
      z.object({
        skillDir: z.string().min(1),
        relPath: z.string().min(1),
        content: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      const dir = resolveSkillDir(input.skillDir)
      const abs = resolveFileInSkill(dir, input.relPath)
      await fs.mkdir(path.dirname(abs), { recursive: true })
      await fs.writeFile(abs, input.content, "utf-8")
      return { success: true as const }
    }),

  /** Save one skill file by committing just that path to the skill ledger. */
  saveFile: publicProcedure
    .input(
      z.object({
        skillDir: z.string().min(1),
        relPath: z.string().min(1),
      }),
    )
    .mutation(async ({ input }) => {
      const dir = resolveSkillDir(input.skillDir)
      const abs = resolveFileInSkill(dir, input.relPath)
      const rel = relToLibrary(abs)
      await ensureSkillsGitRepo()
      await git(["add", "--", rel])
      const staged = await git(["diff", "--cached", "--name-only", "--", rel])
      if (!staged.trim()) return { success: true as const }
      await git([
        "commit",
        "-m",
        `Save skill change: ${rel}`,
        "--",
        rel,
      ])
      return { success: true as const }
    }),

  /** Discard one pending skill-file change by restoring it from HEAD. */
  discardFile: publicProcedure
    .input(
      z.object({
        skillDir: z.string().min(1),
        relPath: z.string().min(1),
      }),
    )
    .mutation(async ({ input }) => {
      const dir = resolveSkillDir(input.skillDir)
      const abs = resolveFileInSkill(dir, input.relPath)
      const rel = relToLibrary(abs)
      await ensureSkillsGitRepo()
      await git(["restore", "--staged", "--worktree", "--", rel], {
        allowFailure: true,
      })
      await git(["clean", "-f", "--", rel], { allowFailure: true })
      return { success: true as const }
    }),

  /** Full history for rollback/audit UI. */
  history: publicProcedure
    .input(
      z.object({
        skillDir: z.string().min(1),
        relPath: z.string().min(1),
      }),
    )
    .query(async ({ input }) => {
      const dir = resolveSkillDir(input.skillDir)
      const abs = resolveFileInSkill(dir, input.relPath)
      const rel = relToLibrary(abs)
      await ensureSkillsGitRepo()
      const raw = await git(
        ["log", "--date=iso", "--pretty=format:%H%x00%h%x00%ad%x00%s", "--", rel],
        { allowFailure: true },
      )
      return raw
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [hash, shortHash, date, subject] = line.split("\0")
          return { hash, shortHash, date, subject }
        })
    }),

  /** Roll one skill file back to a previous saved revision. */
  rollbackFile: publicProcedure
    .input(
      z.object({
        skillDir: z.string().min(1),
        relPath: z.string().min(1),
        commit: z.string().min(7),
      }),
    )
    .mutation(async ({ input }) => {
      const dir = resolveSkillDir(input.skillDir)
      const abs = resolveFileInSkill(dir, input.relPath)
      const rel = relToLibrary(abs)
      await ensureSkillsGitRepo()
      await git(["checkout", input.commit, "--", rel])
      return { success: true as const }
    }),
})
