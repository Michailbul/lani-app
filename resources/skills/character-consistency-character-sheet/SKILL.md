---
name: character-consistency-character-sheet
description: >
  Create consistent AI characters using the character sheet method. Use when the user wants
  character consistency, reference sheets, model turnarounds, or maintaining character identity
  across multiple generations. Works with Nano Banana Pro/2, Google Flow, Midjourney, and other
  image models. Triggers on: character sheet, character consistency, reference sheet, model
  turnaround, identity lock, same character multiple angles, AI character, consistent face.
version: 1.0.0
status: active
created: 2026-03-27
updated: 2026-03-27
owner: Crea
agents: [Crea]
departments: [AI Creatorship]
purposes: [Character Generation, Consistency, AI Filmmaking]
tags:
  - character-consistency
  - character-sheet
  - reference-sheet
  - nano-banana
  - google-flow
  - ai-filmmaking
  - model-turnaround
  - identity-lock
---

# Character Consistency — Character Sheet Method

Create consistent AI characters that maintain identity across outfits, lighting changes, aging, and video sequences.

---

## When to Use This Skill

- Creating a character that needs to appear in multiple scenes/outfits
- Building an AI influencer or digital persona
- Making AI videos with consistent characters
- Need a reference anchor for downstream generation

---

## The Core Method

**One character sheet → use as reference for everything else.**

The sheet shows 7 views:
- **Top row (full body):** front, left profile, right profile, back
- **Bottom row (close-up):** front face, left profile face, right profile face

This becomes your anchor. All downstream work (new outfits, lighting, aging, video) uses this sheet as the image reference.

---

## Tool Stack

| Tool | Role |
| **Nano Banana Pro/2** | Image generation engine |


---

## Prompts

### 1️⃣ Character Sheet (With Reference Image)

Upload a reference image, then use:

```
Create a professional character reference sheet based strictly on the uploaded reference image. Use a clean, neutral plain background and present the sheet as a technical model turnaround while matching the exact visual style of the reference (same realism level, rendering approach, texture, color treatment, and overall aesthetic). Arrange the composition into two horizontal rows. Top row: four full-body standing views placed side-by-side in this order: front view, left profile view (facing left), right profile view (facing right), back view. Bottom row: three highly detailed close-up portraits aligned beneath the full-body row in this order: front portrait, left profile portrait (facing left), right profile portrait (facing right). Maintain perfect identity consistency across every panel. Keep the subject in a relaxed A-pose and with consistent scale and alignment between views, accurate anatomy, and clear silhouette; ensure even spacing and clean panel separation, with uniform framing and consistent head height across the full-body lineup and consistent facial scale across the portraits. Lighting should be consistent across all panels (same direction, intensity, and softness), with natural, controlled shadows that preserve detail without dramatic mood shifts. Output a crisp, print-ready reference sheet look, sharp details.
```

**Generate 4 outputs.** Pick the best. Upscale to 2K or 4K in Flow.

---

### 2️⃣ Character Sheet (No Reference — Text Only)

For minor characters or when you don't have a source image:

```
Create a professional character reference sheet of [PUT YOUR CHARACTER DESCRIPTION HERE]. Use a clean, neutral plain background and present the sheet as a technical model turnaround in a photographic style. Arrange the composition into two horizontal rows. Top row: four full-body standing views placed side-by-side in this order: front view, left profile view (facing left), right profile view (facing right), back view. Bottom row: three highly detailed close-up portraits aligned beneath the full-body row in this order: front portrait, left profile portrait (facing left), right profile portrait (facing right). Maintain perfect identity consistency across every panel. Keep the subject in a relaxed A-pose and with consistent scale and alignment between views, accurate anatomy, and clear silhouette; ensure even spacing and clean panel separation, with uniform framing and consistent head height across the full-body lineup and consistent facial scale across the portraits. Lighting should be consistent across all panels (same direction, intensity, and softness), with natural, controlled shadows that preserve detail without dramatic mood shifts. Output a crisp, print-ready reference sheet look, sharp details.
```

---

### 3️⃣ Full-Body Fix (When Feet Get Cropped)

```
Remake this image, ensuring the entire top row shows full body views from head to toe. All subjects in top row must be fully visible including feet with no cropping at the ankles, knees or head.
```

---

### 4️⃣ Wardrobe Change

Use the character sheet as image reference:

```
Keep the same character sheet layout. Keep their physical characteristics and expression the same. Change the outfit to [outfit description or reference to image].
```

Can also use an outfit reference image as a second image prompt.

---

### 5️⃣ Lighting Change

```
Use this character reference sheet. Recreate the character in [DESCRIBE LIGHTING SCENARIO — e.g., golden hour, neon-lit street, soft window light, dramatic side light]. Maintain exact identity, only change lighting.
```

---

### 6️⃣ Aging / Time Progression

```
Take this character reference sheet. Create a portrait of the same character aged by [X] years. Maintain all distinctive features, scars, tattoos. Only change age-related features (wrinkles, hair color, skin texture).
```

For time-lapse video:
1. Generate portrait at Age A
2. Generate portrait at Age B
3. Flow → Frames to Video → Age A as first frame, Age B as second frame
4. Prompt: "time-lapse between these two ages, smooth transition"

---

### 7️⃣ Multi-Character Scene

1. Create character sheets for each character separately
2. Upload both sheets as image references
3. Use ChatGPT to expand the scene description (metaprompt below)
4. Generate the scene

**Metaprompt for ChatGPT:**
```
Enhance this scene description for use as an AI image generation prompt. Be specific about lighting, composition, emotional tone, and physical interaction between characters.

My scene: [brief description]
```

---

### 8️⃣ Animation (Frames to Video)

**Quality method (recommended):**
1. Character sheet as ref → generate scene still image
2. Flow → Frames to Video → use still as first frame
3. Prompt: describe the action

**Fast method:**
1. Flow → Ingredients to Video
2. Upload character sheet
3. Prompt the action

---

## Workflow Summary

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Source Image   │────▶│  Character      │────▶│  Downstream     │
│  (Midjourney/   │     │  Sheet (7-view) │     │  Uses           │
│   Photo/Desc)   │     │                 │     │                 │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                              │                        │
                              ▼                        ▼
                        ┌─────────────┐          ┌─────────────┐
                        │ Upscale 2K  │          │ Outfit swap │
                        │   or 4K     │          │ Lighting    │
                        └─────────────┘          │ Aging       │
                                                 │ Video       │
                                                 │ Multi-char  │
                                                 └─────────────┘
```

---

## Tips

- **Always generate 4 outputs** for the initial sheet. AI rarely nails it first try.
- **Complex features work:** scars, tattoos, piercings — all maintain consistency when locked to the sheet.
- **Nano Banana 2 vs Pro:** Author says NB2 is "even stronger" for this workflow. Test both.
- **Google Flow > raw Gemini** for visual creation tasks.
- **Metaprompting is a real step** — don't skip the ChatGPT enhancement for complex scenes.

---

## Alternative: Photographic Identity Sheet (Samson Method)

For more naturalistic/realistic results, use photographic language instead of "character reference sheet":

| Instead of... | Say... |
|---------------|--------|
| "Character reference sheet" | "Photographic identity sheet" |
| "Model turnaround" | "Contact sheet" |
| A-pose | Natural, casual stance |
| "3D render/CGI/game character" | Real photography, documentary feel |

This keeps consistency but restores human realism. See the video digest for exact wording.
