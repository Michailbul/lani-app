"use client"

/**
 * PromptsModeView — scene-by-scene workflow.
 *
 *   ┌── Project ──┬── Screenplay (editable, scene-blocks) ──┬── ONE scene's shots ──┬── Chat ──┐
 *
 * Mental model:
 *   - The screenplay is divided into scenes (Fountain INT./EXT.
 *     headings auto-detect them; explicit user marks come later).
 *   - You work ONE SCENE at a time. Click a scene block on the left
 *     to switch the right pane to that scene's shots.
 *   - Within a scene, click a shot to expand it for editing. Other
 *     shots stay listed in collapsed form.
 *   - Bottom of the right pane: < Scene N of M > prev/next nav.
 *
 * Default selection: first scene. The right pane never shows multiple
 * scenes at once — keeps the surface focused.
 *
 * Mock data for now (E1.4 wires real entities.read).
 */

import { useAtomValue } from "jotai"
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Image as ImageIcon,
  Pin,
  Plus,
  RotateCcw,
  Sparkles,
  Wand2,
  X,
} from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { cn } from "../../lib/utils"
import { activeEntityAtom } from "./atoms"

// ────────────────────────────────────────────────────────────────────────
// Mock data
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

const MOCK_PROJECT_TITLE = "Friendship on the Line"

const MOCK_STYLE_ANCHOR = `cinematic 35mm anamorphic, amber + rust palette, low atmospheric haze, anamorphic lens flare on highlights, slight film grain, painterly ambient occlusion, golden-hour key light, dust motes hanging in air.`

type PromptType = "keyframe" | "multi-shot" | "start-end-frame" | "workflow"
type PromptStatus = "draft" | "generated" | "approved" | "archived"

interface Shot {
  id: string
  sceneId: string
  title: string
  type: PromptType
  status: PromptStatus
  shotType: string
  duration: string
  body: string
  hasGeneration: boolean
}

const MOCK_SHOTS: Shot[] = [
  {
    id: "S1-A",
    sceneId: "01",
    title: "Crane rise — establishing",
    type: "keyframe",
    status: "approved",
    shotType: "Slow crane rising from line level to mid-air",
    duration: "6s",
    body: "Slow crane shot rising from asphalt level upward, revealing two parked cars at a desert starting line. Dust hangs in amber light. Mountain pass snakes into foothills behind them. Sunset burns orange.",
    hasGeneration: true,
  },
  {
    id: "S1-B",
    sceneId: "01",
    title: "Referee silhouette",
    type: "keyframe",
    status: "generated",
    shotType: "Low ground-level silhouette",
    duration: "4s",
    body: "Low-angle silhouette of the referee, arm raised against the sunset. Their figure dwarfed by the cars on either side. Backlit, almost cut from black paper.",
    hasGeneration: true,
  },
  {
    id: "S1-C",
    sceneId: "01",
    title: "Two cars symmetry",
    type: "keyframe",
    status: "draft",
    shotType: "Tight medium-wide, symmetrical",
    duration: "3s",
    body: "Tight medium-wide on the two cars, painted line dividing them. Engines audibly rumbling. Dust motes hang in amber light. Both cars symmetrical in frame.",
    hasGeneration: false,
  },
  {
    id: "S2-A",
    sceneId: "02",
    title: "Alex CU — jaw clenched",
    type: "keyframe",
    status: "generated",
    shotType: "Tight close-up, slight rack focus",
    duration: "5s",
    body: "Tight close-up on Alex's eyes in the windshield reflection. Jaw clenched, breath caught. Warm light spills across one half of their face. Their hands grip the wheel — knuckles white.",
    hasGeneration: true,
  },
  {
    id: "S3-A",
    sceneId: "03",
    title: "Jordan hand on photo",
    type: "keyframe",
    status: "draft",
    shotType: "Medium close-up, push-in",
    duration: "5s",
    body: "Jordan's jaw clenches. One hand comes off the wheel for half a second. They reach toward the dashboard — a worn photograph taped there. Younger versions of themselves.",
    hasGeneration: false,
  },
  {
    id: "S3-B",
    sceneId: "03",
    title: "Launch — multi-shot",
    type: "multi-shot",
    status: "generated",
    shotType: "3-shot continuous: wide / push-in / launch",
    duration: "7s",
    body: "Three-shot launch.\nShot 1 (2s): static wide on the line.\nShot 2 (3s): low push-in as referee drops arm.\nShot 3 (2s): cars launch, tires scream, dust clouds bloom.",
    hasGeneration: true,
  },
]

const STATUS_DOT: Record<PromptStatus, string> = {
  draft: "bg-muted-foreground/40",
  generated: "bg-amber-500",
  approved: "bg-emerald-500",
  archived: "bg-muted-foreground/20",
}

// ────────────────────────────────────────────────────────────────────────
// Scene parser — split screenplay by INT./EXT./EST./Section headings.
// ────────────────────────────────────────────────────────────────────────

const SCENE_HEADING = /^(INT\.\/EXT\.|I\/E\.|INT\.|EXT\.|EST\.)/i

interface SceneBlock {
  /** Stable id derived from order — "01", "02", … */
  id: string
  /** Display number — 1-indexed. */
  number: number
  /** First line of the scene (the heading itself). */
  heading: string
  /** Whole scene text including heading. */
  text: string
}

function parseScenes(screenplay: string): SceneBlock[] {
  const lines = screenplay.split("\n")
  const blocks: { startLine: number; lines: string[] }[] = []
  let current: { startLine: number; lines: string[] } | null = null
  let preamble: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (SCENE_HEADING.test(line.trim())) {
      if (current) blocks.push(current)
      current = { startLine: i, lines: [line] }
    } else if (current) {
      current.lines.push(line)
    } else {
      preamble.push(line)
    }
  }
  if (current) blocks.push(current)

  // If there's no scene heading at all (rare), treat the whole text as one block
  if (blocks.length === 0) {
    return [
      {
        id: "01",
        number: 1,
        heading: "(Untitled scene)",
        text: screenplay.trim(),
      },
    ]
  }

  return blocks.map((b, idx) => {
    const heading = b.lines[0].trim()
    return {
      id: String(idx + 1).padStart(2, "0"),
      number: idx + 1,
      heading,
      text: b.lines.join("\n").trimEnd(),
    }
  })
}

function joinScenes(scenes: SceneBlock[]): string {
  return scenes.map((s) => s.text).join("\n\n") + "\n"
}

// ────────────────────────────────────────────────────────────────────────
// View
// ────────────────────────────────────────────────────────────────────────

export function PromptsModeView() {
  const active = useAtomValue(activeEntityAtom)
  const [screenplay, setScreenplay] = useState(MOCK_SCREENPLAY)
  const scenes = useMemo(() => parseScenes(screenplay), [screenplay])

  // Default to first scene. If the active entity is a scene with a known id,
  // honour it (best-effort match; mock data scenes are 01/02/03).
  const initialSceneId =
    scenes.find(
      (s) => active?.kind === "scene" && active.id?.startsWith(s.id),
    )?.id ?? scenes[0]?.id ?? "01"
  const [selectedSceneId, setSelectedSceneId] = useState(initialSceneId)
  const [expandedShotId, setExpandedShotId] = useState<string | null>(null)

  // If the screenplay is edited and scenes change, keep the selection valid.
  useEffect(() => {
    if (!scenes.find((s) => s.id === selectedSceneId)) {
      setSelectedSceneId(scenes[0]?.id ?? "01")
    }
  }, [scenes, selectedSceneId])

  const updateScene = (sceneId: string, nextText: string) => {
    setScreenplay(
      joinScenes(
        scenes.map((s) => (s.id === sceneId ? { ...s, text: nextText } : s)),
      ),
    )
  }

  const onSelectScene = (sceneId: string) => {
    setSelectedSceneId(sceneId)
    setExpandedShotId(null)
  }

  const sceneIndex = scenes.findIndex((s) => s.id === selectedSceneId)
  const activeScene = scenes[Math.max(0, sceneIndex)]
  const activeShots = MOCK_SHOTS.filter((s) => s.sceneId === activeScene?.id)
  const activeSegments = MOCK_SEGMENTS.filter(
    (s) => s.sceneId === activeScene?.id,
  )
  const goPrev = () => {
    if (sceneIndex > 0) onSelectScene(scenes[sceneIndex - 1].id)
  }
  const goNext = () => {
    if (sceneIndex < scenes.length - 1) onSelectScene(scenes[sceneIndex + 1].id)
  }

  // Sub-mode: which right-pane representation? Two demo views the user
  // can flip between to compare design directions.
  const [rightMode, setRightMode] = useState<"shots" | "segments">("shots")

  return (
    <div className="flex h-full bg-background overflow-hidden">
      {/* LEFT — screenplay split into scene blocks */}
      <div className="w-[44%] min-w-[360px] max-w-[600px] flex flex-col border-r border-border">
        <div className="flex items-center gap-2 h-9 px-4 border-b border-border bg-card/40 select-none shrink-0">
          <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 font-mono">
            Screenplay
          </span>
          <span className="text-muted-foreground/40">·</span>
          <span className="text-xs text-foreground/85 truncate">
            {MOCK_PROJECT_TITLE}
          </span>
          <span className="text-[10px] tabular-nums text-muted-foreground/60 font-mono ml-auto">
            {scenes.length} scene{scenes.length === 1 ? "" : "s"}
          </span>
        </div>
        <div className="flex-1 min-h-0 overflow-auto bg-card/10">
          <div className="px-3 py-3 space-y-1.5">
            {scenes.map((scene) => (
              <SceneEditorBlock
                key={scene.id}
                scene={scene}
                selected={scene.id === selectedSceneId}
                shotCount={
                  MOCK_SHOTS.filter((sh) => sh.sceneId === scene.id).length
                }
                onSelect={() => onSelectScene(scene.id)}
                onChange={(next) => updateScene(scene.id, next)}
              />
            ))}
          </div>
        </div>
      </div>

      {/* RIGHT — design A (Shots) or design B (Segments) */}
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="flex items-center justify-between gap-3 h-9 px-4 border-b border-border bg-card/40 select-none shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 font-mono">
              Scene {activeScene?.number ?? 1}
            </span>
            <span className="text-muted-foreground/40">·</span>
            <span className="text-xs font-medium text-foreground truncate">
              {activeScene?.heading ?? ""}
            </span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Demo toggle — pick the design that feels right */}
            <div className="flex items-center gap-0.5 p-0.5 rounded-md bg-secondary/60 border border-border/50 mr-1">
              <button
                type="button"
                onClick={() => setRightMode("shots")}
                className={cn(
                  "px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider",
                  "transition-colors",
                  rightMode === "shots"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground/80",
                )}
                title="Design A — list of shots, click to expand"
              >
                A · Shots
              </button>
              <button
                type="button"
                onClick={() => setRightMode("segments")}
                className={cn(
                  "px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider",
                  "transition-colors",
                  rightMode === "segments"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground/80",
                )}
                title="Design B — segments with variant pills (the new model)"
              >
                B · Segments
              </button>
            </div>
            <button
              type="button"
              className={cn(
                "flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono uppercase tracking-wider",
                "text-muted-foreground hover:text-foreground hover:bg-secondary",
                "transition-colors",
              )}
              title="Copy scene prompts"
            >
              <Copy className="h-3 w-3" />
              Copy
            </button>
            <button
              type="button"
              className={cn(
                "flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono uppercase tracking-wider",
                "bg-primary text-primary-foreground hover:opacity-90 transition-opacity",
              )}
            >
              <Plus className="h-3 w-3" />
              {rightMode === "shots" ? "Add shot" : "Add segment"}
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-auto">
          <div className="max-w-[760px] mx-auto px-6 py-4">
            <StyleAnchorCard text={MOCK_STYLE_ANCHOR} />

            {rightMode === "shots" ? (
              <div className="space-y-2 mt-6">
                {activeShots.length === 0 ? (
                  <EmptyShots />
                ) : (
                  activeShots.map((shot) => (
                    <ShotRow
                      key={shot.id}
                      shot={shot}
                      expanded={shot.id === expandedShotId}
                      onToggle={() =>
                        setExpandedShotId((cur) =>
                          cur === shot.id ? null : shot.id,
                        )
                      }
                    />
                  ))
                )}
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
                  Add shot to Scene {activeScene?.number}
                </button>
              </div>
            ) : (
              <div className="space-y-3 mt-6">
                {activeSegments.length === 0 ? (
                  <EmptyShots />
                ) : (
                  activeSegments.map((seg) => (
                    <SegmentCard key={seg.id} segment={seg} />
                  ))
                )}
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
                  Add segment to Scene {activeScene?.number}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Footer: scene navigation */}
        <div className="flex items-center justify-between gap-2 h-10 px-4 border-t border-border bg-card/30 shrink-0">
          <button
            type="button"
            onClick={goPrev}
            disabled={sceneIndex <= 0}
            className={cn(
              "flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium",
              "text-muted-foreground hover:text-foreground hover:bg-secondary",
              "transition-colors",
              "disabled:opacity-30 disabled:cursor-not-allowed",
            )}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Prev scene
          </button>
          <div className="flex items-center gap-1">
            {scenes.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => onSelectScene(s.id)}
                className={cn(
                  "px-1.5 py-0.5 rounded text-[10px] font-mono",
                  "transition-colors",
                  s.id === selectedSceneId
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary",
                )}
                title={s.heading}
              >
                {s.number}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={goNext}
            disabled={sceneIndex >= scenes.length - 1}
            className={cn(
              "flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium",
              "text-muted-foreground hover:text-foreground hover:bg-secondary",
              "transition-colors",
              "disabled:opacity-30 disabled:cursor-not-allowed",
            )}
          >
            Next scene
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Left side — one scene editor block.
// ────────────────────────────────────────────────────────────────────────

interface SceneEditorBlockProps {
  scene: SceneBlock
  selected: boolean
  shotCount: number
  onSelect: () => void
  onChange: (next: string) => void
}

function SceneEditorBlock({
  scene,
  selected,
  shotCount,
  onSelect,
  onChange,
}: SceneEditorBlockProps) {
  const lines = scene.text.split("\n").length
  return (
    <div
      onClick={onSelect}
      className={cn(
        "group relative rounded-md transition-all cursor-text",
        "border-l-2",
        selected
          ? "border-primary bg-primary/5"
          : "border-transparent hover:bg-card/60",
      )}
    >
      <textarea
        value={scene.text}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onSelect}
        rows={Math.max(2, lines)}
        spellCheck={false}
        className={cn(
          "w-full bg-transparent border-0 outline-none resize-none",
          "px-3 py-2 font-mono text-[12.5px] leading-7 text-foreground/85",
        )}
      />
      <div
        className={cn(
          "absolute top-1.5 right-2 flex items-center gap-2",
          "text-[9px] font-mono uppercase tracking-wider",
          "text-muted-foreground/60 select-none pointer-events-none",
          "transition-opacity",
          selected ? "opacity-100" : "opacity-50 group-hover:opacity-90",
        )}
      >
        <span>Scene {scene.number}</span>
        {shotCount > 0 && (
          <span
            className={cn(
              "inline-flex items-center px-1.5 py-0.5 rounded-full",
              "bg-primary/10 text-primary font-semibold",
            )}
            title={`${shotCount} shot${shotCount === 1 ? "" : "s"} for this scene`}
          >
            {shotCount}
          </span>
        )}
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Right side — style anchor + shot row (collapsed/expanded)
// ────────────────────────────────────────────────────────────────────────

function StyleAnchorCard({ text }: { text: string }) {
  const [body, setBody] = useState(text)
  const [collapsed, setCollapsed] = useState(false)
  return (
    <section>
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-1.5">
          <Pin className="h-3 w-3 text-primary" />
          <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 font-mono">
            Style anchor — applies to every shot
          </span>
        </div>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground font-mono"
        >
          {collapsed ? "expand" : "collapse"}
        </button>
      </div>
      {!collapsed && (
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={Math.max(2, body.split("\n").length)}
          className={cn(
            "w-full px-3 py-2 rounded-md",
            "border-l-2 border-primary bg-primary/5",
            "font-mono text-[11.5px] leading-relaxed text-foreground",
            "border-y border-r border-border",
            "outline-none focus:ring-1 focus:ring-primary",
            "resize-none",
          )}
        />
      )}
    </section>
  )
}

interface ShotRowProps {
  shot: Shot
  expanded: boolean
  onToggle: () => void
}

function ShotRow({ shot, expanded, onToggle }: ShotRowProps) {
  if (!expanded) {
    return (
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          "w-full flex items-center gap-2 px-3 py-2 rounded-md text-left",
          "border border-border bg-card",
          "hover:border-foreground/30 transition-colors",
        )}
      >
        <span className="font-mono text-[11px] tracking-wider font-semibold text-primary shrink-0">
          {shot.id}
        </span>
        <span className="text-[13px] text-foreground truncate flex-1">
          {shot.title}
        </span>
        <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground shrink-0">
          <span className={cn("w-1.5 h-1.5 rounded-full", STATUS_DOT[shot.status])} />
          {shot.status}
        </span>
        {shot.hasGeneration && (
          <ImageIcon
            className="h-3 w-3 text-emerald-600 dark:text-emerald-400 shrink-0"
            aria-label="generation available"
          />
        )}
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      </button>
    )
  }

  return <ShotExpanded shot={shot} onCollapse={onToggle} />
}

function ShotExpanded({ shot, onCollapse }: { shot: Shot; onCollapse: () => void }) {
  const [body, setBody] = useState(shot.body)
  const [shotType, setShotType] = useState(shot.shotType)
  const [duration, setDuration] = useState(shot.duration)
  const [title, setTitle] = useState(shot.title)
  return (
    <article className="rounded-md border border-primary bg-card ring-1 ring-primary/15 shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border/60">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="font-mono text-[11px] tracking-wider font-semibold text-primary shrink-0">
            {shot.id}
          </span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={cn(
              "min-w-0 flex-1 bg-transparent text-[13px] font-medium text-foreground",
              "border-0 outline-none px-0 py-0",
            )}
          />
          <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground shrink-0">
            <span className={cn("w-1.5 h-1.5 rounded-full", STATUS_DOT[shot.status])} />
            {shot.status}
          </span>
        </div>
        <button
          type="button"
          onClick={onCollapse}
          className="text-muted-foreground hover:text-foreground p-1 rounded"
          title="Collapse"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Compact metadata strip */}
      <div className="px-3 py-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px] border-b border-border/60 bg-card/30">
        <MetaField icon={Sparkles} label="Type" value={shotType} onChange={setShotType} />
        <MetaField icon={Clock} label="Duration" value={duration} onChange={setDuration} />
      </div>

      {/* Prompt body */}
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={Math.max(4, body.split("\n").length)}
        className={cn(
          "w-full px-3 py-2.5 bg-transparent",
          "font-mono text-[12.5px] leading-relaxed text-foreground",
          "border-0 outline-none resize-none",
        )}
      />

      {/* Bottom row */}
      <div className="px-3 pb-2.5 flex items-center justify-between gap-2 flex-wrap">
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
        <div className="flex items-center gap-1">
          <ActionButton icon={Wand2} label="Compose" title="Compose with character + location + world locks" />
          <ActionButton icon={RotateCcw} label="Iterate" title="Ask the agent for a variation" />
          <ActionButton
            icon={Sparkles}
            label={shot.hasGeneration ? "Re-run" : "Generate"}
            primary
            title={shot.hasGeneration ? "Run again" : "Generate"}
          />
        </div>
      </div>
    </article>
  )
}

function MetaField({
  icon: Icon,
  label,
  value,
  onChange,
}: {
  icon: typeof Sparkles
  label: string
  value: string
  onChange: (next: string) => void
}) {
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <Icon className="h-3 w-3 text-muted-foreground/60 shrink-0" />
      <span className="text-muted-foreground/70 font-mono text-[10px] uppercase tracking-wider shrink-0">
        {label}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "min-w-0 flex-1 bg-transparent text-foreground/90 outline-none",
          "border-0 px-0 py-0 text-[11px]",
        )}
      />
    </div>
  )
}

function ActionButton({
  icon: Icon,
  label,
  title,
  primary,
}: {
  icon: typeof Sparkles
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

function EmptyShots() {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center gap-2">
      <Sparkles className="h-5 w-5 text-muted-foreground/50" />
      <div className="text-[13px] text-foreground/80 font-medium">
        Nothing for this scene yet.
      </div>
      <div className="text-[11px] text-muted-foreground/70 max-w-[40ch]">
        Click <strong>Add</strong> below, or ask the agent to break this scene down.
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Design B — Segments + Variants
//
// One Segment = one Seedance generation (single-shot OR multi-shot up to
// 15s). A Segment has many Variants — different prompt iterations of
// the SAME segment. The user picks a winner ("approved").
//
// This is the iteration-and-observability model: variants live as
// switchable pills inside the segment card. Click a pill, the prompt
// body + generation thumb update inline. Approving one pill marks the
// segment "ready". The losers stay around for reference.
// ────────────────────────────────────────────────────────────────────────

interface Variant {
  id: string
  status: PromptStatus
  body: string
  hasGeneration: boolean
}

interface Segment {
  id: string
  sceneId: string
  type: "single-shot" | "multi-shot" | "start-end-frame"
  duration: string
  variants: Variant[]
  /** Index of the variant the user is actively looking at. */
  activeIndex: number
  /** Index of the variant that's marked "approved" (final pick). null = none. */
  approvedIndex: number | null
}

const MOCK_SEGMENTS: Segment[] = [
  {
    id: "SEG-1A",
    sceneId: "01",
    type: "multi-shot",
    duration: "12s",
    activeIndex: 0,
    approvedIndex: 0,
    variants: [
      {
        id: "v1",
        status: "approved",
        body: "MULTI-SHOT, 12s.\n\nShot 1 (4s): static wide on the asphalt line. Two cars idle, engines rumbling, dust in amber light.\n\nShot 2 (4s): low push-in toward the referee silhouette, arm raising slowly.\n\nShot 3 (4s): the referee drops their arm. Both cars launch forward, tires scream, dust clouds bloom.",
        hasGeneration: true,
      },
      {
        id: "v2",
        status: "generated",
        body: "MULTI-SHOT, 12s.\n\nShot 1 (3s): handheld 3/4 angle on Car 1. Engine vibrating frame.\n\nShot 2 (3s): match-cut to Car 2 mirror angle.\n\nShot 3 (3s): wide overhead drone of both cars on the line.\n\nShot 4 (3s): launch — symmetric speed-ramp on tire spin.",
        hasGeneration: true,
      },
      {
        id: "v3",
        status: "draft",
        body: "MULTI-SHOT, 12s. Slow burn version.\n\nShot 1 (5s): hold on the photograph taped to Alex's dashboard. Younger versions of themselves laughing.\n\nShot 2 (4s): push back to wide of car interior. Alex's jaw clenched.\n\nShot 3 (3s): cut to engine launching, dust kicks.",
        hasGeneration: false,
      },
    ],
  },
  {
    id: "SEG-1B",
    sceneId: "01",
    type: "single-shot",
    duration: "4s",
    activeIndex: 0,
    approvedIndex: null,
    variants: [
      {
        id: "v1",
        status: "draft",
        body: "Slow-motion close-up on tire as it grabs asphalt. Pebbles fly. Heat distortion above the tire.",
        hasGeneration: false,
      },
    ],
  },
  {
    id: "SEG-2A",
    sceneId: "02",
    type: "single-shot",
    duration: "5s",
    activeIndex: 1,
    approvedIndex: 1,
    variants: [
      {
        id: "v1",
        status: "archived",
        body: "Tight close-up on Alex's face. Their eyes flicker between the road and the photograph.",
        hasGeneration: true,
      },
      {
        id: "v2",
        status: "approved",
        body: "Tight close-up on Alex's eyes reflected in the windshield. Jaw clenched, breath caught. Warm light spills across one half of their face. Knuckles white on the wheel.",
        hasGeneration: true,
      },
    ],
  },
  {
    id: "SEG-3A",
    sceneId: "03",
    type: "multi-shot",
    duration: "10s",
    activeIndex: 0,
    approvedIndex: null,
    variants: [
      {
        id: "v1",
        status: "generated",
        body: "MULTI-SHOT, 10s.\n\nShot 1 (4s): Jordan's hand reaches toward the dashboard. Fingertips graze the photograph.\n\nShot 2 (3s): close on the photograph itself. Younger Alex and Jordan, laughing.\n\nShot 3 (3s): pull back. Jordan's hand returns to wheel. Their face: nothing readable.",
        hasGeneration: true,
      },
    ],
  },
]

const SEG_TYPE_LABEL: Record<Segment["type"], string> = {
  "single-shot": "single shot",
  "multi-shot": "multi-shot",
  "start-end-frame": "start ↔ end",
}

const SEG_TYPE_COLORS: Record<Segment["type"], string> = {
  "single-shot": "bg-orange-500/15 text-orange-700 dark:text-orange-300",
  "multi-shot": "bg-slate-500/15 text-slate-700 dark:text-slate-300",
  "start-end-frame": "bg-purple-500/15 text-purple-700 dark:text-purple-300",
}

function SegmentCard({ segment }: { segment: Segment }) {
  const [activeIndex, setActiveIndex] = useState(segment.activeIndex)
  const [approvedIndex, setApprovedIndex] = useState<number | null>(
    segment.approvedIndex,
  )
  const [variants, setVariants] = useState(segment.variants)
  const variant = variants[activeIndex]

  const updateVariantBody = (index: number, body: string) => {
    setVariants((prev) =>
      prev.map((v, i) => (i === index ? { ...v, body } : v)),
    )
  }
  const onApprove = () => {
    setApprovedIndex(activeIndex)
    setVariants((prev) =>
      prev.map((v, i) =>
        i === activeIndex
          ? { ...v, status: "approved" }
          : v.status === "approved"
            ? { ...v, status: "archived" }
            : v,
      ),
    )
  }
  const onAddVariant = () => {
    const next: Variant = {
      id: `v${variants.length + 1}`,
      status: "draft",
      body: "",
      hasGeneration: false,
    }
    setVariants((prev) => [...prev, next])
    setActiveIndex(variants.length)
  }

  return (
    <article className="rounded-md border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border/60">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-[11px] tracking-wider font-semibold text-primary shrink-0">
            {segment.id}
          </span>
          <span
            className={cn(
              "inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-mono font-semibold tracking-wider",
              SEG_TYPE_COLORS[segment.type],
            )}
          >
            {SEG_TYPE_LABEL[segment.type]}
          </span>
          <span className="text-[10px] font-mono text-muted-foreground/70 shrink-0">
            target {segment.duration}
          </span>
          {approvedIndex !== null && (
            <span className="text-[10px] font-mono text-emerald-700 dark:text-emerald-400 shrink-0 ml-auto">
              ✓ approved
            </span>
          )}
        </div>
      </div>

      {/* Variant pills */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border/60 bg-card/30 flex-wrap">
        <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 font-mono mr-1">
          Variants
        </span>
        {variants.map((v, i) => {
          const isActive = i === activeIndex
          const isApproved = i === approvedIndex
          return (
            <button
              key={v.id}
              type="button"
              onClick={() => setActiveIndex(i)}
              className={cn(
                "flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-mono",
                "border transition-colors",
                isActive
                  ? "border-primary bg-primary text-primary-foreground"
                  : isApproved
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300"
                    : v.status === "archived"
                      ? "border-border bg-muted/40 text-muted-foreground/70 hover:text-foreground/80"
                      : "border-border bg-background text-muted-foreground hover:text-foreground hover:border-foreground/30",
              )}
              title={`${v.id} · ${v.status}${v.hasGeneration ? " · has generation" : ""}`}
            >
              {isApproved && !isActive && <span>✓</span>}
              <span>{v.id}</span>
              <span
                className={cn(
                  "w-1.5 h-1.5 rounded-full",
                  isActive ? "bg-white/80" : STATUS_DOT[v.status],
                )}
              />
            </button>
          )
        })}
        <button
          type="button"
          onClick={onAddVariant}
          className={cn(
            "flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-mono",
            "border border-dashed border-border text-muted-foreground",
            "hover:text-primary hover:border-primary/40 hover:bg-primary/5",
            "transition-colors",
          )}
          title="Add a fresh variant"
        >
          <Plus className="h-2.5 w-2.5" />
          new
        </button>
      </div>

      {/* Active variant body */}
      {variant ? (
        <>
          <textarea
            value={variant.body}
            onChange={(e) => updateVariantBody(activeIndex, e.target.value)}
            rows={Math.max(4, variant.body.split("\n").length)}
            className={cn(
              "w-full px-3 py-2.5 bg-transparent",
              "font-mono text-[12.5px] leading-relaxed text-foreground",
              "border-0 outline-none resize-none",
              "placeholder:text-muted-foreground/50",
            )}
            placeholder={`Write the ${SEG_TYPE_LABEL[segment.type]} prompt for this segment, or ask the agent to draft it…`}
          />

          {/* Bottom row */}
          <div className="px-3 pb-2.5 flex items-center justify-between gap-2 flex-wrap">
            {variant.hasGeneration ? (
              <div className="flex items-center gap-2">
                <div
                  className="w-20 h-12 rounded shrink-0"
                  style={{
                    background:
                      "linear-gradient(135deg, #FFB87A 0%, #FF8C42 50%, #B45309 100%)",
                  }}
                  title="Latest generation for this variant"
                />
                <div className="text-[10px] text-muted-foreground/70 font-mono leading-tight">
                  <div>{variant.id} · seedance-2.0</div>
                  <div className="text-muted-foreground/50">2h ago</div>
                </div>
              </div>
            ) : (
              <span className="text-[10px] text-muted-foreground/50 font-mono uppercase tracking-wider">
                no generation for {variant.id} yet
              </span>
            )}
            <div className="flex items-center gap-1">
              <ActionButton icon={Wand2} label="Compose" title="Compose with locks" />
              <ActionButton icon={RotateCcw} label="Iterate" title="Ask the agent for a variation of this variant" />
              <ActionButton
                icon={Sparkles}
                label={variant.hasGeneration ? "Re-run" : "Generate"}
                primary
                title={variant.hasGeneration ? "Regenerate with this prompt" : "Generate"}
              />
              {variant.status !== "approved" && (
                <button
                  type="button"
                  onClick={onApprove}
                  className={cn(
                    "flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium",
                    "border border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
                    "hover:bg-emerald-500/20 transition-colors",
                  )}
                  title="Mark this variant as the approved one for this segment"
                >
                  ✓ Approve {variant.id}
                </button>
              )}
            </div>
          </div>
        </>
      ) : null}
    </article>
  )
}
