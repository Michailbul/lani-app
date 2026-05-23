/**
 * Backlot skill library — `~/.backlot/skills/`.
 *
 * One directory holds every skill the Backlot agent can use, one folder
 * each. `~/.backlot/` is registered with the Claude Agent SDK as a
 * local plugin (`.claude-plugin/plugin.json`), so skill discovery is
 * independent of `settingSources` — that lets Backlot load skills
 * without ever enabling the `"user"` source (which would leak
 * `~/.claude/CLAUDE.md`).
 *
 * Skill sources:
 *   - Factory  — shipped in the app bundle (`resources/skills/`), copied
 *                into `~/.backlot/skills/` on first launch.
 *   - Imported — symlinked in from the user's `~/.claude/skills` /
 *                `~/.agents/skills` via the Settings import panel.
 *   - Created  — written here by the agent (reviewed) or the user.
 *
 * On/off is a disabled-set (`skills-disabled.json`); the active set is
 * passed to the SDK `skills` option.
 */

import { app } from "electron"
import { existsSync } from "node:fs"
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises"
import { createHash } from "node:crypto"
import { homedir } from "node:os"
import { join } from "node:path"
import matter from "gray-matter"

const BACKLOT_DIR = join(homedir(), ".backlot")
export const BACKLOT_SKILLS_DIR = join(BACKLOT_DIR, "skills")
const PLUGIN_DIR = join(BACKLOT_DIR, ".claude-plugin")
const PLUGIN_MANIFEST = join(PLUGIN_DIR, "plugin.json")
const CODEX_PLUGIN_DIR = join(BACKLOT_DIR, ".codex-plugin")
const CODEX_PLUGIN_MANIFEST = join(CODEX_PLUGIN_DIR, "plugin.json")
const CODEX_MARKETPLACE_DIR = join(BACKLOT_DIR, ".agents", "plugins")
const CODEX_MARKETPLACE_MANIFEST = join(CODEX_MARKETPLACE_DIR, "marketplace.json")
const DISABLED_PATH = join(BACKLOT_DIR, "skills-disabled.json")
const FACTORY_MANIFEST = join(BACKLOT_DIR, ".factory-manifest.json")
const PREFS_PATH = join(BACKLOT_DIR, "preferences.json")
const USER_CLAUDE_SKILLS = join(homedir(), ".claude", "skills")
const USER_AGENTS_SKILLS = join(homedir(), ".agents", "skills")

/** Plugin name — plugin skills are namespaced `backlot:<slug>`. */
export const BACKLOT_PLUGIN_NAME = "backlot"

/** The plugin root passed to the SDK `plugins` option. */
export function getBacklotPluginPath(): string {
  return BACKLOT_DIR
}

export function getBacklotCodexPluginKey(): string {
  return `${BACKLOT_PLUGIN_NAME}@backlot`
}

/** Where factory skills ship — repo `resources/skills/` in dev, the
 *  packaged resources dir in production. */
function factoryBundleDir(): string {
  return app.isPackaged
    ? join(process.resourcesPath, "skills")
    : join(__dirname, "../../resources/skills")
}

// ───────────────────────────────────────────────────────────── helpers

async function sha256(file: string): Promise<string | null> {
  try {
    return createHash("sha256").update(await readFile(file)).digest("hex")
  } catch {
    return null
  }
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, "utf-8")) as T
  } catch {
    return fallback
  }
}

/** Directory names under `dir` that contain a `SKILL.md` (follows symlinks). */
async function listSkillDirs(dir: string): Promise<string[]> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const out: string[] = []
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue
    let isDir = entry.isDirectory()
    if (!isDir && entry.isSymbolicLink()) {
      try {
        isDir = (await stat(join(dir, entry.name))).isDirectory()
      } catch {
        continue
      }
    }
    if (!isDir) continue
    if (existsSync(join(dir, entry.name, "SKILL.md"))) out.push(entry.name)
  }
  return out.sort((a, b) => a.localeCompare(b))
}

async function readFrontmatter(
  skillMd: string,
): Promise<{ name?: string; description?: string }> {
  try {
    const { data } = matter(await readFile(skillMd, "utf-8"))
    return {
      name: typeof data.name === "string" ? data.name : undefined,
      description:
        typeof data.description === "string" ? data.description : undefined,
    }
  } catch {
    return {}
  }
}

// ─────────────────────────────────────────────────── plugin + seeding

/**
 * Ensure `~/.backlot/` is a valid local plugin and the factory skills
 * are seeded. Idempotent — safe to call on every app start and before
 * every session.
 */
export async function ensureBacklotPlugin(): Promise<void> {
  await mkdir(BACKLOT_SKILLS_DIR, { recursive: true })
  await mkdir(PLUGIN_DIR, { recursive: true })
  await mkdir(CODEX_PLUGIN_DIR, { recursive: true })
  await mkdir(CODEX_MARKETPLACE_DIR, { recursive: true })
  if (!existsSync(PLUGIN_MANIFEST)) {
    await writeFile(
      PLUGIN_MANIFEST,
      JSON.stringify(
        {
          name: BACKLOT_PLUGIN_NAME,
          version: "1.0.0",
          description: "Backlot skill library",
        },
        null,
        2,
      ) + "\n",
      "utf-8",
    )
  }
  if (!existsSync(CODEX_PLUGIN_MANIFEST)) {
    await writeFile(
      CODEX_PLUGIN_MANIFEST,
      JSON.stringify(
        {
          name: BACKLOT_PLUGIN_NAME,
          version: "1.0.0",
          description: "Backlot skill library",
        },
        null,
        2,
      ) + "\n",
      "utf-8",
    )
  }
  await writeFile(
    CODEX_MARKETPLACE_MANIFEST,
    JSON.stringify(
      {
        name: "backlot",
        plugins: [
          {
            name: BACKLOT_PLUGIN_NAME,
            source: {
              source: "local",
              path: "../..",
            },
          },
        ],
      },
      null,
      2,
    ) + "\n",
    "utf-8",
  )
  await seedFactorySkills()
}

/**
 * Copy factory skills from the app bundle into `~/.backlot/skills/`.
 *  - missing skill          → copy in
 *  - present, untouched,
 *    new version shipped    → refresh to the shipped version
 *  - present, user-modified → leave alone
 *
 * "untouched" is decided by hashing `SKILL.md` against a recorded
 * factory manifest.
 */
async function seedFactorySkills(): Promise<void> {
  const bundle = factoryBundleDir()
  const factorySlugs = await listSkillDirs(bundle)
  if (factorySlugs.length === 0) return

  const manifest = await readJson<Record<string, string>>(FACTORY_MANIFEST, {})

  for (const slug of factorySlugs) {
    const src = join(bundle, slug)
    const dst = join(BACKLOT_SKILLS_DIR, slug)
    const bundledHash = await sha256(join(src, "SKILL.md"))

    if (!existsSync(dst)) {
      try {
        await cp(src, dst, { recursive: true })
        if (bundledHash) manifest[slug] = bundledHash
      } catch (err) {
        console.warn(`[skills] failed to seed factory skill "${slug}":`, err)
      }
      continue
    }

    const installedHash = await sha256(join(dst, "SKILL.md"))
    const recorded = manifest[slug]
    if (
      recorded &&
      installedHash === recorded &&
      bundledHash &&
      bundledHash !== recorded
    ) {
      // Untouched by the user, and the bundle ships a newer version.
      try {
        await rm(dst, { recursive: true, force: true })
        await cp(src, dst, { recursive: true })
        manifest[slug] = bundledHash
      } catch (err) {
        console.warn(`[skills] failed to refresh factory skill "${slug}":`, err)
      }
    } else if (!recorded && installedHash) {
      // First time we've seen this installed skill — record a baseline.
      manifest[slug] = installedHash
    }
  }

  try {
    await writeFile(
      FACTORY_MANIFEST,
      JSON.stringify(manifest, null, 2) + "\n",
      "utf-8",
    )
  } catch {
    /* non-fatal */
  }
}

// ──────────────────────────────────────────────── on/off (disabled set)

export async function readDisabledSkills(): Promise<string[]> {
  const data = await readJson<{ disabled?: unknown }>(DISABLED_PATH, {})
  return Array.isArray(data.disabled)
    ? data.disabled.filter((s): s is string => typeof s === "string")
    : []
}

export async function writeDisabledSkills(disabled: string[]): Promise<void> {
  await mkdir(BACKLOT_DIR, { recursive: true })
  await writeFile(
    DISABLED_PATH,
    JSON.stringify({ disabled: [...new Set(disabled)] }, null, 2) + "\n",
    "utf-8",
  )
}

/** Slugs of every skill folder in the library. */
export async function listBacklotSkillSlugs(): Promise<string[]> {
  return listSkillDirs(BACKLOT_SKILLS_DIR)
}

/** Slugs that are active (in the library, not in the disabled set). */
export async function getEnabledSkillSlugs(): Promise<string[]> {
  const all = await listBacklotSkillSlugs()
  const disabled = new Set(await readDisabledSkills())
  return all.filter((s) => !disabled.has(s))
}

/**
 * Value for the SDK `skills` option. `"all"` when nothing is disabled;
 * otherwise the enabled set, namespaced for the plugin (`backlot:<slug>`).
 */
export async function getSkillsOption(): Promise<"all" | string[]> {
  const all = await listBacklotSkillSlugs()
  const enabled = await getEnabledSkillSlugs()
  if (all.length === 0 || enabled.length === all.length) return "all"
  return enabled.map((slug) => `${BACKLOT_PLUGIN_NAME}:${slug}`)
}

// ─────────────────────────────────────────────────────── preferences

export interface BacklotPreferences {
  /** Load the project's CLAUDE.md (`settingSources: ["project"]`). */
  loadProjectClaudeMd: boolean
  /** Symlink agent-created skills into `~/.claude/skills`. */
  publishCreatedSkills: boolean
}

export async function readPreferences(): Promise<BacklotPreferences> {
  const p = await readJson<Partial<BacklotPreferences>>(PREFS_PATH, {})
  return {
    loadProjectClaudeMd:
      typeof p.loadProjectClaudeMd === "boolean" ? p.loadProjectClaudeMd : true,
    publishCreatedSkills:
      typeof p.publishCreatedSkills === "boolean"
        ? p.publishCreatedSkills
        : true,
  }
}

export async function writePreferences(
  prefs: BacklotPreferences,
): Promise<void> {
  await mkdir(BACKLOT_DIR, { recursive: true })
  await writeFile(PREFS_PATH, JSON.stringify(prefs, null, 2) + "\n", "utf-8")
}

// ───────────────────────────────────────────────────── skill listing

export interface BacklotSkill {
  slug: string
  name: string
  description: string
  enabled: boolean
  /** true → a symlink (imported from the user library); false → a real folder. */
  imported: boolean
  /** Absolute path of the skill folder. */
  dir: string
}

/** Every skill in the library, with on/off + import state. */
export async function listBacklotSkills(): Promise<BacklotSkill[]> {
  const slugs = await listBacklotSkillSlugs()
  const disabled = new Set(await readDisabledSkills())
  const out: BacklotSkill[] = []
  for (const slug of slugs) {
    const dir = join(BACKLOT_SKILLS_DIR, slug)
    const fm = await readFrontmatter(join(dir, "SKILL.md"))
    let imported = false
    try {
      imported = (await lstat(dir)).isSymbolicLink()
    } catch {
      /* ignore */
    }
    out.push({
      slug,
      name: fm.name || slug,
      description: fm.description || "",
      enabled: !disabled.has(slug),
      imported,
      dir,
    })
  }
  return out
}

// ────────────────────────────────────────────────────────── importing

export interface ImportableSkill {
  slug: string
  source: "claude" | "agents"
  path: string
  description: string
}

/**
 * Skills in the user's `~/.claude/skills` + `~/.agents/skills` that are
 * not yet in the Backlot library. Deduped by slug (first source wins).
 */
export async function listImportableSkills(): Promise<ImportableSkill[]> {
  const have = new Set(await listBacklotSkillSlugs())
  const seen = new Set<string>()
  const out: ImportableSkill[] = []
  const sources: Array<[string, "claude" | "agents"]> = [
    [USER_CLAUDE_SKILLS, "claude"],
    [USER_AGENTS_SKILLS, "agents"],
  ]
  for (const [dir, source] of sources) {
    for (const slug of await listSkillDirs(dir)) {
      if (have.has(slug) || seen.has(slug)) continue
      seen.add(slug)
      const fm = await readFrontmatter(join(dir, slug, "SKILL.md"))
      out.push({ slug, source, path: join(dir, slug), description: fm.description || "" })
    }
  }
  return out.sort((a, b) => a.slug.localeCompare(b.slug))
}

/** Symlink one user-library skill into `~/.backlot/skills/`. */
export async function importSkill(slug: string): Promise<void> {
  for (const dir of [USER_CLAUDE_SKILLS, USER_AGENTS_SKILLS]) {
    const src = join(dir, slug)
    if (existsSync(join(src, "SKILL.md"))) {
      const dst = join(BACKLOT_SKILLS_DIR, slug)
      if (existsSync(dst)) return
      await mkdir(BACKLOT_SKILLS_DIR, { recursive: true })
      await symlink(src, dst)
      return
    }
  }
  throw new Error(
    `Skill "${slug}" not found in ~/.claude/skills or ~/.agents/skills`,
  )
}

/** Import every importable skill. Returns the count attempted. */
export async function importAllSkills(): Promise<number> {
  const list = await listImportableSkills()
  for (const skill of list) {
    try {
      await importSkill(skill.slug)
    } catch (err) {
      console.warn(`[skills] failed to import "${skill.slug}":`, err)
    }
  }
  return list.length
}

// ─────────────────────────────────────────────────────────── creating

/** Turn a free-text name into a skill-folder slug. */
export function slugifySkillName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

/**
 * Scaffold a brand-new skill: a folder under `~/.backlot/skills/` with a
 * starter `SKILL.md`. Rejects an empty or already-taken slug. Published
 * into the user library per preference, same as an agent-created skill.
 */
export async function createSkill(
  name: string,
): Promise<{ slug: string; dir: string }> {
  const slug = slugifySkillName(name)
  if (!slug) {
    throw new Error("Give the skill a name with letters or numbers.")
  }
  const dir = join(BACKLOT_SKILLS_DIR, slug)
  if (existsSync(dir)) {
    throw new Error(`A skill called "${slug}" already exists.`)
  }
  await mkdir(dir, { recursive: true })
  const skillMd = `---
name: ${slug}
description: One sentence on what this skill does and when the agent should reach for it. Replace this line.
---

# ${slug}

Replace this body with the skill's workflow — what it does, the steps
to follow, and any resources it relies on.

## Steps

1. ...
`
  await writeFile(join(dir, "SKILL.md"), skillMd, "utf-8")
  await publishSkillToUserLibrary(slug)
  return { slug, dir }
}

/**
 * Remove a skill from the Backlot library. An imported skill loses just
 * its symlink (the user's real skill survives); a factory/created skill
 * has its folder removed. A published `~/.claude/skills` symlink that
 * points back into the library is also removed.
 */
export async function removeSkill(slug: string): Promise<void> {
  const dir = join(BACKLOT_SKILLS_DIR, slug)
  try {
    const st = await lstat(dir)
    if (st.isSymbolicLink()) await unlink(dir)
    else await rm(dir, { recursive: true, force: true })
  } catch {
    /* already gone */
  }
  const published = join(USER_CLAUDE_SKILLS, slug)
  try {
    const st = await lstat(published)
    if (st.isSymbolicLink()) {
      const target = await readlink(published)
      if (target === dir || target.startsWith(BACKLOT_SKILLS_DIR)) {
        await unlink(published)
      }
    }
  } catch {
    /* nothing published */
  }
}

/**
 * Publish a library skill into `~/.claude/skills` as a symlink, so the
 * user's other Claude tools see it. No-op if the preference is off, the
 * skill is missing, or the name is already taken in `~/.claude/skills`.
 */
export async function publishSkillToUserLibrary(slug: string): Promise<void> {
  const prefs = await readPreferences()
  if (!prefs.publishCreatedSkills) return
  const src = join(BACKLOT_SKILLS_DIR, slug)
  const dst = join(USER_CLAUDE_SKILLS, slug)
  if (!existsSync(src) || existsSync(dst)) return
  try {
    await mkdir(USER_CLAUDE_SKILLS, { recursive: true })
    await symlink(src, dst)
  } catch (err) {
    console.warn(`[skills] failed to publish "${slug}" to ~/.claude/skills:`, err)
  }
}
