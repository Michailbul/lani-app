"use client"

/**
 * PromptsModeView — Scenes → Sub-scenes (production units).
 *
 *   ┌── Screenplay (editable scene blocks) ──┬── Sub-scenes for active scene ──┐
 *
 * A SUB-SCENE is a unit of generation. It carries:
 *   · type (multishot / experiment / seedance) — how the user thinks
 *     about generating it
 *   · prompt — one prompt body (the Seedance prompt for multishot)
 *   · elements — characters, locations, frames it uses
 *   · generations — output assets produced from this sub-scene
 *
 * Iteration: duplicate a sub-scene to try another version, keep both
 * around side by side. No "approved" flag, no archived state, no
 * variant pills. The list IS the version history.
 */

import { useAtomValue } from "jotai"
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronRight as ChevronRightSm,
  Copy,
  FileImage,
  Film,
  Image as ImageIcon,
  MapPin,
  MoreHorizontal,
  Plus,
  Sparkles,
  Trash2,
  User,
  Video,
} from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { cn } from "../../lib/utils"
import { activeEntityAtom } from "./atoms"

// ────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────

type SubSceneType = "multishot" | "experiment" | "seedance"

interface Frame {
  id: string
  prompt: string
  hasImage: boolean
  imageHint?: "warm" | "cool"
}

interface Generation {
  id: string
  label: string
  hasVideo: boolean
}

interface SubScene {
  id: string
  sceneId: string
  title: string
  type: SubSceneType
  prompt: string
  characters: string[]
  locations: string[]
  frames: Frame[]
  generations: Generation[]
}

// ────────────────────────────────────────────────────────────────────────
// Mock — replaced by entities.read in E1.4
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

const MOCK_SUBSCENES: SubScene[] = [
  {
    id: "sub-1",
    sceneId: "01",
    title: "Cars at the starting line",
    type: "multishot",
    prompt:
      "MULTI-SHOT, 12s.\n\nShot 1 (4s): static wide on the asphalt line. Two cars idle, engines rumbling, dust in amber light.\nShot 2 (4s): low push-in toward the referee silhouette, arm raising slowly.\nShot 3 (4s): the referee drops their arm. Both cars launch forward, tires scream, dust clouds bloom.",
    characters: ["Alex", "Jordan", "Referee"],
    locations: ["Mountain Pass starting line"],
    frames: [
      { id: "f1", prompt: "Wide establishing — warm dawn", hasImage: true, imageHint: "warm" },
      { id: "f2", prompt: "Referee silhouette, arm raised", hasImage: true, imageHint: "warm" },
      { id: "f3", prompt: "Tires biting asphalt closeup", hasImage: false },
    ],
    generations: [
      { id: "g1", label: "v1 · seedance · 2h ago", hasVideo: true },
    ],
  },
  {
    id: "sub-2",
    sceneId: "01",
    title: "Tires biting asphalt",
    type: "seedance",
    prompt:
      "Single shot, 4s. Slow-motion close-up on tire as it grabs asphalt. Pebbles fly. Heat distortion above the tire.",
    characters: [],
    locations: ["Mountain Pass starting line"],
    frames: [
      { id: "f1", prompt: "Tire close-up reference", hasImage: false },
    ],
    generations: [],
  },
  {
    id: "sub-3",
    sceneId: "02",
    title: "Alex CU — jaw clenched",
    type: "experiment",
    prompt:
      "Tight close-up on Alex's eyes reflected in the windshield. Jaw clenched, breath caught. Warm light spills across one half of their face. Knuckles white on the wheel.",
    characters: ["Alex"],
    locations: ["Car 1 interior"],
    frames: [
      { id: "f1", prompt: "Alex face reference, jaw clenched", hasImage: true, imageHint: "warm" },
    ],
    generations: [
      { id: "g1", label: "v1 · seedance · yesterday", hasVideo: true },
      { id: "g2", label: "v2 · seedance · 1h ago", hasVideo: true },
    ],
  },
  {
    id: "sub-4",
    sceneId: "03",
    title: "Photograph reach",
    type: "multishot",
    prompt:
      "MULTI-SHOT, 10s.\n\nShot 1 (4s): Jordan's hand reaches toward the dashboard. Fingertips graze a worn photograph.\nShot 2 (3s): close on the photograph. Younger Alex and Jordan, laughing.\nShot 3 (3s): pull back. Jordan's hand returns to wheel. Engines rumble forward, tires scream.",
    characters: ["Jordan"],
    locations: ["Car 2 interior"],
    frames: [
      { id: "f1", prompt: "Photograph on dashboard reference", hasImage: false },
    ],
    generations: [],
  },
]

// ────────────────────────────────────────────────────────────────────────
// Tokens
// ────────────────────────────────────────────────────────────────────────

const TYPE_LABEL: Record<SubSceneType, string> = {
  multishot: "multi-shot",
  experiment: "experiment",
  seedance: "seedance",
}
const TYPE_COLORS: Record<SubSceneType, string> = {
  multishot: "bg-slate-500/15 text-slate-700 dark:text-slate-300",
  experiment: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  seedance: "bg-purple-500/15 text-purple-700 dark:text-purple-300",
}

// ────────────────────────────────────────────────────────────────────────
// Scene parser
// ────────────────────────────────────────────────────────────────────────

const SCENE_HEADING = /^(INT\.\/EXT\.|I\/E\.|INT\.|EXT\.|EST\.)/i

interface SceneBlock {
  id: string
  number: number
  heading: string
  text: string
}

function parseScenes(screenplay: string): SceneBlock[] {
  const lines = screenplay.split("\n")
  const blocks: { lines: string[] }[] = []
  let current: { lines: string[] } | null = null
  for (const line of lines) {
    if (SCENE_HEADING.test(line.trim())) {
      if (current) blocks.push(current)
      current = { lines: [line] }
    } else if (current) {
      current.lines.push(line)
    }
  }
  if (current) blocks.push(current)
  if (blocks.length === 0) {
    return [{ id: "01", number: 1, heading: "(Untitled)", text: screenplay.trim() }]
  }
  return blocks.map((b, i) => ({
    id: String(i + 1).padStart(2, "0"),
    number: i + 1,
    heading: b.lines[0].trim(),
    text: b.lines.join("\n").trimEnd(),
  }))
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

  const initialSceneId =
    scenes.find((s) => active?.kind === "scene" && active.id?.startsWith(s.id))?.id ??
    scenes[0]?.id ??
    "01"
  const [selectedSceneId, setSelectedSceneId] = useState(initialSceneId)
  useEffect(() => {
    if (!scenes.find((s) => s.id === selectedSceneId)) {
      setSelectedSceneId(scenes[0]?.id ?? "01")
    }
  }, [scenes, selectedSceneId])

  const [subScenes, setSubScenes] = useState<SubScene[]>(MOCK_SUBSCENES)
  const visible = subScenes.filter((s) => s.sceneId === selectedSceneId)

  const updateScene = (sceneId: string, nextText: string) => {
    setScreenplay(
      joinScenes(scenes.map((s) => (s.id === sceneId ? { ...s, text: nextText } : s))),
    )
  }
  const addSubScene = () => {
    const id = `sub-${Date.now()}`
    const next: SubScene = {
      id,
      sceneId: selectedSceneId,
      title: "New sub-scene",
      type: "multishot",
      prompt: "",
      characters: [],
      locations: [],
      frames: [],
      generations: [],
    }
    setSubScenes((prev) => [...prev, next])
  }
  const updateSubScene = (id: string, patch: Partial<SubScene>) => {
    setSubScenes((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  }
  const duplicateSubScene = (id: string) => {
    setSubScenes((prev) => {
      const idx = prev.findIndex((s) => s.id === id)
      if (idx < 0) return prev
      const original = prev[idx]
      const copy: SubScene = {
        ...original,
        id: `sub-${Date.now()}`,
        title: `${original.title} (copy)`,
        generations: [], // copy doesn't inherit generations
      }
      const next = [...prev]
      next.splice(idx + 1, 0, copy)
      return next
    })
  }
  const deleteSubScene = (id: string) => {
    setSubScenes((prev) => prev.filter((s) => s.id !== id))
  }

  const sceneIndex = scenes.findIndex((s) => s.id === selectedSceneId)
  const activeScene = scenes[Math.max(0, sceneIndex)]
  const goPrev = () => {
    if (sceneIndex > 0) setSelectedSceneId(scenes[sceneIndex - 1].id)
  }
  const goNext = () => {
    if (sceneIndex < scenes.length - 1) setSelectedSceneId(scenes[sceneIndex + 1].id)
  }

  return (
    <div className="flex h-full bg-background overflow-hidden">
      {/* LEFT — screenplay */}
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
            {scenes.length} scenes
          </span>
        </div>
        <div className="flex-1 min-h-0 overflow-auto bg-card/10">
          <div className="px-3 py-3 space-y-1.5">
            {scenes.map((scene) => {
              const subCount = subScenes.filter((s) => s.sceneId === scene.id).length
              return (
                <SceneEditorBlock
                  key={scene.id}
                  scene={scene}
                  selected={scene.id === selectedSceneId}
                  subCount={subCount}
                  onSelect={() => setSelectedSceneId(scene.id)}
                  onChange={(next) => updateScene(scene.id, next)}
                />
              )
            })}
          </div>
        </div>
      </div>

      {/* RIGHT — sub-scenes */}
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
            <span className="text-[10px] tabular-nums text-muted-foreground/60 font-mono ml-1">
              {visible.length} sub-scene{visible.length === 1 ? "" : "s"}
            </span>
          </div>
          <button
            type="button"
            onClick={addSubScene}
            className={cn(
              "flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono uppercase tracking-wider",
              "bg-primary text-primary-foreground hover:opacity-90 transition-opacity",
            )}
          >
            <Plus className="h-3 w-3" />
            New sub-scene
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-auto">
          <div className="max-w-[820px] mx-auto px-6 py-4 space-y-3">
            {visible.length === 0 ? (
              <Empty onAdd={addSubScene} />
            ) : (
              visible.map((sub) => (
                <SubSceneCard
                  key={sub.id}
                  subScene={sub}
                  onChange={(patch) => updateSubScene(sub.id, patch)}
                  onDuplicate={() => duplicateSubScene(sub.id)}
                  onDelete={() => deleteSubScene(sub.id)}
                />
              ))
            )}
            {visible.length > 0 && (
              <button
                type="button"
                onClick={addSubScene}
                className={cn(
                  "w-full flex items-center justify-center gap-2 py-2.5",
                  "border border-dashed border-border rounded-md",
                  "text-muted-foreground hover:text-primary hover:border-primary/60 hover:bg-primary/5",
                  "transition-colors text-[12px] font-medium",
                )}
              >
                <Plus className="h-3.5 w-3.5" />
                New sub-scene
              </button>
            )}
          </div>
        </div>

        {/* Scene nav */}
        <div className="flex items-center justify-between gap-2 h-10 px-4 border-t border-border bg-card/30 shrink-0">
          <button
            type="button"
            onClick={goPrev}
            disabled={sceneIndex <= 0}
            className={cn(
              "flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium",
              "text-muted-foreground hover:text-foreground hover:bg-secondary",
              "transition-colors disabled:opacity-30 disabled:cursor-not-allowed",
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
                onClick={() => setSelectedSceneId(s.id)}
                className={cn(
                  "px-1.5 py-0.5 rounded text-[10px] font-mono transition-colors",
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
              "transition-colors disabled:opacity-30 disabled:cursor-not-allowed",
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
// SceneEditorBlock — left side
// ────────────────────────────────────────────────────────────────────────

function SceneEditorBlock({
  scene,
  selected,
  subCount,
  onSelect,
  onChange,
}: {
  scene: SceneBlock
  selected: boolean
  subCount: number
  onSelect: () => void
  onChange: (next: string) => void
}) {
  const lines = scene.text.split("\n").length
  return (
    <div
      onClick={onSelect}
      className={cn(
        "group relative rounded-md transition-all cursor-text border-l-2",
        selected ? "border-primary bg-primary/5" : "border-transparent hover:bg-card/60",
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
          selected ? "opacity-100" : "opacity-50 group-hover:opacity-90",
        )}
      >
        <span>Scene {scene.number}</span>
        {subCount > 0 && (
          <span
            className={cn(
              "inline-flex items-center px-1.5 py-0.5 rounded-full",
              "bg-primary/10 text-primary font-semibold",
            )}
            title={`${subCount} sub-scene${subCount === 1 ? "" : "s"}`}
          >
            {subCount}
          </span>
        )}
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
// SubSceneCard — the unit. Collapsible.
// ────────────────────────────────────────────────────────────────────────

function SubSceneCard({
  subScene,
  onChange,
  onDuplicate,
  onDelete,
}: {
  subScene: SubScene
  onChange: (patch: Partial<SubScene>) => void
  onDuplicate: () => void
  onDelete: () => void
}) {
  const [expanded, setExpanded] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <article
      className={cn(
        "group rounded-md border border-border bg-card overflow-hidden transition-colors",
        "hover:border-foreground/30",
      )}
    >
      {/* Header — title + type pill + controls */}
      <header className="flex items-center gap-2 px-3 py-2 border-b border-border/60">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-muted-foreground hover:text-foreground p-0.5 shrink-0"
          title={expanded ? "Collapse" : "Expand"}
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRightSm className="h-3.5 w-3.5" />
          )}
        </button>
        <input
          type="text"
          value={subScene.title}
          onChange={(e) => onChange({ title: e.target.value })}
          className={cn(
            "min-w-0 flex-1 bg-transparent text-[14px] font-medium text-foreground",
            "border-0 outline-none px-0 py-0",
          )}
          placeholder="Sub-scene title"
        />
        <select
          value={subScene.type}
          onChange={(e) => onChange({ type: e.target.value as SubSceneType })}
          className={cn(
            "shrink-0 px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold tracking-wider uppercase",
            "border-0 outline-none cursor-pointer",
            TYPE_COLORS[subScene.type],
          )}
        >
          {(Object.keys(TYPE_LABEL) as SubSceneType[]).map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </select>
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-secondary"
            title="More"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
          {menuOpen && (
            <div className="absolute top-7 right-0 z-10 w-40 rounded-md border border-border bg-card shadow-lg overflow-hidden">
              <button
                type="button"
                onClick={() => {
                  onDuplicate()
                  setMenuOpen(false)
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-foreground hover:bg-secondary text-left"
              >
                <Copy className="h-3 w-3" />
                Duplicate
              </button>
              <button
                type="button"
                onClick={() => {
                  onDelete()
                  setMenuOpen(false)
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 text-left"
              >
                <Trash2 className="h-3 w-3" />
                Delete
              </button>
            </div>
          )}
        </div>
      </header>

      {!expanded && (
        // Collapsed — 1-line preview + counts
        <div className="px-3 py-2 flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="font-mono truncate flex-1">
            {subScene.prompt.split("\n")[0] || "(no prompt yet)"}
          </span>
          <span className="shrink-0 inline-flex items-center gap-2">
            {subScene.frames.length > 0 && (
              <span title="frames">
                <FileImage className="h-3 w-3 inline" /> {subScene.frames.length}
              </span>
            )}
            {subScene.generations.length > 0 && (
              <span title="generations">
                <Video className="h-3 w-3 inline" /> {subScene.generations.length}
              </span>
            )}
          </span>
        </div>
      )}

      {expanded && (
        <>
          {/* Prompt */}
          <Section label="Prompt">
            <textarea
              value={subScene.prompt}
              onChange={(e) => onChange({ prompt: e.target.value })}
              rows={Math.max(3, subScene.prompt.split("\n").length)}
              placeholder="Type the prompt, or ask the agent in chat to draft it…"
              className={cn(
                "w-full px-3 py-2 rounded border border-border bg-background",
                "font-mono text-[12.5px] leading-relaxed text-foreground",
                "outline-none focus:border-primary focus:ring-1 focus:ring-primary/15",
                "resize-none",
              )}
            />
          </Section>

          {/* Elements */}
          <Section label="Elements">
            <div className="space-y-2">
              <ChipRow
                icon={User}
                label="Characters"
                items={subScene.characters}
                onAdd={() =>
                  onChange({
                    characters: [...subScene.characters, "New character"],
                  })
                }
                onRemove={(i) =>
                  onChange({
                    characters: subScene.characters.filter((_, idx) => idx !== i),
                  })
                }
              />
              <ChipRow
                icon={MapPin}
                label="Locations"
                items={subScene.locations}
                onAdd={() =>
                  onChange({
                    locations: [...subScene.locations, "New location"],
                  })
                }
                onRemove={(i) =>
                  onChange({
                    locations: subScene.locations.filter((_, idx) => idx !== i),
                  })
                }
              />
            </div>
          </Section>

          {/* Frames */}
          <Section
            label="Frames"
            actions={
              <button
                type="button"
                onClick={() =>
                  onChange({
                    frames: [
                      ...subScene.frames,
                      {
                        id: `f-${Date.now()}`,
                        prompt: "",
                        hasImage: false,
                      },
                    ],
                  })
                }
                className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-muted-foreground hover:text-primary hover:bg-primary/5"
              >
                <Plus className="h-3 w-3" />
                add frame
              </button>
            }
          >
            {subScene.frames.length === 0 ? (
              <div className="text-[11px] text-muted-foreground/60 italic px-1">
                No frames yet. Add a reference / keyframe used to start the generation.
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {subScene.frames.map((f) => (
                  <FrameCard
                    key={f.id}
                    frame={f}
                    onChange={(patch) =>
                      onChange({
                        frames: subScene.frames.map((x) =>
                          x.id === f.id ? { ...x, ...patch } : x,
                        ),
                      })
                    }
                    onDelete={() =>
                      onChange({
                        frames: subScene.frames.filter((x) => x.id !== f.id),
                      })
                    }
                  />
                ))}
              </div>
            )}
          </Section>

          {/* Generations */}
          <Section label="Generations">
            {subScene.generations.length === 0 ? (
              <div className="text-[11px] text-muted-foreground/60 italic px-1">
                No generations yet. Run the prompt to produce a video here.
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {subScene.generations.map((g) => (
                  <GenerationCard key={g.id} gen={g} />
                ))}
              </div>
            )}
          </Section>

          {/* Action row */}
          <div className="px-3 py-2 border-t border-border/60 bg-card/30 flex items-center justify-end gap-1.5">
            <button
              type="button"
              className={cn(
                "flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium",
                "border border-border bg-background hover:bg-secondary transition-colors",
              )}
              title="Ask the agent for a variation of this sub-scene's prompt"
            >
              <Sparkles className="h-3 w-3" />
              Iterate
            </button>
            <button
              type="button"
              className={cn(
                "flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium",
                "bg-primary text-primary-foreground hover:opacity-90 transition-opacity",
              )}
              title="Generate the video for this sub-scene"
            >
              <Film className="h-3 w-3" />
              Generate
            </button>
          </div>
        </>
      )}
    </article>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Small bits
// ────────────────────────────────────────────────────────────────────────

function Section({
  label,
  actions,
  children,
}: {
  label: string
  actions?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="px-3 py-2 border-b border-border/60 last:border-b-0">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground/70 font-mono">
          {label}
        </span>
        {actions}
      </div>
      {children}
    </div>
  )
}

function ChipRow({
  icon: Icon,
  label,
  items,
  onAdd,
  onRemove,
}: {
  icon: typeof User
  label: string
  items: string[]
  onAdd: () => void
  onRemove: (idx: number) => void
}) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground/70 font-mono shrink-0">
        <Icon className="h-3 w-3" />
        {label}
      </span>
      {items.map((it, i) => (
        <span
          key={`${it}-${i}`}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-secondary border border-border"
        >
          {it}
          <button
            type="button"
            onClick={() => onRemove(i)}
            className="text-muted-foreground hover:text-foreground"
            title="Remove"
          >
            ×
          </button>
        </span>
      ))}
      <button
        type="button"
        onClick={onAdd}
        className={cn(
          "inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[11px]",
          "border border-dashed border-border text-muted-foreground",
          "hover:text-primary hover:border-primary/50 hover:bg-primary/5",
        )}
        title={`Add ${label.toLowerCase()}`}
      >
        <Plus className="h-2.5 w-2.5" />
        add
      </button>
    </div>
  )
}

function FrameCard({
  frame,
  onChange,
  onDelete,
}: {
  frame: Frame
  onChange: (patch: Partial<Frame>) => void
  onDelete: () => void
}) {
  return (
    <div className="rounded border border-border bg-background p-1.5 flex flex-col gap-1.5">
      {frame.hasImage ? (
        <div
          className="w-full aspect-video rounded shrink-0"
          style={{
            background:
              frame.imageHint === "cool"
                ? "linear-gradient(135deg, #5E91A8 0%, #4F5B7B 50%, #2A3548 100%)"
                : "linear-gradient(135deg, #FFB87A 0%, #FF8C42 50%, #B45309 100%)",
          }}
        />
      ) : (
        <div className="w-full aspect-video rounded border border-dashed border-border bg-card/40 flex items-center justify-center text-muted-foreground/60">
          <ImageIcon className="h-4 w-4" />
        </div>
      )}
      <input
        type="text"
        value={frame.prompt}
        onChange={(e) => onChange({ prompt: e.target.value })}
        placeholder="Frame prompt…"
        className="w-full bg-transparent border-0 outline-none text-[10.5px] font-mono text-foreground/85 px-0.5"
      />
      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={onDelete}
          className="text-[10px] text-muted-foreground hover:text-rose-600 dark:hover:text-rose-400"
          title="Delete frame"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </div>
  )
}

function GenerationCard({ gen }: { gen: Generation }) {
  return (
    <div className="rounded border border-border bg-background p-1.5 w-32">
      <div
        className="w-full aspect-video rounded shrink-0 relative"
        style={{
          background:
            "linear-gradient(135deg, #FFB87A 0%, #FF8C42 50%, #B45309 100%)",
        }}
      >
        <Video className="absolute inset-0 m-auto h-5 w-5 text-white/70" />
      </div>
      <div className="text-[9.5px] font-mono text-muted-foreground mt-1 truncate">
        {gen.label}
      </div>
    </div>
  )
}

function Empty({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center gap-3">
      <Sparkles className="h-5 w-5 text-muted-foreground/50" />
      <div className="text-[13px] text-foreground/80 font-medium">
        No sub-scenes for this scene yet.
      </div>
      <button
        type="button"
        onClick={onAdd}
        className={cn(
          "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium",
          "bg-primary text-primary-foreground hover:opacity-90 transition-opacity",
        )}
      >
        <Plus className="h-3.5 w-3.5" />
        New sub-scene
      </button>
    </div>
  )
}
