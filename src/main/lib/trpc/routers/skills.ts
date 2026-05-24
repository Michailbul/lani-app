import { z } from "zod"
import { router, publicProcedure } from "../index"
import * as fs from "fs/promises"
import * as path from "path"
import matter from "gray-matter"
import {
  LANI_SKILLS_DIR,
  importAllSkills,
  importSkill,
  listLaniSkills,
  listImportableSkills,
  publishSkillToUserLibrary,
  readDisabledSkills,
  readPreferences,
  removeSkill,
  writeDisabledSkills,
  writePreferences,
  type LaniPreferences,
} from "../../skills/library"

/** Skill shape used by the @-mention picker and legacy callers. */
export interface FileSkill {
  name: string
  description: string
  source: "user"
  path: string
  content: string
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
    const value = rawValue.trim().replace(/^["']|["']$/g, "")
    if (key === "name") parsed.name = value
    if (key === "description") parsed.description = value
  }
  return parsed
}

/** Parse SKILL.md frontmatter, tolerating malformed YAML. */
function parseSkillMd(
  rawContent: string,
): { name?: string; description?: string; content: string } {
  try {
    const { data, content } = matter(rawContent)
    return {
      name: typeof data.name === "string" ? data.name : undefined,
      description:
        typeof data.description === "string" ? data.description : undefined,
      content: content.trim(),
    }
  } catch {
    const loose = parseLooseFrontmatter(rawContent)
    return loose ?? { content: rawContent.trim() }
  }
}

/** Render a SKILL.md from name + description + body. */
function generateSkillMd(skill: {
  name: string
  description: string
  content: string
}): string {
  const lines = [`name: ${JSON.stringify(skill.name)}`]
  if (skill.description) {
    lines.push(`description: ${JSON.stringify(skill.description)}`)
  }
  return `---\n${lines.join("\n")}\n---\n\n${skill.content}\n`
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
}

/**
 * Read the Lani skill library as FileSkill records — used by the
 * @-mention picker. `onlyEnabled` filters to the active set.
 */
async function readLibraryFileSkills(onlyEnabled: boolean): Promise<FileSkill[]> {
  const skills = await listLaniSkills()
  const out: FileSkill[] = []
  for (const skill of skills) {
    if (onlyEnabled && !skill.enabled) continue
    let content = ""
    try {
      const raw = await fs.readFile(path.join(skill.dir, "SKILL.md"), "utf-8")
      content = parseSkillMd(raw).content
    } catch {
      /* skip body */
    }
    out.push({
      name: skill.name,
      description: skill.description,
      source: "user",
      path: path.join(skill.dir, "SKILL.md"),
      content,
    })
  }
  return out
}

export const skillsRouter = router({
  /** All skills in the Lani library — @-mention picker + legacy. */
  list: publicProcedure.query(() => readLibraryFileSkills(false)),

  /** Active (enabled) skills only — used by the @-mention picker. */
  listEnabled: publicProcedure.query(() => readLibraryFileSkills(true)),

  /**
   * The Lani skill library for the Settings page — every skill with
   * its on/off and import state. Flat, alphabetical.
   */
  library: publicProcedure.query(async () => {
    const skills = await listLaniSkills()
    return skills.sort((a, b) => a.slug.localeCompare(b.slug))
  }),

  /** Toggle one skill on or off (writes the disabled set). */
  toggle: publicProcedure
    .input(z.object({ slug: z.string().min(1), enabled: z.boolean() }))
    .mutation(async ({ input }) => {
      const disabled = new Set(await readDisabledSkills())
      if (input.enabled) disabled.delete(input.slug)
      else disabled.add(input.slug)
      await writeDisabledSkills([...disabled])
      return { success: true as const }
    }),

  /** Skills in the user's library not yet imported into Lani. */
  importable: publicProcedure.query(() => listImportableSkills()),

  /** Symlink one user-library skill into the Lani library. */
  import: publicProcedure
    .input(z.object({ slug: z.string().min(1) }))
    .mutation(async ({ input }) => {
      await importSkill(input.slug)
      return { success: true as const }
    }),

  /** Import every importable skill. */
  importAll: publicProcedure.mutation(async () => {
    const count = await importAllSkills()
    return { count }
  }),

  /** Remove a skill from the Lani library. */
  remove: publicProcedure
    .input(z.object({ slug: z.string().min(1) }))
    .mutation(async ({ input }) => {
      await removeSkill(input.slug)
      return { success: true as const }
    }),

  /** Read the Lani skill/CLAUDE.md preferences. */
  getPreferences: publicProcedure.query(() => readPreferences()),

  /** Persist the preferences (CLAUDE.md toggle, publish toggle). */
  setPreferences: publicProcedure
    .input(
      z.object({
        loadProjectClaudeMd: z.boolean(),
        publishCreatedSkills: z.boolean(),
      }),
    )
    .mutation(async ({ input }) => {
      const prefs: LaniPreferences = {
        loadProjectClaudeMd: input.loadProjectClaudeMd,
        publishCreatedSkills: input.publishCreatedSkills,
      }
      await writePreferences(prefs)
      return prefs
    }),

  /** Create a new skill folder in the Lani library. */
  create: publicProcedure
    .input(
      z.object({
        name: z.string().min(1),
        description: z.string(),
        content: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      const slug = slugify(input.name)
      if (!slug) throw new Error("Skill name must contain letters or digits")
      const skillDir = path.join(LANI_SKILLS_DIR, slug)
      const skillMd = path.join(skillDir, "SKILL.md")
      try {
        await fs.access(skillMd)
        throw new Error(`Skill "${slug}" already exists`)
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err
      }
      await fs.mkdir(skillDir, { recursive: true })
      await fs.writeFile(
        skillMd,
        generateSkillMd({
          name: slug,
          description: input.description,
          content: input.content,
        }),
        "utf-8",
      )
      await publishSkillToUserLibrary(slug)
      return { slug, path: skillMd }
    }),
})
