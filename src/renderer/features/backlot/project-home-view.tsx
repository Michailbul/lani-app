"use client"

/**
 * ProjectHomeView — what the user sees after picking a project but
 * before opening (or starting) a chat.
 *
 * Backlot's "open a project" gesture should never *force* the user to
 * write an initial message. Most of the time they want to:
 *
 *   1. Resume a chat they left half-finished, or
 *   2. Start a new chat with a clear thought (or no thought yet),
 *      or
 *   3. Just look at the project's files for a moment before deciding.
 *
 * This view supports all three. It's the project's lobby — never an
 * editor, never a chat surface, never a forced form. From here the
 * user picks where to go next.
 */

import { useMemo } from "react"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import {
  ArrowLeft,
  ChevronRight,
  GitBranch,
  MessageSquarePlus,
  Plus,
  Sparkles,
} from "lucide-react"
import {
  selectedAgentChatIdAtom,
  selectedProjectAtom,
  showNewChatFormAtom,
} from "../agents/atoms"
import { trpc } from "../../lib/trpc"
import { Skeleton } from "../../components/ui/skeleton"
import { ProjectIcon } from "../../components/ui/project-icon"
import { cn } from "../../lib/utils"

/** Friendly relative time. Mirrors the formatter in the landing page. */
function formatRelative(input: string | Date | null | undefined): string {
  if (!input) return "—"
  const d = input instanceof Date ? input : new Date(input)
  const now = Date.now()
  const diff = now - d.getTime()
  const sec = Math.floor(diff / 1000)
  const min = Math.floor(sec / 60)
  const hr = Math.floor(min / 60)
  const day = Math.floor(hr / 24)
  if (sec < 60) return "just now"
  if (min < 60) return `${min}m ago`
  if (hr < 24) return `${hr}h ago`
  if (day === 1) return "yesterday"
  if (day < 7) return `${day}d ago`
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

function prettyPath(p: string): string {
  const idx = p.indexOf("/.backlot/projects/")
  if (idx >= 0) return `~${p.slice(idx)}`
  return p
}

export function ProjectHomeView() {
  const [selectedProject, setSelectedProject] = useAtom(selectedProjectAtom)
  const setSelectedChatId = useSetAtom(selectedAgentChatIdAtom)
  const setShowNewChatForm = useSetAtom(showNewChatFormAtom)

  const projectId = selectedProject?.id

  const { data: chats, isLoading: isLoadingChats } = trpc.chats.list.useQuery(
    { projectId: projectId ?? "" },
    { enabled: !!projectId },
  )

  const recentChats = useMemo(() => {
    if (!chats) return []
    return chats.slice(0, 8)
  }, [chats])

  if (!selectedProject) {
    // Defensive — agents-content shouldn't mount this branch without a project.
    return null
  }

  const handleResumeChat = (chatId: string) => {
    setSelectedChatId(chatId)
  }

  const handleStartChat = () => {
    setShowNewChatForm(true)
  }

  const handleSwitchProject = () => {
    setSelectedProject(null)
  }

  return (
    <div className="h-full w-full overflow-y-auto bg-background">
      <div className="w-full max-w-[640px] mx-auto px-6 pt-12 pb-16 space-y-10">
        {/* ── Switch link, top-left of the column ── */}
        <div className="-mt-6 -mb-4">
          <button
            onClick={handleSwitchProject}
            className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground/65 hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-3 w-3" />
            <span>Switch project</span>
          </button>
        </div>

        {/* ── Project header ── */}
        <header className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-muted/70 border border-border/60 flex items-center justify-center flex-shrink-0">
              <ProjectIcon project={selectedProject} className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground/65">
                  Project
                </span>
              </div>
              <h1 className="font-display text-3xl font-bold tracking-[-0.02em] leading-tight truncate">
                {selectedProject.name}
              </h1>
            </div>
          </div>
          <div className="text-[11px] font-mono text-muted-foreground/65 truncate pl-[52px]">
            {prettyPath(selectedProject.path)}
          </div>
        </header>

        {/* ── Primary action: start a new chat ── */}
        <section>
          <button
            onClick={handleStartChat}
            className={cn(
              "group w-full text-left rounded-xl p-5 overflow-hidden",
              "bg-primary/[0.06] border border-primary/30",
              "hover:bg-primary/[0.1] hover:border-primary/50",
              "dark:bg-primary/[0.08] dark:border-primary/35 dark:hover:bg-primary/[0.14]",
              "transition-[background-color,border-color,transform] duration-150 ease-out",
              "active:scale-[0.99]",
            )}
          >
            <div className="flex items-start gap-4">
              <div className="w-9 h-9 rounded-md bg-primary/15 text-primary flex items-center justify-center flex-shrink-0 mt-0.5">
                <MessageSquarePlus className="h-4.5 w-4.5" />
              </div>
              <div className="flex-1 min-w-0 space-y-1">
                <div className="font-display text-[17px] font-semibold tracking-tight leading-tight">
                  Start a new chat
                </div>
                <div className="text-[12.5px] text-muted-foreground leading-snug max-w-[420px]">
                  Work in the project draft with Claude or Codex - a beat to
                  break, a scene to reshape, a prompt to refine.
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-primary/60 mt-2 -translate-x-1 group-hover:translate-x-0 transition-transform flex-shrink-0" />
            </div>
          </button>
        </section>

        {/* ── Recent chats ── */}
        <section className="space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <div className="flex items-baseline gap-2.5">
              <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground/70">
                Recent chats
              </span>
              <span className="h-px flex-1 bg-border/70 self-center" />
            </div>
            {!isLoadingChats && recentChats.length > 0 && (
              <span className="text-[10px] font-mono tabular-nums text-muted-foreground/55">
                {recentChats.length.toString().padStart(2, "0")}
              </span>
            )}
          </div>

          {isLoadingChats ? (
            <div className="space-y-1">
              {Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 rounded-md px-2.5 py-2"
                >
                  <Skeleton className="h-7 w-7 rounded-md" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3 w-44" />
                    <Skeleton className="h-2.5 w-32" />
                  </div>
                  <Skeleton className="h-2.5 w-12" />
                </div>
              ))}
            </div>
          ) : recentChats.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center py-8 px-4 rounded-lg border border-dashed border-border/60 bg-muted/20">
              <Sparkles className="h-4 w-4 text-muted-foreground/55 mb-2" />
              <div className="text-[12px] text-muted-foreground/85 leading-relaxed max-w-[300px]">
                No chats yet for this project. Start one above when you want an
                agent on the page.
              </div>
            </div>
          ) : (
            <ul className="space-y-0.5">
              {recentChats.map((chat) => (
                <li key={chat.id}>
                  <button
                    onClick={() => handleResumeChat(chat.id)}
                    className={cn(
                      "group w-full flex items-center gap-3 rounded-md px-2.5 py-2 text-left",
                      "transition-colors duration-100",
                      "hover:bg-foreground/[0.04] dark:hover:bg-foreground/[0.06]",
                    )}
                  >
                    <div className="w-7 h-7 rounded-md bg-muted/70 border border-border/60 flex items-center justify-center flex-shrink-0">
                      <MessageSquarePlus className="h-3.5 w-3.5 text-muted-foreground/70" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2 min-w-0">
                        <span className="font-display text-[14px] font-semibold tracking-tight text-foreground truncate">
                          {chat.name?.trim() || "Untitled chat"}
                        </span>
                        <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/55 flex-shrink-0">
                          {formatRelative(chat.updatedAt)}
                        </span>
                      </div>
                      {chat.branch && (
                        <div className="flex items-center gap-1 text-[11px] font-mono text-muted-foreground/65 truncate mt-0.5">
                          <GitBranch className="h-2.5 w-2.5 flex-shrink-0" />
                          <span className="truncate">{chat.branch}</span>
                        </div>
                      )}
                    </div>
                    <ChevronRight
                      className={cn(
                        "h-3.5 w-3.5 text-muted-foreground/40 flex-shrink-0",
                        "transition-[opacity,transform] duration-150",
                        "opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0",
                      )}
                    />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── Tertiary: keyboard hint ── */}
        <section className="flex items-center justify-center gap-2 pt-2">
          <span className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground/45">
            Press
          </span>
          <kbd className="inline-flex items-center justify-center h-4 min-w-[16px] px-1 rounded border border-border/70 bg-background/60 text-[10px] leading-none font-mono">
            ⌘
          </kbd>
          <kbd className="inline-flex items-center justify-center h-4 min-w-[16px] px-1 rounded border border-border/70 bg-background/60 text-[10px] leading-none font-mono">
            ↵
          </kbd>
          <span className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground/45">
            to start a chat
          </span>
        </section>
      </div>
    </div>
  )
}
