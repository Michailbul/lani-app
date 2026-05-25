"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useAtom, useAtomValue } from "jotai"
import {
  Braces,
  Check,
  Copy,
  FileDown,
  ImagePlus,
  Languages,
  ListPlus,
  Loader2,
  MessageSquarePlus,
  Plus,
  X,
} from "lucide-react"
import { toast } from "sonner"
import type {
  SceneShotlist,
  ShotPrompt,
  ShotStatus,
} from "../../../shared/shotlist-types"
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

// The raised liquid-glass thumb — lifted straight from the workflow
// ModeDock so the Shotlist's lime controls speak the same glass
// language: a kiwi switch that catches the light from every edge.
const GLASS_THUMB =
  "shadow-[0_0_6px_rgba(0,0,0,0.03),0_2px_6px_rgba(0,0,0,0.08),inset_3px_3px_0.5px_-3px_rgba(0,0,0,0.9),inset_-3px_-3px_0.5px_-3px_rgba(0,0,0,0.85),inset_1px_1px_1px_-0.5px_rgba(0,0,0,0.6),inset_-1px_-1px_1px_-0.5px_rgba(0,0,0,0.6),inset_0_0_6px_6px_rgba(0,0,0,0.12),inset_0_0_2px_2px_rgba(0,0,0,0.06),0_0_12px_rgba(255,255,255,0.15)] " +
  "dark:shadow-[0_0_8px_rgba(0,0,0,0.03),0_2px_6px_rgba(0,0,0,0.08),inset_3px_3px_0.5px_-3.5px_rgba(255,255,255,0.09),inset_-3px_-3px_0.5px_-3.5px_rgba(255,255,255,0.85),inset_1px_1px_1px_-0.5px_rgba(255,255,255,0.6),inset_-1px_-1px_1px_-0.5px_rgba(255,255,255,0.6),inset_0_0_6px_6px_rgba(255,255,255,0.12),inset_0_0_2px_2px_rgba(255,255,255,0.06),0_0_12px_rgba(0,0,0,0.15)]"

// ── Prompt / screenplay split — a single persisted fraction ───────────────

const PROMPT_FRACTION_KEY = "lani:shotlist:prompt-fraction:v1"
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

// ── Prompt versions ───────────────────────────────────────────────────────

/** Normalise a Part into its version list — legacy parts have one. */
function readVersions(shot: ShotPrompt): { versions: string[]; active: number } {
  const versions =
    shot.promptVersions && shot.promptVersions.length > 0
      ? shot.promptVersions
      : [shot.prompt ?? ""]
  let active = shot.activeVersion ?? 0
  if (!Number.isInteger(active) || active < 0 || active >= versions.length) {
    active = 0
  }
  return { versions, active }
}

/** A Part patch that writes a versions array and keeps `prompt` in sync. */
function versionPatch(versions: string[], active: number): Partial<ShotPrompt> {
  const safe = versions.length > 0 ? versions : [""]
  const idx = clamp(active, 0, safe.length - 1)
  return {
    promptVersions: safe,
    activeVersion: idx,
    prompt: safe[idx] ?? "",
  }
}

/** A scene's shotlist file sits next to its scene.fountain. */
function shotlistPathForScene(scriptPath: string): string {
  return scriptPath.replace(/[^/]+$/, "shotlist.lani.json")
}

function scriptPathForShotlist(path: string): string {
  return path
    .replace(/\/shotlist\/shotlist\.lani\.json$/i, "/scene.fountain")
    .replace(/[^/]+$/, "scene.fountain")
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
  // A clicked shotlist.lani.json — resolve back to its scene.
  if (active.kind === "shotlist") {
    const activeScriptPath = scriptPathForShotlist(active.path)
    return (
      scenes.find(
        (s) =>
          s.scriptPath === activeScriptPath ||
          shotlistPathForScene(s.scriptPath) === active.path,
      ) ?? null
    )
  }
  return null
}

function randomId(): string {
  return `shot-local-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 7)}`
}

/** Keep `number` aligned with screenplay order after a structural change. */
function renumber(shots: ShotPrompt[]): ShotPrompt[] {
  return shots.map((shot, i) =>
    shot.number === String(i + 1) ? shot : { ...shot, number: String(i + 1) },
  )
}

/** Stream a project file to the renderer over the lani-asset:// scheme. */
function assetUrl(absPath: string): string {
  return `lani-asset://asset/?p=${encodeURIComponent(absPath)}`
}

/** A fresh, empty Part — its screenplay slice may be seeded by the caller. */
function emptyPart(scriptRef: string): ShotPrompt {
  return {
    id: randomId(),
    number: "",
    plan: "",
    camera: "",
    action: "",
    summary: "",
    scriptRef,
    prompt: "",
    promptVersions: [""],
    activeVersion: 0,
    tag: "",
    referenceImages: [],
    status: "draft",
    updatedAt: new Date().toISOString(),
  }
}

type EntityRoot =
  | { chatId: string; projectId?: undefined }
  | { chatId?: undefined; projectId: string }

// ──────────────────────────────────────────────────────────────────────────

export function ShotlistSurface() {
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
      <ShotlistEmpty
        title="No project"
        message="Pick a project to work on a scene's shotlist."
      />
    )
  }
  return (
    <ShotlistWorkspace entityRoot={entityRoot} entityRootKey={entityRootKey} />
  )
}

function ShotlistWorkspace({
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
  const activeShotlistPath = active?.kind === "shotlist" ? active.path : null

  // Follow the project tree: when the active entity *changes* to one that
  // resolves to a scene (a scene file, or a shotlist.lani.json), jump
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

  const sceneOwnsActiveShotlist =
    !!scene &&
    !!activeShotlistPath &&
    (shotlistPathForScene(scene.scriptPath) === activeShotlistPath ||
      scriptPathForShotlist(activeShotlistPath) === scene.scriptPath)

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
      <ShotlistEmpty
        title="No scenes yet"
        message="Add scenes to your screenplay first — each scene gets its own shotlist."
      />
    )
  }

  const sceneOptions: SceneOption[] = scenes.map((s) => ({
    id: s.id,
    label: s.label,
    order: s.order,
  }))

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {scene ? (
        <SceneShotlistView
          key={`${entityRootKey}:${scene.id}`}
          entityRoot={entityRoot}
          sceneId={scene.id}
          sceneLabel={scene.label}
          sceneOrder={scene.order}
          scriptPath={scene.scriptPath}
          shotlistPath={sceneOwnsActiveShotlist ? activeShotlistPath : null}
          scenes={sceneOptions}
          onSelectScene={setPickedSceneId}
        />
      ) : (
        <ScenePicker
          mode="Shotlist"
          blurb="Each scene keeps its own shotlist."
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

function SceneShotlistView({
  entityRoot,
  sceneId,
  sceneLabel,
  sceneOrder,
  scriptPath,
  shotlistPath,
  scenes,
  onSelectScene,
}: {
  entityRoot: EntityRoot
  sceneId: string
  sceneLabel: string
  sceneOrder: number | null
  scriptPath: string
  shotlistPath: string | null
  scenes: SceneOption[]
  onSelectScene: (id: string) => void
}) {
  const relPath = useMemo(
    () => shotlistPath ?? shotlistPathForScene(scriptPath),
    [scriptPath, shotlistPath],
  )
  const read = trpc.shotlists.read.useQuery(
    { ...entityRoot, relPath },
    { refetchOnWindowFocus: true, refetchInterval: LIVE_POLL_MS },
  )
  const script = trpc.shotlists.readScript.useQuery(
    { ...entityRoot, relPath: scriptPath },
    { refetchOnWindowFocus: true },
  )
  const write = trpc.shotlists.write.useMutation({
    onError: (err) => toast.error(err.message || "Couldn't save shotlist"),
  })
  const queueAdd = trpc.queue.addItem.useMutation()

  const [doc, setDoc] = useState<SceneShotlist | null>(null)
  const [selectedShotId, setSelectedShotId] = useState<string | null>(null)
  const [showRaw, setShowRaw] = useState(false)
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle")
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const localEditAtRef = useRef(0)
  const { fraction, setFraction, persist } = usePromptFraction()

  // Undo stack for structural edits only (split / merge / carve). Cmd+Z
  // reverts the last one as long as nothing else happened since.
  const rootRef = useRef<HTMLDivElement | null>(null)
  const undoStackRef = useRef<
    { snapshot: SceneShotlist; prevWasStructural: boolean }[]
  >([])
  const lastWasStructuralRef = useRef(false)
  const undoStructuralRef = useRef<() => void>(() => {})

  useEffect(() => {
    const incoming = read.data?.shotlist ?? null
    if (!incoming) return
    if (Date.now() - localEditAtRef.current < 1000) return
    setDoc(incoming)
  }, [read.data?.shotlist])

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (!doc || doc.shots.length === 0) return
    if (selectedShotId && doc.shots.some((s) => s.id === selectedShotId)) return
    setSelectedShotId(doc.shots[0]!.id)
  }, [doc, selectedShotId])

  const queueSave = (next: SceneShotlist) => {
    setDoc(next)
    localEditAtRef.current = Date.now()
    setSaveState("saving")
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      write.mutate(
        { ...entityRoot, relPath, shotlist: next },
        {
          onSuccess: () => {
            setSaveState("saved")
            setTimeout(() => setSaveState("idle"), 1400)
          },
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

  /** Mark that the last edit was ordinary (text/prompt) — not structural. */
  const markTextEdit = () => {
    lastWasStructuralRef.current = false
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
  // edit is the most recent thing and focus is inside the Shotlist surface,
  // so it never steals undo from screenplay or prompt text editing.
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

  const startShotlist = () => {
    queueSave({
      schemaVersion: 2,
      sceneId,
      sceneNumber: sceneOrder != null ? String(sceneOrder) : "",
      heading: sceneLabel,
      scriptPath,
      shots: [],
      updatedAt: new Date().toISOString(),
    })
  }

  const updateShot = (shotId: string, patch: Partial<ShotPrompt>) => {
    if (!doc) return
    markTextEdit()
    queueSave({
      ...doc,
      shots: doc.shots.map((shot) =>
        shot.id === shotId
          ? { ...shot, ...patch, updatedAt: new Date().toISOString() }
          : shot,
      ),
    })
  }

  /** Seed the shotlist with one Part holding the whole scene screenplay. */
  const importScreenplay = () => {
    if (!doc) return
    markTextEdit()
    const part = renumber([emptyPart(script.data?.text ?? "")])[0]!
    queueSave({ ...doc, shots: [part] })
    setSelectedShotId(part.id)
  }

  /** Append an empty Part — a prompt with no screenplay slice yet. */
  const addRegion = () => {
    if (!doc) return
    markTextEdit()
    const part = emptyPart("")
    queueSave({ ...doc, shots: renumber([...doc.shots, part]) })
    setSelectedShotId(part.id)
  }

  /** Place a divider: cut a Part's screenplay slice at `caret` into two. */
  const splitPart = (shotId: string, caret: number) => {
    if (!doc) return
    const i = doc.shots.findIndex((s) => s.id === shotId)
    if (i < 0) return
    const part = doc.shots[i]!
    const text = part.scriptRef ?? ""
    if (caret <= 0 || caret >= text.length) return
    pushStructuralUndo()
    const head: ShotPrompt = {
      ...part,
      scriptRef: text.slice(0, caret),
      updatedAt: new Date().toISOString(),
    }
    const tail = emptyPart(text.slice(caret))
    queueSave({
      ...doc,
      shots: renumber([
        ...doc.shots.slice(0, i),
        head,
        tail,
        ...doc.shots.slice(i + 1),
      ]),
    })
    setSelectedShotId(tail.id)
  }

  /**
   * Carve a selected stretch of a Part's screenplay into its own Part.
   * `start`/`end` are offsets within the Part's `scriptRef`. The leading
   * piece keeps the original prompt; the carved Part and any trailing
   * piece start blank. The carved Part becomes the selection.
   */
  const carvePart = (shotId: string, start: number, end: number) => {
    if (!doc) return
    const i = doc.shots.findIndex((s) => s.id === shotId)
    if (i < 0) return
    const part = doc.shots[i]!
    const text = part.scriptRef ?? ""
    const a = clamp(start, 0, text.length)
    const b = clamp(end, 0, text.length)
    if (b <= a) return
    const segments: string[] = []
    if (a > 0) segments.push(text.slice(0, a))
    segments.push(text.slice(a, b))
    if (b < text.length) segments.push(text.slice(b))
    if (segments.length < 2) return
    pushStructuralUndo()
    const carvedIndex = a > 0 ? 1 : 0
    const newParts = segments.map((seg, idx) =>
      idx === 0
        ? { ...part, scriptRef: seg, updatedAt: new Date().toISOString() }
        : emptyPart(seg),
    )
    queueSave({
      ...doc,
      shots: renumber([
        ...doc.shots.slice(0, i),
        ...newParts,
        ...doc.shots.slice(i + 1),
      ]),
    })
    setSelectedShotId(newParts[carvedIndex]!.id)
  }

  /** Remove the divider after Part `index`: merge the next Part up into it. */
  const mergeAt = (index: number) => {
    if (!doc) return
    if (index < 0 || index >= doc.shots.length - 1) return
    pushStructuralUndo()
    const head = doc.shots[index]!
    const tail = doc.shots[index + 1]!
    const merged: ShotPrompt = {
      ...head,
      scriptRef: (head.scriptRef ?? "") + (tail.scriptRef ?? ""),
      updatedAt: new Date().toISOString(),
    }
    queueSave({
      ...doc,
      shots: renumber([
        ...doc.shots.slice(0, index),
        merged,
        ...doc.shots.slice(index + 2),
      ]),
    })
    if (selectedShotId === tail.id) setSelectedShotId(merged.id)
  }

  /** Persist a screenplay edit — slices align 1:1 with the current Parts. */
  const applyScriptSlices = (slices: string[]) => {
    if (!doc) return
    if (slices.length !== doc.shots.length) return
    markTextEdit()
    let changed = false
    const shots = doc.shots.map((shot, i) => {
      if ((shot.scriptRef ?? "") === slices[i]) return shot
      changed = true
      return {
        ...shot,
        scriptRef: slices[i]!,
        updatedAt: new Date().toISOString(),
      }
    })
    if (changed) queueSave({ ...doc, shots })
  }

  const addToContext = (shot: ShotPrompt, index: number) => {
    if (!doc) return
    const block = [
      `Scene ${doc.sceneNumber || sceneOrder || "?"} · Part ${index + 1}` +
        (shot.action ? ` — ${shot.action}` : ""),
      shot.scriptRef ? `Screenplay:\n${shot.scriptRef}` : "",
      shot.prompt ? `Prompt:\n${shot.prompt}` : "",
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
    toast.success(`Part ${index + 1} added to chat context`)
  }

  /** Push a Part's prompt onto the project's submission queue. */
  const addToQueue = async (shot: ShotPrompt, index: number) => {
    if (!doc) return
    const text = (shot.prompt ?? "").trim()
    if (!text) {
      toast.error("Write the prompt before queuing it.")
      return
    }
    const partNum = index + 1
    const partLabel =
      `Part ${partNum}` + (shot.action ? ` — ${shot.action}` : "")
    try {
      await queueAdd.mutateAsync({
        ...entityRoot,
        prompt: shot.prompt,
        zh: shot.zh,
        sourceImages: shot.referenceImages ?? [],
        scriptExcerpt: shot.scriptRef?.trim() || undefined,
        source: {
          mode: "shotlist",
          sceneId: doc.sceneId,
          label: `Scene ${doc.sceneNumber || sceneOrder || "?"} · ${partLabel}`,
          sceneName: doc.heading || undefined,
          partLabel,
        },
      })
      toast.success("Added to the submission queue")
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't add to the queue",
      )
    }
  }

  /** Hand the English prompt to the chat thread for a ZH translation. */
  const sendToTranslate = (shot: ShotPrompt, index: number) => {
    const english = (shot.prompt ?? "").trim()
    if (!english) {
      toast.error("Write the English prompt first.")
      return
    }
    const message = [
      "Translate this generation prompt into Chinese (ZH) and save it as the Part's ZH prompt.",
      "",
      "Edit the scene's shotlist file directly and set this Part's `zh` field.",
      `Shotlist: ${relPath}`,
      `Part id: ${shot.id}`,
      "",
      `English prompt — Part ${index + 1}${
        shot.action ? ` (${shot.action})` : ""
      }:`,
      english,
    ].join("\n")
    window.dispatchEvent(
      new CustomEvent("lani-chat-compose", { detail: { text: message } }),
    )
    toast.success("Translation request added to chat — review and send")
  }

  const selectedIndex = doc
    ? doc.shots.findIndex((s) => s.id === selectedShotId)
    : -1
  const selectedShot =
    selectedIndex >= 0 ? doc!.shots[selectedIndex]! : doc?.shots[0] ?? null
  const resolvedIndex =
    selectedIndex >= 0 ? selectedIndex : doc && doc.shots.length > 0 ? 0 : -1

  return (
    <div ref={rootRef} className="flex min-h-0 flex-1 flex-col">
      {/* ── Scene bar — fixed, the surface's masthead. ───────────────── */}
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
          {doc && (
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground/80">
              {doc.shots.length} {doc.shots.length === 1 ? "part" : "parts"}
            </span>
          )}
          {doc && (
            <button
              type="button"
              onClick={() => setShowRaw((v) => !v)}
              aria-pressed={showRaw}
              title={showRaw ? "Back to shotlist view" : "View the raw JSON file"}
              className={cn(
                "press inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5",
                "font-mono text-[10px] font-semibold uppercase tracking-[0.1em] transition-colors",
                showRaw
                  ? "bg-foreground/[0.1] text-foreground"
                  : "bg-foreground/[0.06] text-muted-foreground/70 hover:text-foreground",
              )}
            >
              <Braces className="h-3.5 w-3.5" />
              Raw
            </button>
          )}
        </div>
      </header>

      {/* ── Body ──────────────────────────────────────────────────────── */}
      {showRaw && doc ? (
        <RawJsonView doc={doc} />
      ) : read.isPending && !doc ? (
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading shotlist
        </div>
      ) : !doc ? (
        <div className="flex flex-1 flex-col items-center justify-center px-10 text-center">
          <p className="text-sm font-medium text-foreground">
            No shotlist for this scene
          </p>
          <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted-foreground">
            Ask the agent in chat to break this scene into parts — or start one
            yourself and write the prompts.
          </p>
          <button
            type="button"
            onClick={startShotlist}
            className={cn(
              "press mt-6 inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2",
              "text-xs font-medium text-primary-foreground",
              GLASS_THUMB,
            )}
          >
            <Plus className="h-3.5 w-3.5" />
            Start a shotlist
          </button>
        </div>
      ) : doc.shots.length === 0 || resolvedIndex < 0 || !selectedShot ? (
        <ScreenplaySeed
          loading={script.isPending}
          hasScript={(script.data?.text ?? "").trim().length > 0}
          onImport={importScreenplay}
          onAddRegion={addRegion}
        />
      ) : (
        <WorkArea
          entityRoot={entityRoot}
          relPath={relPath}
          shots={doc.shots}
          selectedShot={selectedShot}
          selectedIndex={resolvedIndex}
          promptFraction={fraction}
          onPromptFraction={setFraction}
          onPersist={persist}
          onSelect={setSelectedShotId}
          onChangeSelected={(patch) => updateShot(selectedShot.id, patch)}
          onEditSlices={applyScriptSlices}
          onSplit={splitPart}
          onCarve={carvePart}
          onMerge={mergeAt}
          onAddToContext={() => addToContext(selectedShot, resolvedIndex)}
          onSendToTranslate={() => sendToTranslate(selectedShot, resolvedIndex)}
          onAddToQueue={() => addToQueue(selectedShot, resolvedIndex)}
          addingToQueue={queueAdd.isPending}
        />
      )}
    </div>
  )
}

// ── Raw JSON view — the shotlist file, plain ──────────────────────────────

/** Read-only dump of the shotlist's underlying `.lani.json` file. */
function RawJsonView({ doc }: { doc: SceneShotlist }) {
  const json = useMemo(() => JSON.stringify(doc, null, 2), [doc])
  const [copied, setCopied] = useState(false)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current)
    }
  }, [])

  const copy = () => {
    navigator.clipboard.writeText(json)
    setCopied(true)
    if (copyTimer.current) clearTimeout(copyTimer.current)
    copyTimer.current = setTimeout(() => setCopied(false), 1600)
    toast.success("Shotlist JSON copied")
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col px-6 pb-5 pt-3">
      <button
        type="button"
        onClick={copy}
        title="Copy the JSON"
        className="press absolute right-9 top-6 z-10 inline-flex h-7 items-center gap-1.5 rounded-lg bg-foreground/[0.06] px-2.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-foreground/[0.1] hover:text-foreground"
      >
        {copied ? (
          <Check className="h-3.5 w-3.5" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
        {copied ? "Copied" : "Copy"}
      </button>
      <pre className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-border/70 bg-foreground/[0.02] p-4 font-mono text-[12px] leading-[1.7] text-foreground">
        {json}
      </pre>
    </div>
  )
}

// ── Screenplay seed — the empty shotlist state ────────────────────────────

function ScreenplaySeed({
  loading,
  hasScript,
  onImport,
  onAddRegion,
}: {
  loading: boolean
  hasScript: boolean
  onImport: () => void
  onAddRegion: () => void
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
        {hasScript ? "Bring the screenplay in" : "This scene has no screenplay yet"}
      </p>
      <p className="mt-1.5 max-w-md text-sm leading-relaxed text-muted-foreground">
        {hasScript
          ? "Import the scene's screenplay, then drop dividers to cut it into parts — each part gets its own generation prompt."
          : "Write the scene first. You can still start an empty part and write a prompt by hand."}
      </p>
      <div className="mt-6 flex items-center gap-2">
        {hasScript && (
          <button
            type="button"
            onClick={onImport}
            className={cn(
              "press inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2",
              "text-xs font-medium text-primary-foreground",
              GLASS_THUMB,
            )}
          >
            <FileDown className="h-3.5 w-3.5" />
            Import screenplay
          </button>
        )}
        <button
          type="button"
          onClick={onAddRegion}
          className="press inline-flex items-center gap-2 rounded-lg border border-border/70 px-3.5 py-2 text-xs font-medium text-muted-foreground transition-colors hover:border-border hover:bg-foreground/[0.03] hover:text-foreground"
        >
          <Plus className="h-3.5 w-3.5" />
          Empty part
        </button>
      </div>
    </div>
  )
}

// ── Work area — prompt | screenplay ───────────────────────────────────────

function WorkArea({
  entityRoot,
  relPath,
  shots,
  selectedShot,
  selectedIndex,
  promptFraction,
  onPromptFraction,
  onPersist,
  onSelect,
  onChangeSelected,
  onEditSlices,
  onSplit,
  onCarve,
  onMerge,
  onAddToContext,
  onSendToTranslate,
  onAddToQueue,
  addingToQueue,
}: {
  entityRoot: EntityRoot
  relPath: string
  shots: ShotPrompt[]
  selectedShot: ShotPrompt
  selectedIndex: number
  promptFraction: number
  onPromptFraction: (fraction: number) => void
  onPersist: () => void
  onSelect: (id: string) => void
  onChangeSelected: (patch: Partial<ShotPrompt>) => void
  onEditSlices: (slices: string[]) => void
  onSplit: (shotId: string, caret: number) => void
  onCarve: (shotId: string, start: number, end: number) => void
  onMerge: (index: number) => void
  onAddToContext: () => void
  onSendToTranslate: () => void
  onAddToQueue: () => void
  addingToQueue: boolean
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
      onPersist()
    }
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
  }

  // Slim, content-stable slice for the screenplay editor. Prevents the
  // CodeMirror reseed effect from firing when only prompt/status fields
  // changed and the screenplay text is byte-identical.
  const screenplayParts = useStableScreenplayParts(shots)

  return (
    <div ref={containerRef} className="flex min-h-0 flex-1 px-6 pb-5 pt-3">
      <div
        className="flex min-w-0 shrink-0 flex-col"
        style={{ width: `calc(${promptFraction * 100}% - 7px)` }}
      >
        <PromptColumn
          entityRoot={entityRoot}
          relPath={relPath}
          shot={selectedShot}
          index={selectedIndex}
          onChange={onChangeSelected}
          onAddToContext={onAddToContext}
          onSendToTranslate={onSendToTranslate}
          onAddToQueue={onAddToQueue}
          addingToQueue={addingToQueue}
        />
      </div>
      <PanelResizer onResize={beginColResize} />
      <div className="flex min-w-0 flex-1 flex-col">
        <ShotlistScreenplay
          parts={screenplayParts}
          activeIndex={selectedIndex}
          onSelect={onSelect}
          onEditSlices={onEditSlices}
          onSplit={onSplit}
          onCarve={onCarve}
          onMerge={onMerge}
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

// ── Prompt column — the hero, boxless ─────────────────────────────────────

type PromptLang = "en" | "zh"

function PromptColumn({
  entityRoot,
  relPath,
  shot,
  index,
  onChange,
  onAddToContext,
  onSendToTranslate,
  onAddToQueue,
  addingToQueue,
}: {
  entityRoot: EntityRoot
  relPath: string
  shot: ShotPrompt
  index: number
  onChange: (patch: Partial<ShotPrompt>) => void
  onAddToContext: () => void
  onSendToTranslate: () => void
  onAddToQueue: () => void
  addingToQueue: boolean
}) {
  const { versions, active } = readVersions(shot)
  const activeText = versions[active] ?? ""
  const zhText = shot.zh ?? ""
  const [lang, setLang] = useState<PromptLang>("en")
  const [copied, setCopied] = useState(false)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const addReferences = trpc.shotlists.addPartReferenceImages.useMutation()

  const mergeAddedReferences = (added: string[]) => {
    if (added.length === 0) return
    const existing = shot.referenceImages ?? []
    const merged = [...existing, ...added.filter((p) => !existing.includes(p))]
    if (merged.length === existing.length) return
    onChange({ referenceImages: merged })
  }

  const pickAndAddReferences = async () => {
    try {
      const result = await addReferences.mutateAsync({
        ...entityRoot,
        relPath,
      })
      mergeAddedReferences(result.added)
      if (result.added.length > 0) {
        toast.success(
          result.added.length === 1
            ? "Reference image added"
            : `${result.added.length} reference images added`,
        )
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't add reference images",
      )
    }
  }

  const dropAddReferences = async (sourcePaths: string[]) => {
    if (sourcePaths.length === 0) return
    try {
      const result = await addReferences.mutateAsync({
        ...entityRoot,
        relPath,
        sourcePaths,
      })
      mergeAddedReferences(result.added)
      if (result.added.length > 0) {
        toast.success(
          result.added.length === 1
            ? "Reference image added"
            : `${result.added.length} reference images added`,
        )
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't add reference images",
      )
    }
  }

  const removeReference = (path: string) => {
    const next = (shot.referenceImages ?? []).filter((p) => p !== path)
    onChange({ referenceImages: next })
  }

  useEffect(() => {
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current)
    }
  }, [])

  const isZh = lang === "zh"
  const bodyText = isZh ? zhText : activeText

  const editActive = (value: string) => {
    const next = [...versions]
    next[active] = value
    onChange(versionPatch(next, active))
  }
  const editBody = (value: string) => {
    if (isZh) onChange({ zh: value })
    else editActive(value)
  }
  const selectVersion = (i: number) => {
    onChange(versionPatch(versions, i))
  }
  const addVersion = () => {
    onChange(versionPatch([...versions, ""], versions.length))
  }
  const deleteActiveVersion = () => {
    if (versions.length <= 1) return
    const next = versions.filter((_, i) => i !== active)
    onChange(versionPatch(next, active > 0 ? active - 1 : 0))
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
      {/* ── Identity — status, the Part's title, its number. ──────── */}
      <div className="flex shrink-0 items-center gap-2.5 pb-2">
        <StatusPicker
          value={shot.status}
          onChange={(status) => onChange({ status })}
        />
        <input
          value={shot.action}
          onChange={(e) => onChange({ action: e.target.value })}
          placeholder="Untitled part"
          aria-label="Part title"
          className="min-w-0 flex-1 truncate bg-transparent text-[13.5px] font-semibold text-foreground outline-none placeholder:text-muted-foreground/40"
        />
        <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground/55">
          Part {String(index + 1).padStart(2, "0")}
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
          {!isZh && (
            <button
              type="button"
              onClick={onSendToTranslate}
              title="Send the English prompt to chat for a ZH translation"
              className="press flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground/65 transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
            >
              <Languages className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            onClick={onAddToContext}
            title="Add this part to chat context"
            className="press flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground/65 transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
          >
            <MessageSquarePlus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onAddToQueue}
            disabled={addingToQueue}
            title="Add this part's prompt to the submission queue"
            className="press flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground/65 transition-colors hover:bg-foreground/[0.06] hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
          >
            {addingToQueue ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ListPlus className="h-4 w-4" />
            )}
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

      {/* Reference images — visual refs and/or prompt inputs for this Part. */}
      <PartReferences
        entityRoot={entityRoot}
        images={shot.referenceImages ?? []}
        adding={addReferences.isPending}
        onAdd={pickAndAddReferences}
        onDropPaths={dropAddReferences}
        onRemove={removeReference}
      />

      {/* Body — the prompt, capped to a readable measure. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <textarea
          value={bodyText}
          onChange={(e) => editBody(e.target.value)}
          spellCheck={!isZh}
          placeholder={
            isZh
              ? "Chinese (ZH) prompt — write it here, or use Translate to ask the agent…"
              : "Write the generation prompt for this part…"
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
          {isZh
            ? "ZH prompt"
            : `Version ${active + 1} of ${versions.length}`}
        </span>
        <span className="tabular-nums">
          {bodyText.length.toLocaleString()} chars
        </span>
      </div>
    </div>
  )
}

// ── Reference images for a Part ───────────────────────────────────────────

function PartReferences({
  entityRoot,
  images,
  adding,
  onAdd,
  onDropPaths,
  onRemove,
}: {
  entityRoot: EntityRoot
  images: string[]
  adding: boolean
  onAdd: () => void
  onDropPaths: (paths: string[]) => void
  onRemove: (path: string) => void
}) {
  const [dragging, setDragging] = useState(false)

  const collectDroppedPaths = (e: React.DragEvent): string[] => {
    const files = Array.from(e.dataTransfer.files)
    return files
      .map(
        (file) =>
          window.webUtils?.getPathForFile?.(file) ??
          (file as File & { path?: string }).path ??
          "",
      )
      .filter((p) => p.length > 0)
  }

  return (
    <div
      onDragEnter={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault()
          setDragging(true)
        }
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault()
          e.dataTransfer.dropEffect = "copy"
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setDragging(false)
        }
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return
        e.preventDefault()
        setDragging(false)
        const paths = collectDroppedPaths(e)
        if (paths.length > 0) onDropPaths(paths)
      }}
      className={cn(
        "flex shrink-0 items-center gap-2.5 rounded-lg pb-2.5 transition-colors",
        dragging && "bg-primary/[0.06] ring-1 ring-primary/40",
      )}
    >
      <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground/45">
        Refs
      </span>
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto py-0.5">
        {images.map((path) => (
          <PartReferenceThumb
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
            Drop or pick reference images for this part
          </span>
        )}
      </div>
    </div>
  )
}

function PartReferenceThumb({
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

function ShotlistEmpty({
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
