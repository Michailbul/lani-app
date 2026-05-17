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
 * Editing is direct + autosave — the same low-friction convention as
 * the writer's surfaces. The agent's own skill edits still route
 * through the propose_skill_change diff modal.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useAtom } from "jotai"
import { FileText, PanelLeft, PanelRight, Wrench, X } from "lucide-react"
import { ChatMarkdownRenderer } from "../../components/chat-markdown-renderer"
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
// File editor — direct edit + debounced autosave, with a markdown
// preview toggle for .md files.
// ────────────────────────────────────────────────────────────────────────

const AUTOSAVE_DELAY_MS = 600

function SkillFileEditor({
  skillDir,
  relPath,
}: {
  skillDir: string
  relPath: string
}) {
  const isMarkdown = relPath.toLowerCase().endsWith(".md")
  const [mode, setMode] = useState<"edit" | "preview">(
    isMarkdown ? "preview" : "edit",
  )
  const [content, setContent] = useState<string | null>(null)
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  )
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Latest unsaved buffer. Held in a ref so an unmount (tab switch /
  // close) mid-debounce can still flush it.
  const latestRef = useRef<string | null>(null)

  const fileQuery = trpc.skillWorkbench.readFile.useQuery(
    { skillDir, relPath },
    { refetchOnWindowFocus: false },
  )
  // Writes go through the vanilla client, not useMutation — that way a
  // flush triggered while the component is unmounting still completes.
  const utils = trpc.useUtils()

  // Load buffer once per file. The `key` on this component is the tab
  // id, so a new file always remounts — no cross-file bleed.
  useEffect(() => {
    if (fileQuery.data && content === null) {
      setContent(fileQuery.data.content)
    }
  }, [fileQuery.data, content])

  const flush = useCallback(() => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    const next = latestRef.current
    if (next === null) return
    latestRef.current = null
    setStatus("saving")
    utils.client.skillWorkbench.writeFile
      .mutate({ skillDir, relPath, content: next })
      .then(() => setStatus("saved"))
      .catch(() => setStatus("error"))
  }, [skillDir, relPath, utils])

  // Always flush through the freshest closure on unmount.
  const flushRef = useRef(flush)
  useEffect(() => {
    flushRef.current = flush
  }, [flush])
  useEffect(() => {
    return () => flushRef.current()
  }, [])

  const onChange = useCallback((next: string) => {
    setContent(next)
    latestRef.current = next
    setStatus("saving")
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => flushRef.current(), AUTOSAVE_DELAY_MS)
  }, [])

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
      {/* File chrome — path, save status, preview toggle. */}
      <div className="flex items-center gap-2 px-3 py-1.5 shrink-0 border-b border-border/40">
        <span
          className="truncate text-[11px] text-muted-foreground/70 font-mono"
          title={relPath}
        >
          {relPath}
        </span>
        <SaveStatus status={status} />
        {isMarkdown && (
          <button
            type="button"
            onClick={() => setMode((m) => (m === "edit" ? "preview" : "edit"))}
            className={cn(
              "ml-auto press text-[10px] uppercase tracking-wider font-mono px-2 py-0.5 rounded",
              "text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors",
            )}
          >
            {mode === "edit" ? "Preview" : "Edit"}
          </button>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        {isMarkdown && mode === "preview" ? (
          <div
            className="px-6 py-5 cursor-text"
            onClick={() => setMode("edit")}
            title="Click to edit"
          >
            <ChatMarkdownRenderer content={content} size="sm" />
          </div>
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

function SaveStatus({
  status,
}: {
  status: "idle" | "saving" | "saved" | "error"
}) {
  if (status === "idle") return null
  const label =
    status === "saving"
      ? "Saving…"
      : status === "saved"
        ? "Saved"
        : "Save failed"
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
