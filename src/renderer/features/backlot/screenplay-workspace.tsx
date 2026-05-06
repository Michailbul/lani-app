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
import { ProjectTreeRail } from "./project-tree-rail"
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
      {/* Left rail — project tree navigator. Collapsible. */}
      <ProjectTreeRail />

      {/* Center — lineage breadcrumb (when forked) + screenplay.
          Top "Direction tabs" were removed because they duplicated the
          existing 1code workspaces sidebar on the left — every chat
          (root or fork) already appears there. The fork action moved
          into the chat rail header where the user said it belonged
          ("forking lives in the main chat"). */}
      <div className="flex-1 min-w-0 relative flex flex-col">
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
          <div className="flex items-center justify-between gap-2 h-9 px-3 border-b border-border bg-card/40 select-none shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <MessageSquare className="h-3 w-3 text-muted-foreground shrink-0" />
              <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 font-mono">
                Assistant
              </span>
            </div>
            <div className="flex items-center gap-1">
              <ForkActiveButton />
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
          </div>

          {/* Chat — existing 1code ChatView, unchanged. */}
          <div className="flex-1 min-h-0 overflow-hidden">{assistant}</div>
        </aside>
      )}
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
// ForkActiveButton — sits in the chat rail header (next to "Hide").
//
// The user said "forking lives in the main chat", so this is the
// canonical place to trigger a fork. The new chat appears in the
// existing 1code workspaces sidebar on the left automatically (since
// chats.list returns every chat in the project), and we also flip the
// active chat to it so the screenplay + assistant immediately reflect
// the new Direction.
// ────────────────────────────────────────────────────────────────────────
function ForkActiveButton() {
  const activeChatId = useAtomValue(selectedAgentChatIdAtom)
  const setSelectedChatId = useSetAtom(selectedAgentChatIdAtom)

  const fork = trpc.chats.forkDirection.useMutation({
    onSuccess: (newChat) => {
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
        "flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono uppercase tracking-wider",
        "text-muted-foreground hover:text-primary hover:bg-primary/10",
        "transition-colors",
        "disabled:opacity-40 disabled:cursor-not-allowed",
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
