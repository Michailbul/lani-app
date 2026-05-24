#!/usr/bin/env node
/**
 * Seed a Lani project's library with example workflows so the
 * Library mode renders with realistic content. Idempotent — running it
 * twice replaces the file but never duplicates entries.
 *
 *   node scripts/seed-library.mjs                 # → daddy-issues (default)
 *   node scripts/seed-library.mjs <project-path>  # → arbitrary project root
 *
 * Copies the chosen source images into `library-media/<id>/` and
 * writes `library.lani.json` at the project root.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { basename, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { homedir } from "node:os"

const __dirname = dirname(fileURLToPath(import.meta.url))

const projectRoot =
  process.argv[2] ?? join(homedir(), ".lani/projects/daddy-issues")

if (!existsSync(projectRoot)) {
  console.error(`No project at: ${projectRoot}`)
  process.exit(1)
}

console.log(`→ Seeding library at: ${projectRoot}`)

const now = new Date().toISOString()

/**
 * Each entry describes one library item. `sourceImages` lists
 * project-relative paths (we resolve against the project root) — the
 * script copies each into `library-media/<id>/` and rewrites the
 * referenceImages array to point at the copies.
 */
const ENTRIES = [
  {
    id: "character-identity-board",
    kind: "character-sheet",
    title: "Character identity board",
    subtitle: "Locked 4-pose character sheet at 2K, Nano Banana Pro",
    description:
      "The first thing we build for every new hero. A 4-pose character sheet (front, 3/4, side, back) on a clean cyc, used as the locked identity reference for every downstream shot. Always render at 2K so Seedance and Runway have enough resolution to read facial structure.",
    tags: ["character", "identity-board", "banana-pro", "2k"],
    sourceImages: [
      "characters/ann/ann-character-identity-board.png",
      "characters/mark/mark-character-identity-board.png",
      "characters/mother/mother-doberman-character-identity-board.png",
    ],
    agentInstructions: [
      "1. Read the character's lock file at `characters/[CHARACTER]/character.md`. Pull the verbatim identity description.",
      "2. Render a 4-pose character sheet with Nano Banana Pro at 2K. Use the prompt template below. Always keep `--cyc=white` and `--lighting=even`.",
      "3. Save the result to `characters/[CHARACTER]/[CHARACTER]-character-identity-board.png`.",
      "4. Update the character's lock file `references:` array to point at the new board.",
    ].join("\n"),
    characterSheetPrompt: [
      "A locked 4-pose character identity board of [CHARACTER]:",
      "  - Pose 1: full-body front, arms relaxed.",
      "  - Pose 2: 3/4 view, slight turn toward camera left.",
      "  - Pose 3: full profile, camera right.",
      "  - Pose 4: full back view.",
      "All four poses on a single canvas, evenly spaced, identical lighting.",
      "Identity lock (verbatim from character file): [IDENTITY_LOCK]",
      "Wardrobe lock: [OUTFIT]",
      "Lighting: soft key from above-left, fill bounce camera-right, clean white cyc.",
      "Lens: 85mm equivalent, neutral perspective, no depth-of-field.",
      "Style: photoreal, editorial fashion-board look. 2K. Sharp focus on all four poses.",
    ].join("\n"),
    seedancePrompt: [
      "MULTI-SHOT, 6s — Slow 360° turnaround of [CHARACTER] from the identity board.",
      "Shot 1 (0–2s): full-body front, character holds still.",
      "Shot 2 (2–4s): camera arcs around to 3/4 right side.",
      "Shot 3 (4–6s): camera completes the arc to the back, then begins the return.",
      "Lock: locked-off vertical axis, character at frame center the entire time.",
      "Light: same soft key from above-left, no flicker.",
      "Render: clean white cyc, no shadows on the floor. 50mm equivalent.",
    ].join("\n"),
    notes:
      "Use this any time we lock a new character. The identity board is the single source of truth for that character's look — every Part prompt that mentions them copies the identity lock by path.",
  },
  {
    id: "live-action-to-animated",
    kind: "workflow",
    title: "Live-action → animated identity",
    subtitle: "Carry a live-action photo into an animated character sheet",
    description:
      "When the writer has a live-action reference (a photoshoot still, a casting comp) but the project ships animated. This workflow keeps the silhouette, wardrobe and face structure but re-stages everything in our animated style. The trick is the two-pass: first a faithful animated portrait, then a 4-pose sheet from THAT portrait — never directly from the live-action source.",
    tags: ["character", "live-action", "animation", "two-pass"],
    sourceImages: [
      "characters/mark/mark-live-action-character-identity-board.png",
      "characters/mark/mark-character-identity-board.png",
      "characters/mark/mark-pierre-animated-character-identity-board-v2-pierre-reference.png",
    ],
    agentInstructions: [
      "1. Pass 1 — animated portrait. Read the live-action reference at `[LIVE_ACTION_PATH]`. Render a single animated portrait (front, 3/4 view) at 2K. Use the character-sheet prompt below as a base.",
      "2. Save the portrait to `characters/[CHARACTER]/[CHARACTER]-animated-portrait.png`.",
      "3. Pass 2 — 4-pose sheet. Use the animated portrait (not the live-action source) as the reference for a fresh 4-pose sheet via the `character-identity-board` workflow.",
      "4. Update the character's lock file to point at both — `animated-portrait` for face-detail shots, the 4-pose sheet for body/wardrobe.",
    ].join("\n"),
    characterSheetPrompt: [
      "Animated portrait of [CHARACTER] in our project style.",
      "Pose: 3/4 view, looking just past camera left.",
      "Identity reference (live-action photo, treat as input, never expose photoreal texture): [LIVE_ACTION_PATH]",
      "Style lock: hand-drawn-feel digital painting, soft cel-shaded skin, line work subtle.",
      "Wardrobe: copy verbatim from the source photo's silhouette and palette.",
      "Lighting: gentle Rembrandt key on the camera-right side, soft fill.",
      "Background: clean, single warm cream tone — no environment.",
      "Render at 2K. Sharp focus on the face.",
    ].join("\n"),
    seedancePrompt: [
      "MULTI-SHOT, 5s — Subtle character study of [CHARACTER] from the animated portrait.",
      "Shot 1 (0–2.5s): tight head-and-shoulders, character holds the pose, micro-blink.",
      "Shot 2 (2.5–5s): camera arcs 30° to the right while character's gaze tracks back to camera at the end.",
      "Lock: cel-shaded animated style, no photoreal slippage.",
      "Light: same Rembrandt key, no flicker.",
    ].join("\n"),
    notes:
      "Never feed the live-action ref directly into Seedance — the model will partially render photoreal skin and break the animated lock. Always go through the animated portrait pass first.",
  },
  {
    id: "seedance-turnaround-from-sheet",
    kind: "workflow",
    title: "Seedance turnaround from identity board",
    subtitle: "Take a locked 4-pose sheet → 6s 360° spin in Seedance 2",
    description:
      "Once the character identity board exists, this workflow spins it into a 6-second turnaround clip in Seedance 2. The clip becomes the canonical motion reference — drop it into a Multishot Part's referenceImages and the model picks up the silhouette and gait without any wardrobe drift.",
    tags: ["seedance", "turnaround", "character", "motion-reference"],
    sourceImages: [
      "characters/ann/ann-animated-character-identity-board-v2-height-heels.png",
      "characters/ann/ann-character-identity-board.png",
    ],
    agentInstructions: [
      "1. Confirm the character has a locked identity board at `characters/[CHARACTER]/[CHARACTER]-character-identity-board.png`. If not, run the `character-identity-board` workflow first.",
      "2. Submit the Seedance prompt below with the identity board as `referenceImages[0]`.",
      "3. Render at 6s @ 24fps, 1080p. The locked-off camera is non-negotiable — never request a hand-held variant for the turnaround.",
      "4. Save the result to `characters/[CHARACTER]/[CHARACTER]-turnaround.mp4`. Reference it by name in any Part where the writer asks for `[CHARACTER]`'s gait or silhouette.",
    ].join("\n"),
    seedancePrompt: [
      "MULTI-SHOT, 6s — 360° turnaround of [CHARACTER] from the locked identity board.",
      "Shot 1 (0–2s): full-body front, holds still, micro-breath.",
      "Shot 2 (2–4s): camera arcs around clockwise to the 3/4 back view.",
      "Shot 3 (4–6s): camera completes the arc, character ends at full front again.",
      "Lock: locked-off vertical axis, character at frame center the entire time. Identity verbatim from the source board.",
      "Light: clean key from above-left, fill bounce camera-right, white cyc. No floor shadow.",
      "Lens: 50mm equivalent, no perspective distortion.",
    ].join("\n"),
    notes:
      "If Seedance ever introduces clothing drift, re-submit with `--lock_wardrobe=high` and reference the identity board twice (cover + first reference). The double-reference trick pins the outfit hard.",
  },
  {
    id: "animated-storyboard-frame",
    kind: "prompt",
    title: "Animated storyboard frame",
    subtitle: "One-shot storyboard panel — Nano Banana Pro, project style",
    description:
      "Single panel storyboard frame in our animated style. Used when the writer wants to pre-visualise a beat before committing it to a shot prompt. Cheap, fast, surprisingly accurate to what Seedance later renders.",
    tags: ["storyboard", "previs", "banana-pro", "single-frame"],
    sourceImages: [
      "assets/canvas/imported/f0571b28dbc3--Animated-Storyboard-Sequence-1-.png",
      "assets/canvas/imported/050a6553f030--Animated-Storyboard-Creation-1-.png",
      "assets/canvas/imported/b5312e5d2a1a--Storyboard-Design-2-.png",
    ],
    characterSheetPrompt: undefined,
    seedancePrompt: undefined,
    agentInstructions: [
      "Use when the writer says 'storyboard this' or 'show me what this beat looks like'. Render a single frame from the prompt below.",
      "Always quote the scene's `SHOT X:` heading inside the prompt so the model gets the camera idea.",
      "Save into the scene's `references/` folder (NOT into `library-media/`) — storyboard panels belong to the scene, not the library.",
    ].join("\n"),
    notes:
      "Don't oversell the storyboard — it's a previs, not a final. If the writer reacts strongly to the panel, that's the signal to go into Multishot mode and turn it into a real Part.",
  },
  {
    id: "magnific-sketch-pass",
    kind: "prompt",
    title: "Magnific sketch-style pass",
    subtitle: "Convert a still into a hand-drawn storyboard sketch",
    description:
      "Run any frame through Magnific in sketch-conversion mode. The output reads as a storyboard artist's pencil pass — useful when the writer wants to share a beat with the director without committing to a final render.",
    tags: ["magnific", "sketch", "storyboard", "style-transfer"],
    sourceImages: [
      "assets/canvas/imported/617d37659092--magnific__make-the-image-in-a-sketch-style-preserving-the-co__58811.png",
      "assets/canvas/imported/d9fb40e48044--magnific_digital-illustration-a-25_2911679606.png",
    ],
    agentInstructions: [
      "Open Magnific. Drop the source frame in. Set: Style → 'Sketch', Creativity → 25, Resemblance → 80.",
      "Render at 2K. Save next to the source as `[source-name]-sketch.png`.",
      "If the result loses recognisability of the character, lower Creativity to 18 and bump Resemblance to 90.",
    ].join("\n"),
    notes:
      "Magnific Sketch is the only style pass we use on character beats — every other style converter we've tried breaks face geometry. Keep this entry as the canonical recipe.",
  },
]

function escapeYaml(value) {
  if (/^[A-Za-z0-9 _\-]+$/.test(value)) return value
  return `"${value.replace(/"/g, '\\"')}"`
}

/**
 * Render an entry's prose as a single markdown body. Mirrors
 * `buildMarkdownBody` in `src/shared/library-types.ts` so the seed
 * script produces the same shape the router writes on `addItem`.
 */
function renderMarkdown(entry) {
  const lines = []
  lines.push("---")
  lines.push(`id: ${entry.id}`)
  lines.push(`kind: ${entry.kind}`)
  lines.push(`title: ${escapeYaml(entry.title)}`)
  if (entry.subtitle) lines.push(`subtitle: ${escapeYaml(entry.subtitle)}`)
  if (entry.tags?.length)
    lines.push(`tags: [${entry.tags.map(escapeYaml).join(", ")}]`)
  if (entry.cover) lines.push(`cover: ${escapeYaml(entry.cover)}`)
  lines.push("---")
  lines.push("")

  const section = (heading, body) => {
    if (!body || !String(body).trim()) return
    lines.push(`## ${heading}`)
    lines.push("")
    lines.push(String(body).trim())
    lines.push("")
  }

  section("Description", entry.description)
  section("Agent instructions", entry.agentInstructions)
  section("Character-sheet prompt", entry.characterSheetPrompt)
  section("Seedance 2 animation prompt", entry.seedancePrompt)
  section("Notes", entry.notes)
  return lines.join("\n").trim() + "\n"
}

let copied = 0
let written = 0
for (const entry of ENTRIES) {
  const mediaDir = join(projectRoot, "library-media", entry.id)
  mkdirSync(mediaDir, { recursive: true })

  // Carry the cover filename so the frontmatter can pin it.
  let cover = null
  for (const rel of entry.sourceImages) {
    const src = join(projectRoot, rel)
    if (!existsSync(src)) {
      console.warn(`  ⚠ skipping missing source: ${rel}`)
      continue
    }
    const dst = join(mediaDir, basename(src))
    copyFileSync(src, dst)
    if (!cover) cover = basename(dst)
    copied += 1
  }

  // Write workflow.md with the seeded prose + a `cover:` field so
  // the gallery picks the right thumbnail. The folder + its image
  // listing is the entire source of truth — no JSON index anymore.
  const mdAbs = join(mediaDir, "workflow.md")
  writeFileSync(mdAbs, renderMarkdown({ ...entry, cover }), "utf-8")
  written += 1
}

// Remove the stale JSON index — the new router scans folders and
// the file would just confuse a reader poking around the project.
const staleJson = join(projectRoot, "library.lani.json")
if (existsSync(staleJson)) {
  rmSync(staleJson)
  console.log(`✓ Removed orphaned ${basename(staleJson)}`)
}

console.log(`✓ Wrote ${written} workflow.md files under library-media/`)
console.log(`✓ Copied ${copied} reference images`)
console.log(`\nOpen Lani, switch to the daddy-issues project, and click the`)
console.log(`Library mode button (6th from the left in the dock).`)
