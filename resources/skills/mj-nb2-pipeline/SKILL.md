---
name: mj-nb2-pipeline
description: >
  Two-stage image pipeline: generate a scene in Midjourney, then enhance realism in Nano Banana (NB2/Pro).
  Use when the user generates images with Midjourney and then modifies or enhances them with Nano Banana
  or another image model. Trigger keywords: midjourney + nano banana, MJ to NB2, enhance my MJ output,
  take my midjourney image into nano banana, realism upgrade, enhance without changing composition.
version: 1.0.0
status: active
created: 2026-04-02
updated: 2026-04-02
owner: Crea
depends_on:
  - nano-banana-pro
  - midjourney (placeholder — skill not yet created, see note below)
---

# MJ → NB2 Pipeline

**Two-stage workflow:** Midjourney builds the scene → Nano Banana 2 upgrades the realism.

Source: Shlabu's Craft guide — [Midjourney x Nano Banana](https://shlabu.craft.me/Qu4f0BLHsSwBEk)

---

## The Pipeline

```
Midjourney → download image → Nano Banana 2 (as reference) → enhanced output
```

### Stage 1: Midjourney — Build the Scene

Write a full cinematic MJ prompt:
- Subject + wardrobe + environment + pose
- Camera angle, lens, framing (e.g. `50mm cinema lens at eye level`)
- Lighting (e.g. `warm natural desert sunlight`)
- Color grade (e.g. `warm dusty desert color grading, sandy browns and muted greens`)
- Aesthetic anchor (e.g. `--ar 16:9 --p owuip2c`)


### Stage 2: Nano Banana 2 — Enhance Realism

Upload the MJ output as a reference image. Apply the NB2 Enhancement Prompt Template below.

**Critical constraint:** NB2 must preserve the entire composition. Its only job is texture, skin, and grade — not restructuring.

---

## NB2 Enhancement Prompt Template

```
Ultra-realistic enhancement of the existing [SCENE DESCRIPTION] photograph while preserving the exact composition, pose, camera angle, [KEY OBJECT] position, lighting direction, and background elements. [SUBJECT DESCRIPTION with wardrobe] remains [POSE/POSITION] with [ENVIRONMENT DETAILS]. Improve skin realism and facial detail: visible pores, subtle freckles, natural skin micro-texture, fine facial hair, realistic lip texture, detailed eyelashes, natural catchlights in the eyes, and slightly imperfect skin variation while avoiding artificial smoothing. Maintain the same [LIGHTING TYPE] and direction, enhancing subtle highlight roll-off on the cheekbones and nose and preserving soft shadows. Increase image clarity and micro-contrast across fabrics and environment: detailed weave in [FABRIC], realistic stitching and folds, textured [GROUND/SURFACE], sharper [BACKGROUND DETAIL]. Keep the original [AESTHETIC: moody analog / cinematic / warm travel] aesthetic with controlled grain, cinematic color grading, [COLOR PALETTE], and [MOOD]. Improve sharpness and dynamic range while retaining the nostalgic atmosphere, natural depth, and photographic authenticity.
```

**Fill in the brackets — never leave them generic.** The more specific you are about what to preserve, the more controlled the output.

### Locked Preservation Clause

When composition fidelity is critical, prepend this clause to your NB2 prompt:

```
Keep the original image's composition, camera angle, framing, lens behavior, depth of field, pose, and lighting direction exactly the same. Do not alter perspective or subject positioning unless explicitly requested.
```

---

## Example: Desert Scene (Shlabu)

**MJ Prompt:**
```
Cinematic desert scene continuing from the same environment as the blonde curly-haired man in the yellow hazmat overall: a young woman in her mid-20s with warm olive skin, straight shoulder-length dark brown hair, natural makeup and soft freckles, sitting comfortably beside an old beige desert caravan parked in dry grass and sand, wearing the same bright yellow hazmat-style overall with a black shirt underneath, relaxed posture in a simple folding camping chair with both hands resting naturally on the sides of the chair, calm contemplative expression looking slightly off toward the desert horizon as if the camera has panned to the right from the man's position, medium shot captured with a 50mm cinema lens at eye level, the caravan occupying the background with subtle retro stripes and a small awning casting soft shade, desert plants and distant mountains visible beyond, warm natural desert sunlight creating soft highlights on her face and the yellow suit, consistent warm dusty desert color grading matching the previous shot, sandy browns and muted greens with cinematic contrast, shallow depth of field with the caravan and background gently softened, realistic skin texture, natural hair strands moving slightly in the breeze, detailed folds and matte texture on the yellow suit, subtle film grain, ultra-detailed 8K cinematic movie still aesthetic maintaining continuity with the original desert scene. --ar 16:9 --p owuip2c
```

**NB2 Enhancement Prompt:**
```
Ultra-realistic enhancement of the existing desert photograph while preserving the exact composition, pose, camera angle, caravan position, chair position, lighting direction, and background elements. The young woman with warm olive skin and shoulder-length dark brown hair remains seated in the folding desert chair wearing yellow overalls and a black t-shirt, with the weathered beige caravan and awning in the background. Improve skin realism and facial detail: visible pores, subtle freckles, natural skin micro-texture, fine facial hair, realistic lip texture, detailed eyelashes, natural catchlights in the eyes, and slightly imperfect skin variation while avoiding artificial smoothing. Maintain the same warm desert lighting and direction, enhancing subtle highlight roll-off on the cheekbones and nose and preserving soft shadows. Increase image clarity and micro-contrast across fabrics and environment: detailed weave in the overalls, realistic stitching and folds, textured desert ground, sharper caravan paint wear, and defined shrub detail. Keep the original moody analog film aesthetic with controlled grain, cinematic color grading, warm golden tones, deep blue sky, and slightly faded vintage palette. Improve sharpness and dynamic range while retaining the nostalgic atmosphere, natural depth, and photographic authenticity.
```

---

## Related Skills

| Skill | When to Use | Location |
|---|---|---|
| `nano-banana-pro` | Full NB2/Pro prompting rules, generation + editing | [laniameda-skills/skills/ai-creatorship/nano-banana-pro](https://github.com/Michailbul/laniameda-hq/tree/main/laniameda-skills/skills/ai-creatorship/nano-banana-pro) |
| `midjourney` | ⚠️ **PLACEHOLDER — Skill not yet created.** Revisit when building Midjourney-specific skill: trigger words, prompt anatomy, style codes (`--p`), aspect ratios, sref/cref usage. | *To be created in laniameda-skills/skills/ai-creatorship/midjourney/* |

> **TODO for Michael:** Create the `midjourney` skill — should cover: prompt anatomy, `--p` moodboard codes, `--sref` / `--cref` style/character references, aspect ratios, and model version differences. Link back here when done.

---

## Quick Decision Guide

| Situation | Action |
|---|---|
| User has MJ output, wants "make it more realistic" | Stage 2 only — apply NB2 Enhancement Template |
| User wants to build a new scene from scratch in MJ | Stage 1 — write full MJ scene prompt |
| User wants the full pipeline from concept | Both stages in order |
| User wants to enhance a non-MJ image | NB2 Enhancement Template still applies — just skip Stage 1 |
