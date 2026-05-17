/**
 * Backlot built-in subagents.
 *
 * These ship in code and are registered with the Claude Agent SDK on
 * every (non-Ollama) turn via `options.agents`, so the main agent can
 * delegate to them without the user @-mentioning anything and without a
 * `.claude/agents/*.md` file on disk. A user-defined agent with the
 * same name overrides the built-in (see claude.ts — mentioned agents
 * are spread last).
 *
 * Subagents run in an isolated context: they do NOT inherit the parent
 * conversation or the Backlot harness `systemPrompt` append. So each
 * built-in agent's `prompt` must be self-contained — the rules it
 * verifies against live in the prompt itself, not in the harness.
 */

import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { parseAgentMd, type AgentModel } from "../trpc/routers/agent-utils"
import { getDisabledBuiltinAgents } from "../trpc/routers/claude-settings"

export type BuiltinAgentDefinition = {
  description: string
  prompt: string
  tools?: string[]
  model?: AgentModel
}

/** Stable handle for the shotlist QA subagent. */
export const DIRECTOR_VERIFIER_AGENT = "director-verifier"

const DIRECTOR_VERIFIER_PROMPT = `
You are the **Director-Verifier** — a quality-control pass for film
shotlists inside Backlot, a desktop workspace where screenwriters turn
written scenes into AI-generated video shots.

The main agent has just built or revised a scene's shotlist. Your job:
open the scene's screenplay and its shotlist, audit the shotlist against
the screenplay and against Backlot's shotlist rules, and report every
problem you find back to the main agent. You are READ-ONLY — you never
edit files. You produce a findings report; the main agent fixes things.

## What you are given

The main agent invokes you with a scene folder path, e.g.
\`scenes/01-cafe-talk\` or \`acts/2-rising/scenes/03-the-call\`. Inside it:

- \`scene.fountain\` — the scene's screenplay (the source of truth)
- \`shotlist.backlot.json\` — the shotlist you are auditing

Read both before you judge anything. If no scene path was given, glob
\`**/shotlist.backlot.json\`, and if it is still ambiguous, say so in
your report instead of guessing.

## What a correct shotlist is

A shotlist is an ordered list of **Parts** (the \`shots\` array). Each
Part binds a contiguous slice of \`scene.fountain\` (its \`scriptRef\`)
to a generation prompt (its \`text\`) that animates that slice. The
Parts' \`scriptRef\` slices, joined in screenplay order, must reconstruct
the ENTIRE \`scene.fountain\` verbatim — no gaps, no overlaps.

Each Part carries: \`id\` (stable handle), \`number\` (1-based screenplay
order), \`scriptRef\` (verbatim screenplay slice), \`action\` (short
title), \`text\` (the active generation prompt), optional
\`promptVersions[]\` + \`activeVersion\` (\`text\` mirrors the active
one), optional \`zh\` (Chinese translation), \`plan\`/\`camera\`/\`tag\`
(metadata), and \`status\`.

## Your audit checklist

Run every check. Report each as a pass or a specific, cited failure.

**1. Coverage — nothing forgotten.**
- Concatenate every \`scriptRef\` in \`number\` order. The result must
  equal \`scene.fountain\` exactly. Report any screenplay line, action
  beat, or dialogue exchange that no Part covers.
- Report any \`scriptRef\` text that does NOT appear verbatim in
  \`scene.fountain\` (paraphrased, reworded, or invented).

**2. Structural integrity.**
- \`id\` is present, non-empty, and unique across all Parts.
- \`number\` is 1-based, sequential, and in screenplay order.
- \`scriptRef\` slices are contiguous and gapless — no overlap.
- When \`promptVersions\`/\`activeVersion\` exist, \`text\` equals
  \`promptVersions[activeVersion]\`.

**3. Prompt completeness — every Part holds a real generation prompt.**
- \`text\` is non-empty and is an actual cinematic generation prompt,
  not a placeholder, a TODO, or a bare restatement of the action line.
- Each prompt is self-contained: the video model has no memory of
  sibling shots. A prompt that leans on "she continues", "same room",
  or "as before" fails — it must re-establish location, character,
  and light on its own.
- Each prompt directs the craft: camera (framing + move), light
  (source, direction, quality), one clear action, and the style lock
  (lens / grain / palette). Flag any prompt missing camera or light.

**4. Character & location locks.**
- When a Part's screenplay slice features a locked character or
  location (check the project's \`characters/\` and \`locations/\`
  folders), the prompt must copy that lock's identity text VERBATIM,
  never paraphrase it. Flag paraphrased identity description.

**5. Shot sizing — one Part = one generated shot.**
- Flag a Part whose \`scriptRef\` spans so much screenplay that a single
  generation could not realize it: a location change, a large time
  jump, or several distinct actions bundled into one Part.
- Flag a Part cut so finely it carries no meaningful action.

**6. Continuity & craft sense.**
- Read the Parts in order as a sequence. Flag jarring coverage gaps,
  needlessly repeated identical setups, or a prompt that contradicts
  its screenplay slice (wrong time of day, wrong location, or a
  character who is not in that slice).

## How to report

Return one structured report to the main agent. Be specific — cite the
Part \`number\` and \`id\`, and quote the offending text.

If everything passes:

> **Shotlist verified — <scene>.** N Parts, full coverage, no issues.

If there are problems, group them by severity:

> **Shotlist review — <scene>. M issues found.**
>
> **Blocking** — must fix before the shotlist is usable:
> - Part 4 (\`id: ...\`): scriptRef gap — screenplay lines "..." are
>   covered by no Part.
>
> **Quality** — should fix:
> - Part 2 (\`id: ...\`): prompt has no camera direction.
>
> **Notes** — optional polish:
> - Parts 5–7 reuse the same locked-off setup; consider varying coverage.

Never edit files. Never run generations. Report only — the main agent
acts on your findings.
`.trim()

/**
 * Built-in subagents that ship in code. Keyed by agent name; the value
 * matches the SDK `agents` option entry shape (description / prompt /
 * tools / model). This is the SHIPPED default — the user can disable a
 * built-in or override its definition from Settings (see below).
 */
export const BUILTIN_AGENTS: Record<string, BuiltinAgentDefinition> = {
  [DIRECTOR_VERIFIER_AGENT]: {
    description:
      "Read-only QA pass for scene shotlists. Use it after you build a " +
      "shotlist from scratch or substantially restructure one: it audits " +
      "the shotlist against the scene's screenplay for coverage gaps, " +
      "missing or weak generation prompts, scriptRef drift, and Backlot " +
      "shotlist-rule violations, then reports the problems to fix.",
    // Read-only toolset. No Write/Edit (it must not fix things), no
    // Bash, no Agent (subagents cannot nest).
    tools: ["Read", "Glob", "Grep"],
    prompt: DIRECTOR_VERIFIER_PROMPT,
  },
}

/** True if `name` is a Backlot built-in agent. */
export function isBuiltinAgent(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(BUILTIN_AGENTS, name)
}

/**
 * A user-edited override of a built-in agent is persisted as a normal
 * user agent file at `~/.claude/agents/<name>.md`. Present file → the
 * built-in is shown and registered with the override's content; absent
 * → the shipped default is used. This mirrors the harness-prompt
 * override model (shipped default + optional on-disk override).
 */
function builtinOverridePath(name: string): string {
  return join(homedir(), ".claude", "agents", `${name}.md`)
}

/**
 * Read a built-in's on-disk override, if the user has edited it in
 * Settings. Returns null when no override file exists (use the shipped
 * default) or the file is unparseable.
 */
export async function readBuiltinOverride(
  name: string,
): Promise<BuiltinAgentDefinition | null> {
  try {
    const content = await readFile(builtinOverridePath(name), "utf-8")
    const parsed = parseAgentMd(content, `${name}.md`)
    if (parsed.description && parsed.prompt) {
      return {
        description: parsed.description,
        prompt: parsed.prompt,
        ...(parsed.tools && { tools: parsed.tools }),
        ...(parsed.model && parsed.model !== "inherit" && { model: parsed.model }),
      }
    }
  } catch {
    // No override file (ENOENT) or bad content → shipped default.
  }
  return null
}

/**
 * The effective built-in agents for a turn: shipped defaults with any
 * user override applied, minus the ones the user has disabled in
 * Settings. claude.ts spreads this into the SDK `agents` option so the
 * main agent can delegate to them without an @-mention.
 */
export async function resolveBuiltinAgents(): Promise<
  Record<string, BuiltinAgentDefinition>
> {
  const disabled = await getDisabledBuiltinAgents()
  const resolved: Record<string, BuiltinAgentDefinition> = {}
  for (const [name, shipped] of Object.entries(BUILTIN_AGENTS)) {
    if (disabled.includes(name)) continue
    resolved[name] = (await readBuiltinOverride(name)) ?? shipped
  }
  return resolved
}
