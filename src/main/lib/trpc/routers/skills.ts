import { z } from "zod"
import { observable } from "@trpc/server/observable"
import { router, publicProcedure } from "../index"
import * as fs from "fs/promises"
import * as path from "path"
import * as os from "os"
import matter from "gray-matter"
import { discoverInstalledPlugins, getPluginComponentPaths } from "../../plugins"
import { getEnabledPlugins } from "./claude-settings"
import {
  BACKLOT_SKILL_REGISTRY,
  getAllRegistrySkillNames,
} from "../../skills/registry"
import { readSkillFilter, writeSkillFilter } from "../../skills/filter"
import {
  listPendingProposals,
  resolveProposal,
  subscribeProposalEvents,
  type ProposalEvent,
} from "../../skills/proposals"

export interface FileSkill {
  name: string
  description: string
  source: "user" | "project" | "plugin"
  pluginName?: string
  path: string
  content: string
}

function stripYamlQuotes(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length < 2) return trimmed
  const quote = trimmed[0]
  if ((quote !== `"` && quote !== "'") || trimmed[trimmed.length - 1] !== quote) {
    return trimmed
  }

  if (quote === `"`) {
    try {
      return JSON.parse(trimmed)
    } catch {
      return trimmed.slice(1, -1)
    }
  }

  return trimmed.slice(1, -1).replaceAll("''", "'")
}

function parseLooseFrontmatter(
  rawContent: string,
): { name?: string; description?: string; content: string } | null {
  if (!rawContent.startsWith("---")) return null

  const closeMatch = rawContent.match(/\r?\n---\r?\n/)
  if (!closeMatch || closeMatch.index === undefined) return null

  const frontmatter = rawContent.slice(3, closeMatch.index)
  const body = rawContent.slice(closeMatch.index + closeMatch[0].length)
  const parsed: { name?: string; description?: string; content: string } = {
    content: body.trim(),
  }

  for (const line of frontmatter.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!match) continue
    const [, key, rawValue] = match
    if (key === "name") parsed.name = stripYamlQuotes(rawValue)
    if (key === "description") parsed.description = stripYamlQuotes(rawValue)
  }

  return parsed
}

function yamlString(value: string): string {
  return JSON.stringify(value)
}

/**
 * Parse SKILL.md frontmatter to extract name and description.
 *
 * Some personal skill files contain plain scalars with additional colons
 * (for example `description: ... Trigger when: ...`). That is invalid YAML,
 * but it should not make Backlot's settings or chat boot path noisy. Fall
 * back to a line-oriented parser for the fields Backlot needs.
 */
function parseSkillMd(
  rawContent: string,
  filePath?: string,
): { name?: string; description?: string; content: string } {
  try {
    const { data, content } = matter(rawContent)
    return {
      name: typeof data.name === "string" ? data.name : undefined,
      description: typeof data.description === "string" ? data.description : undefined,
      content: content.trim(),
    }
  } catch (err) {
    const loose = parseLooseFrontmatter(rawContent)
    if (loose) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn(
        `[skills] Recovered malformed frontmatter${filePath ? ` in ${filePath}` : ""}: ${message}`,
      )
      return loose
    }

    const message = err instanceof Error ? err.message : String(err)
    console.warn(
      `[skills] Failed to parse frontmatter${filePath ? ` in ${filePath}` : ""}: ${message}`,
    )
    return { content: rawContent.trim() }
  }
}

/**
 * Scan a directory for SKILL.md files
 */
async function scanSkillsDirectory(
  dir: string,
  source: "user" | "project" | "plugin",
  basePath?: string, // For project skills, the cwd to make paths relative to
): Promise<FileSkill[]> {
  const skills: FileSkill[] = []

  try {
    // Check if directory exists
    try {
      await fs.access(dir)
    } catch {
      return skills
    }

    const entries = await fs.readdir(dir, { withFileTypes: true })

    for (const entry of entries) {
      // Check if entry is a directory or a symlink pointing to a directory
      let isDir = entry.isDirectory()
      if (!isDir && entry.isSymbolicLink()) {
        try {
          const targetPath = path.join(dir, entry.name)
          const stat = await fs.stat(targetPath) // stat() follows symlinks
          isDir = stat.isDirectory()
        } catch {
          // Symlink target doesn't exist or is inaccessible - skip it
          continue
        }
      }
      if (!isDir) continue

      // Validate entry name for security (prevent path traversal)
      if (entry.name.includes("..") || entry.name.includes("/") || entry.name.includes("\\")) {
        console.warn(`[skills] Skipping invalid directory name: ${entry.name}`)
        continue
      }

      const skillMdPath = path.join(dir, entry.name, "SKILL.md")

      try {
        await fs.access(skillMdPath)
        const content = await fs.readFile(skillMdPath, "utf-8")
        const parsed = parseSkillMd(content, skillMdPath)

        // For project skills, show relative path; for user skills, show ~/.claude/... path
        let displayPath: string
        if (source === "project" && basePath) {
          displayPath = path.relative(basePath, skillMdPath)
        } else {
          // For user skills, show ~/.claude/skills/... format
          const homeDir = os.homedir()
          displayPath = skillMdPath.startsWith(homeDir)
            ? "~" + skillMdPath.slice(homeDir.length)
            : skillMdPath
        }

        skills.push({
          name: parsed.name || entry.name,
          description: parsed.description || "",
          source,
          path: displayPath,
          content: parsed.content,
        })
      } catch (err) {
        // Skill directory doesn't have SKILL.md or read failed - skip it
      }
    }
  } catch (err) {
    console.error(`[skills] Failed to scan directory ${dir}:`, err)
  }

  return skills
}

// Shared procedure for listing skills
const listSkillsProcedure = publicProcedure
  .input(
    z
      .object({
        cwd: z.string().optional(),
      })
      .optional(),
  )
  .query(async ({ input }) => {
    const userSkillsDir = path.join(os.homedir(), ".claude", "skills")
    const userSkillsPromise = scanSkillsDirectory(userSkillsDir, "user")

    let projectSkillsPromise = Promise.resolve<FileSkill[]>([])
    if (input?.cwd) {
      const projectSkillsDir = path.join(input.cwd, ".claude", "skills")
      projectSkillsPromise = scanSkillsDirectory(projectSkillsDir, "project", input.cwd)
    }

    // Discover plugin skills
    const [enabledPluginSources, installedPlugins] = await Promise.all([
      getEnabledPlugins(),
      discoverInstalledPlugins(),
    ])
    const enabledPlugins = installedPlugins.filter(
      (p) => enabledPluginSources.includes(p.source),
    )
    const pluginSkillsPromises = enabledPlugins.map(async (plugin) => {
      const paths = getPluginComponentPaths(plugin)
      try {
        const skills = await scanSkillsDirectory(paths.skills, "plugin")
        return skills.map((skill) => ({ ...skill, pluginName: plugin.source }))
      } catch {
        return []
      }
    })

    // Scan all directories in parallel
    const [userSkills, projectSkills, ...pluginSkillsArrays] =
      await Promise.all([
        userSkillsPromise,
        projectSkillsPromise,
        ...pluginSkillsPromises,
      ])
    const pluginSkills = pluginSkillsArrays.flat()

    return [...projectSkills, ...userSkills, ...pluginSkills]
  })

/**
 * Generate SKILL.md content from name, description, and body
 */
function generateSkillMd(skill: { name: string; description: string; content: string }): string {
  const frontmatter: string[] = []
  frontmatter.push(`name: ${yamlString(skill.name)}`)
  if (skill.description) {
    frontmatter.push(`description: ${yamlString(skill.description)}`)
  }
  return `---\n${frontmatter.join("\n")}\n---\n\n${skill.content}`
}

/**
 * Resolve the absolute filesystem path of a skill given its display path
 */
function resolveSkillPath(displayPath: string): string {
  if (displayPath.startsWith("~")) {
    return path.join(os.homedir(), displayPath.slice(1))
  }
  return displayPath
}

export const skillsRouter = router({
  /**
   * List all skills from filesystem
   * - User skills: ~/.claude/skills/
   * - Project skills: .claude/skills/ (relative to cwd)
   */
  list: listSkillsProcedure,

  /**
   * Alias for list - used by @ mention
   */
  listEnabled: listSkillsProcedure,

  /**
   * The Backlot curated registry — the AI-creatorship skills the
   * settings UI surfaces, grouped by category. The agent's actual
   * inclusion / exclusion preference is in `getFilter` below.
   */
  registry: publicProcedure.query(async () => {
    const userSkillsDir = path.join(os.homedir(), ".claude", "skills")
    const allOnDisk = await scanSkillsDirectory(userSkillsDir, "user")
    const byName = new Map(allOnDisk.map((s) => [s.name, s]))

    return BACKLOT_SKILL_REGISTRY.map((cat) => ({
      label: cat.label,
      blurb: cat.blurb,
      skills: cat.skills.map((skill) => {
        const found = byName.get(skill.name)
        return {
          name: skill.name,
          description: found?.description ?? null,
          installed: !!found,
          path: found?.path ?? null,
        }
      }),
    }))
  }),

  /**
   * Read the user's current filter (mode + selection).
   */
  getFilter: publicProcedure.query(async () => {
    return await readSkillFilter()
  }),

  /**
   * Persist a new filter. Returns the normalised value the file ended
   * up holding (selections intersected with the registry, mode coerced).
   */
  setFilter: publicProcedure
    .input(
      z.object({
        mode: z.enum(["allow", "deny"]),
        selected: z.array(z.string()),
      }),
    )
    .mutation(async ({ input }) => {
      await writeSkillFilter(input)
      return await readSkillFilter()
    }),

  /**
   * Active set — the resolved list of skill names that pass the filter.
   * Used by injection (Phase 2) and surfaced in the UI as a counter.
   */
  active: publicProcedure.query(async () => {
    const filter = await readSkillFilter()
    const all = getAllRegistrySkillNames()
    const sel = new Set(filter.selected)
    return filter.mode === "allow"
      ? all.filter((n) => sel.has(n))
      : all.filter((n) => !sel.has(n))
  }),

  /**
   * Create a new skill
   */
  create: publicProcedure
    .input(
      z.object({
        name: z.string(),
        description: z.string(),
        content: z.string(),
        source: z.enum(["user", "project"]),
        cwd: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const safeName = input.name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "")
      if (!safeName) {
        throw new Error("Skill name must contain at least one alphanumeric character")
      }

      let targetDir: string
      if (input.source === "project") {
        if (!input.cwd) {
          throw new Error("Project path (cwd) required for project skills")
        }
        targetDir = path.join(input.cwd, ".claude", "skills")
      } else {
        targetDir = path.join(os.homedir(), ".claude", "skills")
      }

      const skillDir = path.join(targetDir, safeName)
      const skillMdPath = path.join(skillDir, "SKILL.md")

      // Check if already exists
      try {
        await fs.access(skillMdPath)
        throw new Error(`Skill "${safeName}" already exists`)
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
          throw err
        }
      }

      // Create directory and write SKILL.md
      await fs.mkdir(skillDir, { recursive: true })

      const fileContent = generateSkillMd({
        name: safeName,
        description: input.description,
        content: input.content,
      })

      await fs.writeFile(skillMdPath, fileContent, "utf-8")

      return {
        name: safeName,
        path: skillMdPath,
        source: input.source,
      }
    }),

  /**
   * Update a skill's SKILL.md content
   */
  update: publicProcedure
    .input(
      z.object({
        path: z.string(),
        name: z.string(),
        description: z.string(),
        content: z.string(),
        cwd: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const absolutePath = input.cwd && !input.path.startsWith("~") && !input.path.startsWith("/")
        ? path.join(input.cwd, input.path)
        : resolveSkillPath(input.path)

      // Verify file exists before writing
      await fs.access(absolutePath)

      const fileContent = generateSkillMd({
        name: input.name,
        description: input.description,
        content: input.content,
      })

      await fs.writeFile(absolutePath, fileContent, "utf-8")

      return { success: true }
    }),

  /**
   * Stream of skill-proposal events. The renderer subscribes once
   * (mounted at the layout root via SkillProposalsHost) and uses the
   * `proposed` events to open the diff modal. On reconnect we replay
   * any still-pending proposals so the modal survives a renderer
   * reload.
   */
  proposalEvents: publicProcedure.subscription(() => {
    return observable<ProposalEvent>((emit) => {
      // Replay still-pending proposals so a fresh subscriber sees
      // anything the modal would otherwise have missed.
      for (const proposal of listPendingProposals()) {
        emit.next({ type: "proposed", proposal })
      }
      const unsubscribe = subscribeProposalEvents((event) => {
        try {
          emit.next(event)
        } catch {
          // Already closed — ignore.
        }
      })
      return () => {
        unsubscribe()
      }
    })
  }),

  /**
   * Renderer calls this when the user clicks Apply or Dismiss in the
   * SkillDiffModal. The corresponding tool handler in the in-process
   * MCP server is awaiting this verdict and will resume on resolve.
   */
  resolveProposal: publicProcedure
    .input(
      z.object({
        proposalId: z.string().min(1),
        action: z.enum(["apply", "dismiss"]),
      }),
    )
    .mutation(async ({ input }) => {
      const ok = resolveProposal(input.proposalId, { action: input.action })
      if (!ok) {
        return { success: false, reason: "unknown-or-already-resolved" as const }
      }
      return { success: true as const }
    }),

  /**
   * Currently-pending proposals. Used as a one-shot fallback if a
   * renderer can't keep a subscription open (rare; mostly for
   * debugging).
   */
  listPendingProposals: publicProcedure.query(() => {
    return listPendingProposals()
  }),
})
