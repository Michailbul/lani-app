"use client"

/**
 * SceneFocusView (lives in this file under the legacy name
 * PromptsModeView for backward compat with the workspace import).
 *
 * The user's spec, simplest version:
 *
 *   ┌── Project tree ──┬── Scene focus mode ────────────────────┬── Chat ──┐
 *   │                  │                                          │          │
 *   │ Scene 1 ←        │  Scene 1 — DESERT MOUNTAIN PASS         │          │
 *   │ Scene 2          │  Logline: "Two cars start a deadly race" │          │
 *   │ Scene 3          │  Characters: Alex · Jordan · Referee    │          │
 *   │                  │  Location: Mountain Pass starting line  │          │
 *   │                  │                                          │          │
 *   │                  │  ┌── Script ─v1 ──┬── Prompt ─v2 ──┐  │          │
 *   │                  │  │                 │                 │  │          │
 *   │                  │  │  EXT. DESERT…   │  MULTI-SHOT…   │  │          │
 *   │                  │  │  …editable…     │  …editable…    │  │          │
 *   │                  │  │                 │                 │  │          │
 *   │                  │  └─────────────────┴─────────────────┘  │          │
 *   └──────────────────┴──────────────────────────────────────────┴──────────┘
 *
 * Two panels, side by side. Each has its own version selector — pick a
 * past version to view; "+ new version" snapshots the current text and
 * starts a fresh editable copy. No cards, no nested entities, no
 * frames-grid, no generations-grid. Just script and prompt.
 */

import { useAtomValue } from "jotai"
import {
  ChevronDown,
  Plus,
} from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { cn } from "../../lib/utils"
import { activeEntityAtom } from "./atoms"

// ────────────────────────────────────────────────────────────────────────
// Mock — replaced by entities.read in E1.4
// ────────────────────────────────────────────────────────────────────────

interface VersionedText {
  versions: { id: string; label: string; text: string; createdAt: string }[]
  activeIndex: number
}

interface SceneRecord {
  id: string
  number: number
  title: string
  logline: string
  characters: string[]
  location: string
  script: VersionedText
  prompt: VersionedText
}

const MOCK_SCENES: SceneRecord[] = [
  {
    id: "01",
    number: 1,
    title: "DESERT MOUNTAIN PASS",
    logline: "Two cars start a deadly race at sunset.",
    characters: ["Alex", "Jordan", "Referee"],
    location: "Mountain Pass starting line",
    script: {
      activeIndex: 1,
      versions: [
        {
          id: "s-v1",
          label: "v1",
          createdAt: "yesterday",
          text: `EXT. DESERT MOUNTAIN PASS - SUNSET

Two cars idle at a starting line painted across asphalt. The sky burns amber.

A REFEREE stands between them, arm raised.

The REFEREE drops their arm.

Both cars LAUNCH forward.`,
        },
        {
          id: "s-v2",
          label: "v2",
          createdAt: "2h ago",
          text: `EXT. DESERT MOUNTAIN PASS - SUNSET

Two cars idle at a starting line painted across asphalt. Beyond them, the road snakes into foothills. The sky burns amber and rust.

A REFEREE in a dark jacket stands between the vehicles, arm raised.

The REFEREE drops their arm.

Both cars LAUNCH forward. Tires scream. Dust kicks up.`,
        },
      ],
    },
    prompt: {
      activeIndex: 0,
      versions: [
        {
          id: "p-v1",
          label: "v1",
          createdAt: "1h ago",
          text: `MULTI-SHOT, 12s.

Shot 1 (4s): static wide on the asphalt line. Two cars idle, engines rumbling, dust in amber light.

Shot 2 (4s): low push-in toward the referee silhouette, arm raising slowly.

Shot 3 (4s): the referee drops their arm. Both cars launch forward, tires scream, dust clouds bloom.`,
        },
      ],
    },
  },
  {
    id: "02",
    number: 2,
    title: "INT. CAR 1 - CONTINUOUS",
    logline: "Alex grips the wheel, knowing this is a mistake.",
    characters: ["Alex"],
    location: "Car 1 interior",
    script: {
      activeIndex: 0,
      versions: [
        {
          id: "s-v1",
          label: "v1",
          createdAt: "today",
          text: `INT. CAR 1 - CONTINUOUS

ALEX (late 20s, focused, hands tight on the wheel) stares ahead. Jaw clenched.

ALEX
We're not safe here.
But there's no going back now.`,
        },
      ],
    },
    prompt: {
      activeIndex: 0,
      versions: [
        {
          id: "p-v1",
          label: "v1",
          createdAt: "30m ago",
          text: `Single shot, 5s. Tight close-up on Alex's eyes reflected in the windshield. Jaw clenched, breath caught. Warm light spills across one half of their face.`,
        },
      ],
    },
  },
  {
    id: "03",
    number: 3,
    title: "INT. CAR 2 - CONTINUOUS",
    logline: "Jordan touches the photograph. The moment fractures.",
    characters: ["Jordan"],
    location: "Car 2 interior",
    script: {
      activeIndex: 0,
      versions: [
        {
          id: "s-v1",
          label: "v1",
          createdAt: "today",
          text: `INT. CAR 2 - CONTINUOUS

JORDAN (same age, confident but tense) grips their own wheel. They reach toward the dashboard — a worn photograph taped there. Younger versions of themselves. Jordan and Alex. Laughing. Before this.

Their hand drops back to the wheel. The moment fractures.`,
        },
      ],
    },
    prompt: {
      activeIndex: 0,
      versions: [
        {
          id: "p-v1",
          label: "v1",
          createdAt: "fresh draft",
          text: ``,
        },
      ],
    },
  },
]

// ────────────────────────────────────────────────────────────────────────
// View
// ────────────────────────────────────────────────────────────────────────

export function PromptsModeView() {
  const active = useAtomValue(activeEntityAtom)

  // Scenes live in component state for the demo. E1.4 wires real
  // entities.read for both script and prompt files (and version
  // history comes from git via the existing partHistory infra).
  const [scenes, setScenes] = useState<SceneRecord[]>(MOCK_SCENES)

  const initialIndex =
    scenes.findIndex(
      (s) => active?.kind === "scene" && active.id?.startsWith(s.id),
    ) ?? 0
  const [activeIdx, setActiveIdx] = useState(Math.max(0, initialIndex))

  // Keep activeIdx valid if scenes change.
  useEffect(() => {
    if (activeIdx >= scenes.length) setActiveIdx(0)
  }, [activeIdx, scenes.length])

  const scene = scenes[activeIdx]

  const updateScene = (patch: Partial<SceneRecord>) => {
    setScenes((prev) =>
      prev.map((s, i) => (i === activeIdx ? { ...s, ...patch } : s)),
    )
  }
  const updateScript = (next: VersionedText) => updateScene({ script: next })
  const updatePrompt = (next: VersionedText) => updateScene({ prompt: next })

  if (!scene) return null

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">
      <SceneHeader scene={scene} onChange={updateScene} />
      <div className="flex-1 min-h-0 flex">
        <Panel
          label="Script"
          versioned={scene.script}
          onChange={updateScript}
          flavor="screenplay"
        />
        <div className="w-px bg-border shrink-0" />
        <Panel
          label="Prompt"
          versioned={scene.prompt}
          onChange={updatePrompt}
          flavor="prompt"
        />
      </div>
      {/* Bottom: scene navigation */}
      <SceneNav
        scenes={scenes}
        activeIdx={activeIdx}
        onSelect={setActiveIdx}
      />
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Header — title + logline + characters + location
// ────────────────────────────────────────────────────────────────────────

function SceneHeader({
  scene,
  onChange,
}: {
  scene: SceneRecord
  onChange: (patch: Partial<SceneRecord>) => void
}) {
  return (
    <div className="border-b border-border bg-card/30 px-6 py-3 shrink-0">
      <div className="flex items-baseline gap-3 mb-1">
        <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 font-mono">
          Scene {scene.number}
        </span>
        <input
          type="text"
          value={scene.title}
          onChange={(e) => onChange({ title: e.target.value })}
          className={cn(
            "min-w-0 flex-1 bg-transparent",
            "font-display text-[20px] font-bold leading-tight text-foreground",
            "border-0 outline-none px-0 py-0",
          )}
        />
      </div>
      <input
        type="text"
        value={scene.logline}
        onChange={(e) => onChange({ logline: e.target.value })}
        placeholder="One-line logline…"
        className={cn(
          "w-full bg-transparent italic text-[12px] text-muted-foreground/85",
          "border-0 outline-none px-0 py-0.5",
          "placeholder:text-muted-foreground/40",
        )}
      />
      <div className="flex items-center gap-3 mt-1.5 text-[11px] flex-wrap">
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground/60 font-mono">
            Characters
          </span>
          <span className="text-foreground/85">
            {scene.characters.length === 0
              ? "—"
              : scene.characters.join(" · ")}
          </span>
        </div>
        <span className="text-muted-foreground/30">|</span>
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground/60 font-mono">
            Location
          </span>
          <span className="text-foreground/85">{scene.location || "—"}</span>
        </div>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Panel — one of the two side-by-side editors. Versioned.
// ────────────────────────────────────────────────────────────────────────

function Panel({
  label,
  versioned,
  onChange,
  flavor,
}: {
  label: string
  versioned: VersionedText
  onChange: (next: VersionedText) => void
  flavor: "screenplay" | "prompt"
}) {
  const active = versioned.versions[versioned.activeIndex]
  const updateText = (text: string) => {
    onChange({
      ...versioned,
      versions: versioned.versions.map((v, i) =>
        i === versioned.activeIndex ? { ...v, text } : v,
      ),
    })
  }
  const switchTo = (i: number) => {
    onChange({ ...versioned, activeIndex: i })
  }
  const newVersion = () => {
    const next: VersionedText = {
      activeIndex: versioned.versions.length,
      versions: [
        ...versioned.versions,
        {
          id: `v-${Date.now()}`,
          label: `v${versioned.versions.length + 1}`,
          createdAt: "just now",
          text: active?.text ?? "",
        },
      ],
    }
    onChange(next)
  }

  return (
    <div className="flex-1 min-w-0 flex flex-col">
      {/* Panel header */}
      <div className="flex items-center justify-between gap-2 h-9 px-4 border-b border-border bg-card/40 select-none shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 font-mono">
            {label}
          </span>
          <span className="text-muted-foreground/40">·</span>
          <VersionSelector
            versioned={versioned}
            onSwitch={switchTo}
            onNew={newVersion}
          />
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-auto">
        <textarea
          value={active?.text ?? ""}
          onChange={(e) => updateText(e.target.value)}
          spellCheck={flavor === "screenplay"}
          placeholder={
            flavor === "screenplay"
              ? "Write the scene script here…"
              : "Write the prompt for this scene here, or ask the agent in chat to draft it…"
          }
          className={cn(
            "w-full h-full min-h-full px-6 py-5 bg-transparent",
            "border-0 outline-none resize-none",
            "font-mono text-[13px] leading-7",
            flavor === "screenplay"
              ? "text-foreground/90"
              : "text-foreground/90",
            "placeholder:text-muted-foreground/40",
          )}
        />
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Version dropdown — minimal pill + popup list
// ────────────────────────────────────────────────────────────────────────

function VersionSelector({
  versioned,
  onSwitch,
  onNew,
}: {
  versioned: VersionedText
  onSwitch: (idx: number) => void
  onNew: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!ref.current) return
      if (!ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [open])
  const active = versioned.versions[versioned.activeIndex]

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono",
          "border border-border bg-background",
          "hover:bg-secondary hover:border-foreground/30 transition-colors",
        )}
        title="Switch version or create a new one"
      >
        <span className="font-medium">{active?.label ?? "v1"}</span>
        <span className="text-muted-foreground/60">· {active?.createdAt ?? ""}</span>
        <ChevronDown className="h-3 w-3 text-muted-foreground" />
      </button>
      {open && (
        <div className="absolute top-7 left-0 z-20 w-56 rounded-md border border-border bg-card shadow-lg overflow-hidden">
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground/70 font-mono px-3 pt-2 pb-1">
            Versions
          </div>
          {versioned.versions.map((v, i) => {
            const isActive = i === versioned.activeIndex
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => {
                  onSwitch(i)
                  setOpen(false)
                }}
                className={cn(
                  "w-full flex items-center justify-between gap-2 px-3 py-1.5",
                  "text-left text-[12px] transition-colors",
                  isActive
                    ? "bg-primary/10 text-foreground"
                    : "text-foreground/85 hover:bg-secondary",
                )}
              >
                <span className="font-mono font-medium">{v.label}</span>
                <span className="text-[10px] text-muted-foreground/70 font-mono">
                  {v.createdAt}
                </span>
              </button>
            )
          })}
          <div className="border-t border-border">
            <button
              type="button"
              onClick={() => {
                onNew()
                setOpen(false)
              }}
              className={cn(
                "w-full flex items-center gap-1.5 px-3 py-2",
                "text-[12px] text-primary hover:bg-primary/5 transition-colors",
              )}
            >
              <Plus className="h-3 w-3" />
              New version (snapshot current)
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Bottom — scene navigation
// ────────────────────────────────────────────────────────────────────────

function SceneNav({
  scenes,
  activeIdx,
  onSelect,
}: {
  scenes: SceneRecord[]
  activeIdx: number
  onSelect: (idx: number) => void
}) {
  return (
    <div className="flex items-center justify-center gap-1 h-10 px-4 border-t border-border bg-card/30 shrink-0">
      {scenes.map((s, i) => (
        <button
          key={s.id}
          type="button"
          onClick={() => onSelect(i)}
          className={cn(
            "px-2.5 py-1 rounded text-[11px] transition-colors",
            i === activeIdx
              ? "bg-primary text-primary-foreground font-medium"
              : "text-muted-foreground hover:text-foreground hover:bg-secondary",
          )}
          title={s.title}
        >
          <span className="font-mono mr-1">{s.number}.</span>
          <span className="truncate max-w-[180px] inline-block align-bottom">
            {s.title}
          </span>
        </button>
      ))}
    </div>
  )
}
