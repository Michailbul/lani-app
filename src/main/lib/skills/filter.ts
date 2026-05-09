/**
 * Skills filter — user-controlled allowlist / denylist over the curated
 * Backlot skill registry.
 *
 * Persisted to `~/.backlot/skills-filter.json` so the choice sticks
 * across sessions. Schema:
 *
 *   {
 *     "mode": "allow" | "deny",
 *     "selected": ["nano-banana-pro", "seedance-prompting", ...]
 *   }
 *
 * Semantics:
 *   - `mode: "allow"` → only the names in `selected` are active.
 *     Empty `selected` = nothing active. The strict opt-in mode.
 *   - `mode: "deny"`  → everything except names in `selected` is active.
 *     Empty `selected` = everything active. The default; safer because
 *     a fresh install has all curated skills available.
 *
 * The renderer reads `getFilter`, mutates locally, calls `setFilter`
 * with the new state. A single file write per change — no need for
 * fancy locking, the user is the only writer.
 */

import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { homedir } from "node:os"

import { BACKLOT_SKILL_REGISTRY, getAllRegistrySkillNames } from "./registry"

const FILTER_PATH = join(homedir(), ".backlot", "skills-filter.json")

export type SkillFilterMode = "allow" | "deny"

export interface SkillFilter {
  mode: SkillFilterMode
  /** Skill names participating in the filter (interpretation depends on mode). */
  selected: string[]
}

const DEFAULT_FILTER: SkillFilter = {
  mode: "deny",
  selected: [],
}

/**
 * Read the current filter from disk. Returns the default when no file
 * exists yet, or when the file is unreadable / malformed (so a corrupt
 * config never bricks the settings UI). Selections are intersected with
 * the registry — any stale entries (skills removed from the registry)
 * are silently dropped.
 */
export async function readSkillFilter(): Promise<SkillFilter> {
  if (!existsSync(FILTER_PATH)) return { ...DEFAULT_FILTER }
  try {
    const raw = await readFile(FILTER_PATH, "utf-8")
    const parsed = JSON.parse(raw) as Partial<SkillFilter>
    const mode: SkillFilterMode = parsed.mode === "allow" ? "allow" : "deny"
    const known = new Set(getAllRegistrySkillNames())
    const selected = Array.isArray(parsed.selected)
      ? parsed.selected.filter((n): n is string => typeof n === "string" && known.has(n))
      : []
    return { mode, selected }
  } catch (err) {
    console.warn("[skills.filter] could not read filter, using default:", err)
    return { ...DEFAULT_FILTER }
  }
}

/** Write the filter to disk. Creates `~/.backlot/` if missing. */
export async function writeSkillFilter(filter: SkillFilter): Promise<void> {
  const known = new Set(getAllRegistrySkillNames())
  const safe: SkillFilter = {
    mode: filter.mode === "allow" ? "allow" : "deny",
    selected: Array.from(
      new Set(
        (filter.selected ?? []).filter(
          (n) => typeof n === "string" && known.has(n),
        ),
      ),
    ),
  }
  await mkdir(dirname(FILTER_PATH), { recursive: true })
  await writeFile(FILTER_PATH, JSON.stringify(safe, null, 2) + "\n", "utf-8")
}

/**
 * Resolve the filter into the concrete set of *active* skill names
 * (the ones Backlot should expose to the agent). Used by injection.
 */
export function resolveActiveSkillNames(filter: SkillFilter): string[] {
  const all = getAllRegistrySkillNames()
  const sel = new Set(filter.selected)
  return filter.mode === "allow"
    ? all.filter((n) => sel.has(n))
    : all.filter((n) => !sel.has(n))
}

/** Re-export so callers don't need a second import. */
export { BACKLOT_SKILL_REGISTRY }
