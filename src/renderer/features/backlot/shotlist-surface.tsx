"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useAtomValue } from "jotai"
import {
  Check,
  ChevronDown,
  ChevronUp,
  Loader2,
  MessageSquarePlus,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react"
import { toast } from "sonner"
import type { SceneShotlist, ShotPrompt, ShotStatus } from "../../../shared/shotlist-types"
import { selectedAgentChatIdAtom } from "../agents/atoms"
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
  Dialog,
  DialogContent,
  DialogTitle,
} from "../../components/ui/dialog"
import { Table, TableBody, TableHeader } from "../../components/ui/table"
import { activeEntityAtom } from "./atoms"

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

// ── Long-prompt handling — three switchable variants ──────────────────────

type PromptMode = "1" | "2" | "3"

const PROMPT_MODES: {
  id: PromptMode
  label: string
  hint: string
}[] = [
  {
    id: "1",
    label: "Side panel",
    hint: "Open the full prompt in a panel pinned beside the table.",
  },
  {
    id: "2",
    label: "Expand inline",
    hint: "Expand the prompt cell to full height, in place.",
  },
  {
    id: "3",
    label: "Dialog",
    hint: "Open the full prompt in a centered dialog.",
  },
]

const PROMPT_MODE_STORAGE_KEY = "backlot:shotlist:promptmode:v1"

function usePromptMode() {
  const [mode, setModeState] = useState<PromptMode>(() => {
    try {
      const raw = localStorage.getItem(PROMPT_MODE_STORAGE_KEY)
      if (raw === "1" || raw === "2" || raw === "3") return raw
    } catch {
      /* fall through */
    }
    return "1"
  })
  const setMode = (next: PromptMode) => {
    setModeState(next)
    try {
      localStorage.setItem(PROMPT_MODE_STORAGE_KEY, next)
    } catch {
      /* ignore */
    }
  }
  return [mode, setMode] as const
}

// ── Resizable columns ─────────────────────────────────────────────────────

type ColKey =
  | "num"
  | "plan"
  | "camera"
  | "action"
  | "script"
  | "prompt"
  | "tag"
  | "status"

const COLUMNS: { key: ColKey; label: string; min: number; initial: number }[] = [
  { key: "num", label: "#", min: 44, initial: 54 },
  { key: "plan", label: "Plan", min: 56, initial: 80 },
  { key: "camera", label: "Camera", min: 96, initial: 158 },
  { key: "action", label: "Action", min: 120, initial: 214 },
  { key: "script", label: "Script", min: 110, initial: 188 },
  { key: "prompt", label: "Prompt", min: 200, initial: 380 },
  { key: "tag", label: "Tag", min: 64, initial: 106 },
  { key: "status", label: "Status", min: 96, initial: 124 },
]

const ACTIONS_COL_WIDTH = 56
const COL_STORAGE_KEY = "backlot:shotlist:colwidths:v1"

/** Column widths with drag-to-resize, persisted across sessions. */
function useColumnWidths() {
  const [widths, setWidths] = useState<number[]>(() => {
    try {
      const raw = localStorage.getItem(COL_STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed) && parsed.length === COLUMNS.length) {
          return parsed as number[]
        }
      }
    } catch {
      /* fall through to defaults */
    }
    return COLUMNS.map((c) => c.initial)
  })

  const widthsRef = useRef(widths)
  widthsRef.current = widths

  const beginResize = (index: number) => (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startW = widthsRef.current[index]!
    const min = COLUMNS[index]!.min

    const onMove = (ev: PointerEvent) => {
      const next = [...widthsRef.current]
      next[index] = Math.max(min, Math.round(startW + ev.clientX - startX))
      setWidths(next)
    }
    const onUp = () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
      try {
        localStorage.setItem(COL_STORAGE_KEY, JSON.stringify(widthsRef.current))
      } catch {
        /* ignore persistence failures */
      }
    }

    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
  }

  return { widths, beginResize }
}

/** A scene's shotlist file sits next to its scene.fountain. */
function shotlistPathForScene(scriptPath: string): string {
  return scriptPath.replace(/[^/]+$/, "shotlist.backlot.json")
}

function randomId(): string {
  return `shot-local-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 7)}`
}

export function ShotlistSurface() {
  const chatId = useAtomValue(selectedAgentChatIdAtom)
  if (!chatId) {
    return (
      <ShotlistEmpty
        title="No scene context"
        message="Open a chat to work on a scene's shotlist."
      />
    )
  }
  return <ShotlistWorkspace chatId={chatId} />
}

function ShotlistWorkspace({ chatId }: { chatId: string }) {
  const hierarchy = trpc.entities.list.useQuery({ chatId })
  const active = useAtomValue(activeEntityAtom)
  const scenes = hierarchy.data?.scenes ?? []
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null)

  useEffect(() => {
    if (scenes.length === 0) return
    if (selectedSceneId && scenes.some((s) => s.id === selectedSceneId)) return
    const fromActive =
      active?.kind === "scene"
        ? scenes.find((s) => s.id === active.id)
        : undefined
    setSelectedSceneId((fromActive ?? scenes[0]!).id)
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
      <ShotlistEmpty
        title="No scenes yet"
        message="Add scenes to your screenplay first — each scene gets its own shotlist."
      />
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <header className="no-drag flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
        <div className="flex shrink-0 items-center gap-2">
          <span className="h-3.5 w-[3px] rounded-full bg-primary" />
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            Shotlist
          </span>
        </div>
        <Select
          value={scene?.id ?? ""}
          onValueChange={(value) => setSelectedSceneId(value)}
        >
          <SelectTrigger className="h-8 w-auto min-w-[260px] rounded-lg shadow-none">
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
      </header>
      {scene && (
        <SceneShotlistView
          key={scene.id}
          chatId={chatId}
          sceneId={scene.id}
          sceneLabel={scene.label}
          sceneOrder={scene.order}
          scriptPath={scene.scriptPath}
        />
      )}
    </div>
  )
}

function SceneShotlistView({
  chatId,
  sceneId,
  sceneLabel,
  sceneOrder,
  scriptPath,
}: {
  chatId: string
  sceneId: string
  sceneLabel: string
  sceneOrder: number | null
  scriptPath: string
}) {
  const relPath = useMemo(() => shotlistPathForScene(scriptPath), [scriptPath])
  const read = trpc.shotlists.read.useQuery(
    { chatId, relPath },
    { refetchOnWindowFocus: true, refetchInterval: LIVE_POLL_MS },
  )
  const write = trpc.shotlists.write.useMutation({
    onError: (err) => toast.error(err.message || "Couldn't save shotlist"),
  })

  const [doc, setDoc] = useState<SceneShotlist | null>(null)
  const [selectedShotId, setSelectedShotId] = useState<string | null>(null)
  const [dialogShotId, setDialogShotId] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [promptMode, setPromptMode] = usePromptMode()
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle")
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const localEditAtRef = useRef(0)

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

  const queueSave = (next: SceneShotlist) => {
    setDoc(next)
    localEditAtRef.current = Date.now()
    setSaveState("saving")
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      write.mutate(
        { chatId, relPath, shotlist: next },
        {
          onSuccess: () => {
            setSaveState("saved")
            setTimeout(() => setSaveState("idle"), 1400)
          },
        },
      )
    }, AUTOSAVE_MS)
  }

  const startShotlist = () => {
    queueSave({
      schemaVersion: 1,
      sceneId,
      sceneNumber: sceneOrder != null ? String(sceneOrder) : "",
      heading: sceneLabel,
      scriptPath,
      shots: [],
      updatedAt: new Date().toISOString(),
    })
  }

  const updateScene = (patch: Partial<SceneShotlist>) => {
    if (!doc) return
    queueSave({ ...doc, ...patch })
  }

  const updateShot = (shotId: string, patch: Partial<ShotPrompt>) => {
    if (!doc) return
    queueSave({
      ...doc,
      shots: doc.shots.map((shot) =>
        shot.id === shotId
          ? { ...shot, ...patch, updatedAt: new Date().toISOString() }
          : shot,
      ),
    })
  }

  const addShot = () => {
    if (!doc) return
    const maxNumber = doc.shots.reduce((max, shot) => {
      const n = Number.parseInt(shot.number, 10)
      return Number.isFinite(n) && n > max ? n : max
    }, 0)
    const shot: ShotPrompt = {
      id: randomId(),
      number: String(maxNumber + 1),
      plan: "",
      camera: "",
      action: "",
      scriptRef: "",
      text: "",
      tag: "",
      status: "draft",
      updatedAt: new Date().toISOString(),
    }
    queueSave({ ...doc, shots: [...doc.shots, shot] })
    setSelectedShotId(shot.id)
    if (promptMode === "3") setDialogShotId(shot.id)
  }

  const deleteShot = (shotId: string) => {
    if (!doc) return
    queueSave({ ...doc, shots: doc.shots.filter((s) => s.id !== shotId) })
    if (selectedShotId === shotId) setSelectedShotId(null)
    if (dialogShotId === shotId) setDialogShotId(null)
  }

  const addToContext = (shot: ShotPrompt) => {
    if (!doc) return
    const block = [
      `Scene ${doc.sceneNumber || sceneOrder || "?"} · Shot ${shot.number}` +
        (shot.plan ? ` (${shot.plan})` : ""),
      shot.action ? `Action: ${shot.action}` : "",
      shot.text ? `Prompt:\n${shot.text}` : "",
    ]
      .filter(Boolean)
      .join("\n")
    window.dispatchEvent(
      new CustomEvent("file-viewer-add-to-context", {
        detail: { text: block, source: { type: "file-viewer", filePath: relPath } },
      }),
    )
    toast.success(`Shot ${shot.number} added to chat context`)
  }

  /** What happens when the prompt of a shot is opened, per variant. */
  const openPrompt = (shotId: string) => {
    setSelectedShotId(shotId)
    if (promptMode === "3") setDialogShotId(shotId)
  }

  const filteredShots = useMemo(() => {
    if (!doc) return []
    const q = query.trim().toLowerCase()
    if (!q) return doc.shots
    return doc.shots.filter((shot) =>
      [
        shot.number,
        shot.plan,
        shot.camera,
        shot.action,
        shot.scriptRef,
        shot.text,
        shot.tag,
        shot.status,
      ]
        .join(" ")
        .toLowerCase()
        .includes(q),
    )
  }, [doc, query])

  if (read.isPending && !doc) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading shotlist
      </div>
    )
  }

  if (!doc) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-10 text-center">
        <p className="text-sm font-medium text-foreground">
          No shotlist for this scene
        </p>
        <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted-foreground">
          Ask the agent in chat to break this scene into shots — or start one
          yourself and fill it in.
        </p>
        <button
          type="button"
          onClick={startShotlist}
          className={cn(
            "press mt-6 inline-flex items-center gap-2 rounded-lg px-3.5 py-2",
            "border border-border bg-card text-xs font-medium text-foreground/85",
            "hover:border-primary/40 hover:text-foreground",
          )}
        >
          <Plus className="h-3.5 w-3.5" />
          Start a shotlist
        </button>
      </div>
    )
  }

  const selectedShot =
    promptMode === "1" && selectedShotId
      ? doc.shots.find((s) => s.id === selectedShotId) ?? null
      : null
  const dialogShot =
    promptMode === "3" && dialogShotId
      ? doc.shots.find((s) => s.id === dialogShotId) ?? null
      : null

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Scene title block. */}
      <div className="flex shrink-0 items-start justify-between gap-6 px-6 pb-4 pt-5">
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground/70">
            Scene {doc.sceneNumber || (sceneOrder != null ? sceneOrder : "—")}
          </div>
          <h1 className="font-display mt-0.5 text-[22px] font-semibold leading-tight tracking-[-0.01em] text-foreground">
            {doc.heading || sceneLabel}
          </h1>
          <input
            value={doc.synopsis ?? ""}
            onChange={(e) =>
              updateScene({ synopsis: e.target.value || undefined })
            }
            placeholder="Add a one-line synopsis for this scene"
            className="mt-1.5 w-full bg-transparent text-sm text-muted-foreground outline-none placeholder:text-muted-foreground/40"
          />
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5 pt-0.5">
          <SaveState state={saveState} />
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground/70">
            {doc.shots.length} {doc.shots.length === 1 ? "shot" : "shots"}
          </span>
        </div>
      </div>

      {/* Toolbar — search, prompt-view switcher, add shot. */}
      <div className="flex shrink-0 items-center gap-3 border-y border-border bg-card/40 px-6 py-2">
        <div className="relative w-full max-w-[240px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/55" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search shots…"
            className={cn(
              "h-8 w-full rounded-lg border border-border bg-background pl-8 pr-2.5 text-sm outline-none",
              "placeholder:text-muted-foreground/45 focus:border-primary/45",
            )}
          />
        </div>
        {query.trim() && (
          <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground/70">
            {filteredShots.length} / {doc.shots.length}
          </span>
        )}

        <button
          type="button"
          onClick={addShot}
          className={cn(
            "press ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5",
            "border border-border bg-background text-xs font-medium text-foreground/85",
            "hover:border-primary/40 hover:text-foreground",
          )}
        >
          <Plus className="h-3.5 w-3.5" />
          Add shot
        </button>
      </div>

      {/* The three explorable long-prompt modes — /1 /2 /3. */}
      <PromptModeBar mode={promptMode} onChange={setPromptMode} />

      {/* Body — table, plus the side panel in variant 1. */}
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          {doc.shots.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center px-10 text-center">
              <p className="text-sm text-muted-foreground">No shots yet.</p>
              <p className="mt-1 text-sm text-muted-foreground/65">
                Add one above, or ask the agent to break down the scene.
              </p>
            </div>
          ) : (
            <ShotlistTable
              shots={filteredShots}
              totalCount={doc.shots.length}
              promptMode={promptMode}
              selectedShotId={selectedShotId}
              onSelect={setSelectedShotId}
              onOpenPrompt={openPrompt}
              onChange={updateShot}
              onAddToContext={addToContext}
              onDelete={deleteShot}
            />
          )}
        </div>

        {selectedShot && (
          <ShotDetailPanel
            shot={selectedShot}
            onClose={() => setSelectedShotId(null)}
            onChange={(patch) => updateShot(selectedShot.id, patch)}
            onAddToContext={() => addToContext(selectedShot)}
            onDelete={() => deleteShot(selectedShot.id)}
          />
        )}
      </div>

      {/* Variant 3 — the prompt opens in a dialog. */}
      <Dialog
        open={!!dialogShot}
        onOpenChange={(open) => {
          if (!open) setDialogShotId(null)
        }}
      >
        <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col gap-0 overflow-hidden p-0">
          <DialogTitle className="sr-only">
            Shot {dialogShot?.number ?? ""} prompt
          </DialogTitle>
          {dialogShot && (
            <ShotEditor
              shot={dialogShot}
              variant="dialog"
              onChange={(patch) => updateShot(dialogShot.id, patch)}
              onAddToContext={() => addToContext(dialogShot)}
              onDelete={() => deleteShot(dialogShot.id)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

/**
 * The long-prompt mode bar. Three explorable modes — /1 side panel,
 * /2 expand inline, /3 dialog — each a different way to read and edit a
 * full prompt while the table keeps a clamped preview.
 */
function PromptModeBar({
  mode,
  onChange,
}: {
  mode: PromptMode
  onChange: (mode: PromptMode) => void
}) {
  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-border bg-background px-6 py-1.5">
      <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground/60">
        Long prompt
      </span>
      <div className="flex items-center gap-1">
        {PROMPT_MODES.map(({ id, label, hint }) => (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            title={hint}
            aria-pressed={mode === id}
            className={cn(
              "press inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors",
              mode === id
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <span
              className={cn(
                "font-mono font-semibold",
                mode === id ? "opacity-100" : "opacity-60",
              )}
            >
              /{id}
            </span>
            <span className="font-medium">{label}</span>
          </button>
        ))}
      </div>
      <span className="ml-auto hidden text-[11px] text-muted-foreground/60 lg:inline">
        {PROMPT_MODES.find((m) => m.id === mode)?.hint}
      </span>
    </div>
  )
}

function ShotlistTable({
  shots,
  totalCount,
  promptMode,
  selectedShotId,
  onSelect,
  onOpenPrompt,
  onChange,
  onAddToContext,
  onDelete,
}: {
  shots: ShotPrompt[]
  totalCount: number
  promptMode: PromptMode
  selectedShotId: string | null
  onSelect: (id: string) => void
  onOpenPrompt: (id: string) => void
  onChange: (shotId: string, patch: Partial<ShotPrompt>) => void
  onAddToContext: (shot: ShotPrompt) => void
  onDelete: (shotId: string) => void
}) {
  const { widths, beginResize } = useColumnWidths()
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const tableWidth = widths.reduce((sum, w) => sum + w, 0) + ACTIONS_COL_WIDTH

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <Table
      containerClassName="flex-1 min-h-0"
      className="table-fixed border-separate border-spacing-0"
      style={{ minWidth: tableWidth }}
    >
      <colgroup>
        {COLUMNS.map((col, i) => (
          <col key={col.key} style={{ width: widths[i] }} />
        ))}
        <col style={{ width: ACTIONS_COL_WIDTH }} />
      </colgroup>

      <TableHeader className="[&_tr]:border-0">
        <tr>
          {COLUMNS.map((col, i) => (
            <th
              key={col.key}
              className={cn(
                "sticky top-0 z-20 select-none border-b border-border bg-background",
                "relative h-9 px-2.5 text-left align-middle",
                "font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/80",
                col.key === "num" && "text-center",
              )}
            >
              {col.label}
              <span
                onPointerDown={beginResize(i)}
                className="group/resize absolute -right-1 top-0 z-10 flex h-full w-2.5 cursor-col-resize items-center justify-center"
              >
                <span className="h-4 w-px bg-border transition-colors group-hover/resize:bg-primary" />
              </span>
            </th>
          ))}
          <th className="sticky top-0 z-20 border-b border-border bg-background" />
        </tr>
      </TableHeader>

      <TableBody>
        {shots.length === 0 ? (
          <tr>
            <td
              colSpan={COLUMNS.length + 1}
              className="px-6 py-14 text-center text-sm text-muted-foreground"
            >
              No shots match your search.
            </td>
          </tr>
        ) : (
          shots.map((shot) => (
            <ShotRow
              key={shot.id}
              shot={shot}
              promptMode={promptMode}
              expanded={expandedIds.has(shot.id)}
              selected={shot.id === selectedShotId}
              onSelect={() => onSelect(shot.id)}
              onOpenPrompt={() => onOpenPrompt(shot.id)}
              onToggleExpand={() => toggleExpand(shot.id)}
              onChange={(patch) => onChange(shot.id, patch)}
              onAddToContext={() => onAddToContext(shot)}
              onDelete={() => onDelete(shot.id)}
            />
          ))
        )}
      </TableBody>

      {shots.length > 0 && (
        <tfoot>
          <tr>
            <td
              colSpan={COLUMNS.length + 1}
              className="px-2.5 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/45"
            >
              {shots.length === totalCount
                ? `${totalCount} ${totalCount === 1 ? "shot" : "shots"}`
                : `${shots.length} of ${totalCount} shots`}
            </td>
          </tr>
        </tfoot>
      )}
    </Table>
  )
}

const CELL_BASE = "border-b border-border/55 px-2.5 py-3 align-top"

function ShotRow({
  shot,
  promptMode,
  expanded,
  selected,
  onSelect,
  onOpenPrompt,
  onToggleExpand,
  onChange,
  onAddToContext,
  onDelete,
}: {
  shot: ShotPrompt
  promptMode: PromptMode
  expanded: boolean
  selected: boolean
  onSelect: () => void
  onOpenPrompt: () => void
  onToggleExpand: () => void
  onChange: (patch: Partial<ShotPrompt>) => void
  onAddToContext: () => void
  onDelete: () => void
}) {
  return (
    <tr
      onClick={onSelect}
      data-state={selected ? "selected" : undefined}
      className="group"
    >
      {/* # — carries the selection indicator. */}
      <td
        className={cn(
          CELL_BASE,
          "border-l-2 pl-2 pr-1.5",
          selected ? "border-l-primary" : "border-l-transparent",
        )}
      >
        <input
          value={shot.number}
          onChange={(e) => onChange({ number: e.target.value })}
          onClick={(e) => e.stopPropagation()}
          aria-label="Shot number"
          className={cn(
            "w-full bg-transparent text-center font-mono text-base font-semibold tabular-nums outline-none",
            selected ? "text-primary" : "text-foreground/80",
          )}
        />
      </td>

      {/* Plan. */}
      <td className={CELL_BASE}>
        <input
          value={shot.plan}
          onChange={(e) => onChange({ plan: e.target.value })}
          onClick={(e) => e.stopPropagation()}
          placeholder="—"
          className="w-full bg-transparent font-mono text-[11px] font-medium uppercase tracking-wide text-foreground/85 outline-none placeholder:text-muted-foreground/35"
        />
      </td>

      {/* Camera. */}
      <td className={CELL_BASE}>
        <AutoGrowTextarea
          value={shot.camera}
          onChange={(value) => onChange({ camera: value })}
          placeholder="lens, movement"
          className="text-xs leading-5 text-muted-foreground placeholder:text-muted-foreground/35"
        />
      </td>

      {/* Action — the headline of the shot. */}
      <td className={CELL_BASE}>
        <AutoGrowTextarea
          value={shot.action}
          onChange={(value) => onChange({ action: value })}
          placeholder="What happens in this shot"
          className="text-[13px] font-medium leading-6 text-foreground placeholder:font-normal placeholder:text-muted-foreground/40"
        />
      </td>

      {/* Script beat. */}
      <td className={CELL_BASE}>
        <AutoGrowTextarea
          value={shot.scriptRef}
          onChange={(value) => onChange({ scriptRef: value })}
          placeholder="Script beat"
          className="text-xs italic leading-5 text-muted-foreground/80 placeholder:not-italic placeholder:text-muted-foreground/35"
        />
      </td>

      {/* Prompt — the cell adapts to the chosen variant. */}
      <td className={CELL_BASE}>
        <PromptCell
          shot={shot}
          promptMode={promptMode}
          expanded={expanded}
          onChange={onChange}
          onOpenPrompt={onOpenPrompt}
          onToggleExpand={onToggleExpand}
        />
      </td>

      {/* Tag. */}
      <td className={CELL_BASE}>
        <input
          value={shot.tag}
          onChange={(e) => onChange({ tag: e.target.value })}
          onClick={(e) => e.stopPropagation()}
          placeholder="15s · 21:9"
          className="w-full bg-transparent font-mono text-[11px] text-muted-foreground/75 outline-none placeholder:text-muted-foreground/30"
        />
      </td>

      {/* Status. */}
      <td className={CELL_BASE}>
        <StatusPicker
          value={shot.status}
          onChange={(status) => onChange({ status })}
        />
      </td>

      {/* Row actions. */}
      <td className={cn(CELL_BASE, "px-1")}>
        <div className="flex flex-col items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            title="Add to chat context"
            onClick={(e) => {
              e.stopPropagation()
              onAddToContext()
            }}
            className="press flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/55 hover:bg-accent hover:text-foreground"
          >
            <MessageSquarePlus className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            title="Delete shot"
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
            className="press flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/55 hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </td>
    </tr>
  )
}

/**
 * The Prompt cell. Always a clamped 3-line preview, except variant 2 when
 * the row is expanded — then the full editable textarea takes over.
 */
function PromptCell({
  shot,
  promptMode,
  expanded,
  onChange,
  onOpenPrompt,
  onToggleExpand,
}: {
  shot: ShotPrompt
  promptMode: PromptMode
  expanded: boolean
  onChange: (patch: Partial<ShotPrompt>) => void
  onOpenPrompt: () => void
  onToggleExpand: () => void
}) {
  const empty = !shot.text.trim()

  if (promptMode === "2" && expanded) {
    return (
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/55">
            Prompt
          </span>
          <button
            type="button"
            title="Collapse"
            onClick={(e) => {
              e.stopPropagation()
              onToggleExpand()
            }}
            className="press flex h-5 w-5 items-center justify-center rounded text-muted-foreground/60 hover:bg-accent hover:text-foreground"
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
        </div>
        <AutoGrowTextarea
          value={shot.text}
          onChange={(value) => onChange({ text: value })}
          placeholder="Generation prompt…"
          className="text-[13px] leading-6 text-foreground/90 placeholder:text-muted-foreground/40"
        />
      </div>
    )
  }

  const openable = promptMode === "1" || promptMode === "3"

  return (
    <div className="flex items-start gap-1">
      <p
        onClick={
          openable
            ? (e) => {
                e.stopPropagation()
                onOpenPrompt()
              }
            : undefined
        }
        className={cn(
          "line-clamp-3 min-w-0 flex-1 whitespace-pre-wrap text-[13px] leading-6",
          empty ? "text-muted-foreground/40" : "text-foreground/85",
          openable && "cursor-pointer",
        )}
      >
        {empty ? "Generation prompt…" : shot.text}
      </p>
      {promptMode === "2" ? (
        <button
          type="button"
          title="Expand prompt"
          onClick={(e) => {
            e.stopPropagation()
            onToggleExpand()
          }}
          className="press flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground/50 hover:bg-accent hover:text-foreground"
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      ) : (
        <span className="mt-0.5 shrink-0 font-mono text-[9px] uppercase tracking-wider text-muted-foreground/0 transition-colors group-hover:text-muted-foreground/50">
          Open
        </span>
      )}
    </div>
  )
}

/** Variant 1 — a side panel pinned to the right of the table. */
function ShotDetailPanel({
  shot,
  onClose,
  onChange,
  onAddToContext,
  onDelete,
}: {
  shot: ShotPrompt
  onClose: () => void
  onChange: (patch: Partial<ShotPrompt>) => void
  onAddToContext: () => void
  onDelete: () => void
}) {
  return (
    <aside className="flex w-[400px] shrink-0 flex-col border-l border-border bg-background">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border px-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
          Shot detail
        </span>
        <button
          type="button"
          title="Close"
          onClick={onClose}
          className="press flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/60 hover:bg-accent hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <ShotEditor
        shot={shot}
        variant="panel"
        onChange={onChange}
        onAddToContext={onAddToContext}
        onDelete={onDelete}
      />
    </aside>
  )
}

/**
 * The full single-shot editor — shared by the variant-1 side panel and the
 * variant-3 dialog. The prompt is the reading surface: a wide, borderless,
 * auto-growing block of text.
 */
function ShotEditor({
  shot,
  variant,
  onChange,
  onAddToContext,
  onDelete,
}: {
  shot: ShotPrompt
  variant: "panel" | "dialog"
  onChange: (patch: Partial<ShotPrompt>) => void
  onAddToContext: () => void
  onDelete: () => void
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header — number + status + actions. */}
      <div
        className={cn(
          "flex shrink-0 items-center gap-3 pl-5",
          variant === "dialog" ? "pb-3 pr-12 pt-5" : "pb-3 pr-5 pt-4",
        )}
      >
        <span className="flex items-baseline font-mono text-[28px] font-semibold leading-none tabular-nums text-foreground">
          <span className="text-muted-foreground/35">#</span>
          <input
            value={shot.number}
            onChange={(e) => onChange({ number: e.target.value })}
            aria-label="Shot number"
            className="w-[2.5ch] bg-transparent outline-none"
          />
        </span>
        <StatusPicker
          value={shot.status}
          onChange={(status) => onChange({ status })}
        />
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            title="Add to chat context"
            onClick={onAddToContext}
            className="press flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/60 hover:bg-accent hover:text-foreground"
          >
            <MessageSquarePlus className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="Delete shot"
            onClick={onDelete}
            className="press flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/60 hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Scrollable body. */}
      <div className="min-h-0 flex-1 overflow-auto px-5 pb-5">
        {/* Technical metadata. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border/60 pb-3">
          <EditorField label="Plan">
            <input
              value={shot.plan}
              onChange={(e) => onChange({ plan: e.target.value })}
              placeholder="WS"
              className="w-16 bg-transparent font-mono text-xs font-medium uppercase tracking-wide text-foreground/85 outline-none placeholder:text-muted-foreground/35"
            />
          </EditorField>
          <EditorField label="Camera">
            <input
              value={shot.camera}
              onChange={(e) => onChange({ camera: e.target.value })}
              placeholder="lens, movement"
              className="w-full bg-transparent text-xs text-muted-foreground outline-none placeholder:text-muted-foreground/35"
            />
          </EditorField>
          <EditorField label="Tag">
            <input
              value={shot.tag}
              onChange={(e) => onChange({ tag: e.target.value })}
              placeholder="15s · 21:9"
              className="w-24 bg-transparent font-mono text-[11px] text-muted-foreground/80 outline-none placeholder:text-muted-foreground/30"
            />
          </EditorField>
        </div>

        {/* Action. */}
        <input
          value={shot.action}
          onChange={(e) => onChange({ action: e.target.value })}
          placeholder="What happens in this shot"
          className="mt-3 w-full bg-transparent text-[15px] font-medium leading-snug text-foreground outline-none placeholder:font-normal placeholder:text-muted-foreground/40"
        />

        {/* Script beat. */}
        <input
          value={shot.scriptRef}
          onChange={(e) => onChange({ scriptRef: e.target.value })}
          placeholder="Script beat — the screenplay line this shot covers"
          className="mt-1 w-full bg-transparent text-xs italic text-muted-foreground/80 outline-none placeholder:not-italic placeholder:text-muted-foreground/35"
        />

        {/* Prompt — the reading surface. */}
        <div className="mt-4">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground/55">
            Prompt
          </span>
          <AutoGrowTextarea
            value={shot.text}
            onChange={(value) => onChange({ text: value })}
            placeholder="Generation prompt…"
            className="mt-1.5 max-w-[64ch] text-[14px] leading-7 text-foreground/90 placeholder:text-muted-foreground/40"
          />
        </div>
      </div>
    </div>
  )
}

function EditorField({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="flex min-w-0 flex-1 items-baseline gap-2">
      <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/55">
        {label}
      </span>
      {children}
    </label>
  )
}

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
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "press inline-flex max-w-full items-center gap-1.5 rounded-md px-1.5 py-1 outline-none",
          "hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/40",
        )}
      >
        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", STATUS_DOT[value])} />
        <span className="truncate font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
          {value}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[150px]">
        {STATUS_OPTIONS.map((status) => (
          <DropdownMenuItem
            key={status}
            onClick={(e) => e.stopPropagation()}
            onSelect={() => onChange(status)}
            className="gap-2"
          >
            <span
              className={cn("h-1.5 w-1.5 shrink-0 rounded-full", STATUS_DOT[status])}
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

/**
 * A borderless textarea that grows with its content. Inside a resizable
 * table cell it also re-measures when the column width changes, so the
 * row height always matches the wrapped text.
 */
function AutoGrowTextarea({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}) {
  const ref = useRef<HTMLTextAreaElement>(null)

  const resize = () => {
    const el = ref.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${el.scrollHeight}px`
  }

  useEffect(resize, [value])

  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(resize)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <textarea
      ref={ref}
      value={value}
      placeholder={placeholder}
      spellCheck
      rows={1}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "block w-full resize-none overflow-hidden bg-transparent outline-none",
        className,
      )}
    />
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
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/45">
      Autosaves
    </span>
  )
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
