"use client"

/**
 * ScreenplayWorkspace — Backlot's two-column desktop layout.
 *
 * Replaces the upstream "single-column chat" arrangement with the
 * screenwriter shape: the screenplay artifact dominates the canvas,
 * the assistant lives in a narrow right rail.
 *
 *   ┌─────────────────────────────────────────┬──────────────┐
 *   │                                         │              │
 *   │  ScreenplayPane                         │  Assistant   │
 *   │  (the artifact — what you're writing)   │  (chat,      │
 *   │                                         │   children)  │
 *   │                                         │              │
 *   └─────────────────────────────────────────┴──────────────┘
 *
 * The right column accepts the existing <ChatView /> as children —
 * every existing tRPC stream, mention, and slash command keeps
 * working untouched. The left column is the new screenplay surface
 * (placeholder for now; CodeMirror in Phase D2).
 */

import { type ReactNode, useEffect, useRef } from "react"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  GitBranch,
  LayoutGrid,
  MessageSquare,
  MessageSquarePlus,
  PenLine,
  Plus,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"
import { ProjectTreeRail } from "./project-tree-rail"
import { ScreenplayPane } from "./screenplay-pane"
import { PromptsModeView } from "./prompts-mode-view"
import { CanvasModeView } from "./canvas-mode-view"
import { EntityEditor } from "./entity-editor"
import { Resizer } from "./resizer"
import { ShotlistSurface } from "./shotlist-surface"
import {
  activeEntityAtom,
  assistantRailOpenAtom,
  assistantRailWidthAtom,
  viewModeAtom,
} from "./atoms"
import { Sparkles } from "lucide-react"
import {
  selectedAgentChatIdAtom,
  selectedProjectAtom,
  threadCreateRequestAtom,
  type ThreadCreateOptions,
} from "../agents/atoms"
import { useAgentSubChatStore } from "../agents/stores/sub-chat-store"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu"
import { trpc } from "../../lib/trpc"
import { cn } from "../../lib/utils"

// The assistant rail is drag-resizable via the handle on its left edge.
// It can be made narrower, but never wider than its default: the chat
// lays out comfortably at the default width, and a wider rail only
// steals canvas from the screenplay — on a small window it can even
// push its own right edge off-screen. So default IS the max.
const RAIL_DEFAULT_WIDTH = 420 // keep in sync with assistantRailWidthAtom
const RAIL_MIN_WIDTH = 340
const RAIL_MAX_WIDTH = RAIL_DEFAULT_WIDTH

interface ScreenplayWorkspaceProps {
  chatId: string | null
  directionName?: string | null
  /** The existing <ChatView /> goes here. */
  assistant: ReactNode
}

export function ScreenplayWorkspace({
  chatId,
  directionName,
  assistant,
}: ScreenplayWorkspaceProps) {
  const [railOpen, setRailOpen] = useAtom(assistantRailOpenAtom)
  const [railUserWidth, setRailUserWidth] = useAtom(assistantRailWidthAtom)

  // Clamp the rendered width to the current bounds, and heal any value
  // persisted under the old 760px ceiling — without this, a rail dragged
  // wide in a past session keeps rendering off the window edge.
  const railWidth = Math.min(
    RAIL_MAX_WIDTH,
    Math.max(RAIL_MIN_WIDTH, railUserWidth),
  )
  useEffect(() => {
    if (railUserWidth !== railWidth) setRailUserWidth(railWidth)
  }, [railUserWidth, railWidth, setRailUserWidth])

  // Cmd+\ (or Ctrl+\) toggles the assistant rail. Single keystroke, mirrors
  // VS Code / Cursor's secondary-sidebar shortcut. Saves the user from
  // having to hunt for the tiny edge chevron when the rail is collapsed.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().includes("MAC")
      const mod = isMac ? e.metaKey : e.ctrlKey
      if (mod && e.key === "\\") {
        e.preventDefault()
        setRailOpen((v) => !v)
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [setRailOpen])

  return (
    <div className="relative flex h-full w-full overflow-hidden bg-background">
      {/* Master canvas — the editor's own paper tone fills the window.
          A faint lime halo keeps it from reading dead-flat. */}
      <AmbientCanvas />

      {/* Floating-island shell. The rail and assistant are cards lifted
          off the canvas; the navbar floats above the editor only, so the
          assistant rail keeps its full height beside it. */}
      <div className="relative z-10 flex h-full w-full gap-2.5 p-2.5">
        {/* Left rail — project tree navigator. */}
        <ProjectTreeRail />

        {/* Center column — the editor on the bare canvas, with the
            workflow mode dock floating at its bottom edge. */}
        <div className="relative flex-1 min-w-0 flex flex-col">
          <div className="relative flex-1 min-h-0 flex flex-col">
            <LineageBreadcrumb />
            <div className="flex-1 min-h-0">
              <ModeAwareCenter chatId={chatId} directionName={directionName} />
            </div>
          </div>
          <ModeDock />
        </div>

      {/* Right-rail resize handle — drag to set the assistant width. The
          handle sits on the rail's LEFT edge, so dragging left (negative
          delta) widens the rail; subtract the delta to grow it. */}
      {railOpen && (
        <Resizer
          axis="x"
          bare
          className="z-10"
          onResize={(d) =>
            setRailUserWidth((w) =>
              Math.max(RAIL_MIN_WIDTH, Math.min(RAIL_MAX_WIDTH, w - d)),
            )
          }
        />
      )}

      {/* Right rail — assistant. Drag the handle on its left edge to
          resize; width also grows when the chat's inline Details panel
          opens so it doesn't overflow off the right edge of the window. */}
      {railOpen && (
        <aside
          className="relative shrink-0 flex flex-col min-w-0 bl-island rounded-2xl overflow-hidden"
          style={{ width: railWidth }}
        >
          {/* Rail header — actions only (Threads / Fork / Hide). */}
          <div className="relative flex items-center justify-end gap-2 h-10 px-3 border-b border-border select-none shrink-0">
            <div className="flex items-center gap-1">
              <ThreadSwitcher />
              <ForkActiveButton />
              <button
                type="button"
                onClick={() => setRailOpen(false)}
                className={cn(
                  "press flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono uppercase tracking-wider",
                  "text-muted-foreground hover:text-foreground hover:bg-secondary",
                  "transition-[color,background-color] duration-150 [transition-timing-function:var(--ease-natural)]",
                )}
                title="Hide assistant (Cmd+\\)"
                aria-label="Hide assistant"
              >
                Hide
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Chat — existing ChatView, unchanged. */}
          <div className="flex-1 min-h-0 min-w-0 overflow-hidden">{assistant}</div>
        </aside>
      )}
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
// AmbientCanvas — the shell's only ambient touch. Clean/minimal: no grain,
// no grid, just one whisper-faint lime wash from the top edge so the
// canvas isn't dead-flat. Sits behind every panel at z-0.
// ────────────────────────────────────────────────────────────────────────

function AmbientCanvas() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
    >
      <div
        className="absolute inset-x-0 top-0 h-[34vh]"
        style={{
          background:
            "radial-gradient(ellipse 58% 100% at 50% 0%, hsl(var(--primary) / 0.06) 0%, transparent 72%)",
        }}
      />
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
// ModeDock — the workflow-stage switcher. A floating macOS-style dock
// pinned to the bottom-centre of the editor: Screenwriting · Prompts ·
// Shotlist · Canvas. The active stage carries a lime fill.
// ────────────────────────────────────────────────────────────────────────

const WORKFLOW_MODES = [
  { id: "screenwriting", label: "Screenwriting", Icon: PenLine },
  { id: "prompts", label: "Prompts", Icon: Sparkles },
  { id: "shotlist", label: "Shotlist", Icon: Clapperboard },
  { id: "canvas", label: "Canvas", Icon: LayoutGrid },
] as const

function ModeDock() {
  const [mode, setMode] = useAtom(viewModeAtom)
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-5 z-30 flex justify-center">
      <div className="pointer-events-auto flex items-center gap-1 rounded-2xl bl-island p-1">
        {WORKFLOW_MODES.map(({ id, label, Icon }) => {
          const active = mode === id
          return (
            <button
              key={id}
              type="button"
              onClick={() => setMode(id)}
              className={cn(
                "press flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12px]",
                "transition-[color,background-color] duration-150 [transition-timing-function:var(--ease-natural)]",
                active
                  ? "bg-primary text-primary-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary/70",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
// ModeAwareCenter — switches the center pane based on the active mode.
// Only one surface visible at a time so the user is never confused
// about which workflow stage they're in.
// ────────────────────────────────────────────────────────────────────────

interface ModeAwareCenterProps {
  chatId: string | null
  directionName?: string | null
}

function ModeAwareCenter({ chatId, directionName }: ModeAwareCenterProps) {
  const mode = useAtomValue(viewModeAtom)
  const active = useAtomValue(activeEntityAtom)

  // The mode toggle is a *workflow* shift, not a layout split — it
  // changes what surface a given entity opens in:
  //
  //   Screenwriting mode  → EntityEditor (single-file textarea + autosave)
  //                         for any markdown/fountain entity. The writer's
  //                         default. Lands here.
  //
  //   Prompts mode        → PromptsModeView for scenes/shots (script +
  //                         prompt + refs split). For other entities,
  //                         falls back to EntityEditor since they don't
  //                         have a dedicated prompt surface.
  //
  //   Shotlist mode       → ShotlistSurface, the imported shotlist and
  //                         Runway submission tracking surface.
  //
  //   Canvas mode         → CanvasModeView, the agent-controllable visual
  //                         board for prompts, references, and generation.
  //
  // Atomic markdown entities (brief/world/main-script/character/location/
  // act) always land in the editor regardless of mode — the prompts UI
  // only makes sense for scenes/shots.

  if (mode === "canvas") {
    return <CanvasModeView worktreeId={chatId} />
  }

  if (mode === "shotlist") {
    return <ShotlistSurface />
  }

  // Atomic entities — always the file editor. Includes the generic
  // "file" kind that the Cursor-style tree produces for arbitrary
  // user-created files: same surface, just no schema-specific kicker.
  if (
    active &&
    (active.kind === "brief" ||
      active.kind === "world" ||
      active.kind === "main-script" ||
      active.kind === "character" ||
      active.kind === "location" ||
      active.kind === "act" ||
      active.kind === "file")
  ) {
    return (
      <div className="h-full">
        <EntityEditor />
      </div>
    )
  }

  // Scene / shot — mode decides the surface.
  if (active && (active.kind === "scene" || active.kind === "shot")) {
    if (mode === "prompts") {
      return <PromptsModeView />
    }
    return (
      <div className="h-full">
        <EntityEditor />
      </div>
    )
  }

  // Nothing selected → fall back to the legacy mode toggle.
  if (mode === "prompts") {
    return <PromptsModeView />
  }
  return (
    <div className="h-full">
      <ScreenplayPane chatId={chatId} directionName={directionName} />
    </div>
  )
}

// Stable hash → palette index. Lets pre-migration chats with NULL
// directionColor get a deterministic colour without a backfill migration.
// Used by the lineage breadcrumb's parent-chain dots.
const FALLBACK_PALETTE = [
  "#F26157",
  "#79B791",
  "#FF8C42",
  "#E8A838",
  "#7280AB",
  "#A87BB8",
  "#5E91A8",
  "#C77B9C",
] as const

function fallbackColor(chatId: string): string {
  let h = 0
  for (let i = 0; i < chatId.length; i++) h = (h * 31 + chatId.charCodeAt(i)) | 0
  return FALLBACK_PALETTE[Math.abs(h) % FALLBACK_PALETTE.length]
}

// ────────────────────────────────────────────────────────────────────────
// ThreadSwitcher — sub-chat picker for the Backlot rail.
//
// In Backlot lingo: a workspace ("Direction") owns many sub-chats
// ("threads"). Messages live inside a sub-chat. The screenwriter layout
// hides the upstream sub-chat tab strip, so without this control the
// user has no in-rail affordance to switch threads. The visible symptom
// is the one that surfaced this fix — chat with the agent, leave to
// settings, come back, and the rail mounts a fresh empty "New Thread"
// sub-chat instead of the one with your messages. The previous sub-chat
// still exists in the DB; the user just can't see it.
//
// The dropdown lists every sub-chat of the active workspace (sorted by
// activity), marks the active one, lets the user click to switch back,
// and keeps the branch/fresh create actions in a footer.
// ────────────────────────────────────────────────────────────────────────
function ThreadSwitcher() {
  const activeChatId = useAtomValue(selectedAgentChatIdAtom)
  const setThreadCreateRequest = useSetAtom(threadCreateRequestAtom)
  const activeSubChatId = useAgentSubChatStore((state) => state.activeSubChatId)
  const allSubChats = useAgentSubChatStore((state) => state.allSubChats)
  const setActiveSubChat = useAgentSubChatStore((state) => state.setActiveSubChat)
  const addToOpenSubChats = useAgentSubChatStore(
    (state) => state.addToOpenSubChats,
  )
  const removeFromOpenSubChats = useAgentSubChatStore(
    (state) => state.removeFromOpenSubChats,
  )

  const utils = trpc.useUtils()
  const deleteSubChat = trpc.chats.deleteSubChat.useMutation({
    onSuccess: (_data, variables) => {
      // Pull the close-tab state through the same hook the keyboard
      // shortcut uses — it auto-promotes the last remaining tab to
      // active if we just deleted the active one.
      removeFromOpenSubChats(variables.id)
      // Re-fetch the workspace so allSubChats drops the row. The
      // upstream code path is `utils.agents.getAgentChat.invalidate`,
      // which is a wrapper around chats.get — calling chats.get
      // directly avoids the wrapper-typed indirection.
      if (activeChatId) {
        utils.chats.get.invalidate({ id: activeChatId })
      }
    },
    onError: (err) => {
      toast.error(err.message || "Couldn't delete thread")
    },
  })

  // Sort by recency. updated_at is optional in the metadata; missing
  // entries sink so freshly opened ones still surface.
  const sortedSubChats = [...allSubChats].sort((a, b) => {
    const aT = a.updated_at ? new Date(a.updated_at).getTime() : 0
    const bT = b.updated_at ? new Date(b.updated_at).getTime() : 0
    return bT - aT
  })

  // Switching a sub-chat is store-side only. The workspace (chatId)
  // doesn't change, so no atom plumbing for source mode is needed.
  // Add to open tabs so the upstream tab logic treats it as a real
  // active session.
  const handleSelect = (subChatId: string) => {
    if (subChatId === activeSubChatId) return
    addToOpenSubChats(subChatId)
    setActiveSubChat(subChatId)
  }

  // Delete a thread. Native confirm is ugly but unambiguous; this is a
  // hard delete (existing chats.deleteSubChat is destructive — no
  // archive table for sub-chats), so the friction is the safety. If
  // the user is deleting only one thread, refuse — the workspace must
  // keep at least one sub-chat for the rail to render coherently; in
  // that case the empty path is to delete the workspace from the
  // sidebar, not the thread.
  const handleDelete = (
    e: React.MouseEvent,
    thread: { id: string; name?: string },
  ) => {
    e.preventDefault()
    e.stopPropagation()
    if (sortedSubChats.length <= 1) {
      toast.message("Can't delete the only thread", {
        description:
          "A workspace needs at least one thread. Create another, then delete this one.",
      })
      return
    }
    const ok = window.confirm(
      `Delete thread "${thread.name?.trim() || "Untitled"}"?\nThis can't be undone.`,
    )
    if (!ok) return
    deleteSubChat.mutate({ id: thread.id })
  }

  const createThread = (options: ThreadCreateOptions) => {
    if (!activeChatId) return
    setThreadCreateRequest({
      id: Date.now(),
      chatId: activeChatId,
      options,
    })
  }

  const triggerDisabled = !activeChatId

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={triggerDisabled}
          className={cn(
            "press flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono uppercase tracking-wider",
            "text-muted-foreground hover:text-primary hover:bg-primary/10",
            "transition-[color,background-color] duration-150 [transition-timing-function:var(--ease-natural)]",
            "disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100",
          )}
          title="Switch threads, or start a new one"
          aria-label="Threads"
        >
          <MessageSquare className="h-3 w-3" />
          Threads
          {sortedSubChats.length > 0 && (
            <span className="ml-0.5 tabular-nums text-muted-foreground/60">
              {sortedSubChats.length}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72 p-1">
        {sortedSubChats.length > 0 && (
          <>
            <div className="px-2 pt-1.5 pb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
              Threads
            </div>
            <div className="max-h-[280px] overflow-y-auto">
              {sortedSubChats.map((thread) => {
                const isActive = thread.id === activeSubChatId
                const isCodex = thread.provider === "codex"
                return (
                  <DropdownMenuItem
                    key={thread.id}
                    onClick={() => handleSelect(thread.id)}
                    className="group flex items-start gap-2 py-2"
                  >
                    <span className="mt-0.5 w-3.5 shrink-0 flex items-center justify-center">
                      {isActive ? (
                        <Check className="h-3.5 w-3.5 text-primary" />
                      ) : (
                        <span className="w-1.5 h-1.5 rounded-full border border-border" />
                      )}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={cn(
                            "truncate text-sm",
                            isActive
                              ? "text-foreground font-medium"
                              : "text-foreground/85",
                          )}
                        >
                          {thread.name?.trim() || "Untitled thread"}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
                        <span className="font-mono uppercase tracking-wider text-[10px]">
                          {thread.mode === "plan" ? "Plan" : "Agent"}
                        </span>
                        <span className="text-muted-foreground/40">·</span>
                        <span className="font-mono text-[10px]">
                          {isCodex ? "Codex" : "Claude"}
                        </span>
                        <span className="ml-auto tabular-nums shrink-0">
                          {formatThreadRelative(thread.updated_at)}
                        </span>
                      </div>
                    </div>
                    {/* Delete affordance — hover-revealed so the row stays
                        clean while still giving the user a clear destructive
                        path. Stops propagation so clicking it doesn't also
                        switch the thread. */}
                    <button
                      type="button"
                      onClick={(e) => handleDelete(e, thread)}
                      className={cn(
                        "shrink-0 ml-1 mt-0.5 h-6 w-6 rounded flex items-center justify-center",
                        "text-muted-foreground/0 group-hover:text-muted-foreground/70 hover:!text-rose-600 dark:hover:!text-rose-400",
                        "hover:bg-rose-500/10",
                        "transition-colors duration-150",
                      )}
                      title="Delete thread"
                      aria-label={`Delete thread ${thread.name?.trim() || "Untitled"}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </DropdownMenuItem>
                )
              })}
            </div>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem
          disabled={!activeSubChatId}
          onClick={() =>
            createThread({ kind: "branch", provider: "claude-code" })
          }
        >
          <GitBranch className="h-4 w-4 mr-2 text-muted-foreground" />
          <div className="flex flex-col">
            <span>Branch into Claude</span>
            <span className="text-[11px] text-muted-foreground">
              Keep current thread history
            </span>
          </div>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!activeSubChatId}
          onClick={() => createThread({ kind: "branch", provider: "codex" })}
        >
          <GitBranch className="h-4 w-4 mr-2 text-muted-foreground" />
          <div className="flex flex-col">
            <span>Branch into Codex</span>
            <span className="text-[11px] text-muted-foreground">
              Keep current thread history
            </span>
          </div>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={!activeChatId}
          onClick={() =>
            createThread({ kind: "fresh", provider: "claude-code" })
          }
        >
          <MessageSquarePlus className="h-4 w-4 mr-2 text-muted-foreground" />
          Start new chat with Claude
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!activeChatId}
          onClick={() => createThread({ kind: "fresh", provider: "codex" })}
        >
          <MessageSquarePlus className="h-4 w-4 mr-2 text-muted-foreground" />
          Start new chat with Codex
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Compact relative-time formatter for the threads dropdown. Mirrors the
 *  one in NoChatAssistantPanel so the visual register stays consistent. */
function formatThreadRelative(input: string | Date | null | undefined): string {
  if (!input) return "—"
  const d = input instanceof Date ? input : new Date(input)
  const now = Date.now()
  const diff = now - d.getTime()
  const min = Math.floor(diff / 60000)
  const hr = Math.floor(min / 60)
  const day = Math.floor(hr / 24)
  if (min < 1) return "now"
  if (min < 60) return `${min}m`
  if (hr < 24) return `${hr}h`
  if (day === 1) return "1d"
  if (day < 7) return `${day}d`
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

// ────────────────────────────────────────────────────────────────────────
// ForkActiveButton — sits in the chat rail header (next to "Hide").
//
// The user said "forking lives in the main chat", so this is the
// canonical place to trigger a fork. The new chat appears in the
// existing workspaces sidebar on the left automatically (since
// chats.list returns every chat in the project), and we also flip the
// active chat to it so the screenplay + assistant immediately reflect
// the new Direction.
// ────────────────────────────────────────────────────────────────────────
function ForkActiveButton() {
  const activeChatId = useAtomValue(selectedAgentChatIdAtom)
  const setSelectedChatId = useSetAtom(selectedAgentChatIdAtom)
  const utils = trpc.useUtils()

  const fork = trpc.chats.forkDirection.useMutation({
    onSuccess: (newChat) => {
      if (newChat.projectId) {
        utils.chats.list.invalidate({ projectId: newChat.projectId })
        utils.chats.directionsForProject.invalidate({
          projectId: newChat.projectId,
        })
      }
      utils.chats.get.invalidate({ id: newChat.id })
      setSelectedChatId(newChat.id)
      toast.success(`Forked into "${newChat.name ?? "Untitled"}"`)
    },
    onError: (err) => {
      toast.error(err.message || "Couldn't fork. Try again.")
    },
  })

  const onClick = () => {
    if (!activeChatId) return
    fork.mutate({ fromChatId: activeChatId })
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!activeChatId || fork.isPending}
      className={cn(
        "press flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono uppercase tracking-wider",
        "text-muted-foreground hover:text-primary hover:bg-primary/10",
        "transition-[color,background-color] duration-150 [transition-timing-function:var(--ease-natural)]",
        "disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100",
      )}
      title="Try another way — fork this Direction at its latest saved version"
      aria-label="Try another way"
    >
      {fork.isPending ? (
        <Sparkles className="h-3 w-3 animate-pulse" />
      ) : (
        <Plus className="h-3 w-3" />
      )}
      Fork
    </button>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Lineage breadcrumb — Layer 2.
//
// Shows the chain from root → current Direction:
//   "main draft  ›  alex rewrite  ›  alex flashback try"
//
// Each segment is clickable and switches the active chat to that
// ancestor. Hidden entirely when the active Direction has no parent
// (root case) — no point dedicating a row of vertical space to a
// single label.
// ────────────────────────────────────────────────────────────────────────

function LineageBreadcrumb() {
  const project = useAtomValue(selectedProjectAtom)
  const [activeChatId, setActiveChatId] = useAtom(selectedAgentChatIdAtom)

  const directions = trpc.chats.directionsForProject.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id, refetchInterval: 5000 },
  )

  const chain = (() => {
    const list = directions.data ?? []
    if (!activeChatId) return [] as typeof list
    const byId = new Map(list.map((d) => [d.id, d]))
    const out: typeof list = []
    let cursor = byId.get(activeChatId)
    let safety = 32 // guard against unexpected cycles in the parentWorktreeId chain
    while (cursor && safety-- > 0) {
      out.unshift(cursor)
      cursor = cursor.parentWorktreeId ? byId.get(cursor.parentWorktreeId) : undefined
    }
    return out
  })()

  // Hide when there's nothing meaningful to show — root Direction or
  // pre-mount (active chat not yet in the directions list).
  if (chain.length <= 1) return null

  return (
    <div className="flex items-center gap-1.5 h-8 px-1 pb-1.5 select-none shrink-0 overflow-hidden">
      <GitBranch className="h-3 w-3 text-muted-foreground/60 shrink-0" />
      <div className="flex items-center gap-1 text-[11px] font-mono tabular-nums truncate">
        {chain.map((d, idx) => {
          const isCurrent = d.id === activeChatId
          const color = d.directionColor || fallbackColor(d.id)
          return (
            <div key={d.id} className="flex items-center gap-1 min-w-0">
              {idx > 0 && (
                <ChevronRight className="h-3 w-3 text-muted-foreground/40 shrink-0" />
              )}
              <button
                type="button"
                onClick={() => setActiveChatId(d.id)}
                className={cn(
                  "press flex items-center gap-1.5 px-1.5 py-0.5 rounded truncate",
                  "transition-[color,background-color] duration-150 [transition-timing-function:var(--ease-natural)]",
                  isCurrent
                    ? "text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary/60",
                )}
                title={
                  d.forkedAtCommit
                    ? `${d.name ?? "Untitled"} — forked at ${d.forkedAtCommit.slice(0, 7)}`
                    : d.name ?? "Untitled"
                }
              >
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ backgroundColor: color }}
                />
                <span className="truncate max-w-[200px]">
                  {d.name ?? "Untitled"}
                </span>
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
