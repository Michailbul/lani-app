/**
 * Skill Workbench router — backs the Skill Workbench mode.
 *
 * The workbench lets the user (and the agent) inspect and edit the
 * Claude Agent SDK skills Backlot surfaces in Settings — the curated
 * `BACKLOT_SKILL_REGISTRY`. A skill is a *folder*, not a single file:
 * `~/.claude/skills/<name>/` holds `SKILL.md` plus any reference docs,
 * scripts, or assets the skill ships. So this router exposes the
 * folder tree, not just SKILL.md.
 *
 * Editing is direct + autosave (writer-surface convention), so
 * `writeFile` writes straight to disk. Path containment is enforced on
 * every read/write: a resolved path must stay inside the user skills
 * root, so a malformed `relPath` can't escape into the rest of disk.
 */

import { observable } from "@trpc/server/observable"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import matter from "gray-matter"
import { z } from "zod"
import { publicProcedure, router } from "../index"
import { BACKLOT_SKILL_REGISTRY } from "../../skills/registry"
import {
  subscribeSkillWorkbenchFocus,
  type SkillWorkbenchFocusRequest,
} from "../../skills/workbench-focus"

/** Root of user-scope skills. Every workbench path must resolve inside. */
const USER_SKILLS_ROOT = path.join(os.homedir(), ".claude", "skills")

/** Files/dirs the tree never surfaces — OS noise and VCS metadata. */
const TREE_IGNORE = new Set([".git", ".DS_Store", "node_modules"])

/**
 * Resolve a skill directory and assert it lives directly under the
 * user skills root. Returns the absolute, normalised path.
 */
function resolveSkillDir(skillDir: string): string {
  const resolved = path.resolve(skillDir)
  const parent = path.dirname(resolved)
  if (parent !== USER_SKILLS_ROOT) {
    throw new Error("Skill directory must live under ~/.claude/skills")
  }
  return resolved
}

/**
 * Resolve `relPath` inside an already-validated skill directory and
 * assert it can't escape that directory via `..` or an absolute path.
 */
function resolveFileInSkill(skillDir: string, relPath: string): string {
  const resolved = path.resolve(skillDir, relPath)
  if (resolved !== skillDir && !resolved.startsWith(skillDir + path.sep)) {
    throw new Error("File path escapes the skill directory")
  }
  return resolved
}

interface SkillTreeNode {
  kind: "file" | "folder"
  name: string
  /** Path relative to the skill directory. */
  relPath: string
  children?: SkillTreeNode[]
}

/** Recursively walk a skill directory into a tree of relative paths. */
async function walkSkillTree(
  absDir: string,
  skillDir: string,
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
      nodes.push({
        kind: "folder",
        name: entry.name,
        relPath,
        children: await walkSkillTree(abs, skillDir),
      })
    } else if (entry.isFile()) {
      nodes.push({ kind: "file", name: entry.name, relPath })
    }
  }

  // Folders first, then files; each group alphabetised.
  nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  return nodes
}

/** Read a SKILL.md description without throwing on malformed YAML. */
async function readSkillDescription(skillMdPath: string): Promise<string> {
  try {
    const raw = await fs.readFile(skillMdPath, "utf-8")
    const { data } = matter(raw)
    return typeof data.description === "string" ? data.description : ""
  } catch {
    return ""
  }
}

export const skillWorkbenchRouter = router({
  /**
   * The curated registry skills, grouped by category — the same set the
   * Settings → Skills page shows. Each skill carries its absolute folder
   * path and an `installed` flag (false when the directory is missing).
   */
  list: publicProcedure.query(async () => {
    return Promise.all(
      BACKLOT_SKILL_REGISTRY.map(async (category) => ({
        label: category.label,
        blurb: category.blurb,
        skills: await Promise.all(
          category.skills.map(async (skill) => {
            const dir = path.join(USER_SKILLS_ROOT, skill.name)
            const skillMdPath = path.join(dir, "SKILL.md")
            let installed = false
            try {
              await fs.access(skillMdPath)
              installed = true
            } catch {
              installed = false
            }
            return {
              name: skill.name,
              dir,
              installed,
              description: installed
                ? await readSkillDescription(skillMdPath)
                : "",
            }
          }),
        ),
      })),
    )
  }),

  /** The file tree of one skill folder. */
  tree: publicProcedure
    .input(z.object({ skillDir: z.string().min(1) }))
    .query(async ({ input }) => {
      const dir = resolveSkillDir(input.skillDir)
      return walkSkillTree(dir, dir)
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
      const content = await fs.readFile(abs, "utf-8")
      return { content }
    }),

  /** Write one file inside a skill folder (direct edit + autosave). */
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

  /**
   * Stream of workbench focus requests. The agent's `open_skill_workbench`
   * MCP tool emits one; the renderer host flips into Skill Workbench mode
   * and opens the file. Live requests only — a request is not replayed on
   * (re)connect, so relaunching the app never hijacks the view mode.
   */
  focusEvents: publicProcedure.subscription(() => {
    return observable<SkillWorkbenchFocusRequest>((emit) => {
      const unsubscribe = subscribeSkillWorkbenchFocus((request) => {
        try {
          emit.next(request)
        } catch {
          // Subscriber already closed — ignore.
        }
      })
      return () => unsubscribe()
    })
  }),
})
