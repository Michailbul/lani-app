"use client"

/**
 * ScreenplayWorkspace — Lani's two-column desktop layout.
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

import { type ReactNode } from "react"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  FolderTree,
  GitBranch,
  LayoutGrid,
  LibraryBig,
  ListChecks,
  MessageSquare,
  MessageSquarePlus,
  PanelLeft,
  PanelRight,
  PenLine,
  Plus,
  Trash2,
  Wrench,
} from "lucide-react"
import { toast } from "sonner"
import { ProjectTreeRail } from "./project-tree-rail"
import { MultishotSurface } from "./multishot-surface"
import { CanvasModeView } from "./canvas-mode-view"
import { AssetPreviewPane } from "./asset-preview-pane"
import { EntityEditor } from "./entity-editor"
import { ShotlistSurface } from "./shotlist-surface"
import { QueueSurface } from "./queue-surface"
import { LibrarySurface } from "./library-surface"
import { SkillWorkbenchView } from "./skill-workbench-view"
import {
  activeEntityAtom,
  assistantRailOpenAtom,
  projectTreeOpenAtom,
  shotlistSubmodeAtom,
  viewModeAtom,
  workspaceRightInsetAtom,
} from "./atoms"
import {
  agentsSidebarOpenAtom,
  isDesktopAtom,
  isFullscreenAtom,
} from "../../lib/atoms"
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
import { GlassFilter } from "../../components/ui/liquid-glass-filter"
import { WEBP_DISPLACEMENT_MAP as DOCK_THUMB_DISPLACEMENT_MAP } from "../../components/ui/apple-tahoe-liquid-glass-button"
import { trpc } from "../../lib/trpc"
import { cn } from "../../lib/utils"

interface ScreenplayWorkspaceProps {
  chatId: string | null
  directionName?: string | null
}

export function ScreenplayWorkspace({
  chatId,
  directionName,
}: ScreenplayWorkspaceProps) {
  return (
    <div className="relative flex h-full w-full overflow-hidden bg-background">
      {/* Master canvas — the editor's own paper tone fills the window.
          A faint lime halo keeps it from reading dead-flat. */}
      <AmbientCanvas />

      {/* Floating-island shell — project tree on the left, the editor on
          the bare canvas with the workflow mode dock at its bottom edge.
          The assistant rail is hoisted to AgentsLayout so it can span the
          full window height; it is no longer a child here. */}
      <div className="relative z-10 flex h-full w-full gap-2 p-2">
        {/* Left rail — project tree navigator. */}
        <ProjectTreeRail />

        {/* Center column — the editor on the bare canvas. Its own macOS
            chrome strip sits on top; the workflow mode dock floats at its
            bottom edge. */}
        <div className="relative flex-1 min-w-0 flex flex-col">
          <AppTopBar workspace />
          <div className="relative flex-1 min-h-0 flex flex-col">
            <div className="flex-1 min-h-0">
              <ModeAwareCenter chatId={chatId} directionName={directionName} />
            </div>
          </div>
          <ModeDock />
        </div>
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
// ModeDock — the workflow-stage switcher. A floating liquid-glass dock
// pinned to the bottom-centre of the editor: Screenwriting · Shotlist ·
// Skills · Canvas · Queue. A kiwi thumb slides under the active stage;
// the glass surface refracts the canvas through an SVG displacement
// filter.
// ────────────────────────────────────────────────────────────────────────

const WORKFLOW_MODES = [
  { id: "screenwriting", label: "Screenwriting", Icon: PenLine },
  { id: "shotlist", label: "Shotlist", Icon: Clapperboard },
  { id: "skill", label: "Skills", Icon: Wrench },
  { id: "canvas", label: "Canvas", Icon: LayoutGrid },
  { id: "queue", label: "Queue", Icon: ListChecks },
  { id: "library", label: "Library", Icon: LibraryBig },
] as const

function ModeDock() {
  const [mode, setMode] = useAtom(viewModeAtom)
  const rightInset = useAtomValue(workspaceRightInsetAtom)
  const activeIndex = Math.max(
    0,
    WORKFLOW_MODES.findIndex((m) => m.id === mode),
  )
  return (
    <div
      className="pointer-events-none absolute bottom-5 left-0 z-30 flex justify-center transition-[right] duration-200 [transition-timing-function:var(--ease-natural)]"
      style={{ right: rightInset }}
    >
      <GlassFilter />
      {/* Apple Tahoe liquid-glass displacement filter — refracts the
          canvas behind the active dock thumb through a WebP normal map. */}
      <svg
        className="absolute w-0 h-0 overflow-hidden pointer-events-none"
        aria-hidden="true"
      >
        <filter id="bl-dock-thumb-glass" primitiveUnits="objectBoundingBox">
          <feImage
            result="map"
            width="100%"
            height="100%"
            x="0"
            y="0"
            href={DOCK_THUMB_DISPLACEMENT_MAP}
            preserveAspectRatio="none"
          />
          <feGaussianBlur in="SourceGraphic" stdDeviation="0.01" result="blur" />
          <feDisplacementMap
            in="blur"
            in2="map"
            scale="0.5"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </svg>
      <div
        className={cn(
          "pointer-events-auto relative grid grid-cols-6 h-11 p-1 rounded-2xl",
          "border border-white/55",
          "shadow-[0_1px_2px_rgba(20,22,14,0.06),0_14px_34px_-12px_rgba(20,22,14,0.30)]",
        )}
        style={{
          background: "hsl(0 0% 100% / 0.5)",
          backdropFilter: "url(#bl-glass-displace) blur(3px) saturate(150%)",
          WebkitBackdropFilter: "url(#bl-glass-displace) blur(3px) saturate(150%)",
        }}
      >
        {/* Sliding liquid-glass thumb — Apple Tahoe lens treatment.
            The empty lens div lets backdrop-filter refract the canvas
            cleanly through the SVG displacement map; the inset/outset
            shadow stack carves the bevel and outer drop. */}
        <span
          aria-hidden
          className={cn(
            "bl-dock-thumb absolute inset-y-1 left-1 rounded-xl",
            "transition-transform duration-300 [transition-timing-function:cubic-bezier(0.16,1,0.3,1)]",
          )}
          style={{
            width: "calc((100% - 0.5rem) / 6)",
            transform: `translateX(${activeIndex * 100}%)`,
          }}
        />
        {WORKFLOW_MODES.map(({ id, label, Icon }) => {
          const active = mode === id
          return (
            <button
              key={id}
              type="button"
              onClick={() => setMode(id)}
              className={cn(
                "press relative z-10 flex items-center justify-center gap-1.5 rounded-xl px-3 text-[12px]",
                "transition-colors duration-200 [transition-timing-function:var(--ease-natural)]",
                active
                  ? "text-primary-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground dark:text-primary-foreground/75 dark:hover:text-primary-foreground",
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

function ModeAwareCenter({ chatId }: ModeAwareCenterProps) {
  const mode = useAtomValue(viewModeAtom)
  const submode = useAtomValue(shotlistSubmodeAtom)
  const active = useAtomValue(activeEntityAtom)

  // Wraps every center-pane surface with data attrs so the text-selection
  // context can resolve any selection inside (textarea, preview, JSON
  // panes, history view, etc.) back to the file the user is looking at.
  // The textarea selection bridge lives in screenplay-pane.tsx because
  // <textarea> selections are not exposed through window.getSelection().
  const centerPaneAttrs = active?.path
    ? {
        "data-center-pane-path": active.path,
        "data-center-pane-mode":
          mode === "shotlist" && submode ? `${mode}:${submode}` : mode,
      }
    : {}

  return (
    <div className="h-full w-full" {...centerPaneAttrs}>
      {renderModeSurface()}
    </div>
  )

  function renderModeSurface() {

  // The workflow dock is the primary navigation. Clicking a stage always
  // lands on that stage's surface — it is never overridden by whichever
  // entity happens to be open. Each generation surface carries its own
  // scene selector, so it stands up on its own even when no `.lani`
  // file was opened first.
  //
  // Opening a `.lani` file in the project tree sets the matching mode
  // (see project-file-tree's handleOpen), so the file and the mode never
  // disagree in practice.
  if (mode === "skill") {
    return <SkillWorkbenchView />
  }
  if (mode === "canvas") {
    return <CanvasModeView worktreeId={chatId} />
  }
  if (mode === "queue") {
    return <QueueSurface />
  }
  if (mode === "library") {
    return <LibrarySurface />
  }
  // Shotlist mode holds two submodes the writer toggles between — the
  // Shotlist (a scene cut into Parts) and the Multishot (one multi-shot
  // prompt for the whole scene).
  if (mode === "shotlist") {
    return submode === "multishot" ? <MultishotSurface /> : <ShotlistSurface />
  }

  // Screenwriting mode — the surface follows the opened entity. Image
  // and video assets get the liquid-glass media preview; everything
  // else (the screenplay, brief, character notes, generic files) opens
  // in the single-file editor.
  if (active?.kind === "image" || active?.kind === "video") {
    return <AssetPreviewPane />
  }
  return (
    <div className="h-full">
      <EntityEditor />
    </div>
  )
  }
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
// ThreadSwitcher — sub-chat picker for the Lani rail.
//
// In Lani lingo: a workspace ("Direction") owns many sub-chats
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
// AppTopBar — the macOS chrome strip for the editor column. Holds the
// panel toggles on the left, the project title centred, and the assistant
// toggle on the right. The strip is transparent (the canvas shows through)
// and is a window-drag region. It reserves space for the native traffic
// lights only when the editor column is itself the left-most panel — both
// side rails collapsed — since otherwise the lights sit over a side rail.
//
// `workspace` = full project chrome (file-tree + assistant toggles).
// Without it the bar is the lighter fallback used by Settings / new-chat.
// ────────────────────────────────────────────────────────────────────────

export function AppTopBar({ workspace = false }: { workspace?: boolean }) {
  const isDesktop = useAtomValue(isDesktopAtom)
  const isFullscreen = useAtomValue(isFullscreenAtom)
  const [sidebarOpen, setSidebarOpen] = useAtom(agentsSidebarOpenAtom)
  const [treeOpen, setTreeOpen] = useAtom(projectTreeOpenAtom)
  const [assistantOpen, setAssistantOpen] = useAtom(assistantRailOpenAtom)
  const project = useAtomValue(selectedProjectAtom)

  const isMac =
    typeof navigator !== "undefined" &&
    navigator.platform.toUpperCase().includes("MAC")

  // Windows has its own WindowsTitleBar; the web build has no chrome.
  if (!isDesktop || !isMac) return null

  // The traffic lights sit at the window's top-left. They land on the
  // editor column only when every panel to its left is collapsed: the
  // projects sidebar always, and the file rail too on a workspace
  // surface. Reserve the 72px just for that case.
  const filesRailToLeft = workspace && treeOpen
  const reserve = !isFullscreen && !sidebarOpen && !filesRailToLeft

  return (
    <div
      className="relative z-30 shrink-0 flex items-stretch h-10"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      {/* Left — panel collapse toggles (un-dragged so they stay clickable),
          after an optional traffic-light reserve. */}
      <div
        className="flex items-center"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        {reserve && <div aria-hidden className="w-[72px] shrink-0" />}
        <div className="flex items-center gap-0.5 pl-1.5">
          <TopBarToggle
            onClick={() => setSidebarOpen((v) => !v)}
            title={sidebarOpen ? "Hide projects sidebar" : "Show projects sidebar"}
          >
            <PanelLeft className="h-4 w-4" />
          </TopBarToggle>
          {workspace && (
            <TopBarToggle
              onClick={() => setTreeOpen((v) => !v)}
              title={treeOpen ? "Hide file explorer" : "Show file explorer"}
            >
              <FolderTree className="h-4 w-4" />
            </TopBarToggle>
          )}
        </div>
      </div>

      {/* Centre — the project title, native-window-title style. */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="flex items-center gap-1.5 text-[12px]">
          <span className="text-muted-foreground/70">Lani</span>
          {project?.name && (
            <>
              <span className="text-muted-foreground/40">/</span>
              <span className="font-medium text-foreground/90">{project.name}</span>
            </>
          )}
        </div>
      </div>

      {/* Right — assistant rail toggle. The rail owns its own header
          (name + close); this stays so a closed rail can be reopened. */}
      {workspace && (
        <div
          className="ml-auto flex items-center pr-1.5"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <TopBarToggle
            onClick={() => setAssistantOpen((v) => !v)}
            title={assistantOpen ? "Hide assistant" : "Show assistant"}
          >
            <PanelRight className="h-4 w-4" />
          </TopBarToggle>
        </div>
      )}
    </div>
  )
}

function TopBarToggle({
  onClick,
  title,
  children,
}: {
  onClick: () => void
  title: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={cn(
        "press flex items-center justify-center h-7 w-7 rounded-md",
        "text-muted-foreground hover:text-foreground hover:bg-foreground/10",
        "transition-[color,background-color] duration-150 [transition-timing-function:var(--ease-natural)]",
      )}
    >
      {children}
    </button>
  )
}
