"use client"

/**
 * ScreenplayWorkspace — Backlot's two-column desktop layout.
 *
 * Replaces the upstream 1code "single-column chat" arrangement with
 * the screenwriter shape: the screenplay artifact dominates the
 * canvas, the assistant lives in a narrow right rail.
 *
 *   ┌─────────────────────────────────────────┬──────────────┐
 *   │                                         │              │
 *   │  ScreenplayPane                         │  Assistant   │
 *   │  (the artifact — what you're writing)   │  (chat,      │
 *   │                                         │   children)  │
 *   │                                         │              │
 *   └─────────────────────────────────────────┴──────────────┘
 *
 * The right column accepts the existing 1code <ChatView /> as
 * children — every existing tRPC stream, mention, and slash command
 * keeps working untouched. The left column is the new screenplay
 * surface (placeholder for now; CodeMirror in Phase D2).
 */

import { type ReactNode, useEffect } from "react"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { atomWithStorage } from "jotai/utils"
import { ChevronLeft, ChevronRight, GitBranch, MessageSquare, Plus, Sparkles } from "lucide-react"
import { toast } from "sonner"
import { ScreenplayPane } from "./screenplay-pane"
import {
  detailsSidebarOpenAtom,
  detailsSidebarWidthAtom,
} from "../details-sidebar/atoms"
import { selectedAgentChatIdAtom, selectedProjectAtom } from "../agents/atoms"
import { trpc } from "../../lib/trpc"
import { cn } from "../../lib/utils"

const ASSISTANT_RAIL_OPEN_ATOM = atomWithStorage("backlot:assistant-rail-open", true)

const RAIL_BASE_WIDTH = 420 // px — wide enough for chat bubbles + tool chips, narrow enough that the screenplay still breathes
const DETAILS_FALLBACK_WIDTH = 500 // matches detailsSidebarWidthAtom default in case the atom isn't initialised yet

interface ScreenplayWorkspaceProps {
  chatId: string | null
  directionName?: string | null
  /** The existing 1code <ChatView /> goes here. */
  assistant: ReactNode
}

export function ScreenplayWorkspace({
  chatId,
  directionName,
  assistant,
}: ScreenplayWorkspaceProps) {
  const [railOpen, setRailOpen] = useAtom(ASSISTANT_RAIL_OPEN_ATOM)

  // When the chat opens its inline DetailsSidebar (Workspace / Branch /
  // Path / Changes / MCP), it demands ~500px of its own. With the rail
  // pinned at 420px the details column overflows the right edge of the
  // window. Subscribe to both atoms so the rail grows when details opens
  // and shrinks back when it closes — same behaviour as 1code's original
  // single-column layout, just driven by the atoms instead of being
  // implicit in the flex tree.
  const isDetailsOpen = useAtomValue(detailsSidebarOpenAtom)
  const detailsWidth = useAtomValue(detailsSidebarWidthAtom) ?? DETAILS_FALLBACK_WIDTH
  const railWidth = isDetailsOpen
    ? RAIL_BASE_WIDTH + detailsWidth
    : RAIL_BASE_WIDTH

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
    <div className="flex h-full w-full overflow-hidden">
      {/* Center — Direction tabs + lineage breadcrumb + screenplay */}
      <div className="flex-1 min-w-0 relative flex flex-col">
        <DirectionTabs />
        <LineageBreadcrumb />
        <div className="flex-1 min-h-0">
          <ScreenplayPane chatId={chatId} directionName={directionName} />
        </div>

        {/* Show-assistant pill — vertical label on the right edge. Big enough
            to find without hunting; clickable across the whole pill. */}
        {!railOpen && (
          <button
            type="button"
            onClick={() => setRailOpen(true)}
            className={cn(
              "absolute top-1/2 -translate-y-1/2 right-0 z-30",
              "flex flex-col items-center justify-center gap-2",
              "w-9 py-4 rounded-l-lg border border-r-0 border-border",
              "bg-primary text-primary-foreground hover:opacity-90",
              "shadow-lg transition-opacity",
            )}
            title="Show assistant (Cmd+\\)"
            aria-label="Show assistant"
          >
            <MessageSquare className="h-4 w-4" />
            <span
              className="text-[10px] uppercase tracking-[0.18em] font-mono"
              style={{ writingMode: "vertical-rl" }}
            >
              Assistant
            </span>
            <ChevronLeft className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Right rail — assistant. Width grows when the chat's inline Details
          panel is open so it doesn't overflow off the right edge of the window. */}
      {railOpen && (
        <aside
          className="border-l border-border bg-background/40 relative shrink-0 flex flex-col transition-[width] duration-150 ease-out"
          style={{ width: railWidth }}
        >
          {/* Rail header */}
          <div className="flex items-center justify-between h-9 px-3 border-b border-border bg-card/40 select-none shrink-0">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-3 w-3 text-muted-foreground" />
              <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 font-mono">
                Assistant
              </span>
            </div>
            <button
              type="button"
              onClick={() => setRailOpen(false)}
              className={cn(
                "flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono uppercase tracking-wider",
                "text-muted-foreground hover:text-foreground hover:bg-secondary",
                "transition-colors",
              )}
              title="Hide assistant (Cmd+\\)"
              aria-label="Hide assistant"
            >
              Hide
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Chat — existing 1code ChatView, unchanged. */}
          <div className="flex-1 min-h-0 overflow-hidden">{assistant}</div>
        </aside>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Direction sidetabs — the always-visible switcher at the top of the
// screenplay center pane.
//
// Each tab represents one Direction (a chat tied to a worktree). Active
// tab is fully filled; inactive tabs show only the colour stripe + name
// + tiny lineage hint ("↳ from main"). The right-most "+ Try another
// way" button forks the active Direction at HEAD and switches to the
// new fork.
//
// State source of truth:
//   - selectedAgentChatIdAtom — which Direction is currently active
//   - selectedProjectAtom     — scopes the directionsForProject query
//
// The fork mutation runs `forkDirection` server-side (atomic DB writes
// + cleanup-on-failure), then sets the active chat id to the new chat.
// The screenplay pane + chat view both react to that atom change and
// load the new worktree's content automatically.
// ────────────────────────────────────────────────────────────────────────

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
  // Stable hash → index. Lets pre-migration chats with NULL color get a
  // deterministic colour without a backfill migration.
  let h = 0
  for (let i = 0; i < chatId.length; i++) h = (h * 31 + chatId.charCodeAt(i)) | 0
  return FALLBACK_PALETTE[Math.abs(h) % FALLBACK_PALETTE.length]
}

function DirectionTabs() {
  const project = useAtomValue(selectedProjectAtom)
  const [activeChatId, setActiveChatId] = useAtom(selectedAgentChatIdAtom)
  const setSelectedChatId = useSetAtom(selectedAgentChatIdAtom)

  const directions = trpc.chats.directionsForProject.useQuery(
    { projectId: project?.id ?? "" },
    {
      enabled: !!project?.id,
      // Refetch on a slow cadence — directions only change on fork or
      // rename, neither of which is frequent. We also explicitly
      // invalidate after fork() succeeds so users see the new tab
      // immediately.
      refetchInterval: 5000,
      refetchOnWindowFocus: true,
    },
  )

  const fork = trpc.chats.forkDirection.useMutation({
    onSuccess: (newChat) => {
      setSelectedChatId(newChat.id)
      directions.refetch()
      toast.success(`Forked into "${newChat.name}"`)
    },
    onError: (err) => {
      toast.error(err.message || "Couldn't fork. Try again.")
    },
  })

  const onForkActive = () => {
    if (!activeChatId) return
    fork.mutate({ fromChatId: activeChatId })
  }

  if (!project?.id) return null

  // Build a parent-name lookup so each tab can show "↳ from <parent>".
  const directionsList = directions.data ?? []
  const byId = new Map(directionsList.map((d) => [d.id, d]))

  return (
    <div className="flex items-stretch gap-px h-9 px-2 border-b border-border bg-card/30 shrink-0 overflow-x-auto select-none">
      {directionsList.map((d) => {
        const isActive = d.id === activeChatId
        const color = d.directionColor || fallbackColor(d.id)
        const parent = d.parentChatId ? byId.get(d.parentChatId) : null
        return (
          <button
            key={d.id}
            type="button"
            onClick={() => setActiveChatId(d.id)}
            className={cn(
              "group relative flex items-center gap-2 px-3 my-1 rounded-md text-xs",
              "border transition-colors shrink-0 max-w-[280px]",
              isActive
                ? "border-border bg-background shadow-sm"
                : "border-transparent bg-transparent hover:bg-secondary/60",
            )}
            title={
              parent
                ? `Forked from "${parent.name ?? "Untitled"}"`
                : "Root Direction"
            }
          >
            {/* Color stripe */}
            <span
              className={cn(
                "w-1 h-4 rounded-sm shrink-0",
                isActive ? "" : "opacity-60",
              )}
              style={{ backgroundColor: color }}
            />
            <span
              className={cn(
                "truncate",
                isActive
                  ? "text-foreground font-medium"
                  : "text-muted-foreground group-hover:text-foreground/80",
              )}
            >
              {d.name ?? "Untitled"}
            </span>
            {parent && (
              <span
                className={cn(
                  "text-[10px] font-mono tabular-nums shrink-0",
                  isActive
                    ? "text-muted-foreground/70"
                    : "text-muted-foreground/50",
                )}
                title={`Forked from ${parent.name}`}
              >
                ↳ {parent.name?.slice(0, 14) ?? "?"}
              </span>
            )}
          </button>
        )
      })}

      {/* Spacer so the + button sits flush right when there's room. */}
      <div className="flex-1 min-w-2" />

      {/* "Try another way" — fork the active Direction at its current HEAD. */}
      <button
        type="button"
        onClick={onForkActive}
        disabled={!activeChatId || fork.isPending}
        className={cn(
          "flex items-center gap-1.5 my-1 px-2.5 rounded-md text-xs font-medium shrink-0",
          "border border-dashed border-border",
          "text-muted-foreground hover:text-primary hover:border-primary/60 hover:bg-primary/5",
          "transition-colors",
          "disabled:opacity-40 disabled:cursor-not-allowed",
        )}
        title="Fork the current Direction at its latest saved version"
      >
        {fork.isPending ? (
          <Sparkles className="h-3 w-3 animate-pulse" />
        ) : (
          <Plus className="h-3 w-3" />
        )}
        Try another way
      </button>
    </div>
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
    let safety = 32 // guard against unexpected cycles in the parentChatId chain
    while (cursor && safety-- > 0) {
      out.unshift(cursor)
      cursor = cursor.parentChatId ? byId.get(cursor.parentChatId) : undefined
    }
    return out
  })()

  // Hide when there's nothing meaningful to show — root Direction or
  // pre-mount (active chat not yet in the directions list).
  if (chain.length <= 1) return null

  return (
    <div className="flex items-center gap-1 h-6 px-3 border-b border-border bg-card/20 select-none shrink-0 overflow-hidden">
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
                  "flex items-center gap-1.5 px-1.5 py-0.5 rounded truncate",
                  "transition-colors",
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
