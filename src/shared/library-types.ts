/**
 * Backlot library — the bookshelf of reusable workflows, character
 * sheet templates and saved generation prompts the user collects
 * across films.
 *
 * Two tiers:
 *
 *   1. **Studio** (`~/.backlot/library/<id>/`) — universal recipes,
 *      project-agnostic. Editable from any project. Survives moving
 *      projects, switching machines (with sync), etc.
 *
 *   2. **Project** (`<project>/library-media/<id>/`) — film-specific
 *      entries tuned for the project's characters, locations and style.
 *      Only visible inside that project.
 *
 * Both tiers share the **same on-disk shape** — a folder per entry,
 * containing one `workflow.md` (the prose body, with YAML frontmatter
 * carrying the entry's metadata) and any number of image files used
 * as cover/reference examples. The agent reads and writes these
 * files directly with `Read`/`Edit`/`Write` — there is no JSON index
 * to keep in sync.
 *
 * When an id collides across tiers, the **project tier shadows the
 * studio entry** — the same precedence VS Code uses for workspace vs
 * user settings. The studio version stays on disk; the gallery just
 * hides it as long as a project shadow exists.
 */

/** The folder name under the project root for project-scoped entries. */
export const LIBRARY_PROJECT_DIR = "library-media"
/** Conventional filename for an entry's prose body. */
export const LIBRARY_MARKDOWN_FILE = "workflow.md"
/** Image extensions recognised as reference example files. */
export const LIBRARY_IMAGE_EXTENSIONS = [
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "avif",
] as const

export type LibrarySource = "studio" | "project"
export type LibraryItemKind = "workflow" | "character-sheet" | "prompt"

/**
 * One library entry — the canonical shape the renderer and the
 * agent see after the router has scanned the on-disk folders and
 * parsed each entry's `workflow.md` frontmatter.
 *
 * `coverImage` and `referenceImages` carry plain **filenames**
 * relative to the entry's folder — the router knows the folder's
 * absolute path and the renderer streams images via the
 * `backlot-asset://` scheme using that path.
 */
export interface LibraryItem {
  /** Which tier this entry lives in. */
  source: LibrarySource
  /** Slug id — also the folder's name. */
  id: string
  /** Drives the card chrome and the labels in the Copy payload. */
  kind: LibraryItemKind
  /** Human title shown on the card. */
  title: string
  /** Short subtitle. */
  subtitle?: string
  /** Free-tag list for filtering. */
  tags: string[]
  /**
   * Card thumbnail — a filename inside this entry's folder. Falls
   * back to the first image alphabetically when absent.
   */
  coverImage?: string
  /**
   * Filenames of every image inside this entry's folder, in stable
   * (sorted) order. The renderer resolves each to a
   * `backlot-asset://` URL using `folderPath`.
   */
  referenceImages: string[]
  /** Absolute filesystem path of the entry's folder. */
  folderPath: string
  /** Absolute filesystem path of the entry's `workflow.md`. */
  markdownPath: string
  /** ISO-8601 — folder ctime. */
  addedAt: string
  /** ISO-8601 — most recent file mtime inside the folder. */
  updatedAt: string
}

/** Reasonable defaults for a new entry's seeded `workflow.md`. */
export interface NewEntrySeed {
  id: string
  kind: LibraryItemKind
  title: string
  subtitle?: string
  description?: string
  agentInstructions?: string
  characterSheetPrompt?: string
  seedancePrompt?: string
  notes?: string
  tags?: string[]
  cover?: string
}

/**
 * Render a seeded prose body as the canonical markdown the router
 * writes to `workflow.md` on entry creation. Sections that have no
 * content are omitted; the frontmatter mirrors the entry's metadata
 * so the file is self-describing when the agent reads it standalone.
 */
export function buildMarkdownBody(seed: NewEntrySeed): string {
  const lines: string[] = []
  lines.push("---")
  lines.push(`id: ${seed.id}`)
  lines.push(`kind: ${seed.kind}`)
  lines.push(`title: ${escapeYaml(seed.title)}`)
  if (seed.subtitle) lines.push(`subtitle: ${escapeYaml(seed.subtitle)}`)
  if (seed.tags && seed.tags.length > 0) {
    lines.push(`tags: [${seed.tags.map(escapeYaml).join(", ")}]`)
  }
  if (seed.cover) lines.push(`cover: ${escapeYaml(seed.cover)}`)
  lines.push("---")
  lines.push("")

  const section = (heading: string, body: string | undefined) => {
    if (!body || !body.trim()) return
    lines.push(`## ${heading}`)
    lines.push("")
    lines.push(body.trim())
    lines.push("")
  }

  section("Description", seed.description)
  section("Agent instructions", seed.agentInstructions)
  section("Character-sheet prompt", seed.characterSheetPrompt)
  section("Seedance 2 animation prompt", seed.seedancePrompt)
  section("Notes", seed.notes)

  if (lines.length <= 3) {
    lines.push("## Description")
    lines.push("")
    lines.push("_Describe the workflow in one or two paragraphs._")
    lines.push("")
  }

  return lines.join("\n").trim() + "\n"
}

function escapeYaml(value: string): string {
  if (/^[A-Za-z0-9 _\-]+$/.test(value)) return value
  return `"${value.replace(/"/g, '\\"')}"`
}

/**
 * Build the clipboard payload for a library entry — the prose the
 * agent receives when the user hits Copy. Always renders the full
 * markdown body (the source of truth) plus a reference-images list
 * resolved to absolute file paths so the agent can `Read` them.
 */
export function buildLibraryClipboard(
  item: LibraryItem,
  markdownBody?: string | null,
): string {
  const intro = [
    `Use this entry from the project library: "${item.title}" (#${item.id}, ${item.source}).`,
  ]
  if (item.subtitle) intro.push(item.subtitle)
  intro.push("")

  const body =
    (markdownBody && markdownBody.trim()) ||
    `*(workflow.md not yet on disk for ${item.id})*`

  const refsBlock =
    item.referenceImages.length > 0
      ? [
          "",
          "## Reference images",
          ...item.referenceImages.map(
            (filename) => `- ${item.folderPath}/${filename}`,
          ),
        ]
      : []

  return [intro.join("\n"), body.trim(), refsBlock.join("\n")]
    .join("\n")
    .trim() + "\n"
}

/**
 * Parse YAML frontmatter from a markdown body and split out the
 * pure-body remainder. Kept tiny — Backlot's frontmatter is always
 * a small flat dictionary, so a custom mini-parser keeps the file
 * dependency-free (gray-matter lives in the main process; this
 * helper runs on shared/renderer code too).
 */
export function parseLibraryFrontmatter(content: string): {
  data: Record<string, unknown>
  body: string
} {
  const normalized = content.replace(/^﻿/, "")
  const match = normalized.match(
    /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/,
  )
  if (!match) return { data: {}, body: normalized }
  const data: Record<string, unknown> = {}
  for (const line of (match[1] ?? "").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_\-]*)\s*:\s*(.*)$/)
    if (!m) continue
    const key = m[1]!
    let raw = m[2]!.trim()
    // Strip wrapping quotes
    if (
      (raw.startsWith('"') && raw.endsWith('"')) ||
      (raw.startsWith("'") && raw.endsWith("'"))
    ) {
      raw = raw.slice(1, -1).replace(/\\"/g, '"')
    }
    // Inline array: [a, b, c]
    if (raw.startsWith("[") && raw.endsWith("]")) {
      data[key] = raw
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter((s) => s.length > 0)
      continue
    }
    data[key] = raw
  }
  const body = normalized.slice(match[0].length).replace(/^\r?\n+/, "")
  return { data, body }
}
