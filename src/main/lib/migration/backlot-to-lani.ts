/**
 * One-shot migration: rename the legacy ~/.backlot data directory to
 * ~/.lani and rewrite every *.backlot.json file inside it to *.lani.json.
 *
 * Runs at the very start of app.whenReady(), before any code touches the
 * data dir. A marker file (`~/.lani/.migrations/backlot-to-lani.done`)
 * makes the migration idempotent — subsequent launches no-op cheaply.
 *
 * Safe-path behavior:
 *   • Marker present                  → no-op
 *   • Neither old nor new dir exists  → fresh install, write marker, done
 *   • Only legacy ~/.backlot exists   → rename it to ~/.lani, then rewrite suffixes
 *   • Only ~/.lani exists             → rewrite any straggler suffixes, write marker
 *   • Both exist (rare)               → log a warning, leave both in place, no-op
 */
import { existsSync, mkdirSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

const LEGACY_DIR = join(homedir(), ".backlot")
const NEW_DIR = join(homedir(), ".lani")
const MARKER_REL = join(".migrations", "backlot-to-lani.done")
const SUFFIX_OLD = ".backlot.json"
const SUFFIX_NEW = ".lani.json"

const SKIP_DIR_NAMES = new Set(["node_modules", ".git"])

function markerPath(): string {
  return join(NEW_DIR, MARKER_REL)
}

function writeMarker(): void {
  const dir = join(NEW_DIR, ".migrations")
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(
    markerPath(),
    `${new Date().toISOString()} backlot-to-lani migration completed\n`,
    "utf-8",
  )
}

function renameSuffixesRecursively(root: string): number {
  let renamed = 0
  const stack: string[] = [root]
  while (stack.length > 0) {
    const dir = stack.pop()!
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const abs = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (SKIP_DIR_NAMES.has(entry.name)) continue
        stack.push(abs)
        continue
      }
      if (entry.isFile() && entry.name.endsWith(SUFFIX_OLD)) {
        const next = abs.slice(0, -SUFFIX_OLD.length) + SUFFIX_NEW
        if (existsSync(next)) {
          console.warn(
            `[migration] both legacy and new suffix exist, leaving alone: ${abs}`,
          )
          continue
        }
        try {
          renameSync(abs, next)
          renamed += 1
        } catch (err) {
          console.warn(`[migration] rename failed for ${abs}:`, err)
        }
      }
    }
  }
  return renamed
}

export function runBacklotToLaniMigration(): void {
  // Fast path: marker present.
  try {
    if (existsSync(markerPath())) return
  } catch {
    // ignore — fall through and try the migration
  }

  const legacyExists = existsSync(LEGACY_DIR)
  const newExists = existsSync(NEW_DIR)

  if (!legacyExists && !newExists) {
    // Fresh install. Create the new dir + marker so this is a one-time check.
    try {
      mkdirSync(NEW_DIR, { recursive: true })
      writeMarker()
    } catch (err) {
      console.warn("[migration] failed to seed ~/.lani:", err)
    }
    return
  }

  if (legacyExists && newExists) {
    // Ambiguous — both dirs present. Don't risk merging. The user can
    // decide which one wins by removing the other.
    try {
      if (statSync(LEGACY_DIR).isDirectory() && statSync(NEW_DIR).isDirectory()) {
        console.warn(
          `[migration] both ~/.backlot and ~/.lani exist; leaving as-is. ` +
            `Move data manually or delete one to let the rename complete.`,
        )
      }
    } catch {
      // ignore
    }
    return
  }

  if (legacyExists && !newExists) {
    try {
      renameSync(LEGACY_DIR, NEW_DIR)
      console.log(`[migration] renamed ~/.backlot -> ~/.lani`)
    } catch (err) {
      console.error("[migration] failed to rename ~/.backlot to ~/.lani:", err)
      return
    }
  }

  // At this point ~/.lani exists. Walk it once and rename any leftover
  // *.backlot.json files. This also catches the legacy-only-and-just-renamed
  // case, and the new-dir-only case where prior launches predated this code.
  let renamed = 0
  try {
    renamed = renameSuffixesRecursively(NEW_DIR)
    if (renamed > 0) {
      console.log(`[migration] rewrote ${renamed} *.backlot.json -> *.lani.json`)
    }
  } catch (err) {
    console.warn("[migration] suffix sweep failed:", err)
  }

  try {
    writeMarker()
  } catch (err) {
    console.warn("[migration] failed to write marker:", err)
  }
}
