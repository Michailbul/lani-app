/**
 * Skill preset — the curated set of skills the Backlot Claude agent
 * loads.
 *
 * A **factory** default list ships in code (`BACKLOT_SKILL_REGISTRY`).
 * The user's edited list persists to `~/.backlot/skills-preset.json`.
 * The effective list is just an explicit array of skill names — what
 * the user has switched on.
 *
 * How it reaches the agent: at session start `buildSessionSkillsDir()`
 * fills `<CLAUDE_CONFIG_DIR>/skills/` with one symlink per preset skill.
 * The Claude Agent SDK discovers that directory as the "user" skill
 * source (the session runs with a redirected `CLAUDE_CONFIG_DIR` and
 * `settingSources` includes `"user"`). So the agent sees exactly this
 * curated set — never the user's full `~/.claude/skills`. `CLAUDE.md`
 * is deliberately never linked in, so the user's global memory file
 * does not bleed into Backlot sessions.
 */

import { existsSync } from "node:fs"
import { mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

import { getAllRegistrySkillNames } from "./registry"

const PRESET_PATH = join(homedir(), ".backlot", "skills-preset.json")
const USER_SKILLS_DIR = join(homedir(), ".claude", "skills")

export interface SkillPreset {
  /** Skill names the Claude agent loads. */
  skills: string[]
}

/** The factory default skill set — ships in code via the registry. */
export function getFactorySkillNames(): string[] {
  return getAllRegistrySkillNames()
}

function dedupeNames(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  return Array.from(
    new Set(
      input.filter((n): n is string => typeof n === "string" && n.length > 0),
    ),
  )
}

/**
 * Read the active preset. No file yet → the factory defaults. A
 * malformed file also falls back to factory so a bad write never
 * bricks skill loading.
 */
export async function readSkillPreset(): Promise<SkillPreset> {
  if (!existsSync(PRESET_PATH)) return { skills: getFactorySkillNames() }
  try {
    const parsed = JSON.parse(await readFile(PRESET_PATH, "utf-8")) as
      | Partial<SkillPreset>
      | undefined
    if (!parsed || !Array.isArray(parsed.skills)) {
      return { skills: getFactorySkillNames() }
    }
    return { skills: dedupeNames(parsed.skills) }
  } catch (err) {
    console.warn("[skills.preset] could not read preset, using factory:", err)
    return { skills: getFactorySkillNames() }
  }
}

/** Persist the preset. Creates `~/.backlot/` if missing. */
export async function writeSkillPreset(skills: string[]): Promise<SkillPreset> {
  const clean = dedupeNames(skills)
  await mkdir(dirname(PRESET_PATH), { recursive: true })
  await writeFile(
    PRESET_PATH,
    JSON.stringify({ skills: clean }, null, 2) + "\n",
    "utf-8",
  )
  return { skills: clean }
}

/**
 * Build the per-session skills directory the Claude Agent SDK reads as
 * its "user" skill source. Rebuilt from scratch each call — cheap (a
 * few dozen symlinks) and never stale, so a preset change takes effect
 * on the next agent turn. Only preset skills that actually exist under
 * `~/.claude/skills/<name>/SKILL.md` are linked. Returns the names
 * that were linked.
 */
export async function buildSessionSkillsDir(
  configDir: string,
): Promise<string[]> {
  const skillsDir = join(configDir, "skills")
  // Remove whatever is there (a stale per-skill set, or a legacy
  // whole-directory symlink). `rm` unlinks a symlink without touching
  // its target, so the real ~/.claude/skills is never at risk.
  await rm(skillsDir, { recursive: true, force: true }).catch(() => {})
  await mkdir(skillsDir, { recursive: true })

  const { skills } = await readSkillPreset()
  const linked: string[] = []
  for (const name of skills) {
    const source = join(USER_SKILLS_DIR, name)
    if (!existsSync(join(source, "SKILL.md"))) continue
    try {
      await symlink(source, join(skillsDir, name), "dir")
      linked.push(name)
    } catch (err) {
      console.warn(`[skills.preset] failed to link skill "${name}":`, err)
    }
  }
  return linked
}

/**
 * Names of skills installed under `~/.claude/skills` that are NOT in
 * the preset — useful for the settings UI's "add a skill" list. Cheap
 * directory scan; descriptions are read elsewhere (`skills.list`).
 */
export async function listInstalledSkillNames(): Promise<string[]> {
  try {
    const entries = await readdir(USER_SKILLS_DIR, { withFileTypes: true })
    const names: string[] = []
    for (const entry of entries) {
      if (entry.isDirectory() || entry.isSymbolicLink()) {
        if (existsSync(join(USER_SKILLS_DIR, entry.name, "SKILL.md"))) {
          names.push(entry.name)
        }
      }
    }
    return names.sort((a, b) => a.localeCompare(b))
  } catch {
    return []
  }
}
