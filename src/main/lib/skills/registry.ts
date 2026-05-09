/**
 * BACKLOT_SKILL_REGISTRY — the curated list of AI-creatorship skills
 * the Backlot agent has access to.
 *
 * Source of truth for *which* skills the user considers Backlot-relevant
 * and *how they group together* in the settings UI. The user's actual
 * inclusion / exclusion preference (allowlist or denylist on top of
 * this registry) lives in `~/.backlot/skills-filter.json` — see
 * `filter.ts`.
 *
 * Skills not listed here exist on disk (under `~/.claude/skills/`) but
 * are not surfaced in Backlot's settings, because they're general-
 * purpose engineering tools rather than visual / screenwriting ones.
 *
 * To add a skill: drop it under one of the categories below. The skill
 * directory must already exist at `~/.claude/skills/<name>/SKILL.md` —
 * the registry only declares relevance + ordering, never installation.
 */

export interface CuratedSkill {
  /** Slug — must match the directory name under `~/.claude/skills/`. */
  name: string
}

export interface SkillCategory {
  /** Display name for the category header. */
  label: string
  /** Short description, shown under the header. */
  blurb: string
  skills: CuratedSkill[]
}

export const BACKLOT_SKILL_REGISTRY: SkillCategory[] = [
  {
    label: "Image generation",
    blurb: "Stills, hero frames, cover plates.",
    skills: [
      { name: "higgsfield-generate" },
      { name: "higgsfield-marketplace-cards" },
      { name: "higgsfield-product-photoshoot" },
      { name: "higgsfield-soul-id" },
      { name: "mj-nb2-pipeline" },
      { name: "nano-banana-pro" },
      { name: "product-visual-generator" },
      { name: "recraft-v4-prompting" },
    ],
  },
  {
    label: "Video generation",
    blurb: "Motion, prompts, multi-shot pipelines.",
    skills: [
      { name: "frame-vfx-stylizer" },
      { name: "seedance-prompting" },
      { name: "seedance-screenwriter" },
      { name: "varg-video-generation" },
      { name: "video-prompt-builder" },
    ],
  },
  {
    label: "Characters & avatars",
    blurb: "Identity locks and character continuity.",
    skills: [
      { name: "ai-avatar-realistic" },
      { name: "character-consistency-character-sheet" },
    ],
  },
  {
    label: "Prompt engineering",
    blurb: "Prompt builders, frame extraction, style replication.",
    skills: [
      { name: "burst-frame" },
      { name: "burst-frame-cars" },
      { name: "car-angle-extractor" },
      { name: "enhance-prompt" },
      { name: "image-to-prompt" },
      { name: "visual-style-replicator" },
    ],
  },
  {
    label: "Screenwriting & storytelling",
    blurb: "Long-form narrative tools.",
    skills: [{ name: "screenwriter" }],
  },
  {
    label: "Laniameda content pipelines",
    blurb: "Studio-specific ingestion, ads, social posts.",
    skills: [
      { name: "laniameda-gallery-ingest" },
      { name: "laniameda-gallery-query" },
      { name: "laniameda-pet-ad-pipeline" },
      { name: "laniameda-ugc-ad-pipeline" },
      { name: "laniameda-x-post" },
      { name: "laniameda-youtube-digest" },
    ],
  },
]

/** Flat list of all skill names in the registry, in display order. */
export function getAllRegistrySkillNames(): string[] {
  return BACKLOT_SKILL_REGISTRY.flatMap((cat) =>
    cat.skills.map((s) => s.name),
  )
}

/** Lookup by skill name → the category that contains it (or null). */
export function categoryForSkill(name: string): SkillCategory | null {
  return (
    BACKLOT_SKILL_REGISTRY.find((cat) =>
      cat.skills.some((s) => s.name === name),
    ) ?? null
  )
}
