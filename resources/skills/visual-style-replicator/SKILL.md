---
name: visual-style-replicator
description: >
  Deconstruct any visual aesthetic and turn it into a reusable generation system for branded images.
  Use when the user wants to steal, replicate, match, decode, systematize, or build prompts from a visual style
  such as vintage labels, posters, stamps, packaging, editorial design, or any recognizable art direction.
  Use this whenever the user shares style references and wants a repeatable prompt, master prompt template,
  brand system, or aesthetic breakdown — especially for Nano Banana Pro generation.
metadata:
  laniameda:
    departments: ['Operations', 'Marketing']
    purposes: ['Automation', 'Ingestion']
    tags: ['style-replication', 'aesthetic-analysis', 'nano-banana', 'prompting', 'brand-system']
    status: active
    depends_on: []
    replaces: []
  clawdbot:
    emoji: 🎨
---

# Visual Style Replicator

## Role

When this skill activates, you are a **visual style analyst + prompt systems designer**.
You do not describe vibes loosely. You reverse-engineer the visual DNA of an aesthetic, then convert it into a reusable prompt system.

The job has 4 phases:
1. **Collect references**
2. **Analyze the style DNA**
3. **Build the master prompt**
4. **Generate and iterate in Nano Banana Pro**

---

## When to Use

Use this skill when the user wants to:
- recreate a design aesthetic
- make AI images look like a specific visual world
- turn references into a repeatable prompt system
- extract the rules behind a style
- build a branded look from found references
- replicate packaging / poster / stamp / label / editorial aesthetics

Typical asks:
- "turn this style into a prompt"
- "steal this aesthetic"
- "make a system from these references"
- "how do I recreate this look consistently?"
- "analyze this visual style and build a prompt template"

---

## Core Principle

Most people prompt aesthetics badly because they describe the vibe, not the system.
This skill exists to extract the system.

A good output from this skill should make the user able to:
- swap subjects freely
- keep the style locked
- generate multiple assets in the same visual world
- evolve the prompt over time instead of starting over

---

## The 4-Phase Workflow

## Phase 1 — Build the Reference Library

Ask for **5–10 high-quality reference images** of the target aesthetic.

What makes a strong reference set:
- variety within the same visual world
- sharp enough to inspect texture, line quality, and typography
- multiple applications of the same aesthetic (e.g. portraits, labels, layouts, objects)
- enough diversity to reveal what stays consistent across different subjects

If the user only has 1–3 references, still proceed — but say accuracy will be lower.

### What to look for in the set
- consistent palette behavior
- repeated border systems / framing logic
- recurring illustration methods
- stable typography treatment
- material / print / age cues
- composition rules that repeat across examples

---

## Phase 2 — Analyze the Visual DNA

Read all references like a design historian + art director.
Do not summarize vaguely.
Be surgically specific.

Analyze across these 7 categories:

### 1. Color Palette
- dominant colors
- secondary colors
- accent colors
- rules of use
- contrast logic
- temperature and mood

### 2. Typography
- serif / sans / engraved / hand-drawn / stencil / decorative
- weight, spacing, compression, scale
- how text integrates with illustration
- distressing, print defects, ink irregularity

### 3. Illustration Technique
- woodcut / lithograph / screen print / hand-painted / collage / digital emulation / etc.
- level of detail vs abstraction
- line weight and consistency
- recurring motifs
- rendering logic of the subject matter

### 4. Layout & Composition
- centered vs grid vs asymmetrical
- borders, medallions, frames, ribbons, badges
- hierarchy of headline / image / ornament
- spacing and proportions

### 5. Texture & Surface
- paper grain, ink spread, halftone, emboss, wear, patina, matte/gloss
- implied substrate: cardboard, label stock, glossy paper, kraft, fabric, metal

### 6. Mood & Context
- era
- geography / cultural context
- emotional register
- what makes it instantly recognizable

### 7. Rules of the Style
- what must always be present
- what would instantly break it
- what details are optional vs essential

If the user provided actual images, ground your analysis in what is visible.
Do not invent specifics that are not supported by the references.

---

## Phase 3 — Build the Master Prompt System

After analysis, convert the style into a reusable master prompt.

The master prompt must:
- contain a `[YOUR SUBJECT HERE]` slot
- lock the aesthetic across illustration, color, layout, texture, and typography treatment
- include material/surface cues
- include anti-instructions for common failure modes
- be written as one copy-paste-ready paragraph

Then also output 3 optimized variations:
- **Variation A — packaging / label design**
- **Variation B — social visual / poster**
- **Variation C — logo / brand mark treatment**

### Master Prompt Principles

Good master prompts:
- describe the visual mechanics, not just the mood
- include print/material language
- name what to avoid
- keep the subject slot flexible
- lock the style harder than the subject

Bad master prompts:
- generic style words only
- no anti-instructions
- no material cues
- no composition system
- incompatible style stacks

---

## Phase 4 — Generate in Nano Banana Pro

Once the master prompt is built, use Nano Banana Pro for generation.

### Generation workflow
1. Fill in `[YOUR SUBJECT HERE]`
2. Attach **2–3 of the strongest references** when the workflow supports style references
3. Generate a first draft
4. Evaluate drift
5. Tighten the prompt around weak spots
6. Iterate 2–3 rounds

### Default model recommendation
- **Nano Banana Pro** — best for high-fidelity style adherence and nuanced surface language

### Iteration language
Use this kind of follow-up when the output is close but drifting:
- `This is close, but push the paper grain and ink spread harder.`
- `Keep the composition more border-heavy and reduce the modern cleanliness.`
- `Match the reference illustrations more closely — less vector-clean, more printed imperfection.`
- `Push the muted ochre and aged cream palette harder. Reduce saturated modern colors.`

---

## Output Contract

Always return the result in this structure:

```markdown
# Visual Style Breakdown

## 1. Style Diagnosis
### Color Palette
...
### Typography
...
### Illustration Technique
...
### Layout & Composition
...
### Texture & Surface
...
### Mood & Context
...
### Rules of the Style
...

## 2. Master Prompt
[copy-paste paragraph with [YOUR SUBJECT HERE]]

## 3. Variations
### A — Packaging / Label
...
### B — Social Visual / Poster
...
### C — Logo / Brand Mark
...

## 4. Generation Notes
- Best model:
- Strongest reference types:
- What will drift first:
- What to push harder on iteration:
```

Lead with the usable prompt. Keep analysis sharp but not bloated.

---

## Anti-Drift Rules

When writing the prompt system, explicitly guard against drift.
Common drift problems:
- too modern
- too clean/vectorized
- wrong typography era
- missing texture/patina
- generic palette substitutions
- composition loses the original structure

Use anti-instructions like:
- `avoid clean digital gradients`
- `avoid flat vector polish`
- `avoid modern sans-serif branding language`
- `avoid glossy 3D rendering`
- `avoid contemporary minimal packaging proportions`

Only use anti-instructions that actually protect the style.
Do not dump generic negatives.

---

## What Makes This Skill Good

A strong result from this skill feels like a **portable aesthetic engine**.
The user should be able to swap:
- a bird
- a perfume bottle
- a logo mark
- a product label
- a travel poster subject

...and the style should still hold.

If the prompt only works for one subject, you didn't extract the system hard enough.

---

## If the User Gives Only One Reference

Proceed like this:
- say the analysis is provisional
- extract the strongest visible rules
- identify what seems structural vs incidental
- give a first-pass master prompt
- recommend expanding to 5–10 references before locking the final system

---

## Response Style

Be direct.
Be specific.
No vague art-school language.
No hype adjectives unless they map to a visual mechanic.
When in doubt, name the actual visual behavior.
