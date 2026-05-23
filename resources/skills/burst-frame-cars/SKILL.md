---
name: burst-frame-cars
description: >
  Generate BURST FRAME prompts for automotive reference frame generation using the @kaigani technique.
  Produces a 20-shot (or 10-shot) Seedance 2.0 Rapid Fire prompt that outputs one video containing
  consistent, full-resolution car reference frames — then extracts them with ffmpeg.

  Use this skill whenever the user wants to: generate reference images of a car, create automotive
  consistency frames for Seedance or Nano Banana, get 20 angles of a car, build a studio shot list
  for a vehicle, or says "burst frame" for any car or vehicle. Also trigger on: "car reference frames",
  "20 shots of [car]", "10 shots of [car]", "consistency frames for [car]", "studio prompt for [car]",
  "automotive burst", "burst frame [car name]", "[car] reference sheet", "generate angles of my car".

  Works for any car, any environment: studio, road, canyon, mountain, forest, desert, night.
---

# BURST FRAME — Automotive

The BURST FRAME technique generates consistent, full-resolution car reference frames from a single
Seedance 2.0 generation. Instead of running 5+ separate image generations, all angles are encoded
into one Rapid Fire video prompt. Seedance's consistency within a single generation ensures every
frame shares the same car identity, paint color, and visual style. ffmpeg extracts the individual frames.

**The result:** 1 prompt → 1 Seedance video → usable reference frames ready to feed back into
Seedance as start frames, or into Nano Banana as consistency anchors.

**Default:** 20 shots / 10 seconds. Use 10-shot mode when the user asks for fewer frames or when
prompt length is tight.

---

## What you always deliver

1. **Shot list** — automotive angles tailored to the car and environment
2. **Seedance BURST FRAME prompt** — compressed, copy-paste ready, ≤ 3500 characters
3. **ffmpeg extraction command**

---

## ⚠️ Character Limit — Non-Negotiable

**Every prompt must be ≤ 3500 characters total before delivery.**

This limit exists for Runway ML aggregator compatibility. Steps:
1. Write the full prompt
2. Count characters (run `echo -n "..." | wc -c` or equivalent)
3. If over 3500: compress shot descriptions to shorter phrases, trim the Global block, shorten the identity/setup header
4. Never output a prompt over 3500 characters regardless of how much detail is requested
5. When trimming, preserve identity lock and shot diversity over verbose descriptions

---

## Step 1 — Lock the inputs

Extract from context or ask for:

| Input | Examples |
|---|---|
| **Car** | Ferrari 812 rosso corsa, Porsche 911 RWB dark plum, black Lamborghini Huracán |
| **Environment** | Studio, alpine road, canyon night, forest, urban, desert |
| **Style** | Cinematic hyperrealistic, luxury editorial, stylized 3D |
| **Color system** | The car's color + the world's palette relationship |
| **Frame count** | 20 (default) or 10 (compact mode) |

If the user provides a reference image, extract car model, paint color, and environment from it.

---

## Step 2 — Build the shot list

Draw from this angle bank. Select shots that best serve the car and environment combination.

### Exterior — Full Car
- **Front 3/4 (driver's side, ~45°)** — bonnet, one headlight, profile line
- **Rear 3/4** — roofline, wing/spoiler, one taillight, exhaust
- **Dead front (0°)** — headlights centered, symmetrical, confrontational
- **Dead rear (0°)** — taillights, diffuser, exhaust layout
- **Side profile (90°)** — full car length, stance, ride height, wheel well
- **Overhead top-down** — roof geometry, full footprint, body symmetry
- **Ground level extreme low** — car looming, underside glimpse, heroic angle
- **Low front 3/4** — fender flares prominent, aggressive low perspective

### Detail Shots
- **Headlight cluster** — DRL signature, lens housing, projector detail
- **Taillight cluster** — LED pattern, lens depth, color
- **Front grille and badge** — brand emblem, chrome, intake mesh texture
- **Wheel and rim** — spoke pattern, brake caliper color, tyre sidewall
- **Wheel arch / fender** — panel gap, flare edge, body line
- **Exhaust tips** — tip count and layout, material finish
- **Rear diffuser** — fin detail, carbon or body-color
- **Bonnet/hood surface** — paint depth, reflections, power dome if present
- **Side mirror** — stalk, housing shape, reflection in glass
- **Door shut line** — panel alignment precision, handle recess

### In-Motion (road environments)
- **Tracking side pan** — car sharp, environment motion-blurred behind
- **FPV behind** — tail of car leading into road ahead
- **Retreating front** — camera backing away, headlights filling frame
- **Cockpit POV** — through windshield, interior in shadow, road ahead
- **Low panning** — tarmac blur at wheel level, horizon low
- **Overhead aerial** — car small against landscape

### Environment-Specific
- **Studio** — mirror floor reflection beneath car, backdrop gradient catch
- **Night road** — headlight beam reaching into dark, brake disc orange glow
- **Alpine/forest day** — wildflower foreground blur, god ray on roof
- **Canyon** — cliff edge in frame, stars overhead, puddle reflection
- **Desert** — dust trailing behind, heat shimmer off hood

---

## Step 3 — Write the prompt

### 20-shot template (10 seconds)
```
same vehicle throughout all shots, same [car name + color] consistent identity every shot.

10 seconds, 20 shots (Rapid Fire). [Car identity — 1 sentence]. [Environment]. [Style + mood]. [Color palette]. [Film format].

[1] [one-line shot description].
...
[20] [one-line shot description].

Global: same [car] identity every shot, [environment constraint], [lighting rule], no other vehicles. Audio: [sound design].
```

### 10-shot template (5 seconds)
```
same vehicle throughout all shots, same [car name + color] consistent identity every shot.

5 seconds, 10 shots (Rapid Fire). [Car identity — 1 sentence]. [Environment]. [Style + mood]. [Color palette]. [Film format].

[1] [one-line shot description].
...
[10] [one-line shot description].

Global: same [car] identity every shot, [environment constraint], [lighting rule], no other vehicles. Audio: [sound design].
```

### Physics — name these explicitly

| Element | Exact language |
|---|---|
| Tire smoke | `tire smoke radial displacement` |
| Brake disc | `brake disc igniting orange-red under compression, heat shimmer rising` |
| Exhaust (cold air) | `exhaust pulse visible as white breath in cold air` |
| Road motion blur | `road surface motion blur at speed` |
| Wildflower blur | `radial motion blur on foreground wildflowers` |
| Wet tarmac | `wet tarmac surface mirror reflections` |
| Studio floor | `seamless studio floor mirror reflection` |
| Paint surface | `paint depth visible, orange-peel texture catching raking light` |

---

## Step 4 — ffmpeg extraction

```bash
# 20-shot: 1 frame per 0.5 seconds
ffmpeg -i your_video.mp4 -vf fps=2 frame_%02d.png

# 10-shot: 1 frame per 0.5 seconds (same rate, 5s video)
ffmpeg -i your_video.mp4 -vf fps=2 frame_%02d.png

# Scene-change detection — better when Seedance cuts are crisp
ffmpeg -i your_video.mp4 -vf "select=gt(scene\,0.25)" -vsync 0 frame_%02d.png
```

Tell the user to drop the Seedance video here when ready — offer to run extraction directly.

---

## Environment presets

**Studio**
`Seamless [color] backdrop and matching floor, soft diffused overhead-left light source, no hard shadows, mirror floor reflection. Medium format lens compression. Clean and minimal.`

**Alpine Mountain Road (Day)**
`Warm golden daylight, dense pine forest on both sides, god rays through mist, pink wildflowers on road shoulder. 35mm grain, cinematic hyperrealistic.`

**Canyon Night**
`Pitch-black, cold white DRL headlights as primary source, brake disc orange-red glow, stars overhead, crushed blacks. Anamorphic 2.39:1, predatory.`

**Forest Atmospheric**
`Teal-amber grade, god rays through canopy, wet dark tarmac, mist in air. 70% deep shadow, cinematic.`

**Desert**
`Burnt amber and ochre. Volumetric dust haze, harsh directional sun, isolated.`

---

## Quality rules

- **≤ 3500 characters** — count before output, trim if over. Runway ML aggregator hard limit.
- **Identity lock is non-negotiable** — open every prompt with `same vehicle throughout all shots, same [car] consistent identity every shot`
- **One line per shot** — verbosity causes drift and pushes past character limit
- **Name physics explicitly** — unnamed physics renders flat and weightless
- **Studio shots: car stationary, camera moves** — never move the car in studio context
- **Motion shots: state what moves** — car, camera, or both must be explicit
- **No STOP MOTION in BURST FRAME prompts** — conflicts with rapid-fire pacing

---

## Reference: full example outputs

See `references/examples.md` for complete worked examples:
- Ferrari 812 · Studio (charcoal grey backdrop)
- Ferrari 812 · Alpine Forest Road (daytime)
- Porsche 911 RWB · Studio (mauve backdrop)
- Ferrari 812 · Canyon Night
