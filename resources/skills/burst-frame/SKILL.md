---
name: burst-frame
description: >
  Generate BURST FRAME prompts for any subject — characters, creatures, products,
  environments, or objects — using the @kaigani technique in Seedance 2.0.
  Produces a 20-shot Rapid Fire prompt that outputs one video containing 20 consistent,
  full-resolution reference frames, then extracts them with ffmpeg.

  Use this skill whenever the user wants to: generate reference frames for a character,
  creature, or object, build a consistency sheet for any AI subject, get 20 angles/poses
  of anything, create a shot list for a non-automotive subject, or says "burst frame"
  for anything that isn't a car. Also trigger on: "reference frames for [subject]",
  "20 shots of [character/creature/product]", "consistency frames for [subject]",
  "burst frame [subject]", "[subject] reference sheet", "generate poses/angles of [subject]",
  "knight burst", "character burst", "creature reference", "product reference frames".

  For cars, use the burst-frame-cars skill instead — it has dedicated automotive angles.
---

# BURST FRAME — Universal

The BURST FRAME technique generates 20 consistent, full-resolution reference frames from a single
Seedance 2.0 generation. Instead of running multiple separate image generations, all 20 angles or
moments are encoded into one Rapid Fire video prompt. Seedance's consistency within a single
generation ensures every frame shares the same subject identity, visual style, and lighting logic.
ffmpeg then extracts the individual frames.

**The result:** 1 prompt → 1 Seedance video → 20 usable reference frames ready to feed back into
Seedance as start frames, or into Nano Banana as consistency anchors.

---

## What you always deliver

1. **20-shot list** — angles, poses, or moments tailored to the subject type and context
2. **Seedance BURST FRAME prompt** — compressed and copy-paste ready
3. **ffmpeg extraction command**

---

## Step 1 — Identify the subject type

Determine which category the subject falls into. This shapes the angle strategy.

| Type | Examples | Primary goal |
|---|---|---|
| **Character / humanoid** | Knight, samurai, cyberpunk hacker, alien, robot | Pose variety + identity lock across angles |
| **Creature / non-human** | Dragon, wolf, mech beast, monster | Form clarity from key angles + detail closeups |
| **Product / object** | Sneaker, weapon, armor, gadget, jewelry | Material texture + 360° coverage |
| **Environment / world** | Cyberpunk city, fantasy forest, space station | Establishing coverage + atmosphere |
| **Hybrid** | Character in world, creature with rider | Identity lock on primary + world integration |

---

## Step 2 — Lock the inputs

Extract from context or ask:

| Input | Examples |
|---|---|
| **Subject** | Dark fantasy knight, cyberpunk samurai, dragon, artifact |
| **Visual style** | Cinematic 3D, cel animation, hyperrealistic, stylized |
| **Environment** | Studio void, battlefield, rooftop, forest, canyon |
| **Color system** | Dominant palette + accent relationship |
| **Animation / live action** | Seedance handles both; specify if key |

If the user provides a reference image, extract subject, style, and environment from it.

---

## Step 3 — Build the 20-shot list

Select the 20 shots that best serve the subject type and context. Draw from the banks below.

### Character / Humanoid — Angle Bank

**Full figure**
- **Dead front (0°)** — full height, centered, confrontational
- **Dead rear (0°)** — back silhouette, armor/costume detail
- **Side profile (90°)** — complete silhouette line, stance
- **Front 3/4 (45°, one side)** — dominant shoulder + face readable
- **Rear 3/4** — back detail + opposite shoulder
- **Overhead top-down** — helmet/crown, shoulder spread, footprint
- **Ground level extreme low** — looming, heroic, menacing
- **High angle looking down** — vulnerability or grandeur

**Portrait / Detail**
- **Face extreme close-up** — eyes, expression, skin/texture detail
- **Helmet or headgear detail** — visor, horn, crest, battle damage
- **Chest armor close-up** — crest, material, engraving, wear
- **Hand close-up** — gauntlet, weapon grip, sigil, gesture
- **Weapon or accessory detail** — blade, hilt, crossguard, material
- **Boot / foot close-up** — ground contact, material, weight
- **Back detail** — cape, spine armor, cape clasp, wings

**In-Context**
- **Action pose — attack** — weapon raised or mid-swing
- **Action pose — defend** — shield raised, guarded stance
- **Environmental integration** — subject in world, environment visible
- **Dynamic motion blur** — movement through frame, speed lines
- **Silhouette against sky or light source** — pure form read

### Creature / Non-Human — Angle Bank

- **Full body front** — complete form, scale reference
- **Full body side** — complete silhouette, limb proportion
- **Three-quarter front** — dominant mass + key features
- **Overhead** — wing span, body footprint, symmetry
- **Low front looking up** — scale and threat
- **Head extreme close-up** — eye, horn, teeth, texture
- **Claw or limb close-up** — weapon appendage detail
- **Spine or dorsal** — back ridge, fin, wing root
- **Tail close-up** — tail tip, scale texture, coil
- **Mid-action (leap, strike, spread wings)** — dynamic moment
- **Environmental scale** — creature small in world, world visible

### Product / Object — Angle Bank

- **Dead front** — face-on, symmetrical
- **Dead rear** — back face
- **Side profile left** — clean silhouette
- **Side profile right** — opposite silhouette
- **Top-down** — footprint, top surface
- **Three-quarter front** — primary reading angle
- **Three-quarter rear** — secondary reading angle
- **Bottom/underside** — sole, base, engineering
- **Material close-up (x3)** — texture, finish, detail at different points
- **Brand/logo close-up** — badge, mark, signature element
- **Environmental context** — object in use or in world

### Environment / World — Shot Strategy

- **Wide establishing** — full environment, horizon
- **Mid establishing left** — leading into scene
- **Mid establishing right** — opposite reading
- **Atmospheric foreground** — bokeh detail, texture, scale element
- **Overhead aerial** — full geography from above
- **Ground level** — immersive, inside the world
- **Key architectural detail (x3)** — specific elements that define the world
- **Light source close-up** — neon, fire, moonlight, volumetric ray
- **Reflection / surface** — puddle, mirror, window, lake
- **Human scale element** — figure-scale reference in the world
- **Transition moment** — dusk, fog roll, weather

---

## Step 4 — Write the Seedance BURST FRAME prompt

Use this template. One line per shot — verbosity exceeds the character limit.

```
same subject throughout all shots, same [subject name + key visual trait] consistent identity every shot.

10 seconds, 20 shots (Rapid Fire). [Subject identity sentence]. [Environment]. [Style + mood]. [Color palette]. [Film format].

[1] [one-line shot description].
[2] [one-line shot description].
...
[20] [one-line shot description].

Global: same [subject] identity every shot, [environment constraint], [style/lighting rule], no [unwanted elements]. Audio: [sound design].
```

### Identity lock — non-negotiable

Open every prompt with the identity lock. The subject's key traits (color, material, markings, silhouette) must be named explicitly and repeated in the Global line. Seedance drifts without this.

```
same character throughout all shots, same dark fantasy knight in obsidian plate armor consistent identity every shot.
```

### Style language — use precise descriptors

| Style | Exact language |
|---|---|
| Cinematic 3D | `cinematic hyperrealistic 3D render, volumetric lighting, subsurface skin scatter` |
| Cel animation | `delicate thin black line work, vivid flat color within lines, cel animation quality` |
| Dark fantasy | `dark fantasy aesthetic, deep shadow, candlelight or cold moonlight, desaturated with accent color pop` |
| Cyberpunk | `neon-saturated cyberpunk, rain-slicked surfaces, holographic overlay, crushed blacks` |
| Editorial photo | `luxury editorial photography, medium format lens compression, clean and minimal` |
| Anime | `high-contrast anime style, speed lines, expressive key frame, flat cel shading` |

### Physics — name these explicitly

Seedance won't infer physics correctly without explicit direction:

| Element | Exact language |
|---|---|
| Cape / cloth | `cape billowing under wind load, fabric catching light at trailing edge` |
| Weapon swing | `sword arc motion blur trailing from blade tip` |
| Particle effect | `ember sparks radial displacement from impact point` |
| Rain / wet surface | `wet surface mirror reflection, rain streak motion blur` |
| Smoke / breath | `breath visible as white condensation in cold air` |
| Fire / glow | `fire source illuminating underside of subject, heat shimmer rising` |
| Wing spread | `wing membrane stretching, leading edge catching light` |
| Speed / movement | `radial motion blur from center of action outward` |

---

## Step 5 — ffmpeg extraction

**Always include this in your output.** The ffmpeg command is the final step the user needs — don't skip it.

```bash
# Fixed interval — 1 frame per 0.5 seconds (10s video = 20 frames)
ffmpeg -i your_video.mp4 -vf fps=2 frame_%02d.png

# Scene-change detection — better when Seedance cuts are crisp
ffmpeg -i your_video.mp4 -vf "select=gt(scene\,0.25)" -vsync 0 frame_%02d.png
```

Tell the user to drop the Seedance video here when ready — offer to run extraction directly.

---

## Environment presets

Apply these when the user names an environment without specifying the visual system:

**Studio void**
`Seamless [color] backdrop, matching floor, soft overhead diffused light, no hard shadows, mirror floor reflection. No environment, no props, pure subject.`

**Dark fantasy battlefield**
`Smoke-filled battlefield, distant fire on horizon, cold moonlight through cloud breaks, churned mud ground, armored corpses in deep background. Desaturated, deep shadow, single accent color.`

**Cyberpunk rooftop / street**
`Rain-soaked neon city, reflective tarmac, holographic ad panels, night environment, crushed blacks. Cold blue + saturated neon accent.`

**Fantasy forest**
`Ancient forest cathedral, god rays through dense canopy, moss-covered stone, fog at ground level, teal-amber grade.`

**Void / abstract**
`Pure black void environment, subject floating, dramatic single-source rim light, studio fill, no environment cues.`

**Space / cosmic**
`Deep space, distant nebula cloud, star field, planet limb visible, cold starlight as key, warm engine glow as fill.`

---

## Quality rules

- **Identity lock is non-negotiable** — open every prompt with `same subject throughout all shots, same [subject description] consistent identity every shot`
- **One line per shot** — shot descriptions that run longer than one line push past Seedance's character limit and cause drift
- **Name style and physics explicitly** — unnamed physics and style ambiguity renders flat, generic, weightless
- **No STOP MOTION** — rapid-fire pacing and freeze frames conflict with BURST FRAME technique
- **Repeat the subject description in the Global line** — this is a second identity lock that prevents late-shot drift
- **Keep color system in the header** — stating the palette once globally in the intro line overrides per-shot color drift

---

## Reference: subject type examples

For automotive BURST FRAME (cars, bikes, trucks), use the `burst-frame-cars` skill instead — it contains a dedicated automotive angle bank, environment presets, and worked examples specific to car photography.

For this generic skill, the following subject types have been used successfully:
- Dark fantasy knight (studio void, battlefield)
- Cyberpunk samurai (rooftop, rain-slicked street)
- Creature — dragon (aerial, cave, cliff environment)
- Product — sneaker, weapon, armor piece
- Environment — cyberpunk city block
