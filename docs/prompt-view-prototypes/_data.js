// Mock data shared by all three prototypes — same prompts, same shot,
// so the UX comparison is fair.
window.MOCK_DATA = {
  shotTitle: "Shot 01 — Wide establishing",
  sceneTitle: "Scene 01 — Opening",
  prompts: [
    {
      id: "v1-wide-establishing",
      title: "Wide establishing — warm dawn",
      type: "keyframe",
      status: "approved",
      parent: null,
      body:
        "A wide establishing shot of an empty forest road at dawn. Warm amber light grazes the asphalt, mist hugs the treeline, anamorphic flare on the horizon. 35mm film stock feel, slight grain.",
      thumb: "warm",
      generatedAt: "2 days ago",
      iterations: 1,
    },
    {
      id: "v2-warmer-light",
      title: "Wide — warmer light, lower angle",
      type: "keyframe",
      status: "generated",
      parent: "v1-wide-establishing",
      body:
        "Same composition, lower camera angle (almost ground level). Push the warmth — golden hour at peak. The road stretches into a vanishing point lit gold.",
      thumb: "warm",
      generatedAt: "yesterday",
      iterations: 0,
    },
    {
      id: "v3-medium-pushed-in",
      title: "Medium — pushed-in version",
      type: "keyframe",
      status: "draft",
      parent: "v2-warmer-light",
      body:
        "Medium shot. Tighter framing, asphalt textured detail in foreground, treeline blurred. Cooler grade — feels uncertain rather than romantic.",
      thumb: null,
      generatedAt: null,
      iterations: 0,
    },
    {
      id: "v1-dolly-tracking",
      title: "Multi-shot — dolly tracking through the road",
      type: "multi-shot",
      status: "generated",
      parent: null,
      body:
        "Shot 1 (3s): static wide. Shot 2 (4s): dolly forward, cars enter frame. Shot 3 (3s): cars pass camera, mist disturbed. Continuity: amber light constant.",
      thumb: "warm",
      generatedAt: "5 hours ago",
      iterations: 0,
    },
    {
      id: "v2-handheld-energy",
      title: "Multi-shot — handheld, more kinetic",
      type: "multi-shot",
      status: "draft",
      parent: "v1-dolly-tracking",
      body:
        "Same beats but handheld. Slight breathing in the camera. Less precious, more documentary feel. Cars enter on a frame disrupt.",
      thumb: null,
      generatedAt: null,
      iterations: 0,
    },
    {
      id: "v1-color-grade",
      title: "Workflow — color grade transfer template",
      type: "workflow",
      status: "approved",
      parent: null,
      body:
        "Reusable template: extract LUT from reference still, apply to shot. Use this whenever a generated frame needs grade-matching to a reference.",
      thumb: null,
      generatedAt: null,
      iterations: 3,
    },
  ],
  references: [
    "forest-road-cinematic.jpg",
    "dawn-light-ref.jpg",
    "anamorphic-flare-still.jpg",
  ],
}
