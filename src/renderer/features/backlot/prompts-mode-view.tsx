"use client"

/**
 * PromptsModeView — dumb-simple version.
 *
 *   ┌── Screenplay (editable, scene blocks) ──┬── Prompt cards for active scene ──┐
 *
 * Each prompt is a plain text card. To iterate, duplicate a card and
 * edit. To see your versions, scroll the list. No metadata fields, no
 * types, no segments, no variants. The user / agent both edit the
 * card text directly.
 *
 * Scene-by-scene workflow: pick a scene block on the left → see its
 * prompt cards on the right. Bottom of right pane has prev/next nav.
 */

import { useAtomValue } from "jotai"
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  MoreHorizontal,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { cn } from "../../lib/utils"
import { activeEntityAtom } from "./atoms"

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

interface PromptCard {
  id: string
  sceneId: string
  text: string
}

// Each scene gets a few starter cards. The user/agent can add more.
const MOCK_PROMPTS: PromptCard[] = [
  {
    id: "p1",
    sceneId: "01",
    text: "MULTI-SHOT, 12s.\n\nShot 1 (4s): static wide on the asphalt line. Two cars idle, engines rumbling, dust in amber light.\nShot 2 (4s): low push-in toward the referee silhouette, arm raising slowly.\nShot 3 (4s): the referee drops their arm. Both cars launch forward, tires scream.",
  },
  {
    id: "p2",
    sceneId: "01",
    text: "Single shot, 5s. Slow crane rising from asphalt level upward, revealing two parked cars at a desert starting line. Mountain pass snakes into foothills behind them. Sunset burns orange.",
  },
  {
    id: "p3",
    sceneId: "01",
    text: "Single shot, 4s. Low-angle silhouette of the referee, arm raised against the sunset. Their figure dwarfed by the cars on either side.",
  },
  {
    id: "p4",
    sceneId: "02",
    text: "Single shot, 5s. Tight close-up on Alex's eyes reflected in the windshield. Jaw clenched, breath caught. Warm light spills across one half of their face.",
  },
  {
    id: "p5",
    sceneId: "03",
    text: "MULTI-SHOT, 10s.\n\nShot 1 (4s): Jordan's hand reaches toward the dashboard. Fingertips graze a worn photograph.\nShot 2 (3s): close on the photograph. Younger Alex and Jordan, laughing.\nShot 3 (3s): pull back. Jordan's hand returns to wheel. Both engines rumble. Tires scream forward.",
  },
]

// ────────────────────────────────────────────────────────────────────────
// Scene parser — Fountain INT./EXT. headings split scenes
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
    return [{ id: "01", number: 1, heading: "(Untitled scene)", text: screenplay.trim() }]
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

  const [prompts, setPrompts] = useState<PromptCard[]>(MOCK_PROMPTS)
  const visiblePrompts = prompts.filter((p) => p.sceneId === selectedSceneId)

  const updateScene = (sceneId: string, nextText: string) => {
    setScreenplay(
      joinScenes(
        scenes.map((s) => (s.id === sceneId ? { ...s, text: nextText } : s)),
      ),
    )
  }
  const addPrompt = () => {
    const id = `p${Date.now()}`
    const next: PromptCard = { id, sceneId: selectedSceneId, text: "" }
    setPrompts((prev) => [...prev, next])
    setTimeout(() => {
      const el = document.getElementById(`prompt-${id}`) as HTMLTextAreaElement | null
      el?.focus()
    }, 0)
  }
  const updatePrompt = (id: string, text: string) => {
    setPrompts((prev) => prev.map((p) => (p.id === id ? { ...p, text } : p)))
  }
  const duplicatePrompt = (id: string) => {
    setPrompts((prev) => {
      const idx = prev.findIndex((p) => p.id === id)
      if (idx < 0) return prev
      const original = prev[idx]
      const copy: PromptCard = {
        id: `p${Date.now()}`,
        sceneId: original.sceneId,
        text: original.text,
      }
      const next = [...prev]
      next.splice(idx + 1, 0, copy)
      return next
    })
  }
  const deletePrompt = (id: string) => {
    setPrompts((prev) => prev.filter((p) => p.id !== id))
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
      {/* LEFT — screenplay (editable scene blocks, click to switch) */}
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
            {scenes.map((scene) => {
              const promptCount = prompts.filter((p) => p.sceneId === scene.id).length
              return (
                <SceneEditorBlock
                  key={scene.id}
                  scene={scene}
                  selected={scene.id === selectedSceneId}
                  promptCount={promptCount}
                  onSelect={() => setSelectedSceneId(scene.id)}
                  onChange={(next) => updateScene(scene.id, next)}
                />
              )
            })}
          </div>
        </div>
      </div>

      {/* RIGHT — prompt cards for the active scene */}
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
              {visiblePrompts.length} prompt{visiblePrompts.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={addPrompt}
              className={cn(
                "flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono uppercase tracking-wider",
                "bg-primary text-primary-foreground hover:opacity-90 transition-opacity",
              )}
            >
              <Plus className="h-3 w-3" />
              New prompt
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-auto">
          <div className="max-w-[760px] mx-auto px-6 py-4 space-y-3">
            {visiblePrompts.length === 0 ? (
              <Empty onAdd={addPrompt} />
            ) : (
              visiblePrompts.map((p) => (
                <PromptCardView
                  key={p.id}
                  prompt={p}
                  onChange={(text) => updatePrompt(p.id, text)}
                  onDuplicate={() => duplicatePrompt(p.id)}
                  onDelete={() => deletePrompt(p.id)}
                />
              ))
            )}
            {visiblePrompts.length > 0 && (
              <button
                type="button"
                onClick={addPrompt}
                className={cn(
                  "w-full flex items-center justify-center gap-2 py-2.5",
                  "border border-dashed border-border rounded-md",
                  "text-muted-foreground hover:text-primary hover:border-primary/60 hover:bg-primary/5",
                  "transition-colors text-[12px] font-medium",
                )}
              >
                <Plus className="h-3.5 w-3.5" />
                New prompt
              </button>
            )}
          </div>
        </div>

        {/* Scene navigation */}
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
// Scene block on the left
// ────────────────────────────────────────────────────────────────────────

function SceneEditorBlock({
  scene,
  selected,
  promptCount,
  onSelect,
  onChange,
}: {
  scene: SceneBlock
  selected: boolean
  promptCount: number
  onSelect: () => void
  onChange: (next: string) => void
}) {
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
        {promptCount > 0 && (
          <span
            className={cn(
              "inline-flex items-center px-1.5 py-0.5 rounded-full",
              "bg-primary/10 text-primary font-semibold",
            )}
            title={`${promptCount} prompt${promptCount === 1 ? "" : "s"} for this scene`}
          >
            {promptCount}
          </span>
        )}
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
// PromptCardView — minimal: just text + a hover menu
// ────────────────────────────────────────────────────────────────────────

function PromptCardView({
  prompt,
  onChange,
  onDuplicate,
  onDelete,
}: {
  prompt: PromptCard
  onChange: (text: string) => void
  onDuplicate: () => void
  onDelete: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return
    const onDoc = (e: MouseEvent) => {
      if (!ref.current) return
      if (!ref.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [menuOpen])

  return (
    <div
      ref={ref}
      className={cn(
        "group relative rounded-md border border-border bg-card",
        "hover:border-foreground/30 transition-colors",
        "focus-within:border-primary focus-within:ring-1 focus-within:ring-primary/15",
      )}
    >
      <textarea
        id={`prompt-${prompt.id}`}
        value={prompt.text}
        onChange={(e) => onChange(e.target.value)}
        rows={Math.max(3, prompt.text.split("\n").length)}
        placeholder="Type the prompt, or ask the agent in chat to draft it…"
        className={cn(
          "w-full px-3 py-2.5 bg-transparent",
          "font-mono text-[12.5px] leading-relaxed text-foreground",
          "border-0 outline-none resize-none",
          "placeholder:text-muted-foreground/50",
        )}
      />

      {/* Hover menu — top-right */}
      <div className="absolute top-1.5 right-1.5 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
        <button
          type="button"
          onClick={onDuplicate}
          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-secondary"
          title="Duplicate as a new variant"
        >
          <Copy className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-secondary"
          title="More"
        >
          <MoreHorizontal className="h-3 w-3" />
        </button>
      </div>

      {menuOpen && (
        <div className="absolute top-8 right-1.5 z-10 w-40 rounded-md border border-border bg-card shadow-lg overflow-hidden">
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
  )
}

function Empty({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center gap-3">
      <Sparkles className="h-5 w-5 text-muted-foreground/50" />
      <div className="text-[13px] text-foreground/80 font-medium">
        No prompts for this scene yet.
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
        New prompt
      </button>
    </div>
  )
}
