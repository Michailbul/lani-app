"use client"

/**
 * PromptsModeView — the "Prompts" pipeline stage.
 *
 *   ┌── Project ──┬── Screenplay (editable) ──┬── Shot List ──┬── Chat ──┐
 *
 * Layout pattern adopted from the reference UX (a Claude.ai artifact):
 *   - Left: the screenplay as a normal editable document. Just a
 *     textarea — write freely, scroll naturally. No clever
 *     block-filtering because organization lives on the right.
 *   - Right: a structured "Shot List" document. Title + metadata
 *     header, a STYLE ANCHOR block at the top that applies to every
 *     prompt, then scenes (H2) that group shots (H3). Each shot is
 *     a card with metadata fields (type, duration, references) and
 *     a freely-editable prompt body.
 *
 * The screenplay drives the story; the Shot List is the working
 * artifact of "how do we render this visually". The user and the
 * agent both edit shots in place.
 *
 * V1 uses MOCK_DATA. E1.4 wires real entities.read for both surfaces.
 */

import { useAtomValue } from "jotai"
import {
  Camera,
  Clock,
  Copy,
  Image as ImageIcon,
  Layers,
  Link as LinkIcon,
  MoreHorizontal,
  Pin,
  Plus,
  RotateCcw,
  Sparkles,
  Wand2,
} from "lucide-react"
import { useState } from "react"
import { cn } from "../../lib/utils"
import { activeEntityAtom } from "./atoms"

// ────────────────────────────────────────────────────────────────────────
// Mock data — replaced by real entities.read calls in E1.4 + E1.9.
// Modeled after the user's reference shot-list document: scenes contain
// shots, each shot has explicit metadata + a prompt body, plus an
// always-pinned style anchor at the top.
// ────────────────────────────────────────────────────────────────────────

const MOCK_SCREENPLAY = `EXT. DESERT MOUNTAIN PASS - SUNSET

Two cars idle at a starting line painted across asphalt. Beyond them, the road snakes into foothills. The sky burns amber and rust.

A REFEREE in a dark jacket stands between the vehicles, arm raised.

INT. CAR 1 - CONTINUOUS

ALEX (late 20s, focused, hands tight on the wheel) stares ahead. Jaw clenched.

ALEX
We're not safe here.
But there's no going back now.

INT. CAR 2 - CONTINUOUS

JORDAN (same age, confident but tense) grips their own wheel. They don't look sideways. Both engines rumble low.

The REFEREE drops their arm.

Both cars LAUNCH forward. Tires scream. Dust kicks up.`

const MOCK_PROJECT_TITLE = "Friendship on the Line — Seedance 2.0 Shot List"

const MOCK_STYLE_ANCHOR = `cinematic 35mm anamorphic, amber + rust palette, low atmospheric haze, anamorphic lens flare on highlights, slight film grain, painterly ambient occlusion, golden-hour key light raking from screen-right, dust motes hanging in air.`

type PromptType = "keyframe" | "multi-shot" | "start-end-frame" | "workflow"
type PromptStatus = "draft" | "generated" | "approved" | "archived"

interface Shot {
  /** Stable id used in the UI ("S1-A", "S1-B", …). */
  id: string
  /** One-line cue ("CRANE RISE — ESTABLISHING"). */
  title: string
  type: PromptType
  status: PromptStatus
  /** Director-level description (what we're trying to capture). */
  shotType: string
  duration: string
  inputImage?: string
  /** The prompt body — what the agent / user freely edits. */
  body: string
  hasGeneration: boolean
  parent?: string | null
}

interface SceneGroup {
  id: string
  number: number
  title: string
  /** Subtitle / one-line scene goal — shown under the scene heading. */
  goal: string
  shots: Shot[]
}

const MOCK_SCENES: SceneGroup[] = [
  {
    id: "01-mountain-pass",
    number: 1,
    title: "DESERT MOUNTAIN PASS",
    goal: "The opening. Establish stakes, scale, two drivers locked in.",
    shots: [
      {
        id: "S1-A",
        title: "CRANE RISE — ESTABLISHING",
        type: "keyframe",
        status: "approved",
        shotType: "Slow crane rising from line level to mid-air",
        duration: "6s",
        inputImage: "Image 1 (I2V)",
        body: "Slow crane shot rising from asphalt level upward, revealing two parked cars at a desert starting line. Dust hangs in amber light. Mountain pass snakes into foothills behind them. Sunset burns orange, the sky behind streaked with rust.",
        hasGeneration: true,
        parent: null,
      },
      {
        id: "S1-B",
        title: "REFEREE — LOW SILHOUETTE",
        type: "keyframe",
        status: "generated",
        shotType: "Low ground-level silhouette",
        duration: "4s",
        body: "Low-angle silhouette of the referee, arm raised against the sunset. Their figure dwarfed by the cars on either side. Backlit, almost cut from black paper.",
        hasGeneration: true,
        parent: null,
      },
      {
        id: "S1-C",
        title: "TWO CARS — SYMMETRY",
        type: "keyframe",
        status: "draft",
        shotType: "Tight medium-wide, symmetrical",
        duration: "3s",
        body: "Tight medium-wide on the two cars, painted line dividing them. Engines audibly rumbling. Dust motes hang in amber light. Both cars symmetrical in frame.",
        hasGeneration: false,
        parent: null,
      },
    ],
  },
  {
    id: "02-car-interiors",
    number: 2,
    title: "INSIDE THE CARS",
    goal: "Reveal the emotional cost. Each driver alone with what they're about to do.",
    shots: [
      {
        id: "S2-A",
        title: "ALEX CU — JAW CLENCHED",
        type: "keyframe",
        status: "generated",
        shotType: "Tight close-up, slight rack focus",
        duration: "5s",
        body: "Tight close-up on Alex's eyes in the windshield reflection. Jaw clenched, breath caught. Warm light spills across one half of their face. Their hands grip the wheel — knuckles white.",
        hasGeneration: true,
        parent: null,
      },
      {
        id: "S2-B",
        title: "JORDAN CU — HAND ON DASHBOARD",
        type: "keyframe",
        status: "draft",
        shotType: "Medium close-up, push-in",
        duration: "5s",
        body: "Jordan's jaw clenches. One hand comes off the wheel for half a second. They reach toward the dashboard — a worn photograph taped there. Younger versions of themselves. Jordan and Alex. Laughing. Before this.",
        hasGeneration: false,
        parent: null,
      },
    ],
  },
  {
    id: "03-launch",
    number: 3,
    title: "THE LAUNCH",
    goal: "Kinetic release. The point of no return.",
    shots: [
      {
        id: "S3-A",
        title: "MULTI-SHOT — LAUNCH SEQUENCE",
        type: "multi-shot",
        status: "generated",
        shotType: "3-shot continuous: wide / push-in / launch",
        duration: "7s total",
        body: "Three-shot launch.\nShot 1 (2s): static wide on the line.\nShot 2 (3s): low push-in as referee drops arm.\nShot 3 (2s): cars launch, tires scream, dust clouds bloom behind.\n\nContinuity: amber light constant, lens choice locked, no cuts within shots.",
        hasGeneration: true,
        parent: null,
      },
    ],
  },
]

const MOCK_WORKFLOWS = [
  {
    id: "WF-color-grade",
    title: "Color-grade transfer template",
    body: "Reusable workflow. Extract LUT from reference still, apply to generated frame at 0.7 strength. Pull selective skin chroma. Use whenever a Nano Banana output needs grade-matching to a reference still.",
  },
]

const STATUS_DOT: Record<PromptStatus, string> = {
  draft: "bg-muted-foreground/40",
  generated: "bg-amber-500",
  approved: "bg-emerald-500",
  archived: "bg-muted-foreground/20",
}

// ────────────────────────────────────────────────────────────────────────
// View
// ────────────────────────────────────────────────────────────────────────

export function PromptsModeView() {
  const active = useAtomValue(activeEntityAtom)
  const [screenplay, setScreenplay] = useState(MOCK_SCREENPLAY)

  const sceneLabel =
    active?.kind === "scene"
      ? active.label
      : active?.kind === "shot"
        ? `Scene of ${active.label}`
        : "Project"

  const totalPrompts =
    MOCK_SCENES.reduce((acc, s) => acc + s.shots.length, 0) +
    MOCK_WORKFLOWS.length

  return (
    <div className="flex h-full bg-background overflow-hidden">
      {/* Left — editable screenplay */}
      <div className="w-[44%] min-w-[360px] max-w-[600px] flex flex-col border-r border-border">
        <div className="flex items-center justify-between gap-2 h-9 px-4 border-b border-border bg-card/40 select-none shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 font-mono">
              Screenplay
            </span>
            <span className="text-muted-foreground/40">·</span>
            <span className="text-xs text-foreground/85 truncate">
              {sceneLabel}
            </span>
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-auto bg-card/10">
          <textarea
            value={screenplay}
            onChange={(e) => setScreenplay(e.target.value)}
            spellCheck
            className={cn(
              "w-full h-full resize-none px-6 py-6 bg-transparent",
              "font-mono text-[13px] leading-7 text-foreground/90",
              "border-0 outline-none",
              "min-h-full",
            )}
          />
        </div>
      </div>

      {/* Right — Shot List */}
      <div className="flex-1 min-w-0 flex flex-col">
        <ShotListHeader title={MOCK_PROJECT_TITLE} sceneCount={MOCK_SCENES.length} promptCount={totalPrompts} />
        <div className="flex-1 min-h-0 overflow-auto">
          <div className="max-w-[820px] mx-auto px-6 py-4">
            <StyleAnchorCard text={MOCK_STYLE_ANCHOR} />

            {MOCK_SCENES.map((scene) => (
              <SceneSection key={scene.id} scene={scene} />
            ))}

            {/* Workflows section */}
            {MOCK_WORKFLOWS.length > 0 && (
              <section className="mt-10">
                <h2 className="font-display text-[20px] font-bold leading-tight text-foreground mb-1 flex items-center gap-2">
                  <Layers className="h-4 w-4 text-rose-500" />
                  Workflows
                </h2>
                <p className="text-[12px] text-muted-foreground/80 mb-3">
                  Reusable templates that don't tie to a single scene.
                </p>
                <div className="space-y-3">
                  {MOCK_WORKFLOWS.map((wf) => (
                    <div
                      key={wf.id}
                      className="rounded-md border border-border bg-card p-3"
                    >
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-mono text-muted-foreground/70 tracking-wider">
                            {wf.id}
                          </span>
                          <span className="text-[13px] font-medium text-foreground">
                            {wf.title}
                          </span>
                        </div>
                      </div>
                      <p className="text-[12px] font-mono text-muted-foreground leading-relaxed">
                        {wf.body}
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Right-pane header — title, count, copy-all, refresh
// ────────────────────────────────────────────────────────────────────────

function ShotListHeader({
  title,
  sceneCount,
  promptCount,
}: {
  title: string
  sceneCount: number
  promptCount: number
}) {
  return (
    <div className="flex items-center justify-between gap-3 h-10 px-4 border-b border-border bg-card/40 select-none shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        <Camera className="h-3.5 w-3.5 text-primary shrink-0" />
        <span className="text-xs font-medium text-foreground truncate">
          {title}
        </span>
        <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground/60 font-mono ml-1">
          {promptCount} prompts · {sceneCount} scenes
        </span>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          className={cn(
            "flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono uppercase tracking-wider",
            "text-muted-foreground hover:text-foreground hover:bg-secondary",
            "transition-colors",
          )}
          title="Copy all shot prompts"
        >
          <Copy className="h-3 w-3" />
          Copy all
        </button>
        <button
          type="button"
          className={cn(
            "flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono uppercase tracking-wider",
            "bg-primary text-primary-foreground hover:opacity-90 transition-opacity",
          )}
        >
          <Plus className="h-3 w-3" />
          New shot
        </button>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Style anchor — pinned at the top, applies to every prompt's tail.
// ────────────────────────────────────────────────────────────────────────

function StyleAnchorCard({ text }: { text: string }) {
  const [body, setBody] = useState(text)
  const [collapsed, setCollapsed] = useState(false)
  return (
    <section className="mb-8">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h2 className="font-display text-[20px] font-bold leading-tight text-foreground flex items-center gap-2">
          <Pin className="h-4 w-4 text-primary" />
          Style anchor
        </h2>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground font-mono"
        >
          {collapsed ? "expand" : "collapse"}
        </button>
      </div>
      <p className="text-[12px] text-muted-foreground/80 mb-2 italic">
        Copied into every prompt's tail for visual consistency across all clips.
      </p>
      {!collapsed && (
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={Math.max(3, body.split("\n").length)}
          className={cn(
            "w-full px-3 py-2.5 rounded-md",
            "border-l-2 border-primary bg-primary/5",
            "font-mono text-[12px] leading-relaxed text-foreground",
            "border-y border-r border-border",
            "outline-none focus:ring-1 focus:ring-primary",
            "resize-none",
          )}
        />
      )}
    </section>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Scene section — H2 + goal subtitle, then shot cards.
// ────────────────────────────────────────────────────────────────────────

function SceneSection({ scene }: { scene: SceneGroup }) {
  return (
    <section className="mt-8 pt-2">
      <h2 className="font-display text-[20px] font-bold leading-tight text-foreground mb-1">
        Scene {scene.number} — {scene.title}
      </h2>
      <p className="text-[12px] text-muted-foreground/80 italic mb-4">
        {scene.goal}
      </p>
      <div className="space-y-3">
        {scene.shots.map((shot) => (
          <ShotCard key={shot.id} shot={shot} />
        ))}
        <button
          type="button"
          className={cn(
            "w-full flex items-center justify-center gap-2 py-2.5",
            "border border-dashed border-border rounded-md",
            "text-muted-foreground hover:text-primary hover:border-primary/60 hover:bg-primary/5",
            "transition-colors text-[12px] font-medium",
          )}
        >
          <Plus className="h-3.5 w-3.5" />
          Add shot to Scene {scene.number}
        </button>
      </div>
    </section>
  )
}

// ────────────────────────────────────────────────────────────────────────
// ShotCard — the unit. ID + title header, metadata strip, prompt body
// (free-text editable), tiny generation thumb when present, action row.
// ────────────────────────────────────────────────────────────────────────

function ShotCard({ shot }: { shot: Shot }) {
  const [body, setBody] = useState(shot.body)
  const [shotType, setShotType] = useState(shot.shotType)
  const [duration, setDuration] = useState(shot.duration)
  const [focused, setFocused] = useState(false)

  return (
    <article
      className={cn(
        "group rounded-md border bg-card transition-all",
        focused
          ? "border-primary shadow-sm ring-1 ring-primary/15"
          : "border-border hover:border-foreground/30",
      )}
    >
      {/* Card header */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border/60">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-[11px] tracking-wider font-semibold text-primary">
            {shot.id}
          </span>
          <span className="text-muted-foreground/40">·</span>
          <span className="text-[13px] font-medium text-foreground truncate">
            {shot.title}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            <span
              className={cn("w-1.5 h-1.5 rounded-full", STATUS_DOT[shot.status])}
            />
            {shot.status}
          </span>
        </div>
      </div>

      {/* Metadata strip — small, dense, label:value */}
      <div className="px-3 py-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px] border-b border-border/60 bg-card/30">
        <MetaField icon={Camera} label="Shot type" value={shotType} onChange={setShotType} />
        <MetaField icon={Clock} label="Duration" value={duration} onChange={setDuration} />
        {shot.inputImage && (
          <MetaField icon={ImageIcon} label="Input image" value={shot.inputImage} readOnly />
        )}
      </div>

      {/* Prompt body — the main editable surface */}
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        rows={Math.max(3, body.split("\n").length)}
        className={cn(
          "w-full px-3 py-2.5 bg-transparent",
          "font-mono text-[12.5px] leading-relaxed text-foreground",
          "border-0 outline-none resize-none",
        )}
      />

      {/* Generation + actions */}
      <div className="px-3 pb-2 pt-0 flex items-center justify-between gap-2">
        {shot.hasGeneration ? (
          <div className="flex items-center gap-2">
            <div
              className="w-20 h-12 rounded shrink-0"
              style={{
                background:
                  "linear-gradient(135deg, #FFB87A 0%, #FF8C42 50%, #B45309 100%)",
              }}
              title="Latest generation"
            />
            <div className="text-[10px] text-muted-foreground/70 font-mono leading-tight">
              <div>nano-banana-pro</div>
              <div className="text-muted-foreground/50">2h ago</div>
            </div>
          </div>
        ) : (
          <span className="text-[10px] text-muted-foreground/50 font-mono uppercase tracking-wider">
            no generation yet
          </span>
        )}
        <div
          className={cn(
            "flex items-center gap-1 transition-opacity",
            focused ? "opacity-100" : "opacity-0 group-hover:opacity-100",
          )}
        >
          <ActionButton icon={Wand2} label="Compose" title="Compose with locks injected" />
          <ActionButton icon={RotateCcw} label="Iterate" title="Ask the agent for a variation" />
          <ActionButton
            icon={Sparkles}
            label={shot.hasGeneration ? "Re-run" : "Generate"}
            primary
            title={shot.hasGeneration ? "Run the model again" : "Run the model"}
          />
          <button
            type="button"
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-secondary"
            title="More"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </article>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Small bits
// ────────────────────────────────────────────────────────────────────────

function MetaField({
  icon: Icon,
  label,
  value,
  onChange,
  readOnly,
}: {
  icon: typeof Camera
  label: string
  value: string
  onChange?: (next: string) => void
  readOnly?: boolean
}) {
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <Icon className="h-3 w-3 text-muted-foreground/60 shrink-0" />
      <span className="text-muted-foreground/70 font-mono text-[10px] uppercase tracking-wider shrink-0">
        {label}
      </span>
      {readOnly ? (
        <span className="text-foreground/85 truncate">{value}</span>
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          className={cn(
            "min-w-0 flex-1 bg-transparent text-foreground/90 outline-none",
            "border-0 px-0 py-0 text-[11px]",
            "focus:ring-0 focus:bg-bone/10 focus:px-1 focus:rounded",
          )}
        />
      )}
    </div>
  )
}

function ActionButton({
  icon: Icon,
  label,
  title,
  primary,
}: {
  icon: typeof Wand2
  label: string
  title: string
  primary?: boolean
}) {
  return (
    <button
      type="button"
      title={title}
      className={cn(
        "flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium",
        "transition-colors",
        primary
          ? "bg-primary text-primary-foreground hover:opacity-90"
          : "border border-border bg-background hover:bg-secondary",
      )}
    >
      <Icon className="h-3 w-3" />
      {label}
    </button>
  )
}

// Suppress import-pruning
const _LinkIcon = LinkIcon
void _LinkIcon
