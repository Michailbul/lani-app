"use client"

/**
 * MultishotSurface — Backlot's "Multishot" workflow mode.
 *
 * A file-backed sibling of the Shotlist surface. Where a Shotlist cuts a
 * scene into many Parts, a Multishot keeps the scene whole: one screenplay
 * working copy paired with a single multi-shot generation prompt — the
 * "MULTI-SHOT, 12s — Shot 1… Shot 2…" form, where one clip covers several
 * shots.
 *
 *   ┌── masthead — lime tick · "Multishot" · scene Select · save state ──┐
 *   │                                                                    │
 *   │  ┌── Prompt (hero) ──────┬── Screenplay (working copy) ─────────┐  │
 *   │  │  status · versions    │  Fountain editor, seeded from        │  │
 *   │  │  EN / ZH · copy       │  scene.fountain, re-importable       │  │
 *   │  │  the prompt body      │                                      │  │
 *   │  └───────────────────────┴──────────────────────────────────────┘  │
 *   └────────────────────────────────────────────────────────────────────┘
 *
 * One scene = one `multishot.backlot.json` next to its `scene.fountain`.
 * Edits autosave (debounced) through the `multishots` tRPC router, which
 * checkpoints each settled edit into git.
 */

import { useEffect, useMemo, useRef, useState } from "react"
import { useAtomValue } from "jotai"
import {
  Check,
  Copy,
  Loader2,
  MessageSquarePlus,
  Plus,
  RotateCcw,
  X,
} from "lucide-react"
import { toast } from "sonner"
import type { SceneMultishot, ShotStatus } from "../../../shared/multishot-types"
import { selectedAgentChatIdAtom, selectedProjectAtom } from "../agents/atoms"
import { trpc } from "../../lib/trpc"
import { cn } from "../../lib/utils"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu"
import { activeEntityAtom } from "./atoms"
import { FountainSourceEditor } from "./fountain-source-editor"

const AUTOSAVE_MS = 600
const LIVE_POLL_MS = 1500

const STATUS_OPTIONS: ShotStatus[] = [
  "draft",
  "ready",
  "submitted",
  "generated",
  "approved",
]

const STATUS_DOT: Record<ShotStatus, string> = {
  draft: "bg-muted-foreground/40",
  ready: "bg-primary",
  submitted: "bg-amber-500",
  generated: "bg-emerald-500",
  approved: "bg-emerald-400",
}

// The raised liquid-glass thumb — lifted from the workflow ModeDock so the
// Multishot's lime controls speak the same glass language as Shotlist.
const GLASS_THUMB =
  "shadow-[0_0_6px_rgba(0,0,0,0.03),0_2px_6px_rgba(0,0,0,0.08),inset_3px_3px_0.5px_-3px_rgba(0,0,0,0.9),inset_-3px_-3px_0.5px_-3px_rgba(0,0,0,0.85),inset_1px_1px_1px_-0.5px_rgba(0,0,0,0.6),inset_-1px_-1px_1px_-0.5px_rgba(0,0,0,0.6),inset_0_0_6px_6px_rgba(0,0,0,0.12),inset_0_0_2px_2px_rgba(0,0,0,0.06),0_0_12px_rgba(255,255,255,0.15)] " +
  "dark:shadow-[0_0_8px_rgba(0,0,0,0.03),0_2px_6px_rgba(0,0,0,0.08),inset_3px_3px_0.5px_-3.5px_rgba(255,255,255,0.09),inset_-3px_-3px_0.5px_-3.5px_rgba(255,255,255,0.85),inset_1px_1px_1px_-0.5px_rgba(255,255,255,0.6),inset_-1px_-1px_1px_-0.5px_rgba(255,255,255,0.6),inset_0_0_6px_6px_rgba(255,255,255,0.12),inset_0_0_2px_2px_rgba(255,255,255,0.06),0_0_12px_rgba(0,0,0,0.15)]"

// ── Prompt / screenplay split — a single persisted fraction ───────────────

const PROMPT_FRACTION_KEY = "backlot:multishot:prompt-fraction:v1"
const PROMPT_MIN = 0.4
const PROMPT_MAX = 0.72
const PROMPT_DEFAULT = 0.54

/** Hard pixel floors — neither column may be dragged below these widths. */
const PROMPT_COL_MIN_PX = 470
const SCREENPLAY_COL_MIN_PX = 340

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/** The prompt column's width as a fraction of the work area, drag-resizable. */
function usePromptFraction() {
  const [fraction, setFractionState] = useState<number>(() => {
    try {
      const raw = localStorage.getItem(PROMPT_FRACTION_KEY)
      if (raw) {
        const n = Number(raw)
        if (Number.isFinite(n)) return clamp(n, PROMPT_MIN, PROMPT_MAX)
      }
    } catch {
      /* fall through */
    }
    return PROMPT_DEFAULT
  })

  const ref = useRef(fraction)
  ref.current = fraction

  return {
    fraction,
    setFraction: (f: number) =>
      setFractionState(clamp(f, PROMPT_MIN, PROMPT_MAX)),
    persist: () => {
      try {
        localStorage.setItem(PROMPT_FRACTION_KEY, String(ref.current))
      } catch {
        /* ignore persistence failures */
      }
    },
  }
}

/** A scene's multishot file sits next to its scene.fountain. */
function multishotPathForScene(scriptPath: string): string {
  return scriptPath.replace(/[^/]+$/, "multishot.backlot.json")
}

type EntityRoot =
  | { chatId: string; projectId?: undefined }
  | { chatId?: undefined; projectId: string }

// ──────────────────────────────────────────────────────────────────────────

export function MultishotSurface() {
  const chatId = useAtomValue(selectedAgentChatIdAtom)
  const selectedProject = useAtomValue(selectedProjectAtom)
  const entityRoot: EntityRoot | null = chatId
    ? { chatId }
    : selectedProject?.id
      ? { projectId: selectedProject.id }
      : null
  const entityRootKey = chatId
    ? `chat:${chatId}`
    : selectedProject?.id
      ? `project:${selectedProject.id}`
      : null

  if (!entityRoot || !entityRootKey) {
    return (
      <MultishotEmpty
        title="No project"
        message="Pick a project to work on a scene's multishot prompt."
      />
    )
  }
  return (
    <MultishotWorkspace entityRoot={entityRoot} entityRootKey={entityRootKey} />
  )
}

function MultishotWorkspace({
  entityRoot,
  entityRootKey,
}: {
  entityRoot: EntityRoot
  entityRootKey: string
}) {
  const hierarchy = trpc.entities.list.useQuery(entityRoot)
  const active = useAtomValue(activeEntityAtom)
  const scenes = hierarchy.data?.scenes ?? []
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null)

  // Follow the project tree's scene selection; otherwise keep a stable
  // pick and fall back to the first scene.
  useEffect(() => {
    if (scenes.length === 0) return
    const fromActive = (() => {
      if (active?.kind === "scene") {
        return scenes.find((s) => s.id === active.id)
      }
      // A clicked multishot.backlot.json — resolve back to its scene.
      if (active?.kind === "multishot") {
        const scenePath = active.path.replace(/[^/]+$/, "scene.fountain")
        return scenes.find(
          (s) =>
            s.scriptPath === scenePath ||
            multishotPathForScene(s.scriptPath) === active.path,
        )
      }
      return undefined
    })()
    if (fromActive) {
      if (selectedSceneId !== fromActive.id) setSelectedSceneId(fromActive.id)
      return
    }
    if (selectedSceneId && scenes.some((s) => s.id === selectedSceneId)) return
    setSelectedSceneId(scenes[0]!.id)
  }, [scenes, active, selectedSceneId])

  const scene = scenes.find((s) => s.id === selectedSceneId) ?? null

  if (hierarchy.isPending) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading scenes
      </div>
    )
  }

  if (scenes.length === 0) {
    return (
      <MultishotEmpty
        title="No scenes yet"
        message="Add scenes to your screenplay first — each scene gets its own multishot prompt."
      />
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {scene && (
        <SceneMultishotView
          key={`${entityRootKey}:${scene.id}`}
          entityRoot={entityRoot}
          sceneId={scene.id}
          sceneLabel={scene.label}
          sceneOrder={scene.order}
          scriptPath={scene.scriptPath}
          scenes={scenes.map((s) => ({
            id: s.id,
            label: s.label,
            order: s.order,
          }))}
          onSelectScene={setSelectedSceneId}
        />
      )}
    </div>
  )
}

interface SceneOption {
  id: string
  label: string
  order: number | null
}

function SceneMultishotView({
  entityRoot,
  sceneId,
  sceneLabel,
  sceneOrder,
  scriptPath,
  scenes,
  onSelectScene,
}: {
  entityRoot: EntityRoot
  sceneId: string
  sceneLabel: string
  sceneOrder: number | null
  scriptPath: string
  scenes: SceneOption[]
  onSelectScene: (id: string) => void
}) {
  const relPath = useMemo(() => multishotPathForScene(scriptPath), [scriptPath])
  const read = trpc.multishots.read.useQuery(
    { ...entityRoot, relPath },
    { refetchOnWindowFocus: true, refetchInterval: LIVE_POLL_MS },
  )
  const script = trpc.multishots.readScript.useQuery(
    { ...entityRoot, relPath: scriptPath },
    { refetchOnWindowFocus: true },
  )
  const write = trpc.multishots.write.useMutation({
    onError: (err) => toast.error(err.message || "Couldn't save multishot"),
  })

  const [doc, setDoc] = useState<SceneMultishot | null>(null)
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">(
    "idle",
  )
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const localEditAtRef = useRef(0)
  const { fraction, setFraction, persist } = usePromptFraction()

  // Pull server content into local state when the user is idle — a
  // mid-keystroke poll round-trip must not clobber the live draft.
  useEffect(() => {
    const incoming = read.data?.multishot ?? null
    if (!incoming) return
    if (Date.now() - localEditAtRef.current < 1000) return
    setDoc(incoming)
  }, [read.data?.multishot])

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [])

  const queueSave = (next: SceneMultishot) => {
    setDoc(next)
    localEditAtRef.current = Date.now()
    setSaveState("saving")
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      write.mutate(
        { ...entityRoot, relPath, multishot: next },
        {
          onSuccess: () => {
            setSaveState("saved")
            setTimeout(() => setSaveState("idle"), 1400)
          },
          onError: () => setSaveState("idle"),
        },
      )
    }, AUTOSAVE_MS)
  }

  const patchDoc = (patch: Partial<SceneMultishot>) => {
    if (!doc) return
    queueSave({ ...doc, ...patch, updatedAt: new Date().toISOString() })
  }

  /** Seed a fresh multishot — copy the scene's screenplay into the doc. */
  const startMultishot = () => {
    queueSave({
      schemaVersion: 1,
      sceneId,
      sceneNumber: sceneOrder != null ? String(sceneOrder) : "",
      heading: sceneLabel,
      scriptPath,
      screenplay: script.data?.text ?? "",
      promptVersions: [""],
      activeVersion: 0,
      text: "",
      status: "draft",
      updatedAt: new Date().toISOString(),
    })
  }

  /** Re-copy the live `scene.fountain` over the doc's working copy. */
  const reimportScreenplay = () => {
    if (!doc) return
    patchDoc({ screenplay: script.data?.text ?? "" })
    toast.success("Screenplay re-imported from scene.fountain")
  }

  const addToContext = () => {
    if (!doc) return
    const block = [
      `Scene ${doc.sceneNumber || sceneOrder || "?"} — ${
        doc.heading || sceneLabel
      } · Multishot prompt`,
      doc.screenplay ? `Screenplay:\n${doc.screenplay}` : "",
      doc.text ? `Prompt:\n${doc.text}` : "",
    ]
      .filter(Boolean)
      .join("\n\n")
    window.dispatchEvent(
      new CustomEvent("file-viewer-add-to-context", {
        detail: {
          text: block,
          source: { type: "file-viewer", filePath: relPath },
        },
      }),
    )
    toast.success("Multishot added to chat context")
  }

  const activeText = doc
    ? doc.promptVersions[clamp(doc.activeVersion, 0, doc.promptVersions.length - 1)] ?? ""
    : ""

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* ── Masthead — fixed, the surface's identity row. ─────────────── */}
      <header className="no-drag flex h-11 shrink-0 items-center gap-3 border-b border-border/70 px-4">
        <div className="flex shrink-0 items-center gap-2">
          <span className="h-3.5 w-[3px] rounded-full bg-primary" />
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            Multishot
          </span>
        </div>
        <Select value={sceneId} onValueChange={onSelectScene}>
          <SelectTrigger className="h-7 w-auto min-w-[230px] rounded-lg border-none bg-transparent px-1.5 shadow-none hover:bg-accent/60">
            <SelectValue placeholder="Select a scene" />
          </SelectTrigger>
          <SelectContent>
            {scenes.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  {s.order != null ? String(s.order).padStart(2, "0") : "—"}
                </span>
                <span className="ml-2">{s.label}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ml-auto flex shrink-0 items-center gap-3">
          <SaveState state={saveState} />
          {doc && (
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground/80">
              {activeText.length.toLocaleString()} chars
            </span>
          )}
        </div>
      </header>

      {/* ── Body ──────────────────────────────────────────────────────── */}
      {read.isPending && !doc ? (
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading multishot
        </div>
      ) : !doc ? (
        <MultishotSeed
          loading={script.isPending}
          hasScript={(script.data?.text ?? "").trim().length > 0}
          onStart={startMultishot}
        />
      ) : (
        <WorkArea
          doc={doc}
          promptFraction={fraction}
          onPromptFraction={setFraction}
          onPersistFraction={persist}
          onPatch={patchDoc}
          onReimport={reimportScreenplay}
          onAddToContext={addToContext}
        />
      )}
    </div>
  )
}

// ── Seed — the empty multishot state ──────────────────────────────────────

function MultishotSeed({
  loading,
  hasScript,
  onStart,
}: {
  loading: boolean
  hasScript: boolean
  onStart: () => void
}) {
  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading screenplay
      </div>
    )
  }
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-10 text-center">
      <p className="text-sm font-medium text-foreground">
        {hasScript
          ? "Start the multishot"
          : "This scene has no screenplay yet"}
      </p>
      <p className="mt-1.5 max-w-md text-sm leading-relaxed text-muted-foreground">
        {hasScript
          ? "Copy the scene's screenplay in as a working reference, then write one multi-shot prompt for the whole scene."
          : "Write the scene first. You can still start an empty multishot and draft the prompt by hand."}
      </p>
      <button
        type="button"
        onClick={onStart}
        className={cn(
          "press mt-6 inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2",
          "text-xs font-medium text-primary-foreground",
          GLASS_THUMB,
        )}
      >
        <Plus className="h-3.5 w-3.5" />
        Start a multishot
      </button>
    </div>
  )
}

// ── Work area — prompt | screenplay ───────────────────────────────────────

function WorkArea({
  doc,
  promptFraction,
  onPromptFraction,
  onPersistFraction,
  onPatch,
  onReimport,
  onAddToContext,
}: {
  doc: SceneMultishot
  promptFraction: number
  onPromptFraction: (fraction: number) => void
  onPersistFraction: () => void
  onPatch: (patch: Partial<SceneMultishot>) => void
  onReimport: () => void
  onAddToContext: () => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)

  const beginColResize = (e: React.PointerEvent) => {
    e.preventDefault()
    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const onMove = (ev: PointerEvent) => {
      const width = rect.width
      if (width <= 0) return
      const raw = (ev.clientX - rect.left) / width
      const lo = PROMPT_COL_MIN_PX / width
      const hi = 1 - SCREENPLAY_COL_MIN_PX / width
      onPromptFraction(lo <= hi ? clamp(raw, lo, hi) : (lo + hi) / 2)
    }
    const onUp = () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
      onPersistFraction()
    }
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
  }

  return (
    <div ref={containerRef} className="flex min-h-0 flex-1 px-6 pb-5 pt-3">
      <div
        className="flex min-w-0 shrink-0 flex-col"
        style={{ width: `calc(${promptFraction * 100}% - 7px)` }}
      >
        <PromptPane
          doc={doc}
          onPatch={onPatch}
          onAddToContext={onAddToContext}
        />
      </div>
      <PanelResizer onResize={beginColResize} />
      <div className="flex min-w-0 flex-1 flex-col">
        <ScreenplayPane
          value={doc.screenplay}
          onChange={(next) => onPatch({ screenplay: next })}
          onReimport={onReimport}
        />
      </div>
    </div>
  )
}

function PanelResizer({
  onResize,
}: {
  onResize: (e: React.PointerEvent) => void
}) {
  return (
    <div
      onPointerDown={onResize}
      role="separator"
      aria-orientation="vertical"
      className="group/resizer relative z-10 flex w-3.5 shrink-0 cursor-col-resize items-center justify-center self-stretch"
    >
      <span className="h-12 w-[3px] rounded-full bg-border transition-colors duration-150 group-hover/resizer:bg-primary group-active/resizer:bg-primary" />
    </div>
  )
}

// ── Prompt pane — the hero, boxless ───────────────────────────────────────

type PromptLang = "en" | "zh"

function PromptPane({
  doc,
  onPatch,
  onAddToContext,
}: {
  doc: SceneMultishot
  onPatch: (patch: Partial<SceneMultishot>) => void
  onAddToContext: () => void
}) {
  const versions =
    doc.promptVersions.length > 0 ? doc.promptVersions : [""]
  const active = clamp(doc.activeVersion, 0, versions.length - 1)
  const activeText = versions[active] ?? ""
  const zhText = doc.zh ?? ""
  const [lang, setLang] = useState<PromptLang>("en")
  const [copied, setCopied] = useState(false)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current)
    }
  }, [])

  const isZh = lang === "zh"
  const bodyText = isZh ? zhText : activeText

  /** Write a versions array back, keeping `text` synced to the active one. */
  const writeVersions = (next: string[], idx: number) => {
    const safe = next.length > 0 ? next : [""]
    const i = clamp(idx, 0, safe.length - 1)
    onPatch({ promptVersions: safe, activeVersion: i, text: safe[i] ?? "" })
  }
  const editBody = (value: string) => {
    if (isZh) {
      onPatch({ zh: value })
      return
    }
    const next = [...versions]
    next[active] = value
    writeVersions(next, active)
  }
  const selectVersion = (i: number) => writeVersions(versions, i)
  const addVersion = () => writeVersions([...versions, ""], versions.length)
  const deleteActiveVersion = () => {
    if (versions.length <= 1) return
    writeVersions(
      versions.filter((_, i) => i !== active),
      active > 0 ? active - 1 : 0,
    )
  }

  const copyPrompt = () => {
    if (!bodyText.trim()) return
    navigator.clipboard.writeText(bodyText)
    setCopied(true)
    if (copyTimer.current) clearTimeout(copyTimer.current)
    copyTimer.current = setTimeout(() => setCopied(false), 1600)
    toast.success(isZh ? "ZH prompt copied" : "Prompt copied")
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden pr-5">
      {/* ── Identity — status, the scene heading. ─────────────────────── */}
      <div className="flex shrink-0 items-center gap-2.5 pb-2">
        <StatusPicker
          value={doc.status}
          onChange={(status) => onPatch({ status })}
        />
        <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-foreground">
          {doc.heading || "Untitled scene"}
        </span>
        <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground/55">
          Multishot
        </span>
      </div>

      {/* ── Toolbar — language · version · actions. Wraps when cramped. ─── */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 pb-2.5">
        {/* Language */}
        <div className="flex h-7 shrink-0 items-center gap-0.5 rounded-lg bg-foreground/[0.06] p-0.5">
          {(["en", "zh"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setLang(option)}
              aria-pressed={lang === option}
              className={cn(
                "press inline-flex h-6 min-w-[30px] items-center justify-center rounded-md px-1.5",
                "font-mono text-[10px] font-semibold uppercase tracking-[0.08em] transition-colors",
                lang === option
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground/55 hover:text-foreground",
              )}
            >
              {option}
            </button>
          ))}
        </div>

        {/* Versions — English only; the ZH prompt is a single field. */}
        {!isZh && (
          <div className="flex min-w-0 shrink items-center gap-1">
            <div className="flex h-7 items-center gap-0.5 overflow-hidden rounded-lg bg-foreground/[0.06] p-0.5">
              {versions.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => selectVersion(i)}
                  aria-pressed={i === active}
                  className={cn(
                    "press inline-flex h-6 min-w-[28px] shrink-0 items-center justify-center rounded-md px-1.5",
                    "font-mono text-[10px] font-semibold transition-colors",
                    i === active
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground/55 hover:text-foreground",
                  )}
                >
                  v{i + 1}
                </button>
              ))}
              <button
                type="button"
                onClick={addVersion}
                title="New prompt version"
                className="press inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/55 transition-colors hover:bg-background/70 hover:text-foreground"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
            {versions.length > 1 && (
              <button
                type="button"
                onClick={deleteActiveVersion}
                title="Delete this version"
                className="press flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground/45 transition-colors hover:bg-destructive/10 hover:text-destructive"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <span
            title="Prompt length"
            className="mr-1.5 shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground/55"
          >
            {bodyText.length.toLocaleString()} chars
          </span>
          <button
            type="button"
            onClick={onAddToContext}
            title="Add this multishot to chat context"
            className="press flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground/65 transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
          >
            <MessageSquarePlus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={copyPrompt}
            title={isZh ? "Copy ZH prompt" : "Copy prompt"}
            className={cn(
              "press inline-flex h-7 items-center gap-1.5 rounded-lg bg-primary px-2.5",
              "text-[11px] font-semibold text-primary-foreground",
              GLASS_THUMB,
            )}
          >
            {copied ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>

      {/* Body — the prompt, capped to a readable measure. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <textarea
          value={bodyText}
          onChange={(e) => editBody(e.target.value)}
          spellCheck={!isZh}
          placeholder={
            isZh
              ? "Chinese (ZH) prompt — write it here…"
              : "Write the multi-shot generation prompt for this scene — one clip, several shots…"
          }
          className={cn(
            "mx-auto block h-full w-full max-w-[64ch] resize-none bg-transparent py-3 outline-none caret-primary",
            "text-[15px] leading-[1.8] text-foreground placeholder:text-muted-foreground/40",
          )}
        />
      </div>

      {/* Footer — quiet, mono. */}
      <div className="flex shrink-0 items-center justify-between border-t border-border/50 pt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/60">
        <span>
          {isZh ? "ZH prompt" : `Version ${active + 1} of ${versions.length}`}
        </span>
        <span className="tabular-nums">
          {bodyText.length.toLocaleString()} chars
        </span>
      </div>
    </div>
  )
}

// ── Screenplay pane — the working copy, read-and-revise ───────────────────

function ScreenplayPane({
  value,
  onChange,
  onReimport,
}: {
  value: string
  onChange: (next: string) => void
  onReimport: () => void
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden pl-5">
      {/* Header — label + re-import. Mirrors the prompt pane's identity row. */}
      <div className="flex shrink-0 items-center gap-2.5 pb-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground/55">
          Screenplay
        </span>
        <span className="text-[11px] text-muted-foreground/45">
          working copy
        </span>
        <button
          type="button"
          onClick={onReimport}
          title="Re-copy the live scene.fountain over this working copy"
          className="press ml-auto flex h-7 items-center gap-1.5 rounded-lg px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/65 transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Sync
        </button>
      </div>

      {/* Body — the Fountain editor on the open canvas. */}
      <div className="min-h-0 flex-1 overflow-hidden">
        <FountainSourceEditor value={value} onChange={onChange} />
      </div>
    </div>
  )
}

// ── Shared bits ───────────────────────────────────────────────────────────

function StatusPicker({
  value,
  onChange,
}: {
  value: ShotStatus
  onChange: (value: ShotStatus) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        title={`Status: ${value}`}
        className={cn(
          "press flex h-5 w-5 items-center justify-center rounded-md outline-none",
          "hover:bg-foreground/[0.06] focus-visible:ring-2 focus-visible:ring-ring/40",
        )}
      >
        <span
          className={cn("h-2 w-2 shrink-0 rounded-full", STATUS_DOT[value])}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[150px]">
        {STATUS_OPTIONS.map((status) => (
          <DropdownMenuItem
            key={status}
            onSelect={() => onChange(status)}
            className="gap-2"
          >
            <span
              className={cn(
                "h-1.5 w-1.5 shrink-0 rounded-full",
                STATUS_DOT[status],
              )}
            />
            <span className="font-mono text-[11px] uppercase tracking-wide">
              {status}
            </span>
            {status === value && (
              <Check className="ml-auto h-3.5 w-3.5 text-muted-foreground" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function SaveState({ state }: { state: "idle" | "saving" | "saved" }) {
  if (state === "saving") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        Saving
      </span>
    )
  }
  if (state === "saved") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
        <Check className="h-3 w-3" />
        Saved
      </span>
    )
  }
  return null
}

function MultishotEmpty({
  title,
  message,
}: {
  title: string
  message: string
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-10 text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted-foreground">
        {message}
      </p>
    </div>
  )
}
