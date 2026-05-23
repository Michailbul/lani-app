# Nano Banana Pro Prompt Bank

Use these examples as blueprints. Adapt them with new subjects, layouts, and constraints.

## 1) Long Structured Prompt - Logical Layout Anchors
**Use case:** Brand identity, layouts, posters, dashboards.

```
Create a full, multi-dimensional brand identity system for "Higgsfield AI," an advanced AI platform for image, video, animation, and generative creativity. Base all visuals around the looping black S-curve logo on neon green (smooth, continuous thick curve). The identity must feel futuristic, high-tech, kinetic, expressive, human-friendly, and motion-driven.

LOGO SYSTEM: Use the black looping S-curve as the core symbol of generative flow and AI motion paths. Wordmark: "Higgsfield AI" in bold geometric rounded sans serif, open spacing. Variants: icon + wordmark, stacked, icon-only, white version, neon-outline version. Rules: never warp the curve, maintain high contrast, minimum padding = 50% logo height.

COLOR PALETTE: Core colors: Neon Higgs Green #D7FF28; Absolute Black #000000; Pure White #FFFFFF. Supporting: Aqua Quantum #49FFE9; Dark Graphite #1F1F1F; Signal Grey #444444; Electric Violet #A04CFF. Meaning: Neon=creativity, Black=precision, Aqua=AI signal, Violet=experimental mode.

TYPOGRAPHY: Headlines in rounded geometric sans (TG Grotesk / Satoshi / Inter Rounded); body text in modern grotesk; UI text in technical mono for prompts/code.

GRAPHIC LANGUAGE: All visuals derived from S-curve geometry: wave lines, curved dividers, latent-space fields, neon arcs, circular glyphs, repeating wave patterns, neon gradients, ribbon motion paths, particle flows.

BRAND PERSONALITY: Creative, kinetic, intelligent, expressive, human-centered, playfully futuristic. Voice: confident, imaginative, direct. Sample lines: "Create in motion," "Generative thinking visualized," "AI that flows with you."

MOTION DESIGN: Logo animates as a fluid ribbon; particle formation; elastic curves. UI motion uses curved reveals, neon pulses, smooth transitions, camera-path sweeps. Add generative energy layers: particle trails, wave distortions, neon field glows.

APPLICATIONS: Website hero with neon green background and faint flowing S-curve; app icon with curve centered on neon field; product screens with clean UI, neon micro-highlights, mono font prompts, curved separators. Social templates: high contrast, oversized curve textures. Merch: hoodies, stickers, laptop skins, water bottles using the loop motif. Posters: cinematic neon fields and curved-path shapes.

MATERIALS & LIGHTING: Matte neon surfaces, subtle grain, polished black acrylic, soft neon edges, transparent stacked layers. Lighting with radial neon glow, soft volumetric gradients, highlights following curvature.

BRAND MYTHOLOGY: The S-curve symbolizes the Higgs Field - an abstract creative fabric where ideas form and transform. Represents movement, energy pathways, expressive AI, and continuous generative flow.
```

## 2) JSON Prompt with Multiple Input Images - 3D Fighting Game Character Select Screen
**Use case:** Multi-input synthesis + UI layout.

```
{
  "title": "3D Fighting Game Character Select Screen",
  "description": "Generate a dark, gritty, high-intensity 3D character selection screen inspired by brutal, arena-style modern fighting games (without naming any titles).",
  "characters": {
    "source": "uploaded images",
    "count": 10,
    "rules": [
      "Make up a name for each character",
      "Do not describe their physical appearance",
      "Do not modify their identity",
      "Transform each into a realistic 3D fighter model",
      "Each fighter must have a unique, powerful, combat-ready action pose"
    ]
  },
  "visual_style": {
    "render_type": "hyper-realistic AAA 3D graphics with a gritty cinematic finish",
    "lighting": [
      "harsh directional spotlights from above",
      "fiery warm-orange side lights",
      "cold shadowy blue backlights",
      "thick atmospheric fog with volumetric beams",
      "embers, dust, and floating particles"
    ],
    "environment": {
      "arena": "dark stone-and-metal arena platform with cracks, glowing fissures, and heavy atmosphere",
      "floor": "rugged metallic floor with worn textures and faint reflections",
      "background": "massive ceremonial statues, arcane symbols, chains, smoke plumes",
      "platforms": "each character stands on their own circular engraved platform with glowing runes or energy lines"
    },
    "color_palette": [
      "molten orange",
      "blood-red accents (non-graphic)",
      "cold steel blue",
      "charcoal black",
      "embers and fiery yellows"
    ],
    "camera": {
      "angle": "low-angle heroic shot",
      "perspective": "wide cinematic lens emphasizing power and scale",
      "effects": [
        "subtle vignette",
        "depth of field tuned for dramatic silhouettes",
        "filmic contrast"
      ]
    }
  },
  "ui_elements": {
    "title_text": "CHARACTER SELECT",
    "character_name_plates": "Rugged metallic plaques or glowing stone-like labels under each character, empty for later name entry.",
    "interface_style": "ancient-meets-modern combat UI with glowing edges, heavy metal textures, runic motifs and high-contrast menu frames"
  },
  "layout": {
    "arrangement": "10 characters displayed in a curved arc formation, each on their own platform",
    "spacing": "wide spacing for clear silhouettes and dramatic pose readability",
    "hierarchy": "central fighters slightly more forward, balanced left and right"
  },
  "tone_and_vibe": {
    "keywords": [
      "dark fantasy combat",
      "ancient mystical energy",
      "brutal atmosphere (non-graphic)",
      "competitive intensity",
      "epic warrior presence",
      "arena showdown energy"
    ]
  }
}
```

## 3) Scene Composition & Atmosphere - Film Crew Backstage
**Use case:** Simple prompt with strong composition control.

```
Behind-the-scenes wide shot showing a film crew setting up a cinematic portrait scene.
```

```
On a film set, a small crew is working together: a boom operator holding a boom mic (BOOM: Quentin Tarantino), a camera operator with a shoulder rig (CAMERA: Brad Pitt), a focus puller adjusting focus on a follow-focus wheel (FOCUS/1AC: Sydney Sweeney), a DIT watching the image on a small monitor (MONITOR: Christopher Nolan), and a gaffer adjusting a light stand (LIGHT: Stanley Kubrick). Natural lighting, realistic cinematic look, shallow depth of field, behind-the-scenes atmosphere.
```

## 4) Character Pipeline - Game Character MVP Prompt
**Use case:** Identity preservation + UI overlay.

```
Generate the man from Image 1 as a 3D video game character with a weapon inspired by modern FPS games, on a screen after the match with an MVP badge over him. Stats: Accuracy, Kills, K/D ratio, Assists, Revives. He is wearing tactical gear standing in a confident pose.
```

## 5) Ultimate Test - Time-Traveler's Study
**Use case:** Massive enumeration + material realism.

```
Create an ultra-realistic, richly textured image of an eccentric time-traveler's private study, filled with 50 real historical artifacts, displayed in perfect clarity. The room is dimly lit with warm tungsten lamps, soft shadows, dust floating in the air, wooden furniture, brass mechanisms, and worn leather textures. A large panoramic desk occupies the center, surrounded by shelves, crates, cabinets, glass domes, and wall mounts. Every item below must be clearly visible, physically placed, never floating, arranged naturally on shelves, the desk, the floor, or inside cases.

ANCIENT WORLD (1-12)
1. Rosetta Stone replica - with readable hieroglyphs and Greek text
2. Roman gladius sword - iron blade, bronze hilt
3. Athenian owl coin (Tetradrachm) - silver, worn edges
4. Egyptian Ankh amulet - carved stone
5. Terracotta Warrior miniature - Qin Dynasty replica
6. Babylonian cuneiform tablet
7. Greek Corinthian helmet - aged bronze patina
8. Scroll of the Epic of Gilgamesh - rolled parchment
9. Persian Darius I gold daric coin
10. Ancient Indus Valley seal - steatite block
11. Mayan obsidian blade
12. Celtic torc necklace - twisted gold

MEDIEVAL AND RENAISSANCE (13-24)
13. Viking drinking horn - carved rim
14. Runestone fragment - Scandinavian rune carvings
15. Medieval illuminated manuscript page - gold leaf accents
16. Knights Templar cross pendant
17. Samurai katana (Muromachi period style)
18. Mongol recurve bow - wooden
19. Gothic church stained glass fragment
20. Leonardo da Vinci sketch sheet (from Vitruvian Man)
21. Renaissance astrolabe - brass with engraved numerals
22. Ottoman ceramic Iznik tile - blue floral pattern
23. Medieval hourglass - sand half-fallen
24. Ancient Norse longship wooden model

AGE OF DISCOVERY / EARLY MODERN (25-34)
25. Isaac Newton's "Principia Mathematica" - open page, readable Latin
26. Galileo-style brass telescope
27. Columbus-era navigation compass
28. Old world map by Gerardus Mercator
29. 18th-century quill and ink bottle
30. French Revolution tricorne hat
31. Benjamin Franklin's lightning rod prototype (miniature)
32. Old pocket watch (1810s)
33. Napoleonic officer epaulettes
34. Worn violin (Stradivarius-style) displayed under glass

19TH-20TH CENTURY (35-46)
35. Steam engine miniature (Watt design)
36. Telegraph key - brass, functional design
37. Thomas Edison-style light bulb - glowing filament
38. Vintage Kodak Brownie camera
39. WWI military medal
40. Old globe (1910) - faded continents
41. NASA Apollo mission patch (Apollo 11)
42. USSR "Sputnik 1" model
43. First edition "Sherlock Holmes" book - readable spine
44. Victorian brass monocle
45. 1920s Art Deco cigarette case (empty)
46. Early IBM punch card stack

MODERN ODDITIES AND CULTURAL ICONS (47-50)
47. Sony Walkman TPS-L2 - blue, iconic design
48. Game Boy (1989) - grey, with Tetris title visible
49. Film reel canister labeled "Citizen Kane (1941)"
50. Signed vinyl record of "The Beatles - Abbey Road"

ENVIRONMENT: THE TIME-TRAVELER'S ROOM
- A massive oak desk with scratches, ink stains, engraved initials
- Brass desk lamp with warm light illuminating artifacts
- Dark wooden bookshelves stacked with atlases and notebooks
- Polished concrete floor with scattered papers
- A vintage leather chair, cracked and worn
- Glass domes protecting fragile relics
- Blueprints, diagrams, star charts pinned to walls
- A chalkboard with equations, timelines, wormhole sketches
- A mechanical clockwork contraption, partly disassembled
- Steam pipes and pressure gauges along one wall
- A small window showing stormy weather outside
Everything must look tactile: wood grain, metal oxidation, parchment fibers, scratches, dust motes in the light.
```

## 6) Material Gradients and Enumeration - Steak Doneness
**Use case:** Enumerations + subtle material gradient.

```
A high-resolution food photograph shows seven cuts of steak, sliced and arranged in a row on a wooden board, displaying the full gradient of doneness from Blue Rare to Well Done, set in a modern kitchen.
```

## Final Note
Nano Banana Pro rewards planning and structured constraints. Treat prompts as blueprints, not poems.
