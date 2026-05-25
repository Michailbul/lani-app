"use client"

/**
 * MultishotSurface — Lani's "Multishot" workflow mode.
 *
 * A file-backed sibling of the Shotlist surface. Where a Shotlist cuts a
 * scene into many Parts each with its own prompt, a Multishot keeps the
 * scene whole: one multi-shot generation prompt — the "MULTI-SHOT, 12s —
 * Shot 1… Shot 2…" form, where one clip covers several shots.
 *
 * A multishot holds several **versions**. Each version is a complete
 * take: its own prompt *and* its own division of the screenplay into
 * contiguous parts (the same divider model as a Shotlist). Clicking
 * v1 / v2 swaps both the prompt and the screenplay split.
 *
 *   ┌── masthead — lime tick · "Multishot" · scene Select · save state ──┐
 *   │                                                                    │
 *   │  ┌── Prompt (hero) ──────┬── Screenplay (divided) ──────────────┐  │
 *   │  │  status · v1 v2 v3    │  Fountain editor cut into parts by   │  │
 *   │  │  EN / ZH · refs       │  dividers — split / carve / merge    │  │
 *   │  │  the prompt body      │                                      │  │
 *   │  └───────────────────────┴──────────────────────────────────────┘  │
 *   └────────────────────────────────────────────────────────────────────┘
 *
 * One scene = one `multishot.lani.json` next to its `scene.fountain`.
 * Edits autosave (debounced) through the `multishots` tRPC router, which
 * checkpoints each settled edit into git.
 */

import { useEffect, useMemo, useRef, useState } from "react"
import { useAtom, useAtomValue } from "jotai"
import {
  Check,
  Copy,
  FileDown,
  ImagePlus,
  Loader2,
  MessageSquarePlus,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  RotateCcw,
  X,
} from "lucide-react"
import { toast } from "sonner"
import type {
  MultishotVersion,
  SceneMultishot,
  ShotStatus,
} from "../../../shared/multishot-types"
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
import {
  activeEntityAtom,
  selectedSceneIdAtom,
  type ActiveEntity,
} from "./atoms"
import {
  type ScreenplayPart,
  ShotlistScreenplay,
  useStableScreenplayParts,
} from "./shotlist-screenplay"
import { ShotlistSubmodeToggle } from "./shotlist-submode-toggle"

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

const PROMPT_FRACTION_KEY = "lani:multishot:prompt-fraction:v1"
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

// ── Screenplay panel — collapsible, its open state persisted ──────────────

const SCREENPLAY_OPEN_KEY = "lani:multishot:screenplay-open:v1"

/** Whether the screenplay division panel is shown. Persisted. */
function useScreenplayOpen() {
  const [open, setOpenState] = useState<boolean>(() => {
    try {
      return localStorage.getItem(SCREENPLAY_OPEN_KEY) !== "0"
    } catch {
      return true
    }
  })
  return {
    open,
    setOpen: (next: boolean) => {
      setOpenState(next)
      try {
        localStorage.setItem(SCREENPLAY_OPEN_KEY, next ? "1" : "0")
      } catch {
        /* ignore persistence failures */
      }
    },
  }
}

/** Stream a project file to the renderer over the lani-asset:// scheme. */
function assetUrl(absPath: string): string {
  return `lani-asset://asset/?p=${encodeURIComponent(absPath)}`
}

/** A scene's multishot file sits next to its scene.fountain. */
function multishotPathForScene(scriptPath: string): string {
  return scriptPath.replace(/[^/]+$/, "multishot.lani.json")
}

/** Resolve which scene the active project-tree entity points at, if any. */
function sceneFromActive<T extends { id: string; scriptPath: string }>(
  active: ActiveEntity,
  scenes: T[],
): T | null {
  if (!active) return null
  if (active.kind === "scene") {
    return scenes.find((s) => s.id === active.id) ?? null
  }
  // A clicked multishot.lani.json — resolve back to its scene.
  if (active.kind === "multishot") {
    const scenePath = active.path.replace(/[^/]+$/, "scene.fountain")
    return (
      scenes.find(
        (s) =>
          s.scriptPath === scenePath ||
          multishotPathForScene(s.scriptPath) === active.path,
      ) ?? null
    )
  }
  return null
}

/** A fresh version — an empty prompt over a given screenplay division. */
function emptyVersion(scriptParts: string[]): MultishotVersion {
  return { prompt: "", scriptParts: scriptParts.length > 0 ? scriptParts : [""] }
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
  const [pickedSceneId, setPickedSceneId] = useAtom(selectedSceneIdAtom)
  const lastActivePathRef = useRef<string | null>(active?.path ?? null)

  // Follow the project tree: when the active entity *changes* to one that
  // resolves to a scene (a scene file, or a multishot.lani.json), jump
  // the surface to it. A change only — a stable `active` never overrides
  // the writer's own pick from the scene selector.
  useEffect(() => {
    const path = active?.path ?? null
    if (path === lastActivePathRef.current) return
    lastActivePathRef.current = path
    const fromActive = sceneFromActive(active, scenes)
    if (fromActive) setPickedSceneId(fromActive.id)
  }, [active, scenes])

  // Resolve the scene to render: the writer's explicit pick → the active
  // entity's scene → the only scene. Otherwise null — show the picker.
  const scene = useMemo(() => {
    if (pickedSceneId) {
      const s = scenes.find((x) => x.id === pickedSceneId)
      if (s) return s
    }
    const fromActive = sceneFromActive(active, scenes)
    if (fromActive) return fromActive
    return scenes.length === 1 ? (scenes[0] ?? null) : null
  }, [scenes, active, pickedSceneId])

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

  const sceneOptions: SceneOption[] = scenes.map((s) => ({
    id: s.id,
    label: s.label,
    order: s.order,
  }))

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {scene ? (
        <SceneMultishotView
          key={`${entityRootKey}:${scene.id}`}
          entityRoot={entityRoot}
          sceneId={scene.id}
          sceneLabel={scene.label}
          sceneOrder={scene.order}
          scriptPath={scene.scriptPath}
          scenes={sceneOptions}
          onSelectScene={setPickedSceneId}
        />
      ) : (
        <ScenePicker
          mode="Multishot"
          blurb="Each scene keeps its own multishot prompt."
          scenes={sceneOptions}
          onPick={setPickedSceneId}
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
  const addReferences = trpc.multishots.addReferenceImages.useMutation()

  const [doc, setDoc] = useState<SceneMultishot | null>(null)
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">(
    "idle",
  )
  // The screenplay part the caret sits in — drives the editor's highlight
  // and where the caret lands after a structural change.
  const [regionIndex, setRegionIndex] = useState(0)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const localEditAtRef = useRef(0)
  const { fraction, setFraction, persist } = usePromptFraction()
  const { open: screenplayOpen, setOpen: setScreenplayOpen } =
    useScreenplayOpen()

  // Undo stack for structural edits only (split / merge / carve). Cmd+Z
  // reverts the last one as long as nothing else happened since.
  const rootRef = useRef<HTMLDivElement | null>(null)
  const undoStackRef = useRef<
    { snapshot: SceneMultishot; prevWasStructural: boolean }[]
  >([])
  const lastWasStructuralRef = useRef(false)
  const undoStructuralRef = useRef<() => void>(() => {})

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

  /** Snapshot the doc before a structural edit so Cmd+Z can revert it. */
  const pushStructuralUndo = () => {
    if (!doc) return
    undoStackRef.current.push({
      snapshot: doc,
      prevWasStructural: lastWasStructuralRef.current,
    })
    if (undoStackRef.current.length > 30) undoStackRef.current.shift()
    lastWasStructuralRef.current = true
  }

  const undoStructural = () => {
    const entry = undoStackRef.current.pop()
    if (!entry) return
    queueSave(entry.snapshot)
    lastWasStructuralRef.current = entry.prevWasStructural
    toast.success("Reverted")
  }
  undoStructuralRef.current = undoStructural

  // Cmd/Ctrl+Z reverts the last split/merge — but only while a structural
  // edit is the most recent thing and focus is inside the Multishot
  // surface, so it never steals undo from screenplay or prompt editing.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.key !== "z" && e.key !== "Z") || e.shiftKey || e.altKey) return
      if (!(e.metaKey || e.ctrlKey)) return
      if (!lastWasStructuralRef.current) return
      if (undoStackRef.current.length === 0) return
      const root = rootRef.current
      if (!root || !root.contains(document.activeElement)) return
      e.preventDefault()
      e.stopPropagation()
      undoStructuralRef.current()
    }
    window.addEventListener("keydown", onKeyDown, true)
    return () => window.removeEventListener("keydown", onKeyDown, true)
  }, [])

  /** Commit a new doc. `structural` edits snapshot for Cmd+Z. */
  const applyDoc = (next: SceneMultishot, structural: boolean) => {
    if (structural) pushStructuralUndo()
    else lastWasStructuralRef.current = false
    queueSave({ ...next, updatedAt: new Date().toISOString() })
  }

  const activeIndex = doc
    ? clamp(doc.activeVersion, 0, doc.versions.length - 1)
    : 0
  const activeVersion: MultishotVersion | null = doc
    ? (doc.versions[activeIndex] ?? null)
    : null

  /** Replace the active version with a patch. */
  const patchActiveVersion = (
    patch: Partial<MultishotVersion>,
    structural = false,
  ) => {
    if (!doc || !activeVersion) return
    const versions = doc.versions.map((v, i) =>
      i === activeIndex ? { ...v, ...patch } : v,
    )
    applyDoc({ ...doc, versions }, structural)
  }

  /** Seed a fresh multishot — one version over the scene's screenplay. */
  const startMultishot = () => {
    queueSave({
      schemaVersion: 1,
      sceneId,
      sceneNumber: sceneOrder != null ? String(sceneOrder) : "",
      heading: sceneLabel,
      scriptPath,
      versions: [emptyVersion([script.data?.text ?? ""])],
      activeVersion: 0,
      referenceImages: [],
      status: "draft",
      updatedAt: new Date().toISOString(),
    })
    setRegionIndex(0)
  }

  // ── Version operations — each version owns a prompt + a screenplay split ──

  const selectVersion = (i: number) => {
    if (!doc) return
    const next = clamp(i, 0, doc.versions.length - 1)
    if (next === activeIndex) return
    setRegionIndex(0)
    applyDoc({ ...doc, activeVersion: next }, false)
  }

  /** Add a version — a blank prompt over a copy of the current split. */
  const addVersion = () => {
    if (!doc || !activeVersion) return
    const fresh = emptyVersion([...activeVersion.scriptParts])
    setRegionIndex(0)
    applyDoc(
      {
        ...doc,
        versions: [...doc.versions, fresh],
        activeVersion: doc.versions.length,
      },
      false,
    )
  }

  const deleteActiveVersion = () => {
    if (!doc || doc.versions.length <= 1) return
    const versions = doc.versions.filter((_, i) => i !== activeIndex)
    setRegionIndex(0)
    applyDoc(
      {
        ...doc,
        versions,
        activeVersion: activeIndex > 0 ? activeIndex - 1 : 0,
      },
      false,
    )
  }

  // ── Screenplay division — split / carve / merge the active version ───────

  /** Place a divider: cut the part at `shotId` at `caret` into two. */
  const splitPart = (shotId: string, caret: number) => {
    if (!activeVersion) return
    const i = Number(shotId)
    const parts = activeVersion.scriptParts
    const text = parts[i]
    if (text == null || caret <= 0 || caret >= text.length) return
    const next = [
      ...parts.slice(0, i),
      text.slice(0, caret),
      text.slice(caret),
      ...parts.slice(i + 1),
    ]
    setRegionIndex(i + 1)
    patchActiveVersion({ scriptParts: next }, true)
  }

  /** Carve a selected stretch of a part into its own part. */
  const carvePart = (shotId: string, start: number, end: number) => {
    if (!activeVersion) return
    const i = Number(shotId)
    const parts = activeVersion.scriptParts
    const text = parts[i]
    if (text == null) return
    const a = clamp(start, 0, text.length)
    const b = clamp(end, 0, text.length)
    if (b <= a) return
    const segments: string[] = []
    if (a > 0) segments.push(text.slice(0, a))
    segments.push(text.slice(a, b))
    if (b < text.length) segments.push(text.slice(b))
    if (segments.length < 2) return
    const next = [...parts.slice(0, i), ...segments, ...parts.slice(i + 1)]
    setRegionIndex(i + (a > 0 ? 1 : 0))
    patchActiveVersion({ scriptParts: next }, true)
  }

  /** Remove the divider after part `index` — merge the next part up. */
  const mergeAt = (index: number) => {
    if (!activeVersion) return
    const parts = activeVersion.scriptParts
    if (index < 0 || index >= parts.length - 1) return
    const next = [
      ...parts.slice(0, index),
      (parts[index] ?? "") + (parts[index + 1] ?? ""),
      ...parts.slice(index + 2),
    ]
    setRegionIndex(clamp(index, 0, next.length - 1))
    patchActiveVersion({ scriptParts: next }, true)
  }

  /** Persist a screenplay edit — slices align 1:1 with the current parts. */
  const applyScriptSlices = (slices: string[]) => {
    if (!activeVersion) return
    if (slices.length !== activeVersion.scriptParts.length) return
    const same = slices.every((s, i) => s === activeVersion.scriptParts[i])
    if (same) return
    patchActiveVersion({ scriptParts: slices }, false)
  }

  /** Re-copy the live `scene.fountain` over the active version, undivided. */
  const reimportScreenplay = () => {
    if (!activeVersion) return
    setRegionIndex(0)
    patchActiveVersion({ scriptParts: [script.data?.text ?? ""] }, false)
    toast.success("Screenplay re-imported from scene.fountain")
  }

  /** Open the native picker, copy images in, append their paths. */
  const addReferenceImages = async () => {
    if (!doc) return
    try {
      const result = await addReferences.mutateAsync({ ...entityRoot, relPath })
      if (result.added.length === 0) return
      const existing = doc.referenceImages ?? []
      const merged = [
        ...existing,
        ...result.added.filter((p) => !existing.includes(p)),
      ]
      applyDoc({ ...doc, referenceImages: merged }, false)
      toast.success(
        result.added.length === 1
          ? "Reference image added"
          : `${result.added.length} reference images added`,
      )
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't add reference images",
      )
    }
  }

  const removeReferenceImage = (path: string) => {
    if (!doc) return
    applyDoc(
      {
        ...doc,
        referenceImages: (doc.referenceImages ?? []).filter((p) => p !== path),
      },
      false,
    )
  }

  const addToContext = () => {
    if (!doc || !activeVersion) return
    const screenplay = activeVersion.scriptParts.join("")
    const block = [
      `Scene ${doc.sceneNumber || sceneOrder || "?"} — ${
        doc.heading || sceneLabel
      } · Multishot prompt (v${activeIndex + 1})`,
      screenplay ? `Screenplay:\n${screenplay}` : "",
      activeVersion.prompt ? `Prompt:\n${activeVersion.prompt}` : "",
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

  // Ephemeral "parts" for the divider editor — index-keyed slices of the
  // active version's screenplay. Stabilized by content (id + scriptRef)
  // so a fresh `scriptParts` array with identical text doesn't re-seed
  // the CodeMirror editor. The .map allocates per render, but the hook
  // returns the prior reference when content matches, so the downstream
  // reseed effect's dep check short-circuits.
  const screenplayParts: ScreenplayPart[] = useStableScreenplayParts(
    (activeVersion?.scriptParts ?? [""]).map((text, i) => ({
      id: String(i),
      scriptRef: text,
    })),
  )

  return (
    <div ref={rootRef} className="flex min-h-0 flex-1 flex-col">
      {/* ── Masthead — fixed, the surface's identity row. ─────────────── */}
      <header className="no-drag flex h-11 shrink-0 items-center gap-3 border-b border-border/70 px-4">
        <div className="flex shrink-0 items-center gap-2.5">
          <span className="h-3.5 w-[3px] rounded-full bg-primary" />
          <ShotlistSubmodeToggle />
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
          {activeVersion && (
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground/80">
              {activeVersion.prompt.length.toLocaleString()} chars
            </span>
          )}
          {doc && (
            <>
              <span className="h-4 w-px bg-border" />
              <button
                type="button"
                onClick={() => setScreenplayOpen(!screenplayOpen)}
                aria-pressed={screenplayOpen}
                title={screenplayOpen ? "Hide screenplay" : "Show screenplay"}
                className={cn(
                  "press flex h-7 items-center gap-1.5 rounded-lg px-2",
                  "font-mono text-[10px] font-semibold uppercase tracking-[0.1em]",
                  "transition-colors",
                  screenplayOpen
                    ? "bg-foreground/[0.06] text-foreground"
                    : "text-muted-foreground/65 hover:bg-foreground/[0.06] hover:text-foreground",
                )}
              >
                {screenplayOpen ? (
                  <PanelRightClose className="h-3.5 w-3.5" />
                ) : (
                  <PanelRightOpen className="h-3.5 w-3.5" />
                )}
                Screenplay
              </button>
            </>
          )}
        </div>
      </header>

      {/* ── Body ──────────────────────────────────────────────────────── */}
      {read.isPending && !doc ? (
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading multishot
        </div>
      ) : !doc || !activeVersion ? (
        <MultishotSeed
          loading={script.isPending}
          hasScript={(script.data?.text ?? "").trim().length > 0}
          onStart={startMultishot}
        />
      ) : (
        <WorkArea
          doc={doc}
          activeIndex={activeIndex}
          activeVersion={activeVersion}
          entityRoot={entityRoot}
          screenplayOpen={screenplayOpen}
          screenplayParts={screenplayParts}
          regionIndex={clamp(regionIndex, 0, screenplayParts.length - 1)}
          promptFraction={fraction}
          onPromptFraction={setFraction}
          onPersistFraction={persist}
          onStatus={(status) => applyDoc({ ...doc, status }, false)}
          onEditPrompt={(prompt) => patchActiveVersion({ prompt })}
          onEditZh={(zh) => patchActiveVersion({ zh })}
          onSelectVersion={selectVersion}
          onAddVersion={addVersion}
          onDeleteVersion={deleteActiveVersion}
          onSelectRegion={(id) => setRegionIndex(Number(id))}
          onEditSlices={applyScriptSlices}
          onSplit={splitPart}
          onCarve={carvePart}
          onMerge={mergeAt}
          onReimport={reimportScreenplay}
          onCloseScreenplay={() => setScreenplayOpen(false)}
          onAddToContext={addToContext}
          onAddReferences={addReferenceImages}
          onRemoveReference={removeReferenceImage}
          addingReferences={addReferences.isPending}
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
        {hasScript ? "Start the multishot" : "This scene has no screenplay yet"}
      </p>
      <p className="mt-1.5 max-w-md text-sm leading-relaxed text-muted-foreground">
        {hasScript
          ? "Bring the scene's screenplay in, drop dividers to map out the shots, then write one multi-shot prompt for the whole scene."
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
        {hasScript ? (
          <FileDown className="h-3.5 w-3.5" />
        ) : (
          <Plus className="h-3.5 w-3.5" />
        )}
        Start a multishot
      </button>
    </div>
  )
}

// ── Work area — prompt | screenplay ───────────────────────────────────────

function WorkArea({
  doc,
  activeIndex,
  activeVersion,
  entityRoot,
  screenplayOpen,
  screenplayParts,
  regionIndex,
  promptFraction,
  onPromptFraction,
  onPersistFraction,
  onStatus,
  onEditPrompt,
  onEditZh,
  onSelectVersion,
  onAddVersion,
  onDeleteVersion,
  onSelectRegion,
  onEditSlices,
  onSplit,
  onCarve,
  onMerge,
  onReimport,
  onCloseScreenplay,
  onAddToContext,
  onAddReferences,
  onRemoveReference,
  addingReferences,
}: {
  doc: SceneMultishot
  activeIndex: number
  activeVersion: MultishotVersion
  entityRoot: EntityRoot
  screenplayOpen: boolean
  screenplayParts: ScreenplayPart[]
  regionIndex: number
  promptFraction: number
  onPromptFraction: (fraction: number) => void
  onPersistFraction: () => void
  onStatus: (status: ShotStatus) => void
  onEditPrompt: (value: string) => void
  onEditZh: (value: string) => void
  onSelectVersion: (i: number) => void
  onAddVersion: () => void
  onDeleteVersion: () => void
  onSelectRegion: (id: string) => void
  onEditSlices: (slices: string[]) => void
  onSplit: (shotId: string, caret: number) => void
  onCarve: (shotId: string, start: number, end: number) => void
  onMerge: (index: number) => void
  onReimport: () => void
  onCloseScreenplay: () => void
  onAddToContext: () => void
  onAddReferences: () => void
  onRemoveReference: (path: string) => void
  addingReferences: boolean
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

  const prompt = (
    <PromptPane
      doc={doc}
      activeIndex={activeIndex}
      activeVersion={activeVersion}
      entityRoot={entityRoot}
      solo={!screenplayOpen}
      onStatus={onStatus}
      onEditPrompt={onEditPrompt}
      onEditZh={onEditZh}
      onSelectVersion={onSelectVersion}
      onAddVersion={onAddVersion}
      onDeleteVersion={onDeleteVersion}
      onAddToContext={onAddToContext}
      onAddReferences={onAddReferences}
      onRemoveReference={onRemoveReference}
      addingReferences={addingReferences}
    />
  )

  // Screenplay collapsed — the prompt is the whole surface.
  if (!screenplayOpen) {
    return (
      <div className="flex min-h-0 flex-1 px-6 pb-5 pt-3">
        <div className="flex min-w-0 flex-1 flex-col">{prompt}</div>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="flex min-h-0 flex-1 px-6 pb-5 pt-3">
      <div
        className="flex min-w-0 shrink-0 flex-col"
        style={{ width: `calc(${promptFraction * 100}% - 7px)` }}
      >
        {prompt}
      </div>
      <PanelResizer onResize={beginColResize} />
      <div className="flex min-w-0 flex-1 flex-col">
        <ShotlistScreenplay
          key={`version-${activeIndex}`}
          parts={screenplayParts}
          activeIndex={regionIndex}
          onSelect={onSelectRegion}
          onEditSlices={onEditSlices}
          onSplit={onSplit}
          onCarve={onCarve}
          onMerge={onMerge}
          headerSlot={
            <div className="ml-1.5 flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                onClick={onReimport}
                title="Re-copy the live scene.fountain over this version"
                className="press flex h-6 items-center gap-1 rounded-md px-1.5 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/65 transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
              >
                <RotateCcw className="h-3 w-3" />
                Sync
              </button>
              <button
                type="button"
                onClick={onCloseScreenplay}
                title="Hide screenplay"
                className="press flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/55 transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
              >
                <PanelRightClose className="h-3 w-3" />
              </button>
            </div>
          }
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
  activeIndex,
  activeVersion,
  entityRoot,
  solo,
  onStatus,
  onEditPrompt,
  onEditZh,
  onSelectVersion,
  onAddVersion,
  onDeleteVersion,
  onAddToContext,
  onAddReferences,
  onRemoveReference,
  addingReferences,
}: {
  doc: SceneMultishot
  activeIndex: number
  activeVersion: MultishotVersion
  entityRoot: EntityRoot
  solo: boolean
  onStatus: (status: ShotStatus) => void
  onEditPrompt: (value: string) => void
  onEditZh: (value: string) => void
  onSelectVersion: (i: number) => void
  onAddVersion: () => void
  onDeleteVersion: () => void
  onAddToContext: () => void
  onAddReferences: () => void
  onRemoveReference: (path: string) => void
  addingReferences: boolean
}) {
  const versionCount = doc.versions.length
  const zhText = activeVersion.zh ?? ""
  const [lang, setLang] = useState<PromptLang>("en")
  const [copied, setCopied] = useState(false)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current)
    }
  }, [])

  const isZh = lang === "zh"
  const bodyText = isZh ? zhText : activeVersion.prompt

  const copyPrompt = () => {
    if (!bodyText.trim()) return
    navigator.clipboard.writeText(bodyText)
    setCopied(true)
    if (copyTimer.current) clearTimeout(copyTimer.current)
    copyTimer.current = setTimeout(() => setCopied(false), 1600)
    toast.success(isZh ? "ZH prompt copied" : "Prompt copied")
  }

  return (
    <div
      className={cn(
        "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
        !solo && "pr-5",
      )}
    >
      {/* ── Identity — status, the scene heading. ─────────────────────── */}
      <div className="flex shrink-0 items-center gap-2.5 pb-2">
        <StatusPicker value={doc.status} onChange={onStatus} />
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

        {/* Versions — each carries its own prompt + screenplay split. */}
        <div className="flex min-w-0 shrink items-center gap-1">
          <div className="flex h-7 items-center gap-0.5 overflow-hidden rounded-lg bg-foreground/[0.06] p-0.5">
            {doc.versions.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => onSelectVersion(i)}
                aria-pressed={i === activeIndex}
                title={`Version ${i + 1} — its own prompt and screenplay split`}
                className={cn(
                  "press inline-flex h-6 min-w-[28px] shrink-0 items-center justify-center rounded-md px-1.5",
                  "font-mono text-[10px] font-semibold transition-colors",
                  i === activeIndex
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground/55 hover:text-foreground",
                )}
              >
                v{i + 1}
              </button>
            ))}
            <button
              type="button"
              onClick={onAddVersion}
              title="New version — copies this screenplay split, blank prompt"
              className="press inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/55 transition-colors hover:bg-background/70 hover:text-foreground"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
          {versionCount > 1 && (
            <button
              type="button"
              onClick={onDeleteVersion}
              title="Delete this version"
              className="press flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground/45 transition-colors hover:bg-destructive/10 hover:text-destructive"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

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

      {/* Reference images — the scene's input stills, shared by versions. */}
      <ReferenceStrip
        entityRoot={entityRoot}
        images={doc.referenceImages ?? []}
        adding={addingReferences}
        onAdd={onAddReferences}
        onRemove={onRemoveReference}
      />

      {/* Body — the prompt, capped to a readable measure. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <textarea
          value={bodyText}
          onChange={(e) =>
            isZh ? onEditZh(e.target.value) : onEditPrompt(e.target.value)
          }
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
          {isZh ? "ZH prompt" : `Version ${activeIndex + 1} of ${versionCount}`}
        </span>
        <span className="tabular-nums">
          {bodyText.length.toLocaleString()} chars
        </span>
      </div>
    </div>
  )
}

// ── Reference images — the scene's input stills ───────────────────────────

function ReferenceStrip({
  entityRoot,
  images,
  adding,
  onAdd,
  onRemove,
}: {
  entityRoot: EntityRoot
  images: string[]
  adding: boolean
  onAdd: () => void
  onRemove: (path: string) => void
}) {
  return (
    <div className="flex shrink-0 items-center gap-2.5 pb-2.5">
      <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground/45">
        Refs
      </span>
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto py-0.5">
        {images.map((path) => (
          <ReferenceThumb
            key={path}
            entityRoot={entityRoot}
            path={path}
            onRemove={() => onRemove(path)}
          />
        ))}
        <button
          type="button"
          onClick={onAdd}
          disabled={adding}
          title="Add reference images"
          className={cn(
            "press flex h-14 w-14 shrink-0 items-center justify-center rounded-lg",
            "border border-dashed border-border text-muted-foreground/55",
            "transition-colors hover:border-primary/60 hover:bg-foreground/[0.04] hover:text-foreground",
            "disabled:pointer-events-none disabled:opacity-50",
          )}
        >
          {adding ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ImagePlus className="h-4 w-4" />
          )}
        </button>
        {images.length === 0 && !adding && (
          <span className="shrink-0 pl-0.5 text-[11px] text-muted-foreground/45">
            Add input / reference images
          </span>
        )}
      </div>
    </div>
  )
}

function ReferenceThumb({
  entityRoot,
  path,
  onRemove,
}: {
  entityRoot: EntityRoot
  path: string
  onRemove: () => void
}) {
  const resolved = trpc.entities.resolvePath.useQuery(
    { ...entityRoot, entityPath: path },
    { staleTime: 60_000 },
  )
  const name = path.split("/").pop() ?? path
  const url = resolved.data?.absPath ? assetUrl(resolved.data.absPath) : null

  return (
    <div
      title={name}
      className="group/thumb relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-foreground/[0.04] ring-1 ring-border/70"
    >
      {url ? (
        <img
          src={url}
          alt={name}
          draggable={false}
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-muted-foreground/35">
          <ImagePlus className="h-4 w-4" />
        </div>
      )}
      <button
        type="button"
        onClick={onRemove}
        title="Remove reference"
        className={cn(
          "absolute right-0.5 top-0.5 grid h-4 w-4 place-items-center rounded-full",
          "bg-background/85 text-foreground/70 opacity-0 transition-opacity",
          "group-hover/thumb:opacity-100 hover:bg-destructive hover:text-white",
        )}
      >
        <X className="h-2.5 w-2.5" />
      </button>
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

// ── Scene picker — the mode's landing page when no scene is in context ────

function ScenePicker({
  mode,
  blurb,
  scenes,
  onPick,
}: {
  mode: string
  blurb: string
  scenes: SceneOption[]
  onPick: (id: string) => void
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-10">
      <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground/60">
        {mode}
      </span>
      <p className="mt-2 text-sm font-medium text-foreground">Pick a scene</p>
      <p className="mt-1 max-w-sm text-center text-sm leading-relaxed text-muted-foreground">
        {blurb}
      </p>
      <div className="mt-5 flex w-full max-w-sm flex-col gap-1">
        {scenes.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onPick(s.id)}
            className={cn(
              "press flex items-center gap-3 rounded-lg border border-border/70 px-3 py-2.5 text-left",
              "transition-colors hover:border-border hover:bg-foreground/[0.04]",
            )}
          >
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              {s.order != null ? String(s.order).padStart(2, "0") : "—"}
            </span>
            <span className="min-w-0 flex-1 truncate text-[13.5px] text-foreground">
              {s.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
