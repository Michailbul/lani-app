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

import { useAtom, useAtomValue } from "jotai"
import {
  ChevronDown,
  ChevronUp,
  ImagePlus,
  Plus,
  Trash2,
  Upload,
} from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { cn } from "../../lib/utils"
import {
  activeEntityAtom,
  refsPanelHeightAtom,
  scriptPromptSplitAtom,
} from "./atoms"
import { Resizer } from "./resizer"

// ────────────────────────────────────────────────────────────────────────
// Mock — replaced by entities.read in E1.4
// ────────────────────────────────────────────────────────────────────────

interface VersionedText {
  versions: { id: string; label: string; text: string; createdAt: string }[]
  activeIndex: number
}

interface RefImage {
  id: string
  name: string
  /** Visual gradient hint until real upload lands. */
  hint?: "warm" | "cool" | "green" | "muted"
}

interface VersionedRefs {
  activeIndex: number
  versions: {
    id: string
    label: string
    createdAt: string
    refs: RefImage[]
  }[]
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
  refs: VersionedRefs
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
    refs: {
      activeIndex: 0,
      versions: [
        {
          id: "r-v1",
          label: "v1",
          createdAt: "today",
          refs: [
            { id: "r1", name: "forest-road-cinematic.jpg", hint: "warm" },
            { id: "r2", name: "anamorphic-flare.jpg", hint: "warm" },
            { id: "r3", name: "two-cars-still.jpg", hint: "muted" },
          ],
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
    refs: {
      activeIndex: 0,
      versions: [
        {
          id: "r-v1",
          label: "v1",
          createdAt: "today",
          refs: [{ id: "r1", name: "alex-cu-reference.jpg", hint: "warm" }],
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
    refs: {
      activeIndex: 0,
      versions: [
        {
          id: "r-v1",
          label: "v1",
          createdAt: "fresh",
          refs: [],
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
  const updateRefs = (next: VersionedRefs) => updateScene({ refs: next })

  if (!scene) return null

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">
      <SceneHeader scene={scene} onChange={updateScene} />
      <ScriptPromptSplit
        script={scene.script}
        prompt={scene.prompt}
        onScriptChange={updateScript}
        onPromptChange={updatePrompt}
      />
      <RefsPanel versioned={scene.refs} onChange={updateRefs} />
      <SceneNav scenes={scenes} activeIdx={activeIdx} onSelect={setActiveIdx} />
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
// ScriptPromptSplit — horizontal split between the two text panels with
// a draggable divider. Width fraction is persisted via
// scriptPromptSplitAtom (clamped 0.2–0.8).
// ────────────────────────────────────────────────────────────────────────

function ScriptPromptSplit({
  script,
  prompt,
  onScriptChange,
  onPromptChange,
}: {
  script: VersionedText
  prompt: VersionedText
  onScriptChange: (next: VersionedText) => void
  onPromptChange: (next: VersionedText) => void
}) {
  const [split, setSplit] = useAtom(scriptPromptSplitAtom)
  const containerRef = useRef<HTMLDivElement | null>(null)

  return (
    <div ref={containerRef} className="flex-1 min-h-0 flex">
      <div className="min-w-0 flex flex-col" style={{ flex: `${split} 1 0` }}>
        <Panel
          label="Script"
          versioned={script}
          onChange={onScriptChange}
          flavor="screenplay"
        />
      </div>
      <Resizer
        axis="x"
        onResize={(d) => {
          const w = containerRef.current?.clientWidth ?? 1
          if (w === 0) return
          setSplit((s) => Math.max(0.2, Math.min(0.8, s + d / w)))
        }}
      />
      <div className="min-w-0 flex flex-col" style={{ flex: `${1 - split} 1 0` }}>
        <Panel
          label="Prompt"
          versioned={prompt}
          onChange={onPromptChange}
          flavor="prompt"
        />
      </div>
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

  // Suppress unused — versions are stashed in state for when the chrome
  // comes back. Keep `switchTo` / `newVersion` ready but unused until then.
  void switchTo
  void newVersion

  return (
    <div className="flex-1 min-w-0 flex flex-col">
      {/* Panel header — minimal, just the label */}
      <div className="flex items-center gap-2 h-9 px-4 border-b border-border bg-card/40 select-none shrink-0">
        <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 font-mono">
          {label}
        </span>
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
            "font-mono text-[13px] leading-7 text-foreground/90",
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

// ────────────────────────────────────────────────────────────────────────
// References panel — bottom strip, collapsible. Independent version
// history from script + prompt so the user can iterate any of the three
// without disturbing the others.
// ────────────────────────────────────────────────────────────────────────

const REF_HINT_BG: Record<NonNullable<RefImage["hint"]>, string> = {
  warm: "linear-gradient(135deg, #FFB87A 0%, #FF8C42 50%, #B45309 100%)",
  cool: "linear-gradient(135deg, #5E91A8 0%, #4F5B7B 50%, #2A3548 100%)",
  green: "linear-gradient(135deg, #B5D6BD 0%, #79B791 50%, #3D6B4D 100%)",
  muted: "linear-gradient(135deg, #8E8378 0%, #5C544D 100%)",
}

function RefsPanel({
  versioned,
  onChange,
}: {
  versioned: VersionedRefs
  onChange: (next: VersionedRefs) => void
}) {
  const [collapsed, setCollapsed] = useState(false)
  const [height, setHeight] = useAtom(refsPanelHeightAtom)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const dropZoneRef = useRef<HTMLDivElement | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  const active = versioned.versions[versioned.activeIndex]
  const refs = active?.refs ?? []

  const updateRefs = (nextRefs: RefImage[]) => {
    onChange({
      ...versioned,
      versions: versioned.versions.map((v, i) =>
        i === versioned.activeIndex ? { ...v, refs: nextRefs } : v,
      ),
    })
  }
  // Versions kept in data model; UI hidden for now.
  void onChange

  const addPlaceholderRef = (name?: string) => {
    const hints: NonNullable<RefImage["hint"]>[] = [
      "warm",
      "cool",
      "green",
      "muted",
    ]
    const next: RefImage = {
      id: `i-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: name || `reference-${refs.length + 1}.jpg`,
      hint: hints[refs.length % hints.length],
    }
    updateRefs([...refs, next])
  }
  const removeRef = (id: string) => {
    updateRefs(refs.filter((r) => r.id !== id))
  }

  // Browser file input → for now stash names only; real upload lands in E1.4
  const onFiles = (files: FileList | null) => {
    if (!files) return
    Array.from(files).forEach((f) => addPlaceholderRef(f.name))
  }

  return (
    <section className="bg-card/20 shrink-0 flex flex-col">
      {/* Top resize handle */}
      {!collapsed && (
        <Resizer
          axis="y"
          onResize={(d) =>
            setHeight((h) => Math.max(80, Math.min(420, h - d)))
          }
        />
      )}
      {/* Header — always visible */}
      <div
        className={cn(
          "flex items-center justify-between gap-2 h-8 px-4 select-none shrink-0",
          collapsed && "border-t border-border",
        )}
      >
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
          title={collapsed ? "Expand references" : "Collapse references"}
        >
          {collapsed ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
          <span className="text-[10px] uppercase tracking-[0.18em] font-mono">
            References
          </span>
          <span className="text-[10px] tabular-nums text-muted-foreground/60 font-mono">
            {refs.length}
          </span>
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              "flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider",
              "border border-border bg-background hover:bg-secondary transition-colors",
            )}
          >
            <Upload className="h-3 w-3" />
            Upload
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              onFiles(e.target.files)
              e.target.value = ""
            }}
          />
        </div>
      </div>

      {!collapsed && (
        <div
          ref={dropZoneRef}
          onDragEnter={(e) => {
            e.preventDefault()
            setIsDragging(true)
          }}
          onDragOver={(e) => {
            e.preventDefault()
          }}
          onDragLeave={(e) => {
            if (e.currentTarget === e.target) setIsDragging(false)
          }}
          onDrop={(e) => {
            e.preventDefault()
            setIsDragging(false)
            onFiles(e.dataTransfer?.files ?? null)
          }}
          style={{ height }}
          className={cn(
            "px-4 pb-3 pt-1 transition-colors overflow-auto",
            isDragging && "bg-primary/5",
          )}
        >
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            {refs.map((r) => (
              <RefThumb key={r.id} ref_={r} onDelete={() => removeRef(r.id)} />
            ))}
            <button
              type="button"
              onClick={() => addPlaceholderRef()}
              className={cn(
                "shrink-0 w-24 h-16 rounded border border-dashed border-border",
                "flex flex-col items-center justify-center gap-0.5",
                "text-muted-foreground hover:text-primary hover:border-primary/60 hover:bg-primary/5",
                "transition-colors",
              )}
              title="Drop images here, click to add, or use Upload above"
            >
              <ImagePlus className="h-3.5 w-3.5" />
              <span className="text-[9px] uppercase tracking-wider font-mono">
                add
              </span>
            </button>
          </div>
          {refs.length === 0 && (
            <div className="text-[10.5px] text-muted-foreground/60 italic mt-1">
              Drop images anywhere here, or use Upload above. References stay
              attached to whichever version of refs is active.
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function RefThumb({
  ref_,
  onDelete,
}: {
  ref_: RefImage
  onDelete: () => void
}) {
  return (
    <div className="group relative shrink-0 w-24 h-16 rounded overflow-hidden border border-border">
      <div
        className="absolute inset-0"
        style={{
          background: ref_.hint
            ? REF_HINT_BG[ref_.hint]
            : REF_HINT_BG.muted,
        }}
      />
      <div
        className={cn(
          "absolute inset-x-0 bottom-0 px-1.5 py-0.5",
          "bg-black/40 text-white/90 text-[9px] font-mono truncate",
        )}
        title={ref_.name}
      >
        {ref_.name}
      </div>
      <button
        type="button"
        onClick={onDelete}
        className={cn(
          "absolute top-0.5 right-0.5 p-0.5 rounded",
          "bg-black/60 text-white/90 opacity-0 group-hover:opacity-100",
          "hover:bg-rose-500/80 transition-colors",
        )}
        title="Remove reference"
      >
        <Trash2 className="h-2.5 w-2.5" />
      </button>
    </div>
  )
}

function RefsVersionSelector({
  versioned,
  onSwitch,
  onNew,
}: {
  versioned: VersionedRefs
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
          "inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono",
          "border border-border bg-background",
          "hover:bg-secondary hover:border-foreground/30 transition-colors",
        )}
      >
        <span className="font-medium">{active?.label ?? "v1"}</span>
        <span className="text-muted-foreground/60">· {active?.createdAt ?? ""}</span>
        <ChevronDown className="h-2.5 w-2.5 text-muted-foreground" />
      </button>
      {open && (
        <div className="absolute bottom-7 right-0 z-20 w-56 rounded-md border border-border bg-card shadow-lg overflow-hidden">
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground/70 font-mono px-3 pt-2 pb-1">
            Reference versions
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
                  "w-full flex items-center justify-between gap-2 px-3 py-1.5 text-left text-[12px] transition-colors",
                  isActive
                    ? "bg-primary/10 text-foreground"
                    : "text-foreground/85 hover:bg-secondary",
                )}
              >
                <span className="font-mono font-medium">{v.label}</span>
                <span className="text-[10px] text-muted-foreground/70 font-mono">
                  {v.refs.length} · {v.createdAt}
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
