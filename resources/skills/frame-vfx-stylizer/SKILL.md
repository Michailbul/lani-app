---
name: frame-vfx-stylizer
description: >
  Convert source video into stylized frame-by-frame mixed-media animation using AI image editing.
  Three presets: white marker outline, painted background strokes, selective graphic fill.
  Use when asked to stylize a video frame-by-frame, add stop-motion effects, or create animated sketch overlays.
version: 1.0.0
status: draft
created: 2026-03-24
updated: 2026-03-24
owner: Lani
source: https://www.instagram.com/reel/DWPEdC_AWOR/
credit: "@lewis_carrot (Саида | Съемка & Монтаж & Ai | Казань)"
agents: [Lani, Persey]
departments: [Marketing, Dev]
purposes: [Content Creation, AI Creatorship, Visual Workflow]
tags:
  - frame-by-frame
  - video-stylization
  - stop-motion
  - mixed-media
  - ai-image-editing
  - cinematic
  - reels
  - instagram
  - vfx
  - animation
depends_on: []
replaces: []
---

# Frame VFX Stylizer

**Purpose:** Convert a source video into a stylized frame-by-frame mixed-media animation using AI image editing — white marker outlines, painted brush strokes, or selective graphic fill.

**Use when:** Creating editorial reels, music video overlays, fashion/cinematic social content, or any clip that needs an "AI-assisted hand-crafted" motion aesthetic.

---

## What This Skill Does

Takes a video → explodes it into frames → runs an AI graphic effect on each frame → reassembles into a stylized clip.

Three distinct effect presets:
1. **White marker outline** — hand-drawn contour lines over subjects
2. **Painted background** — expressive brush strokes in negative space
3. **Selective graphic fill** — partial paint-fill over the hero object

Output looks like stop-motion mixed-media animation. Feels handmade, editorial, cinematic.

---

## Trigger Phrases

- "add hand-drawn overlay to this video"
- "make this look like stop-motion animation"
- "add marker lines to the footage"
- "painted brush stroke effect on this clip"
- "stylize this video frame by frame"
- "add AI graphic effect to this reel"
- "make this look like animated sketch"

---

## Required Inputs

| Input | Type | Notes |
|---|---|---|
| `video` | file path or URL | source clip to stylize |
| `preset` | enum | `white-marker-outline` / `painted-background-strokes` / `selective-graphic-fill` |
| `timing_mode` | enum | `stop-motion` (0.2s/frame) or `smooth` (0.04s/frame) |
| `subject_focus` | string (optional) | `person`, `object`, `background`, `auto` |
| `style_modifiers` | string (optional) | additional style direction, color, mood |

---

## Output Contract

| Output | Description |
|---|---|
| `output.mp4` | stylized video |
| `preview.gif` | lightweight preview |
| `frames/` | folder of processed frame images |
| `manifest.json` | settings used: preset, timing, prompt, frame count |

---

## Effect Presets

### Preset 1 — `white-marker-outline`

**Visual intent:** White sketch/marker lines tracing selected contours of main subject and key shapes. Imperfect, rough, torn, hand-drawn feel. Best for music videos, editorial portraits, subject separation.

**Production prompt:**
```
Preserve the original composition, camera angle, subject identity, pose, clothing,
lighting, and scene structure. Add rough imperfect white hand-drawn marker lines that
trace only selected contours of the main subject and key shapes in the frame. The lines
should feel handmade, slightly torn, expressive, and editorial. Do not redraw the whole
image. Do not replace the subject. Keep the underlying footage visible.
```

### Preset 2 — `painted-background-strokes`

**Visual intent:** Expressive painterly brush strokes in background and negative space only. Subject stays clean and readable. Best for moody cinematic scenes, atmospheric ambient clips.

**Production prompt:**
```
Preserve the original composition, subject identity, pose, foreground objects, lighting,
and framing. Add expressive painted brush strokes only into the background and
negative-space areas behind the subject. The brush strokes should feel gestural,
cinematic, textured, and emotionally charged. Do not cover the face unless explicitly
requested. Keep the subject readable and realistic.
```

### Preset 3 — `selective-graphic-fill`

**Visual intent:** Partial paint-fill over hero object only. Feels like a deliberate hand-applied graphic accent. Best for emphasis beats, fashion, object-centric edits.

**Production prompt:**
```
Preserve the original composition, subject identity, pose, lighting, and environment.
Add a selective hand-painted graphic fill over the main subject or chosen object only,
as if part of the hero object is briefly painted over by hand. Keep the effect partial,
deliberate, and editorial. Do not fully repaint the full frame. Maintain recognizability
and scene coherence.
```

---

## Execution Protocol

### Step 1 — Extract frames
```bash
# Stop-motion: 5fps
ffmpeg -i input.mp4 -vf fps=5 frames/frame_%04d.png

# Smooth: 25fps
ffmpeg -i input.mp4 -vf fps=25 frames/frame_%04d.png
```

### Step 2 — Apply preset to each frame
Run chosen preset prompt against each frame via image edit model. Enforce preservation constraints. Lock seed if tool supports it.

### Step 3 — Consistency check
Review first / middle / last frame. Check for prompt drift, identity loss, composition shift. Tighten prompt if needed.

### Step 4 — Rebuild video
```bash
# Stop-motion (5fps)
ffmpeg -framerate 5 -i frames/processed_frame_%04d.png -c:v libx264 -pix_fmt yuv420p output.mp4

# Smooth (25fps)
ffmpeg -framerate 25 -i frames/processed_frame_%04d.png -c:v libx264 -pix_fmt yuv420p output.mp4
```

### Step 5 — Add audio back (optional)
```bash
ffmpeg -i output_video.mp4 -i original.mp4 -c:v copy -c:a aac output_final.mp4
```

---

## Timing Reference

| Mode | Frame duration | fps | Vibe |
|---|---|---|---|
| `stop-motion` | 0.2s | ~5fps | Chunky, stylized, old-school stop-motion |
| `smooth` | 0.04s | ~25fps | Fluid, closer to normal motion |

---

## "If X Then Y" Mappings

| If you need... | Then use... |
|---|---|
| Rough indie / music video sketch feel | `white-marker-outline` + `stop-motion` |
| Moody cinematic without touching subject | `painted-background-strokes` |
| Hero-object emphasis hit | `selective-graphic-fill` |
| Long clip | Sample 10 frames first for style test, then full batch |
| Too much flicker | Reduce edit strength / tighten preservation prompt |

---

## Known Risks

| Risk | Mitigation |
|---|---|
| Frame-to-frame flicker | Seed locking, tighter preservation prompt, lower denoise |
| Subject identity loss | Add "Preserve subject identity, pose, face" to prompt |
| Prompt drift on long clips | Process in batches of 20–30 frames |
