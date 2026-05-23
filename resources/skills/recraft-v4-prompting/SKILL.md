---
name: recraft-v4-prompting
description: >
  Write high-performance prompts for Recraft V4 (V4 Standard, V4 Pro, V4 Vector, V4 Vector Pro).
  Use whenever the user asks for a Recraft prompt, a poster layout, editorial image, product shot,
  logo/icon/vector SVG, typographic design, or brand-ready visual to be generated in Recraft.
  Prefer this skill over generic image prompting when the target model is explicitly Recraft V4
  or when the user needs print-ready, vector-native, or typography-integrated output.
---

# Recraft V4 Prompting

## Role

When this skill activates, you are a **Recraft V4 prompt architect**.
Recraft V4 is a design-literate image model — it makes aesthetic decisions on its own ("design taste"). You are not writing for a generic diffusion model. You are briefing a model trained to think like an art director.

Your priorities, in order:
1. **Match prompt length to intent** — short for exploration, structured for production
2. **Define systems, not adjectives** — color system, type system, shape system
3. **Separate visual layers, then describe how they interact**
4. **Quote exact text** — always, no exceptions
5. **Declare format + purpose up front** (poster, editorial, product shot, logo, icon set)

---

## What Recraft V4 Is

- **V4 Standard** — 1024×1024, ~10s generation
- **V4 Pro** — 2048×2048, ~28s, print-ready
- **V4 Vector / Vector Pro** — outputs true editable SVG with structured layers and clean geometry (no tracing)
- Supports CMYK, custom DPI, mockup generation, background manipulation
- Distinct strengths: typography as structural element, editorial portraits, product photography, vector logos, 3D typographic posters

**When to prefer Recraft over other models:**
- Output must be a real SVG (logos, icons, scalable illustration)
- Typography is a structural part of the composition, not overlay
- Print / CMYK / high-DPI deliverable
- Editorial-campaign feel with refined composition
- Multi-product mockup series where consistent label/branding matters

**When another model is better:**
- Cinematic video frames → Nano Banana Pro / Midjourney
- Photoreal characters for video continuity → Nano Banana Pro with character sheets
- Highly stylized illustrated narrative art → Midjourney

---

## Core Operating Principle

> Recraft V4 adapts to your level of clarity.
> **Short prompt → model designs with you.**
> **Long prompt → model executes your architecture.**

Structured prompts don't make results "better." They make results **intentional, controllable, and repeatable**. Choose mode deliberately:

- **Interpretive mode (3–6 words):** exploration, mood discovery, variant hunting
- **Architectural mode (structured, long):** locked art direction, production deliverables, brand-consistent series

---

## Output Contract

Always deliver in this order:

1. **Recraft V4 prompt** — copy-paste ready, in a code block
2. **Recommended model variant** — V4, V4 Pro, Vector, or Vector Pro (with reason)
3. **Why this structure works** — 2–4 bullets max
4. **Failure watchouts** — what may break in generation
5. **Optional tighter / bolder version** — only if useful

Do not bury the prompt under explanation.

---

## Universal Prompt Skeleton (Architectural Mode)

Move from **global → local**. This order is how Recraft reads the scene:

```text
[1. Core concept / format / purpose]       → what this image IS (poster, editorial cover, product shot, logo)
[2. Background & environment]              → spatial context, backdrop, setting
[3. Primary subject: framing + pose]       → positioning, angle, expression
[4. Physical attributes]                   → identity, materials, finishes
[5. Secondary elements + spatial logic]    → what else is in frame, where, why
[6. Lighting]                              → direction, quality, temperature, what it hits
[7. Camera / depth / contrast]             → lens feel, DOF, focus area
[8. Typography block (if any)]             → hierarchy, placement, quoted text
[9. Mood & compositional resolution]       → the emotional payoff
```

For **vector / logo / icon work**, replace lighting + camera with:
- Shape logic and silhouette clarity
- Line discipline (consistent stroke, no texture)
- Strict palette definition (explicit colors)
- Hard constraints (no gradients, no shadows, flat)

---

## Mode Templates

### Short exploration prompt (3–6 words)

Use for mood discovery and variant generation.

```text
[subject descriptor], [context], [framing]
```

Examples:
- `Close up Asian model, orange background`
- `Minimalist travertine product pedestal, studio`
- `Overhead flatlay, botanical cosmetics, cream`

### Editorial / photorealistic portrait

```text
[Format: editorial beauty / skincare portrait], [subject + framing: extreme macro close-up of...], 
[physical attributes: visible pores, fine peach fuzz, stray wet hair strands], 
[expression: relaxed neutral / confident / caught mid-motion],
[lighting: cinematic natural daylight from side / window light / diffused top-left],
[camera: shallow DOF, focus on eye and cheek, warm color grading],
[mood: authentic, imperfect, editorial, campaign-feeling not backstage].
```

### Product photography (mockup series-ready)

```text
High-end studio product photography of [N] [finish] [product] with [label description: minimalist cream label, 
botanical line illustrations, text "BRAND NAME"]. Products arranged on [surface: sculptural travertine pedestal] 
against [backdrop: warm neutral, soft gradient]. [Secondary props: orchids, anthuriums, linen drape]. 
[Lighting: soft diffused natural light, gentle shadows falling left]. 
Consistent branding across all items. [Mood: editorial, muted, luxury skincare campaign].
```

### 3D typographic poster

```text
3D typographic poster, [format: portrait A2 / square / landscape banner].
Monochromatic [color system: deep emerald / ember / linen]. 
Letters appear [spatial behavior: compressed inside cavity, pushing toward frame edges to create tension].
Main word "EXACT TEXT" split [layout logic: vertically as O/VE/R, staggered stacked sculptural segments].
Material: [glossy lacquered emerald, ultra-smooth, fully reflective / matte ceramic / translucent resin].
Secondary text (all quoted):
- top center "CREATIVE STATE STUDIOS"
- upper right vertical "PORTFOLIO 2026"
- center overlay "OPTICAL VEIL"
[Lighting: directional top-left, sculpts letter volumes, deep shadows in cavity].
[Mood: museum catalog, confident, heavy but precise].
```

### Graphic design: poster (layered approach)

Define each visual language separately, then describe how they interact.

```text
Format and scale: [A2 portrait poster / 1080×1350 social].
Background layer: [solid warm cream / gradient dusk / grain-textured ivory].
Graphic overlay: [abstract shape: half-moon silhouette in coral, off-center right].
Typographic hierarchy (largest first):
- Display: "EXACT HEADLINE" — condensed sans-serif, top third, occupies 60% width
- Subhead: "exact subtitle" — serif italic, directly beneath, 1/4 size
- Micro: "ISSUE 07 · APRIL 2026" — mono, bottom edge, tracked out
Text placement logic: [headline anchored to grid baseline, subhead bridges headline to image].
Contrast between layers: [headline overlaps graphic, clipped where it crosses].
[Mood: independent magazine, confident, editorial].
```

### Logo / icon set (vector mode)

```text
[Type: logomark / wordmark / icon set of 6].
Silhouette: [strict geometric / organic rounded / angular sharp].
Shape logic: [built from circles + 45° diagonals / based on single modular unit].
Line discipline: [consistent 2px stroke / filled shapes only / uniform corner radius].
Palette (strict): [coral #F26157 + carbon #191919 — two colors only, no gradients, no shadows].
Layout: [centered, equal optical weight, 1:1 bounding box per icon].
Hard constraints: no gradients, no shadows, no texture, no 3D, flat vector only.
[Brand context: skincare studio, confident modern, no nostalgia].
```

### Vector illustration

```text
Drawing style: [graphic flat / painterly / anime / brutalist geometric].
Subject and pose: [exact description].
Line behavior: [clean, irregular hand-drawn, bold 4px outline].
Color logic: [limited palette of 4, named: coral, carbon, teal, linen].
Surface treatment: [flat fills / grain overlay / watercolor shading].
Depth structure: [airbrush gradient behind subject / hard-edged shadows / no depth].
Emotional tone: [playful, confident, quiet].
```

---

## The Rules (non-negotiable)

### 1. Always quote exact text
If the image must contain text, wrap it in `"quotes"`. Recraft renders quoted text far more accurately than unquoted text.

```text
✓ Main title reads "OVERTHINK"
✗ Main title says overthink
```

### 2. Define format + purpose up front
Start with what this image IS: poster, editorial cover, hero banner, product shot, social ad, logo, icon. The format drives every compositional decision downstream.

### 3. Describe systems, not adjectives
Recraft responds to **structural language**, not style buzzwords.

| Bad (adjective soup) | Good (structural system) |
|---|---|
| "beautiful, stunning, cinematic" | "directional window light from left, shallow DOF on eyes, warm color grading" |
| "amazing typography" | "condensed display sans at top 1/3, serif italic subhead beneath, quoted micro-copy at bottom edge" |
| "vibrant colors" | "palette of three: coral #F26157, carbon #191919, linen #FFF4EA — coral dominates, carbon anchors type, linen is background" |

### 4. Describe materials by finish, not vibe
Name surface behavior: **matte, satin, lacquered, glossy, brushed, diffused, translucent, chalky**.

### 5. Lighting = source + direction + quality + what it does
Not "beautiful lighting." Instead: *"Soft window light from upper-left, diffused through linen, creates long shadows across the travertine surface."*

### 6. One visual language at a time
When mixing typography + photography + graphic overlay, **define each separately, then describe how they interact**. Don't blend languages into a single run-on sentence.

### 7. Short prompt or structured prompt — not mushy middle
A 20-word prompt half-specifying a brand poster produces the worst output. Either keep it 3–6 words for exploration, or commit to the full architectural structure.

### 8. For vector work, strip camera language
No "shallow depth of field," no "cinematic lighting," no "bokeh" in vector prompts. Vector = silhouette, shape, palette, line, constraint.

### 9. Don't stack dramatic adjectives for photorealism
"Hyper-realistic, cinematic, breathtaking, award-winning" actively hurts Recraft output. Use concrete description of the scene instead.

### 10. Use negative prompts for cleanup, not style
Good: `no blur, no artifacts, no distorted hands, no duplicate elements`.
Not: `no ugly, no bad art` (these mean nothing).

---

## Parameter Guidance (Recraft Studio / API)

| Setting | When to change |
|---|---|
| **Style** | If prompts aren't being interpreted right, fall back to broad styles: "Recraft V3", "Photorealism", or "Illustration" rather than niche custom styles. |
| **Artistic level** | Lower it when the model struggles with prompt adherence. Lower artistic level = less creative variance, better prompt compliance. |
| **Avoid text in prompt → Yes** | Enable for logo work when you want expressive text layouts (at the cost of occasional typos). |
| **Creative Upscale** | Apply to fix distorted faces, hands, small details post-generation. |
| **Frame + Outpaint** | Use when content crowds image borders. |
| **Convert to mockup** | For complex curved surfaces (bottles, fabric, cups). |
| **Prompt-based editing** | For flat surfaces (banners, phone screens, posters on walls). |
| **Negative prompt** | Adding `no blur, no artifacts, no distorted anatomy` cuts post-processing by ~15%. |

---

## Model Variant Selection

| Scenario | Use |
|---|---|
| Fast iteration, web assets, 1K enough | **V4** (Standard) |
| Print, billboard, high-DPI, editorial | **V4 Pro** |
| Logo, icon set, illustration needing SVG | **V4 Vector** |
| Print-scale vector, complex illustration SVG | **V4 Vector Pro** |

Default draft loop: **V4 Standard → lock prompt → V4 Pro for final**.

---

## Domain Cheat Sheet

- **Branding:** geometry → hierarchy → spacing → scalability → hard constraints
- **Fashion / campaign:** light → material → framing → simplified background
- **Vectors:** silhouette → shape clarity → system consistency → palette
- **Posters:** grid → margins → text size relationships → layer contrast
- **Product:** surface finish → pedestal/prop → light direction → label text (quoted)
- **Editorial portrait:** skin texture → expression → light source → DOF → mood

---

## Failure Patterns to Watch

| Symptom | Likely cause | Fix |
|---|---|---|
| Typos / garbled text | Text not in quotes | Wrap all text in `"…"` |
| Vague, "stock photo" feel | Adjective soup, no format declared | Start with format + purpose; describe systems |
| Elements drift off edges | Composition over-stuffed | Use Frame + Outpaint, or reduce elements |
| Distorted hands / faces | V4 rare edge case | Creative Upscale on affected region |
| Logo has gradient when you wanted flat | Didn't declare hard constraints | Add `no gradients, no shadows, flat vector only` |
| Typography feels stuck on top | Didn't define interaction between type and image | Describe how type sits relative to other elements ("bridges above-water and below-water areas") |
| Photorealism looks plasticky | Dramatic adjectives stacked | Remove "cinematic/stunning/hyper-realistic"; describe light + skin + DOF concretely |
| Inconsistent branding across product series | No consistency lock | Add "consistent branding across all items, identical label style" |

---

## Working Example (full architectural prompt)

**Brief:** Editorial skincare brand poster, coral + carbon + linen palette, for a Laniameda campaign.

```text
Format: A2 portrait editorial skincare poster, print-ready, CMYK.
Background: warm linen cream (#FFF4EA), subtle grain texture, slight vertical gradient toward ivory at top.
Primary subject: extreme macro close-up of a young woman's face, focus on one cheek and eye, 
visible natural skin texture with pores, fine peach fuzz catching light, stray wet hair strand across forehead, 
relaxed neutral expression, off-center right, occupying right 55% of frame.
Lighting: cinematic natural daylight from upper-left, diffused through soft fabric, 
warm temperature, sculpts cheek and brow, subtle shadow under jaw.
Camera: shallow depth of field, focus anchor on eye, soft fall-off toward ear.
Color grading: warm coral undertones in skin, carbon shadows, linen highlights — three-color system.

Typography (all quoted, left-aligned on left 40% of frame):
- Display: "BOTANICA" — condensed modern sans-serif, coral #F26157, occupies top third left side, 
  vertically stacked as "BOTA/NICA"
- Subhead: "a skincare study" — serif italic, carbon #191919, directly beneath display, 1/6 size
- Micro: "ISSUE 07 · APRIL 2026" — mono, tracked wide, bottom-left edge, carbon

Interaction: display type overlaps the skin edge slightly, clipped where it crosses the cheek, 
creating depth between type layer and image layer.

Mood: confident, quiet, independent magazine editorial, not commercial, not backstage — campaign-feeling.

Hard constraints: no dramatic vignettes, no filter overlays, no decorative flourishes, no stock-photo softness.
Negative: no blur, no artifacts, no duplicate type, no distorted features.
```

**Recommended variant:** V4 Pro (print deliverable).

---

## Quick Reference Card

```text
PROMPT ORDER (global → local):
format/purpose → background → subject framing → attributes → secondary elements 
→ lighting → camera → typography (quoted) → mood

ALWAYS:
- Quote exact text
- Declare format up front
- Describe systems (color / type / shape)
- Separate visual layers

NEVER:
- Stack dramatic adjectives for photorealism
- Use camera language for vector
- Leave text unquoted
- Sit in the "mushy middle" (15–30 word half-specified prompt)

SHORT PROMPT = co-design with model.
LONG PROMPT = architect, model executes.
```
