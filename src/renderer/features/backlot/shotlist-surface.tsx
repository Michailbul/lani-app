"use client"

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useAtomValue } from "jotai"
import {
  Check,
  Clapperboard,
  Clipboard,
  Clock3,
  FileUp,
  Languages,
  Loader2,
  Search,
  Send,
} from "lucide-react"
import { toast } from "sonner"
import type {
  ShotlistDocument,
  ShotlistPrompt,
  ShotlistRow,
  ShotlistScene,
  ShotlistSubmission,
} from "../../../shared/shotlist-types"
import {
  selectedAgentChatIdAtom,
  selectedProjectAtom,
} from "../agents/atoms"
import { trpc } from "../../lib/trpc"
import { cn } from "../../lib/utils"
import { activeEntityAtom } from "./atoms"

const AUTOSAVE_MS = 700
const LIVE_POLL_MS = 1500
const RUNWAY_URL =
  "https://app.runwayml.com/video-tools/teams/mbuloichykai4/ai-tools/generate?tool=video&mode=tools&sessionId=b9d082ef-225c-49f7-bd63-0c715a54dd9a"

type EntityRoot =
  | { chatId: string; projectId?: undefined }
  | { chatId?: undefined; projectId: string }

export function ShotlistSurface() {
  const active = useAtomValue(activeEntityAtom)
  const chatId = useAtomValue(selectedAgentChatIdAtom)
  const selectedProject = useAtomValue(selectedProjectAtom)
  const root: EntityRoot | null = chatId
    ? { chatId }
    : selectedProject?.id
      ? { projectId: selectedProject.id }
      : null

  if (!root) {
    return <ShotlistEmpty title="No project open" message="Pick a project before opening a shotlist." />
  }

  if (active?.kind === "shotlist") {
    return <ShotlistDocumentView root={root} relPath={active.path} />
  }

  return <DefaultShotlistLoader root={root} />
}

function DefaultShotlistLoader({ root }: { root: EntityRoot }) {
  const defaultShotlist = trpc.shotlists.findDefault.useQuery(root, {
    refetchOnWindowFocus: true,
    refetchInterval: LIVE_POLL_MS,
  })

  if (defaultShotlist.isPending) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        Loading shotlist
      </div>
    )
  }

  if (defaultShotlist.data?.relPath) {
    return (
      <ShotlistDocumentView root={root} relPath={defaultShotlist.data.relPath} />
    )
  }

  return <ShotlistStartScreen root={root} />
}

function ShotlistStartScreen({ root }: { root: EntityRoot }) {
  const utils = trpc.useUtils()
  const importHtml = trpc.shotlists.pickAndImportHtml.useMutation({
    onSuccess: () => utils.shotlists.findDefault.invalidate(),
    onError: (err) => toast.error(err.message || "Couldn't import shotlist"),
  })

  return (
    <div className="flex h-full items-center justify-center px-10">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg border border-border bg-card">
          <Clapperboard className="h-5 w-5 text-primary" />
        </div>
        <h2
          className="text-xl text-foreground"
          style={{ fontFamily: "var(--font-display)", fontWeight: 600 }}
        >
          No shotlist yet
        </h2>
        <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
          Ask the agent in chat to build a shotlist from your screenplay. It
          breaks scenes into shots and writes generation prompts — the list
          fills in here as it works.
        </p>
        <button
          type="button"
          onClick={() => importHtml.mutate(root)}
          disabled={importHtml.isPending}
          className={cn(
            "press mt-5 inline-flex items-center gap-2 rounded px-3 py-1.5",
            "border border-border bg-background text-xs text-foreground/85",
            "hover:bg-secondary hover:text-foreground transition-colors",
            "disabled:opacity-60",
          )}
        >
          {importHtml.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <FileUp className="h-3.5 w-3.5" />
          )}
          Import an existing HTML shotlist
        </button>
      </div>
    </div>
  )
}

function ShotlistDocumentView({
  root,
  relPath,
}: {
  root: EntityRoot
  relPath: string
}) {
  const read = trpc.shotlists.read.useQuery(
    { ...root, relPath },
    { refetchOnWindowFocus: true, refetchInterval: LIVE_POLL_MS },
  )
  const write = trpc.shotlists.write.useMutation({
    onError: (err) => toast.error(err.message || "Couldn't save shotlist"),
  })
  const [doc, setDoc] = useState<ShotlistDocument | null>(null)
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null)
  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [planFilter, setPlanFilter] = useState("")
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

  const scenes = doc?.scenes ?? []

  // Keep the scene selection valid as the agent adds/removes scenes.
  useEffect(() => {
    if (scenes.length === 0) return
    if (!selectedSceneId || !scenes.some((s) => s.id === selectedSceneId)) {
      setSelectedSceneId(scenes[0]!.id)
    }
  }, [scenes, selectedSceneId])

  const scene =
    scenes.find((s) => s.id === selectedSceneId) ?? scenes[0] ?? null

  const promptById = useMemo(() => {
    const map = new Map<string, ShotlistPrompt>()
    for (const prompt of scene?.prompts ?? []) map.set(prompt.id, prompt)
    return map
  }, [scene?.prompts])

  // Reset the prompt selection when the active scene changes.
  useEffect(() => {
    setSelectedPromptId(scene?.prompts[0]?.id ?? null)
  }, [scene?.id])

  const selectedPrompt =
    selectedPromptId ? promptById.get(selectedPromptId) ?? null : null
  const planOptions = useMemo(() => {
    return Array.from(
      new Set((scene?.rows ?? []).map((row) => row.plan).filter(Boolean)),
    )
  }, [scene?.rows])
  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (scene?.rows ?? []).filter((row) => {
      const prompt = row.promptId ? promptById.get(row.promptId) : null
      const text = [
        row.id,
        row.plan,
        row.planLabel,
        row.camera,
        row.action,
        row.sceneText,
        prompt?.tag,
        prompt?.promptZh,
        prompt?.promptEn,
        prompt?.promptRunway,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
      return (!q || text.includes(q)) && (!planFilter || row.plan === planFilter)
    })
  }, [planFilter, promptById, query, scene?.rows])

  const queueSave = (next: ShotlistDocument) => {
    setDoc(next)
    localEditAtRef.current = Date.now()
    setSaveState("saving")
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      write.mutate(
        { ...root, relPath, shotlist: next },
        {
          onSuccess: () => {
            setSaveState("saved")
            setTimeout(() => setSaveState("idle"), 1400)
          },
        },
      )
    }, AUTOSAVE_MS)
  }

  const updatePrompt = (
    promptId: string,
    updater: (prompt: ShotlistPrompt) => ShotlistPrompt,
  ) => {
    if (!doc) return
    queueSave({
      ...doc,
      scenes: doc.scenes.map((currentScene) => ({
        ...currentScene,
        prompts: currentScene.prompts.map((prompt) =>
          prompt.id === promptId ? updater(prompt) : prompt,
        ),
      })),
    })
  }

  const markSubmitted = (prompt: ShotlistPrompt) => {
    const sourcePromptField = prompt.promptRunway
      ? "promptRunway"
      : prompt.promptEn
        ? "promptEn"
        : "promptZh"
    const submittedPrompt =
      sourcePromptField === "promptRunway"
        ? prompt.promptRunway ?? ""
        : sourcePromptField === "promptEn"
          ? prompt.promptEn ?? ""
          : prompt.promptZh
    const now = new Date().toISOString()
    const current = prompt.generation?.runway ?? {
      status: "not-submitted" as const,
      attemptCount: 0,
      submissions: [] as ShotlistSubmission[],
    }
    const attempt = current.attemptCount + 1
    updatePrompt(prompt.id, (existing) => ({
      ...existing,
      generation: {
        ...existing.generation,
        runway: {
          status: "submitted",
          attemptCount: attempt,
          lastSubmittedAt: now,
          submissions: [
            ...(existing.generation?.runway?.submissions ?? []),
            {
              attempt,
              submittedAt: now,
              targetUrl: RUNWAY_URL,
              sourcePromptField,
              promptHash: clientHash(submittedPrompt),
              reuseSource: "latest-generation",
              notes: "Marked submitted from Backlot shotlist UI.",
            },
          ],
        },
      },
    }))
    toast.success(`Marked ${prompt.id} submitted`, {
      description: `Attempt ${attempt} at ${now}`,
    })
  }

  if (read.isPending && !doc) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        Loading shotlist
      </div>
    )
  }

  if ((!read.data?.exists && !doc) || !doc) {
    return (
      <ShotlistEmpty
        title="Shotlist unavailable"
        message="This shotlist file could not be read."
      />
    )
  }

  return (
    <div className="flex h-full flex-col bg-background overflow-hidden">
      <ShotlistHeader doc={doc} relPath={relPath} saveState={saveState} />
      <div className="flex flex-1 min-h-0">
        <SceneRail
          scenes={scenes}
          selectedSceneId={scene?.id ?? null}
          onSelect={setSelectedSceneId}
        />
        <main className="flex-1 min-w-0 flex flex-col">
          {scene ? (
            <>
              <div className="flex items-center gap-2 px-5 py-2 border-b border-border bg-card/20">
                <div className="relative flex-1 min-w-[220px]">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search shots, prompts, dialogue..."
                    className={cn(
                      "w-full h-8 rounded border border-border bg-background pl-7 pr-3",
                      "text-xs outline-none focus:border-primary/60",
                    )}
                  />
                </div>
                <select
                  value={planFilter}
                  onChange={(e) => setPlanFilter(e.target.value)}
                  className="h-8 rounded border border-border bg-background px-2 text-xs outline-none"
                >
                  <option value="">All plans</option>
                  {planOptions.map((plan) => (
                    <option key={plan} value={plan}>
                      {plan}
                    </option>
                  ))}
                </select>
              </div>
              <ShotRowsTable
                rows={filteredRows}
                promptById={promptById}
                selectedPromptId={selectedPromptId}
                onSelectPrompt={setSelectedPromptId}
              />
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center px-10 text-center text-sm text-muted-foreground">
              The agent hasn't added any scenes yet.
            </div>
          )}
        </main>
        <PromptInspector
          prompt={selectedPrompt}
          rows={(scene?.rows ?? []).filter(
            (row) => row.promptId === selectedPrompt?.id,
          )}
          onChange={(promptId, patch) =>
            updatePrompt(promptId, (prompt) => ({ ...prompt, ...patch }))
          }
          onMarkSubmitted={markSubmitted}
        />
      </div>
    </div>
  )
}

function ShotlistHeader({
  doc,
  relPath,
  saveState,
}: {
  doc: ShotlistDocument
  relPath: string
  saveState: "idle" | "saving" | "saved"
}) {
  const sceneCount = doc.scenes.length
  const shotCount = doc.scenes.reduce((sum, s) => sum + s.rows.length, 0)
  const promptCount = doc.scenes.reduce((sum, s) => sum + s.prompts.length, 0)
  const derived: Array<[string, string | number]> = [
    ["Scenes", sceneCount],
    ["Shots", shotCount],
    ["Prompts", promptCount],
  ]

  return (
    <header className="shrink-0 px-6 pt-5 pb-4 border-b border-border bg-background">
      <div className="flex items-start justify-between gap-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="inline-block w-4 h-px bg-primary" />
            <span className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground font-mono">
              Shotlist
            </span>
          </div>
          <h1
            className="text-[28px] leading-tight text-foreground truncate"
            style={{ fontFamily: "var(--font-display)", fontWeight: 600 }}
          >
            {doc.title}
          </h1>
          {doc.subtitle && (
            <p className="mt-1 text-xs text-muted-foreground truncate">
              {doc.subtitle}
            </p>
          )}
        </div>
        <div className="shrink-0 text-right">
          <SaveState state={saveState} />
          <div className="mt-1 text-[10px] text-muted-foreground/65 font-mono max-w-[360px] truncate">
            {relPath}
          </div>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-5">
        {derived.map(([label, value]) => (
          <div key={label}>
            <div className="text-lg font-semibold tabular-nums text-primary leading-none">
              {value}
            </div>
            <div className="mt-1 text-[9px] uppercase tracking-[0.16em] text-muted-foreground font-mono">
              {label}
            </div>
          </div>
        ))}
        {Object.entries(doc.stats).map(([label, value]) => (
          <div key={label}>
            <div className="text-lg font-semibold tabular-nums text-foreground/70 leading-none">
              {value}
            </div>
            <div className="mt-1 text-[9px] uppercase tracking-[0.16em] text-muted-foreground font-mono">
              {label}
            </div>
          </div>
        ))}
      </div>
    </header>
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
  return <span className="text-[11px] text-muted-foreground/55">Idle</span>
}

function SceneRail({
  scenes,
  selectedSceneId,
  onSelect,
}: {
  scenes: ShotlistScene[]
  selectedSceneId: string | null
  onSelect: (sceneId: string) => void
}) {
  return (
    <aside className="w-56 shrink-0 border-r border-border bg-card/20 flex flex-col min-h-0">
      <div className="shrink-0 px-3 py-2 border-b border-border text-[10px] uppercase tracking-[0.16em] text-muted-foreground font-mono">
        Scenes
      </div>
      <div className="flex-1 min-h-0 overflow-auto py-1">
        {scenes.length === 0 && (
          <div className="px-3 py-4 text-[11px] text-muted-foreground/60">
            No scenes yet.
          </div>
        )}
        {scenes.map((scene) => {
          const selected = scene.id === selectedSceneId
          return (
            <button
              key={scene.id}
              type="button"
              onClick={() => onSelect(scene.id)}
              className={cn(
                "block w-full text-left px-3 py-2 border-l-2 transition-colors",
                selected
                  ? "border-primary bg-primary/10"
                  : "border-transparent hover:bg-secondary/40",
              )}
            >
              <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground font-mono">
                {scene.numberLabel}
              </div>
              <div className="mt-0.5 text-xs text-foreground/90 line-clamp-2">
                {scene.title}
              </div>
              <div className="mt-1 text-[10px] text-muted-foreground/70 font-mono">
                {scene.rows.length} shots · {scene.prompts.length} prompts
              </div>
            </button>
          )
        })}
      </div>
    </aside>
  )
}

function ShotRowsTable({
  rows,
  promptById,
  selectedPromptId,
  onSelectPrompt,
}: {
  rows: ShotlistRow[]
  promptById: Map<string, ShotlistPrompt>
  selectedPromptId: string | null
  onSelectPrompt: (promptId: string) => void
}) {
  return (
    <div className="flex-1 min-h-0 overflow-auto">
      <table className="w-full text-xs border-collapse">
        <thead className="sticky top-0 z-10 bg-card border-b border-border">
          <tr className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-mono">
            <th className="text-left font-medium px-4 py-2 w-16">#</th>
            <th className="text-left font-medium px-2 py-2 w-28">Plan</th>
            <th className="text-left font-medium px-2 py-2 w-36">Camera</th>
            <th className="text-left font-medium px-2 py-2">Action</th>
            <th className="text-left font-medium px-2 py-2">Scene text</th>
            <th className="text-left font-medium px-2 py-2 w-44">Prompt</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const prompt = row.promptId ? promptById.get(row.promptId) : null
            const selected = prompt?.id === selectedPromptId
            return (
              <tr
                key={row.id}
                onClick={() => prompt?.id && onSelectPrompt(prompt.id)}
                className={cn(
                  "border-b border-border/50 align-top cursor-default",
                  selected ? "bg-primary/10" : "hover:bg-secondary/35",
                )}
              >
                <td className="px-4 py-2 text-muted-foreground font-mono tabular-nums">
                  {row.id}
                </td>
                <td className="px-2 py-2">
                  <PlanBadge plan={row.plan} label={row.planLabel} />
                </td>
                <td className="px-2 py-2 text-muted-foreground">
                  {row.camera}
                </td>
                <td className="px-2 py-2 text-foreground/90">{row.action}</td>
                <td className="px-2 py-2 text-muted-foreground max-w-[320px]">
                  <div className="line-clamp-4 whitespace-pre-line">
                    {row.sceneText}
                  </div>
                </td>
                <td className="px-2 py-2">
                  {prompt ? (
                    <div className="space-y-1">
                      <div className="font-medium text-foreground">
                        {prompt.label}
                      </div>
                      <div className="text-[10px] text-muted-foreground line-clamp-2">
                        {prompt.tag}
                      </div>
                    </div>
                  ) : (
                    <span className="text-muted-foreground/50">None</span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {rows.length === 0 && (
        <div className="px-6 py-10 text-center text-sm text-muted-foreground">
          No shots in this scene yet.
        </div>
      )}
    </div>
  )
}

function PromptInspector({
  prompt,
  rows,
  onChange,
  onMarkSubmitted,
}: {
  prompt: ShotlistPrompt | null
  rows: ShotlistRow[]
  onChange: (promptId: string, patch: Partial<ShotlistPrompt>) => void
  onMarkSubmitted: (prompt: ShotlistPrompt) => void
}) {
  if (!prompt) {
    return (
      <aside className="w-[440px] shrink-0 border-l border-border bg-card/20 flex items-center justify-center px-8 text-center text-sm text-muted-foreground">
        Select a row to inspect its prompt.
      </aside>
    )
  }
  const runway = prompt.generation?.runway
  return (
    <aside className="w-[460px] shrink-0 border-l border-border bg-card/20 flex flex-col min-h-0">
      <div className="shrink-0 px-4 py-3 border-b border-border bg-card/40">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-mono">
              Prompt {prompt.number}
            </div>
            <h2 className="mt-1 text-sm font-semibold text-foreground truncate">
              {prompt.tag || prompt.label}
            </h2>
          </div>
          <div className="text-right shrink-0">
            <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-mono">
              Runway
            </div>
            <div className="mt-1 text-xs text-foreground">
              {runway?.status ?? "not-submitted"} · {runway?.attemptCount ?? 0}
            </div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1">
          {rows.map((row) => (
            <span
              key={row.id}
              className="px-1.5 py-0.5 rounded bg-background border border-border text-[10px] font-mono text-muted-foreground"
            >
              {row.id}
            </span>
          ))}
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-auto px-4 py-3 space-y-4">
        <PromptTextarea
          label="Runway prompt"
          value={prompt.promptRunway ?? ""}
          placeholder="Optional Runway-specific prompt. If empty, Backlot uses EN first, then ZH."
          onChange={(value) =>
            onChange(prompt.id, { promptRunway: value || undefined })
          }
        />
        <PromptTextarea
          label="English translation"
          icon={<Languages className="h-3.5 w-3.5" />}
          value={prompt.promptEn ?? ""}
          placeholder="Precise English translation for review and Runway fallback."
          onChange={(value) =>
            onChange(prompt.id, {
              promptEn: value || undefined,
              translationStatus: value ? "reviewed" : "missing",
            })
          }
        />
        <PromptTextarea
          label="Chinese source"
          value={prompt.promptZh}
          onChange={(value) =>
            onChange(prompt.id, {
              promptZh: value,
              translationStatus: "stale",
            })
          }
        />
      </div>
      <div className="shrink-0 border-t border-border bg-card/40 px-4 py-3 space-y-2">
        <div className="grid grid-cols-3 gap-2">
          <SmallAction
            icon={<Clipboard className="h-3.5 w-3.5" />}
            label="Copy EN"
            onClick={() =>
              copyText(prompt.promptEn || prompt.promptZh, "Copied English prompt")
            }
          />
          <SmallAction
            icon={<Clipboard className="h-3.5 w-3.5" />}
            label="Copy ZH"
            onClick={() => copyText(prompt.promptZh, "Copied Chinese prompt")}
          />
          <SmallAction
            icon={<Send className="h-3.5 w-3.5" />}
            label="Submitted"
            onClick={() => onMarkSubmitted(prompt)}
          />
        </div>
        {runway?.lastSubmittedAt && (
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Clock3 className="h-3.5 w-3.5" />
            Last submitted {runway.lastSubmittedAt}
          </div>
        )}
      </div>
    </aside>
  )
}

function PromptTextarea({
  label,
  value,
  placeholder,
  icon,
  onChange,
}: {
  label: string
  value: string
  placeholder?: string
  icon?: ReactNode
  onChange: (value: string) => void
}) {
  return (
    <label className="block">
      <div className="mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] text-muted-foreground font-mono">
        {icon}
        {label}
      </div>
      <textarea
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "w-full min-h-[180px] rounded border border-border bg-background p-3",
          "text-[11.5px] leading-5 text-foreground/90 outline-none resize-y",
          "focus:border-primary/60",
        )}
        spellCheck
      />
    </label>
  )
}

function SmallAction({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "press inline-flex items-center justify-center gap-1.5 rounded px-2 py-1.5",
        "border border-border bg-background text-xs text-foreground/85",
        "hover:bg-secondary hover:text-foreground transition-colors",
      )}
    >
      {icon}
      {label}
    </button>
  )
}

function PlanBadge({ plan, label }: { plan: string; label: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.04em]",
        plan === "WS" && "bg-blue-500/15 text-blue-600 dark:text-blue-300",
        plan === "MS" && "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
        plan === "CU" && "bg-violet-500/15 text-violet-600 dark:text-violet-300",
        plan === "ECU" && "bg-rose-500/15 text-rose-600 dark:text-rose-300",
        !["WS", "MS", "CU", "ECU"].includes(plan) &&
          "bg-secondary text-muted-foreground",
      )}
      title={label}
    >
      {label || plan || "Shot"}
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
      <p className="mt-1 text-sm text-muted-foreground">{message}</p>
    </div>
  )
}

async function copyText(text: string, message: string) {
  try {
    if (window.desktopApi?.clipboardWrite) {
      await window.desktopApi.clipboardWrite(text)
    } else {
      await navigator.clipboard.writeText(text)
    }
    toast.success(message)
  } catch {
    toast.error("Couldn't copy prompt")
  }
}

function clientHash(text: string): string {
  let hash = 2166136261
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return `fnv1a-${(hash >>> 0).toString(16)}`
}
