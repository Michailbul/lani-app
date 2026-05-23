# Nano Banana Pro Prompt Patterns

## Core Principles
- Treat the model as a reasoning engine; structure beats adjective stacking.
- Use labeled sections and explicit constraints.
- Encode counts, positions, and dependencies as rules.
- Spell exact text and typography requirements.
- Avoid vague quantifiers ("some", "few", "several").

## Pattern Selection
Pick the smallest pattern that can enforce the constraints:
- Layout-heavy, text-heavy, or multi-panel: use Structured Layout Anchors.
- Multi-input synthesis or system-level control: use JSON prompt.
- Cinematic scene with people/props: use Scene Composition.
- Character identity transfer: use Character Pipeline.

## Templates

### 1) Structured Layout Anchors
"""
GOAL: <what to generate>
CANVAS: <size/orientation>
REGIONS:
- HEADER: <content, placement>
- BODY: <content, columns/grids>
- FOOTER: <content, placement>
TYPOGRAPHY:
- HEADLINES: <font family, weight, casing>
- BODY: <font family, size>
COLOR PALETTE: <hex values + intent>
GRAPHIC LANGUAGE: <shapes, motifs>
APPLICATIONS: <where it appears>
MATERIALS/LIGHTING: <surfaces, illumination>
CONSTRAINTS:
- <exact spacing rules>
- <no warping rules>
VALIDATION: Ensure all text is readable and placed in the correct region.
"""

### 2) JSON System Prompt (Multi-Input or Complex Systems)
"""
{
  "title": "<title>",
  "description": "<one-line objective>",
  "inputs": {
    "source": "uploaded images",
    "count": <number>,
    "rules": [
      "<rule 1>",
      "<rule 2>",
      "<rule 3>"
    ]
  },
  "visual_style": {
    "render_type": "<style>",
    "lighting": ["<light 1>", "<light 2>"]
  },
  "environment": {"<key>": "<value>"},
  "ui_elements": {"<key>": "<value>"},
  "layout": {"<key>": "<value>"},
  "constraints": ["<exact count>", "<no extra text>"]
}
"""

### 3) Scene Composition (Simple but Precise)
"""
SCENE: <location and activity>
SUBJECTS: <who, what they do>
PROPS: <key objects>
LIGHTING: <time of day, realism>
CAMERA: <wide/close, lens>
STYLE: <cinematic, documentary, etc>
CONSTRAINTS: <counts, names, positioning>
"""

### 4) Character Pipeline (Image-to-Image)
"""
INPUT: Image <n>
IDENTITY LOCK:
- preserve face and bone structure
- do not alter identity
TRANSFORM:
- <target style, e.g., realistic 3D game fighter>
POSE: <pose requirement>
GEAR/PROPS: <list>
UI OVERLAY: <stats, labels>
CONSTRAINTS: readable text, no extra UI elements.
"""

## Checklists

### Layout and Typography
- Are all regions named and bound to positions?
- Are all text strings specified verbatim?
- Are font styles and sizes specified for hierarchy?

### Image-to-Image Identity
- Are identity locks clearly stated?
- Are allowed transforms explicit?
- Is the pose or action unique per character?

## Prompt QA (Quick Critique)
- Replace any vague terms with measurable constraints.
- Resolve conflicts between layout and style.
- Move aesthetic adjectives after constraints.
- Add validation lines for counts, text, and placement.
