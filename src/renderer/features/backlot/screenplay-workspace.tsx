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
import { atomWithStorage } from "jotai/utils"
import {
  ChevronLeft,
  ChevronRight,
  GitBranch,
  MessageSquare,
  MessageSquarePlus,
  Plus,
} from "lucide-react"
import { motion } from "motion/react"
import { toast } from "sonner"
import { ProjectTreeRail } from "./project-tree-rail"
import { ScreenplayPane } from "./screenplay-pane"
import { PromptsModeView } from "./prompts-mode-view"
import { EntityEditor } from "./entity-editor"
import { activeEntityAtom, viewModeAtom } from "./atoms"
import { Sparkles } from "lucide-react"
import {
  detailsSidebarOpenAtom,
  detailsSidebarWidthAtom,
} from "../details-sidebar/atoms"
import {
  selectedAgentChatIdAtom,
  selectedProjectAtom,
  threadCreateRequestAtom,
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

const ASSISTANT_RAIL_OPEN_ATOM = atomWithStorage("backlot:assistant-rail-open", true)

const RAIL_BASE_WIDTH = 420 // px — wide enough for chat bubbles + tool chips, narrow enough that the screenplay still breathes
const DETAILS_FALLBACK_WIDTH = 500 // matches detailsSidebarWidthAtom default in case the atom isn't initialised yet

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
  const [railOpen, setRailOpen] = useAtom(ASSISTANT_RAIL_OPEN_ATOM)

  // When the chat opens its inline DetailsSidebar (Workspace / Branch /
  // Path / Changes / MCP), it demands ~500px of its own. With the rail
  // pinned at 420px the details column overflows the right edge of the
  // window. Subscribe to both atoms so the rail grows when details opens
  // and shrinks back when it closes — driven by the atoms instead of
  // being implicit in the flex tree.
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

      {/* Center — mode toggle + content. Two distinct surfaces:
            · Screenwriting → ScreenplayPane (existing editor flow)
            · Prompts       → PromptsModeView (screenplay ref left,
                              free-text prompt blocks center, chat right)
          Toggling is a workflow shift, NOT a layout split — only one
          surface is visible at a time so the user is never confused
          about which mode they're in. */}
      <div className="flex-1 min-w-0 relative flex flex-col">
        <ModeToggleStrip />
        <LineageBreadcrumb />
        <div className="flex-1 min-h-0">
          <ModeAwareCenter chatId={chatId} directionName={directionName} />
        </div>

        {/* Show-assistant pill — vertical label on the right edge. Big enough
            to find without hunting; clickable across the whole pill. */}
        {!railOpen && (
          // Positioning shell — handles vertical centering. The button
          // child handles its own press/hover transforms without fighting
          // the centering translate.
          <div className="absolute top-1/2 -translate-y-1/2 right-0 z-30 [animation:rail-pill-enter_220ms_var(--ease-out)_forwards]">
            <button
              type="button"
              onClick={() => setRailOpen(true)}
              className={cn(
                "press group",
                "flex flex-col items-center justify-center gap-2",
                "w-9 py-4 rounded-l-lg border border-r-0 border-border",
                "bg-primary text-primary-foreground",
                "shadow-lg",
                "transition-shadow duration-200 [transition-timing-function:var(--ease-out)]",
                "hover:shadow-xl",
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
              <ChevronLeft className="h-3 w-3 transition-transform duration-200 [transition-timing-function:var(--ease-out)] group-hover:-translate-x-0.5" />
            </button>
          </div>
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
              <ThreadMenuButton />
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
          <div className="flex-1 min-h-0 overflow-hidden">{assistant}</div>
        </aside>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
// ModeToggleStrip — top-of-pane tabs for the workflow stages.
//
//   [ ✎ Screenwriting ]  [ ✦ Prompts ]
//
// Two distinct surfaces, NOT a layout split. The user shifts pipeline
// stages here; the chosen mode persists in viewModeAtom across reloads.
// ────────────────────────────────────────────────────────────────────────

/**
 * The masthead — two words, a moving Coral nib. Reads more like a magazine
 * masthead than an OS tab strip. Active item: foreground tone + a thin
 * Coral underline that slides between the two using framer-motion's
 * shared-layoutId trick. Inactive item: muted, no underline. The point
 * is to feel like an editor turning a manuscript page, not toggling a
 * setting.
 */
function ModeToggleStrip() {
  const [mode, setMode] = useAtom(viewModeAtom)
  return (
    <div className="relative flex items-stretch h-11 border-b border-border/50 bg-background select-none shrink-0">
      <div className="flex items-stretch gap-8 pl-6 pr-6">
        <ModeMastheadItem
          label="Screenwriting"
          active={mode === "screenwriting"}
          onClick={() => setMode("screenwriting")}
        />
        <ModeMastheadItem
          label="Prompts"
          active={mode === "prompts"}
          onClick={() => setMode("prompts")}
        />
      </div>
      {/* Right edge: a single tracked-mono caption identifying the
          current pipeline stage. Reinforces the masthead without
          competing with it. */}
      <div className="ml-auto flex items-center pr-5">
        <span
          className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground/45"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {mode === "screenwriting" ? "The page" : "The prompt"}
        </span>
      </div>
    </div>
  )
}

function ModeMastheadItem({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        // Editorial masthead item — text-only, the active marker is the
        // sliding Coral nib (motion.span layoutId="mode-nib" below), not
        // a button background. `.press` from the animation pass gives it
        // the standard interactive feedback shared by every button.
        "press relative flex items-center px-1 text-[12px] tracking-[0.04em]",
        active
          ? "text-foreground"
          : "text-muted-foreground/65 hover:text-foreground/85",
      )}
      style={{ fontFamily: "var(--font-body)", fontWeight: 500 }}
    >
      <span>{label}</span>
      {active && (
        <motion.span
          layoutId="mode-nib"
          className="absolute left-0 right-0 -bottom-px h-[2px] bg-primary"
          transition={{ type: "spring", stiffness: 480, damping: 38 }}
        />
      )}
    </button>
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
  // Atomic markdown entities (brief/world/main-script/character/location/
  // act) always land in the editor regardless of mode — the prompts UI
  // only makes sense for scenes/shots.

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
// ThreadMenuButton — visible entry point for chat threads in the Backlot rail.
// The internal upstream tab strip is hidden in this layout, so expose the
// actions here where the user can actually find them.
// ────────────────────────────────────────────────────────────────────────
function ThreadMenuButton() {
  const activeChatId = useAtomValue(selectedAgentChatIdAtom)
  const setThreadCreateRequest = useSetAtom(threadCreateRequestAtom)
  const activeSubChatId = useAgentSubChatStore((state) => state.activeSubChatId)
  const allSubChats = useAgentSubChatStore((state) => state.allSubChats)
  const activeSubChat = allSubChats.find((subChat) => subChat.id === activeSubChatId)
  const activeProviderLabel =
    activeSubChat?.provider === "codex" ? "Codex" : "Claude"

  const createThread = (options: { kind: "fresh" } | { kind: "branch" }) => {
    if (!activeChatId) return
    setThreadCreateRequest({
      id: Date.now(),
      chatId: activeChatId,
      options,
    })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={!activeChatId}
          className={cn(
            "press flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono uppercase tracking-wider",
            "text-muted-foreground hover:text-primary hover:bg-primary/10",
            "transition-[color,background-color] duration-150 [transition-timing-function:var(--ease-natural)]",
            "disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100",
          )}
          title="Start or branch an assistant thread"
          aria-label="New assistant thread"
        >
          <MessageSquarePlus className="h-3 w-3" />
          Thread
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem
          disabled={!activeSubChatId}
          onClick={() => createThread({ kind: "branch" })}
        >
          <GitBranch className="h-4 w-4 mr-2 text-muted-foreground" />
          <div className="flex flex-col">
            <span>Branch from current</span>
            <span className="text-[11px] text-muted-foreground">
              Keep history, stay on {activeProviderLabel}
            </span>
          </div>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => createThread({ kind: "fresh" })}
        >
          <MessageSquarePlus className="h-4 w-4 mr-2 text-muted-foreground" />
          Fresh {activeProviderLabel} thread
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
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
