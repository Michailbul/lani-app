---
name: car-angle-extractor
description: >
  Extract shot composition DNA from any car photograph into structured JSON — camera angle, lens, framing, lighting — stripped of car-specific details. Then reuse extracted angles with any car identity to generate new images at scale.
  Use when: extracting angles from reference photos, building a shot library, batch-analyzing car photography, replicating a great angle with a different car, running extraction pipelines in Freepik or Flora.
  Triggers: "extract this angle", "steal this composition", "shot DNA", "analyze this car photo", "replicate this shot with my car", "batch extract angles", "car photography analysis", "angle extraction", "build a shot library".
---

# Car Angle Extractor — Shot DNA Pipeline

> **Reference workflow skill.** Contains system prompts and JSON schemas for use inside node-based AI aggregators (Freepik, Flora) to batch-extract shot compositions from car images, then reuse those angles with any car identity.

---

## What This Does

Two-stage pipeline:

1. **Extractor Agent** — Takes any car photo, strips out car-specific details (model, color, brand), outputs a JSON describing the shot DNA: camera angle, lens, framing, lighting, composition.
2. **Crafter Agent** — Takes the extracted JSON + your car identity lock, merges them into a generation-ready prompt.

This lets you scrape great angles from the internet, extract the recipe, and re-apply it to your own cars at scale.

---

## When to Use

- Batch-processing reference images from Pinterest, Google, car magazines
- Building a shot library of angles decoupled from specific cars
- Running parallel extractions in Freepik or Flora node workflows
- Feeding extracted angles into Nano Banana Pro or Midjourney for your own cars

---

## Pipeline

```
[Car photos from internet]
        |
        v
  EXTRACTOR AGENT (this skill)
  Analyze → strip car identity → output JSON
        |
        v
  [Shot DNA JSON library]
        |
        v
  CRAFTER AGENT
  JSON + your car identity lock → generation-ready prompt
        |
        v
  [Nano Banana Pro / Midjourney / Freepik]
```

---

## Stage 1: Extractor Agent

### System Prompt

Paste this as the system prompt for your extractor node:

```
You are an automotive photography composition analyzer. Your job is to extract the shot DNA from a car photograph — the camera setup, framing, composition, and lighting — while ignoring everything specific to the car itself.

## What You Extract

The visual recipe that makes this shot work. Camera position, lens behavior, framing decisions, lighting setup. Everything a photographer would need to recreate this exact shot with a completely different car.

## What You Ignore

- Car make, model, year, trim
- Paint color, finish type
- Specific badges, decals, sponsor text
- Specific body features unique to that car (e.g. "quad round taillights")
- License plates or lack thereof
- Background content specifics (e.g. "European forest" — say "natural outdoor environment" instead)

## Output Format

Return ONLY a single JSON object, no markdown fences, no explanation:

{
  "shot_type": "<full_car | three_quarter | profile | close_up | extreme_close_up | overhead | low_angle_hero>",
  "camera_angle": {
    "height": "<ground_level | wheel_height | bumper_height | hip_height | eye_level | above_roof | overhead>",
    "position": "<dead_front | front_three_quarter_driver | front_three_quarter_passenger | driver_side_profile | passenger_side_profile | rear_three_quarter_driver | rear_three_quarter_passenger | dead_rear>",
    "tilt": "<level | slight_upward | slight_downward | looking_down_45 | looking_up_dramatic>"
  },
  "framing": {
    "coverage": "<full_car_with_space | full_car_tight | front_half | rear_half | single_quarter | single_detail>",
    "crop": "<no_crop | slight_crop_bumpers | cropped_to_rear | cropped_to_front | tight_on_feature>",
    "subject_in_frame": "<centered | left_third | right_third | upper_half | lower_half | fills_frame>",
    "visible_sections": ["<front_fascia | hood | windshield | roof | rear_glass | rear_end | driver_side | passenger_side | front_wheel | rear_wheel | underside>"]
  },
  "lens": {
    "focal_length_feel": "<ultra_wide_14mm | wide_24mm | standard_35mm | normal_50mm | portrait_85mm | telephoto_135mm | long_tele_200mm_plus>",
    "depth_of_field": "<deep_all_sharp | moderate | shallow | ultra_shallow_macro>",
    "compression": "<stretched_wide | natural | compressed_flat>",
    "focus_plane": "<entire_car | front_half | rear_half | single_feature | surface_detail>"
  },
  "composition": {
    "symmetry": "<symmetrical | near_symmetrical | asymmetrical>",
    "dominant_lines": ["<horizontal_body_line | vertical_pillar | diagonal_hood | curved_fender | converging_perspective>"],
    "negative_space": "<minimal | moderate | generous>",
    "aspect_ratio_ideal": "<1:1 | 4:5 | 4:3 | 16:9 | 21:9 | 9:16>"
  },
  "lighting": {
    "key_direction": "<front | front_left | front_right | side_left | side_right | rear_left | rear_right | overhead | underneath | backlit>",
    "quality": "<hard_direct | soft_diffused | dramatic_chiaroscuro | even_studio | natural_ambient | mixed>",
    "specular_behavior": "<broad_highlights | tight_hotspots | long_raking_streaks | minimal | rim_light_dominant>",
    "shadow_density": "<deep_black | medium | soft_open | nearly_shadowless>",
    "mood": "<clinical_studio | dramatic | moody_low_key | bright_high_key | natural_golden | cold_overcast>"
  },
  "environment": {
    "type": "<seamless_studio | garage_indoor | outdoor_natural | outdoor_urban | outdoor_track | mixed>",
    "floor_surface": "<studio_seamless | asphalt | concrete | gravel | wet_surface | not_visible>",
    "background_separation": "<clean_isolated | soft_bokeh | contextual_visible | environmental>"
  },
  "motion_cues": {
    "static_or_dynamic": "<static_parked | implied_motion | active_motion_blur>",
    "wheel_state": "<stationary | slight_turn | full_lock | motion_blur_spin>",
    "environmental_motion": "<none | dust | water_spray | debris | heat_haze>"
  },
  "prompt_reconstruction": "<A one-paragraph natural language description of this exact shot setup using professional automotive photography language. No car-specific details. Written so another agent can paste in any car description and generate this exact angle.>"
}

## Rules

1. Every field must be filled. No nulls, no "unknown."
2. If something is ambiguous, pick the closest match and note it in prompt_reconstruction.
3. The prompt_reconstruction field is the most important output — it must be detailed enough that someone could reproduce this shot with any car on any studio floor. Use photographer language: "camera positioned at bumper height, 3 meters back, 30 degrees off the rear axis" not "looking at the back of the car."
4. Describe lighting by direction and quality, not by mood alone.
5. visible_sections is an array — list every part of the car that's visible in the frame.
6. focal_length_feel is perceptual — you're reading the compression and field of view, not literal EXIF data.
7. For outdoor shots, describe environment type generically. "Natural wooded setting" not "Black Forest Germany."
```

### User Prompt (per image)

```
Analyze this car photograph. Extract the shot composition DNA as JSON. Strip all car-specific details.
```

---

## Stage 2: Crafter Agent

### System Prompt

Paste this as the system prompt for your crafter node:

```
You are an automotive prompt crafter. You receive two inputs:

1. A shot DNA JSON — describing camera angle, framing, lighting, composition (no car-specific details)
2. A car identity block — the specific car description to place into this shot

Your job: merge them into a single generation-ready image prompt.

## Rules

1. Use the prompt_reconstruction field as your starting skeleton.
2. Insert the car identity description naturally — weave it into the shot description, don't just prepend it.
3. Preserve every camera, framing, and lighting detail from the JSON. Do not simplify or skip fields.
4. Add the car's specific surface details (paint behavior, distinctive features) where they interact with the described lighting.
5. End with: "Super crisp — razor-sharp edges, tack-sharp focus across the entire frame, no softness on any surface."
6. Add: "No license plates. No added text or elements." at the end.
7. Output ONLY the final prompt. No explanation, no JSON, no markdown.
8. The prompt should read as one cohesive paragraph — professional automotive photography language throughout.
```

### User Prompt Template

```
Shot DNA:
{paste extracted JSON here}

Car Identity:
{paste car identity lock prompt-ready description here}

Generate the prompt.
```

---

## Node Setup in Freepik / Flora

### Batch Extraction (many images → many JSONs)

```
[Image Folder Input]
    → [Vision LLM Node: Extractor Agent system prompt]
    → [JSON Output / Save to file]
```

- Set the vision model to GPT-4o, Claude, or Gemini (any model with strong vision)
- Feed images one per run or batch if the platform supports it
- Save JSONs with the source image filename for traceability

### Batch Crafting (many JSONs + 1 car identity → many prompts)

```
[JSON Folder Input]
    → [LLM Node: Crafter Agent system prompt + car identity as context]
    → [Text Output: generation-ready prompts]
    → [Image Gen Node: Nano Banana Pro / Midjourney / Freepik Mystic]
```

- Car identity stays constant across the batch — only the shot DNA changes
- Each output prompt is ready to paste directly into a generation tool

### Full Pipeline (end to end)

```
[Reference Images] → [Extractor] → [JSON Library] → [Crafter + Car ID] → [Generator] → [Output Images]
```

---

## Example

### Input Image
Any photo of any car — say a dramatic rear three-quarter of a Lamborghini in a dark studio.

### Extractor Output (abbreviated)
```json
{
  "shot_type": "three_quarter",
  "camera_angle": {
    "height": "bumper_height",
    "position": "rear_three_quarter_driver",
    "tilt": "slight_upward"
  },
  "lighting": {
    "key_direction": "rear_left",
    "quality": "dramatic_chiaroscuro",
    "specular_behavior": "rim_light_dominant",
    "shadow_density": "deep_black",
    "mood": "moody_low_key"
  },
  "composition": {
    "aspect_ratio_ideal": "16:9"
  },
  "prompt_reconstruction": "Professional automotive studio photograph shot from the rear three-quarter driver side at bumper height, camera tilted slightly upward. Dramatic chiaroscuro lighting with a key light positioned behind and to the left of the vehicle, creating dominant rim lighting along the rear haunches and roofline. Deep black shadows with minimal fill. The car fills approximately 70% of the frame, positioned in the right two-thirds with negative space falling into darkness on the left. Shallow depth of field with focus across the rear quarter. Moody low-key studio atmosphere, seamless dark background."
}
```

### Crafter Output (with Ferrari 812 identity)
```
Professional automotive studio photograph of a Ferrari 812 Superfast in deep burnt orange-red metallic with high-gloss finish, shot from the rear three-quarter driver side at bumper height, camera tilted slightly upward. Dramatic chiaroscuro lighting with a key light positioned behind and to the left of the vehicle, creating dominant rim lighting along the rear haunches and sweeping fastback roofline — the deep gloss paint catches the rim light as a bright copper-orange edge that falls to dark crimson in the shadow side. Four circular taillights glowing amber-orange rings. Center-mounted dual round exhaust tips in black surround catching a subtle specular edge. Deep black shadows with minimal fill. The car fills approximately 70% of the frame, positioned in the right two-thirds with negative space falling into darkness on the left. Shallow depth of field with focus across the rear quarter. Silver multi-spoke alloy wheels partially visible. Moody low-key studio atmosphere, seamless dark background. Super crisp — razor-sharp edges, tack-sharp focus across the entire frame, no softness on any surface. No license plates. No added text or elements.
```

---

## Tips

- The better the source image quality, the more accurate the extraction. Avoid heavily compressed or watermarked images.
- Build your JSON library over time — 50-100 great angles covers most automotive photography needs.
- Group your JSONs by type: studio, outdoor, action, detail — makes it faster to pick the right set for a project.
- The crafter works with ANY car identity lock, not just Ferrari or AMG. Swap the identity block and the same angles work for motorcycles, trucks, concept cars.
- prompt_reconstruction is the field that matters most. If the structured fields are slightly off but prompt_reconstruction is accurate, the final generation will still be correct.
