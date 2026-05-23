---
name: skill-creator
description: Create, edit, and improve Agent Skills inside Backlot. Use this whenever the user asks to make a new skill, capture a workflow as a skill, refine or rewrite an existing skill, or fix a skill's triggering. Trigger on "create a skill", "turn this into a skill", "save this as a skill", "make a skill that…", "edit the X skill", "improve this skill", or any request to author or change a SKILL.md — even if the user does not say the word "skill" explicitly but is clearly describing a reusable workflow they want to keep.
---

# Skill Creator — Backlot

Author and improve Agent Skills inside Backlot. This is the Backlot-adapted
guide: it keeps the craft of writing a good skill and drops the standalone
benchmark/eval apparatus, which Backlot does not use.

## Where skills live — read this first

Every skill Backlot can use is a folder under:

```
~/.backlot/skills/<slug>/
```

That directory is the single source of truth. **It is not `~/.claude/skills`.**
A skill is a folder named after its slug, containing a `SKILL.md` and any
optional resources.

## How to create or edit a skill

Edit `SKILL.md` files directly with `Read`, `Edit`, and `Write`, the same as
any other file — the user watches your changes land live.

- **Editing** an existing skill → `Edit` (or `Write`)
  `~/.backlot/skills/<slug>/SKILL.md`.
- **Creating** a new skill → `Write` `~/.backlot/skills/<new-slug>/SKILL.md`;
  the folder is created along with it.

Write the best draft you can, then tell the user briefly what you changed.

## Capturing intent

Before drafting, be clear on:

1. What should this skill let the agent do?
2. When should it trigger — what user phrases and contexts?
3. What is the expected output?

If the user said "turn this into a skill," mine the conversation first — the
tools used, the order of steps, the corrections they made, the input/output
shapes. Come with a draft, not a list of questions. Confirm the essentials,
then write.

## Anatomy of a skill

```
<slug>/
├── SKILL.md          (required — YAML frontmatter + Markdown body)
└── (optional)
    ├── scripts/      executable helpers for deterministic, repeated work
    ├── references/   docs the agent reads only when needed
    └── assets/       templates, icons, fonts used in output
```

**Progressive disclosure** — three loading levels:

1. **Frontmatter** (`name` + `description`) — always in context. Keep it tight.
2. **SKILL.md body** — loaded when the skill triggers. Aim under ~500 lines.
3. **Bundled resources** — read or executed only when the body points to them.

If the body is growing past ~500 lines, move detail into `references/` and
point at it clearly from `SKILL.md`.

## The frontmatter

```yaml
---
name: <slug>
description: <what it does + WHEN to use it>
---
```

- **`name`** — the slug. Lowercase, hyphenated. Matches the folder name.
- **`description`** — the single most important field. It is what the agent
  reads when deciding whether to invoke the skill. Put **all** the "when to use
  this" cues here, not in the body. Be specific, and lean slightly pushy —
  agents under-trigger skills. Instead of *"Formats data into charts,"* write
  *"Formats data into charts. Use whenever the user wants a chart, graph, or
  visualization, or shares numbers they want plotted — even if they don't say
  'chart' explicitly."*

## Writing the body

- Use the imperative. "Extract the title," not "The title should be extracted."
- Explain the **why** behind instructions — the agent reasons better with intent
  than with bare rules. If you find yourself stacking `ALWAYS` / `NEVER` in caps
  or rigid templates, reframe and explain the reason instead.
- Define output formats explicitly when they matter — show the exact template.
- Include one or two concrete examples. They anchor behavior better than prose.
- Keep it general. A skill that only works for the examples in front of you is
  not a skill. Write for the thousandth use, not the first.
- Draft it, then read it again with fresh eyes and cut what isn't pulling
  weight.

## Bundling resources

- If the same helper script would be rewritten on every run, bundle it in
  `scripts/` and tell the body to call it.
- Large reference material → `references/<topic>.md`, loaded on demand. For a
  reference file over ~300 lines, give it a table of contents.
- When a skill spans several variants (frameworks, platforms), organize
  `references/` by variant so the agent reads only the one it needs.

To add resources to a skill, create the files under
`~/.backlot/skills/<slug>/` directly with the normal file tools.

## Don't surprise the user

A skill's behavior must match what its description promises. No hidden actions,
no malware, no data exfiltration, nothing that compromises the system. Refuse
requests to build deceptive or malicious skills.

## After it's written

A skill created here lands in `~/.backlot/skills/<slug>/` and is on by default —
available to the next session. The user can toggle it off, edit it, or delete it
from Backlot's Settings → Skills page. If "Publish agent-created skills" is on,
Backlot also links it into the user's `~/.claude/skills` so their other tools
see it.

Offer to refine the `description` if the skill isn't triggering reliably — a
sharper, more specific description is almost always the fix.
