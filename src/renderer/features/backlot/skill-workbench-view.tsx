"use client"

/**
 * SkillWorkbenchView — the center surface of Skill Workbench mode.
 *
 * A multi-tab editor over the files of the skills Backlot surfaces in
 * Settings. Each tab is one file inside one skill folder. Tabs can sit
 * on the left or right pane; when any tab is on the right the editor
 * splits side-by-side so the user can hold two skill files (or a skill
 * and its reference doc) in view at once.
 *
 * Edits still autosave to disk, but saving into the skill library is
 * explicit: the library is git-backed, dirty files show up in the
 * explorer, and the user can save, discard, or roll a file back.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useAtom } from "jotai"
import {
  Check,
  Clock3,
  FileText,
  GitCompare,
  PanelLeft,
  PanelRight,
  RotateCcw,
  Wrench,
  X,
} from "lucide-react"
import { toast } from "sonner"
import { RichMarkdownEditor } from "./rich-markdown-editor"
import { trpc } from "../../lib/trpc"
import { cn } from "../../lib/utils"
import {
  skillWorkbenchActiveAtom,
  skillWorkbenchSplitAtom,
  skillWorkbenchTabsAtom,
  type SkillWorkbenchTab,
} from "./atoms"
import { Resizer } from "./resizer"

// ────────────────────────────────────────────────────────────────────────
// Open-a-file hook — shared by the explorer and the agent focus host.
// ────────────────────────────────────────────────────────────────────────

export interface SkillFileRef {
  skillName: string
  skillDir: string
  relPath: string
}

/**
 * Returns a callback that opens a skill file as a workbench tab. If the
 * file is already open it just re-activates that tab in its pane.
 */
export function useOpenSkillFile() {
  const [tabs, setTabs] = useAtom(skillWorkbenchTabsAtom)
  const [active, setActive] = useAtom(skillWorkbenchActiveAtom)

  return useCallback(
    (file: SkillFileRef) => {
      const id = `${file.skillName}::${file.relPath}`
      const existing = tabs.find((t) => t.id === id)
      if (existing) {
        setActive({ ...active, [existing.pane]: id })
        return
      }
      const tab: SkillWorkbenchTab = {
        id,
        skillName: file.skillName,
        skillDir: file.skillDir,
        relPath: file.relPath,
        pane: "left",
      }
      setTabs([...tabs, tab])
      setActive({ ...active, left: id })
    },
    [tabs, active, setTabs, setActive],
  )
}

// ────────────────────────────────────────────────────────────────────────
// View
// ────────────────────────────────────────────────────────────────────────

export function SkillWorkbenchView() {
  const [tabs, setTabs] = useAtom(skillWorkbenchTabsAtom)
  const [active, setActive] = useAtom(skillWorkbenchActiveAtom)
  const [split, setSplit] = useAtom(skillWorkbenchSplitAtom)
  const containerRef = useRef<HTMLDivElement | null>(null)

  const leftTabs = useMemo(() => tabs.filter((t) => t.pane === "left"), [tabs])
  const rightTabs = useMemo(
    () => tabs.filter((t) => t.pane === "right"),
    [tabs],
  )
  const splitOpen = rightTabs.length > 0

  // Keep each pane's active id pointing at a tab that still exists in
  // that pane. Runs after any tab close / move.
  useEffect(() => {
    const fix = (paneTabs: SkillWorkbenchTab[], current: string | null) =>
      current && paneTabs.some((t) => t.id === current)
        ? current
        : (paneTabs[paneTabs.length - 1]?.id ?? null)
    const nextLeft = fix(leftTabs, active.left)
    const nextRight = fix(rightTabs, active.right)
    if (nextLeft !== active.left || nextRight !== active.right) {
      setActive({ left: nextLeft, right: nextRight })
    }
  }, [leftTabs, rightTabs, active, setActive])

  const closeTab = useCallback(
    (id: string) => {
      setTabs(tabs.filter((t) => t.id !== id))
    },
    [tabs, setTabs],
  )

  const moveTab = useCallback(
    (id: string) => {
      setTabs(
        tabs.map((t) =>
          t.id === id
            ? { ...t, pane: t.pane === "left" ? "right" : "left" }
            : t,
        ),
      )
    },
    [tabs, setTabs],
  )

  const onResize = useCallback(
    (delta: number) => {
      const width = containerRef.current?.clientWidth ?? 0
      if (width <= 0) return
      setSplit((s) => Math.min(0.8, Math.max(0.2, s + delta / width)))
    },
    [setSplit],
  )

  if (tabs.length === 0) {
    return <EmptyWorkbench />
  }

  return (
    <div ref={containerRef} className="flex h-full w-full overflow-hidden">
      <div
        className="min-w-0 flex flex-col"
        style={{ width: splitOpen ? `${split * 100}%` : "100%" }}
      >
        <SkillPane
          paneKey="left"
          tabs={leftTabs}
          activeId={active.left}
          onSelect={(id) => setActive({ ...active, left: id })}
          onClose={closeTab}
          onMove={moveTab}
        />
      </div>

      {splitOpen && (
        <>
          <Resizer axis="x" onResize={onResize} />
          <div className="flex-1 min-w-0 flex flex-col">
            <SkillPane
              paneKey="right"
              tabs={rightTabs}
              activeId={active.right}
              onSelect={(id) => setActive({ ...active, right: id })}
              onClose={closeTab}
              onMove={moveTab}
            />
          </div>
        </>
      )}
    </div>
  )
}

function EmptyWorkbench() {
  return (
    <div className="flex h-full w-full items-center justify-center p-8">
      <div className="max-w-sm text-center space-y-2">
        <Wrench className="h-6 w-6 mx-auto text-muted-foreground/50" />
        <p
          className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground/65"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          Skill Workbench
        </p>
        <p
          className="text-[12.5px] leading-[1.6] text-muted-foreground/80"
          style={{ fontFamily: "var(--font-body)" }}
        >
          Pick a skill from the explorer on the left to read and edit it —
          or ask the assistant to open one for you.
        </p>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Pane — tab strip + editor for the active tab.
// ────────────────────────────────────────────────────────────────────────

function SkillPane({
  paneKey,
  tabs,
  activeId,
  onSelect,
  onClose,
  onMove,
}: {
  paneKey: "left" | "right"
  tabs: SkillWorkbenchTab[]
  activeId: string | null
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onMove: (id: string) => void
}) {
  const activeTab = tabs.find((t) => t.id === activeId) ?? tabs[tabs.length - 1]

  if (tabs.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-[11.5px] text-muted-foreground/55 italic">
          No file in this pane
        </p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col min-h-0">
      <div className="flex items-stretch shrink-0 border-b border-border/60 overflow-x-auto">
        {tabs.map((tab) => (
          <SkillTab
            key={tab.id}
            tab={tab}
            active={tab.id === activeTab?.id}
            paneKey={paneKey}
            onSelect={() => onSelect(tab.id)}
            onClose={() => onClose(tab.id)}
            onMove={() => onMove(tab.id)}
          />
        ))}
      </div>
      <div className="flex-1 min-h-0">
        {activeTab && (
          <SkillFileEditor
            key={activeTab.id}
            skillDir={activeTab.skillDir}
            relPath={activeTab.relPath}
          />
        )}
      </div>
    </div>
  )
}

function SkillTab({
  tab,
  active,
  paneKey,
  onSelect,
  onClose,
  onMove,
}: {
  tab: SkillWorkbenchTab
  active: boolean
  paneKey: "left" | "right"
  onSelect: () => void
  onClose: () => void
  onMove: () => void
}) {
  const fileName = tab.relPath.split("/").pop() ?? tab.relPath
  return (
    <div
      className={cn(
        "group/tab relative flex items-center gap-1.5 pl-3 pr-1.5 py-1.5 shrink-0",
        "border-r border-border/60 cursor-pointer max-w-[220px]",
        active
          ? "bg-foreground/[0.06] dark:bg-foreground/[0.08]"
          : "hover:bg-foreground/[0.03]",
      )}
      onClick={onSelect}
      title={`${tab.skillName} / ${tab.relPath}`}
    >
      <FileText
        className={cn(
          "h-3.5 w-3.5 shrink-0",
          active ? "text-foreground/80" : "text-muted-foreground/55",
        )}
      />
      <span
        className={cn(
          "truncate text-[12px]",
          active ? "text-foreground font-medium" : "text-foreground/70",
        )}
        style={{ fontFamily: "var(--font-body)" }}
      >
        {fileName}
      </span>
      <span className="text-[10px] text-muted-foreground/45 font-mono shrink-0">
        {tab.skillName}
      </span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onMove()
        }}
        title={
          tab.pane === "left"
            ? "Open in the right pane"
            : "Move to the left pane"
        }
        aria-label="Move tab to other pane"
        className={cn(
          "shrink-0 h-5 w-5 flex items-center justify-center rounded",
          "text-muted-foreground/0 group-hover/tab:text-muted-foreground/60",
          "hover:!text-primary hover:bg-primary/10 transition-colors",
        )}
      >
        {paneKey === "left" ? (
          <PanelRight className="h-3 w-3" />
        ) : (
          <PanelLeft className="h-3 w-3" />
        )}
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
        title="Close tab"
        aria-label="Close tab"
        className={cn(
          "shrink-0 h-5 w-5 flex items-center justify-center rounded",
          "text-muted-foreground/0 group-hover/tab:text-muted-foreground/60",
          "hover:!text-foreground hover:bg-foreground/10 transition-colors",
          active && "text-muted-foreground/45",
        )}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
// File editor — direct edit + debounced autosave. Markdown files edit
// in a WYSIWYG "Rich" view (with a rendered preamble card) and can be
// flipped to a "Raw" markdown view. Both views are editable.
// ────────────────────────────────────────────────────────────────────────

const AUTOSAVE_DELAY_MS = 600

type SkillFileStatus = "clean" | "modified" | "untracked" | "deleted" | "added"

interface SkillReviewHunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: Array<{ kind: "context" | "added" | "removed"; text: string }>
}

function SkillFileEditor({
  skillDir,
  relPath,
}: {
  skillDir: string
  relPath: string
}) {
  const isMarkdown = relPath.toLowerCase().endsWith(".md")
  const [mode, setMode] = useState<"rich" | "raw">(
    isMarkdown ? "rich" : "raw",
  )
  const [content, setContent] = useState<string | null>(null)
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  )
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Latest unsaved buffer. Held in a ref so an unmount (tab switch /
  // close) mid-debounce can still flush it.
  const latestRef = useRef<string | null>(null)
  const lastServerContentRef = useRef<string | null>(null)

  const fileQuery = trpc.skillWorkbench.readFile.useQuery(
    { skillDir, relPath },
    { refetchOnWindowFocus: false, refetchInterval: 2000 },
  )
  // Writes go through the vanilla client, not useMutation — that way a
  // flush triggered while the component is unmounting still completes.
  const utils = trpc.useUtils()
  const refreshWorkbench = useCallback(() => {
    void utils.skillWorkbench.readFile.invalidate({ skillDir, relPath })
    void utils.skillWorkbench.tree.invalidate({ skillDir })
    void utils.skillWorkbench.list.invalidate()
  }, [skillDir, relPath, utils])

  const history = trpc.skillWorkbench.history.useQuery(
    { skillDir, relPath },
    { enabled: !!fileQuery.data, refetchOnWindowFocus: false },
  )
  const saveFile = trpc.skillWorkbench.saveFile.useMutation({
    onSuccess: () => {
      refreshWorkbench()
      void history.refetch()
      toast.success("Skill change saved")
    },
    onError: (e) => toast.error(e.message || "Couldn't save skill change"),
  })
  const discardFile = trpc.skillWorkbench.discardFile.useMutation({
    onSuccess: async () => {
      latestRef.current = null
      const next = await fileQuery.refetch()
      if (next.data) {
        lastServerContentRef.current = next.data.content
        setContent(next.data.content)
      }
      refreshWorkbench()
      toast.success("Skill change discarded")
    },
    onError: (e) => toast.error(e.message || "Couldn't discard skill change"),
  })
  const rollback = trpc.skillWorkbench.rollbackFile.useMutation({
    onSuccess: async () => {
      latestRef.current = null
      const next = await fileQuery.refetch()
      if (next.data) {
        lastServerContentRef.current = next.data.content
        setContent(next.data.content)
      }
      refreshWorkbench()
      toast.success("Rolled file back")
    },
    onError: (e) => toast.error(e.message || "Couldn't roll back file"),
  })

  // Load buffer once per file. The `key` on this component is the tab
  // id, so a new file always remounts — no cross-file bleed.
  useEffect(() => {
    if (!fileQuery.data) return
    if (content === null) {
      lastServerContentRef.current = fileQuery.data.content
      setContent(fileQuery.data.content)
      return
    }
    if (
      latestRef.current === null &&
      lastServerContentRef.current !== fileQuery.data.content
    ) {
      lastServerContentRef.current = fileQuery.data.content
      setContent(fileQuery.data.content)
    }
  }, [fileQuery.data, content])

  const flush = useCallback(async () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    const next = latestRef.current
    if (next === null) return
    latestRef.current = null
    setStatus("saving")
    try {
      await utils.client.skillWorkbench.writeFile.mutate({
        skillDir,
        relPath,
        content: next,
      })
      lastServerContentRef.current = next
      setStatus("saved")
      refreshWorkbench()
    } catch {
      setStatus("error")
    }
  }, [skillDir, relPath, utils, refreshWorkbench])

  // Always flush through the freshest closure on unmount.
  const flushRef = useRef(flush)
  useEffect(() => {
    flushRef.current = flush
  }, [flush])
  useEffect(() => {
    return () => {
      void flushRef.current()
    }
  }, [])

  const onChange = useCallback((next: string) => {
    setContent(next)
    latestRef.current = next
    setStatus("saving")
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      void flushRef.current()
    }, AUTOSAVE_DELAY_MS)
  }, [])

  const currentStatus: SkillFileStatus = fileQuery.data?.status ?? "clean"
  const isDirty = currentStatus !== "clean"
  const hunks = (fileQuery.data?.hunks ?? []) as SkillReviewHunk[]

  const saveCurrentFile = useCallback(async () => {
    await flushRef.current()
    saveFile.mutate({ skillDir, relPath })
  }, [skillDir, relPath, saveFile])

  const discardCurrentFile = useCallback(() => {
    discardFile.mutate({ skillDir, relPath })
  }, [skillDir, relPath, discardFile])

  if (fileQuery.isError) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <p className="text-[12px] text-rose-500 max-w-sm text-center">
          Couldn't read this file. {fileQuery.error.message}
        </p>
      </div>
    )
  }

  if (content === null) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-[11px] uppercase tracking-[0.2em] font-mono text-muted-foreground/50">
          Loading
        </p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col min-h-0">
      {/* File chrome — path, save status, Rich/Raw toggle. */}
      <div className="flex items-center gap-2 px-3 py-1.5 shrink-0 border-b border-border/40">
        <span
          className="truncate text-[11px] text-muted-foreground/70 font-mono"
          title={relPath}
        >
          {relPath}
        </span>
        <SaveStatus status={status} />
        {isDirty ? <DirtyStatus status={currentStatus} /> : null}
        {isMarkdown && (
          <div className="ml-auto flex items-center gap-0.5 rounded-md bg-foreground/[0.05] p-0.5">
            {(["rich", "raw"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={cn(
                  "press rounded px-2 py-0.5 text-[10px] uppercase tracking-wider font-mono transition-colors",
                  mode === m
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground/70 hover:text-foreground",
                )}
              >
                {m}
              </button>
            ))}
          </div>
        )}
      </div>
      {isDirty && (
        <SkillReviewBar
          status={currentStatus}
          hunks={hunks}
          history={history.data ?? []}
          busy={
            saveFile.isPending || discardFile.isPending || rollback.isPending
          }
          onSave={saveCurrentFile}
          onDiscard={discardCurrentFile}
          onRollback={(commit) =>
            rollback.mutate({ skillDir, relPath, commit })
          }
        />
      )}

      <div className="flex-1 min-h-0 overflow-auto">
        {isMarkdown && mode === "rich" ? (
          <RichMarkdownEditor
            value={content}
            onChange={onChange}
            editable
            autoFocus={false}
            frontmatterVariant="skill"
          />
        ) : (
          <textarea
            value={content}
            onChange={(e) => onChange(e.target.value)}
            spellCheck={false}
            className={cn(
              "h-full w-full resize-none bg-transparent outline-none",
              "px-6 py-5 text-[12.5px] leading-[1.65]",
            )}
            style={{ fontFamily: "var(--font-mono)" }}
          />
        )}
      </div>
    </div>
  )
}

function DirtyStatus({ status }: { status: SkillFileStatus }) {
  const label =
    status === "untracked"
      ? "Untracked"
      : status === "deleted"
        ? "Deleted"
        : status === "added"
          ? "Added"
          : "Modified"
  return (
    <span
      className={cn(
        "rounded-sm px-1.5 py-0.5 text-[10px] uppercase tracking-wider font-mono",
        status === "deleted"
          ? "bg-rose-500/10 text-rose-500"
          : "bg-primary/10 text-primary",
      )}
    >
      {label}
    </span>
  )
}

function SkillReviewBar({
  status,
  hunks,
  history,
  busy,
  onSave,
  onDiscard,
  onRollback,
}: {
  status: SkillFileStatus
  hunks: SkillReviewHunk[]
  history: Array<{
    hash: string
    shortHash: string
    date: string
    subject: string
  }>
  busy: boolean
  onSave: () => void
  onDiscard: () => void
  onRollback: (commit: string) => void
}) {
  const [expanded, setExpanded] = useState(true)
  const [historyOpen, setHistoryOpen] = useState(false)
  const changedLines = hunks.reduce(
    (sum, hunk) =>
      sum +
      hunk.lines.filter((line) => line.kind === "added" || line.kind === "removed")
        .length,
    0,
  )

  return (
    <div className="shrink-0 border-b border-border/45 bg-background/60">
      <div className="flex items-center gap-2 px-3 py-2">
        <GitCompare className="h-3.5 w-3.5 text-primary/80" />
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="min-w-0 flex-1 text-left"
        >
          <span
            className="block truncate text-[12px] text-foreground/85"
            style={{ fontFamily: "var(--font-body)", fontWeight: 500 }}
          >
            {changedLines > 0
              ? `${changedLines} changed line${changedLines === 1 ? "" : "s"}`
              : status === "untracked"
                ? "New file"
                : "Pending skill change"}
          </span>
          <span className="block text-[10.5px] text-muted-foreground/65">
            Save commits this file. Discard restores it from the last saved
            revision.
          </span>
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onSave}
          className={cn(
            "press inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px]",
            "bg-primary text-primary-foreground disabled:opacity-50",
          )}
        >
          <Check className="h-3.5 w-3.5" />
          Save
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onDiscard}
          className={cn(
            "press inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px]",
            "bg-foreground/[0.06] text-foreground/80 hover:bg-foreground/[0.1]",
            "disabled:opacity-50",
          )}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Discard
        </button>
        {history.length > 1 && (
          <button
            type="button"
            onClick={() => setHistoryOpen((v) => !v)}
            className={cn(
              "press inline-flex h-7 w-7 items-center justify-center rounded-md",
              "text-muted-foreground/70 hover:bg-foreground/[0.06] hover:text-foreground",
            )}
            title="Saved revisions"
            aria-label="Saved revisions"
          >
            <Clock3 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {expanded && hunks.length > 0 && (
        <div className="max-h-52 overflow-auto border-t border-border/35 px-3 py-2">
          <div className="space-y-2">
            {hunks.slice(0, 8).map((hunk, index) => (
              <MiniHunk key={`${hunk.newStart}-${index}`} hunk={hunk} />
            ))}
          </div>
        </div>
      )}

      {historyOpen && (
        <div className="border-t border-border/35 px-3 py-2">
          <div className="space-y-1">
            {history.slice(1, 8).map((entry) => (
              <button
                key={entry.hash}
                type="button"
                disabled={busy}
                onClick={() => onRollback(entry.hash)}
                className={cn(
                  "w-full rounded-md px-2 py-1.5 text-left transition-colors",
                  "hover:bg-foreground/[0.05] disabled:opacity-50",
                )}
              >
                <span className="block truncate text-[11.5px] text-foreground/80">
                  {entry.subject}
                </span>
                <span className="font-mono text-[10px] text-muted-foreground/55">
                  {entry.shortHash} · {entry.date}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function MiniHunk({ hunk }: { hunk: SkillReviewHunk }) {
  const visible = hunk.lines.filter((line) => line.kind !== "context").slice(0, 10)
  return (
    <div>
      <div className="mb-1 font-mono text-[10px] text-muted-foreground/55">
        lines {hunk.newStart}-{Math.max(hunk.newStart, hunk.newStart + hunk.newLines - 1)}
      </div>
      <div className="space-y-0.5">
        {visible.map((line, index) => (
          <div
            key={`${line.kind}-${index}-${line.text}`}
            className={cn(
              "grid grid-cols-[18px_1fr] gap-2 rounded-sm px-1 py-0.5 font-mono text-[11px]",
              line.kind === "added"
                ? "bg-primary/8 text-foreground"
                : "bg-rose-500/8 text-foreground/75",
            )}
          >
            <span
              className={
                line.kind === "added" ? "text-primary" : "text-rose-500"
              }
            >
              {line.kind === "added" ? "+" : "-"}
            </span>
            <span className="truncate">{line.text || " "}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function SaveStatus({
  status,
}: {
  status: "idle" | "saving" | "saved" | "error"
}) {
  if (status === "idle") return null
  const label =
    status === "saving"
      ? "Writing…"
      : status === "saved"
        ? "Draft saved"
        : "Write failed"
  return (
    <span
      className={cn(
        "text-[10px] uppercase tracking-wider font-mono",
        status === "error" ? "text-rose-500" : "text-muted-foreground/50",
      )}
    >
      {label}
    </span>
  )
}
