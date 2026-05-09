"use client"

/**
 * NoChatAssistantPanel — what fills the right-rail "assistant" slot of
 * the ScreenplayWorkspace when a project is open but no chat is active.
 *
 * The user can already browse + edit files in project mode. The panel's
 * only job is to be the obvious door to "now put Claude on it" — a
 * single primary CTA, plus a short list of resumable recent chats so
 * picking up where you left off is one click.
 */

import { useMemo } from "react"
import { useSetAtom, useAtomValue } from "jotai"
import {
  ChevronRight,
  GitBranch,
  MessageSquarePlus,
  Sparkles,
} from "lucide-react"
import { trpc } from "../../../lib/trpc"
import { Skeleton } from "../../../components/ui/skeleton"
import { cn } from "../../../lib/utils"
import {
  selectedAgentChatIdAtom,
  selectedProjectAtom,
  showNewChatFormAtom,
} from "../atoms"

function formatRelative(input: string | Date | null | undefined): string {
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

export function NoChatAssistantPanel() {
  const selectedProject = useAtomValue(selectedProjectAtom)
  const setSelectedChatId = useSetAtom(selectedAgentChatIdAtom)
  const setShowNewChatForm = useSetAtom(showNewChatFormAtom)

  const projectId = selectedProject?.id

  const { data: chats, isLoading } = trpc.chats.list.useQuery(
    { projectId: projectId ?? "" },
    { enabled: !!projectId },
  )

  const recentChats = useMemo(() => {
    if (!chats) return []
    return chats.slice(0, 6)
  }, [chats])

  const handleStart = () => setShowNewChatForm(true)
  const handleResume = (chatId: string) => setSelectedChatId(chatId)

  return (
    <div className="h-full w-full flex flex-col overflow-hidden bg-background/40">
      {/* ── Editorial preamble ── */}
      <div className="px-4 pt-5 pb-4 border-b border-border/60">
        <div className="flex items-center gap-2 mb-3">
          <span
            className="inline-block w-[14px] h-[1px] bg-primary"
            aria-hidden
          />
          <span
            className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground/75"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            Assistant
          </span>
        </div>
        <p className="text-[12.5px] text-muted-foreground/85 leading-snug">
          Browsing{" "}
          <span className="text-foreground/90 font-medium">
            {selectedProject?.name ?? "this project"}
          </span>
          . Start a chat to put Claude on the page.
        </p>
      </div>

      {/* ── Primary CTA ── */}
      <div className="px-4 pt-4">
        <button
          onClick={handleStart}
          className={cn(
            "group w-full text-left rounded-lg p-3.5 overflow-hidden",
            "bg-primary/[0.07] border border-primary/30",
            "hover:bg-primary/[0.12] hover:border-primary/50",
            "dark:bg-primary/[0.09] dark:border-primary/35 dark:hover:bg-primary/[0.16]",
            "transition-[background-color,border-color,transform] duration-150 ease-out",
            "active:scale-[0.99]",
          )}
        >
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-md bg-primary/15 text-primary flex items-center justify-center flex-shrink-0">
              <MessageSquarePlus className="h-4 w-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-display text-[13.5px] font-semibold tracking-tight leading-tight">
                Start a new chat
              </div>
              <div className="text-[11px] text-muted-foreground/85 leading-snug mt-0.5">
                Spin up a fresh worktree against this project
              </div>
            </div>
            <ChevronRight className="h-3.5 w-3.5 text-primary/60 -translate-x-1 group-hover:translate-x-0 transition-transform flex-shrink-0" />
          </div>
        </button>
      </div>

      {/* ── Recent chats ── */}
      <div className="flex-1 min-h-0 overflow-y-auto pt-5 pb-4 px-2">
        <div className="px-2 mb-2 flex items-baseline gap-2.5">
          <span
            className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/65"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            Recent chats
          </span>
          <span className="h-px flex-1 bg-border/55 self-center" />
          {!isLoading && recentChats.length > 0 && (
            <span
              className="text-[10px] tabular-nums text-muted-foreground/45"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              {recentChats.length.toString().padStart(2, "0")}
            </span>
          )}
        </div>

        {isLoading ? (
          <div className="space-y-1">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-2.5 px-2 py-1.5">
                <Skeleton className="h-5 w-5 rounded" />
                <div className="flex-1 space-y-1">
                  <Skeleton className="h-2.5 w-32" />
                  <Skeleton className="h-2 w-20" />
                </div>
              </div>
            ))}
          </div>
        ) : recentChats.length === 0 ? (
          <div className="px-3 py-4 flex items-center gap-2 text-[11px] text-muted-foreground/70 leading-snug">
            <Sparkles className="h-3 w-3 flex-shrink-0" />
            <span>No chats yet — start one above.</span>
          </div>
        ) : (
          <ul className="space-y-0.5">
            {recentChats.map((chat) => (
              <li key={chat.id}>
                <button
                  onClick={() => handleResume(chat.id)}
                  className={cn(
                    "group w-full flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left",
                    "transition-colors duration-100",
                    "hover:bg-foreground/[0.04] dark:hover:bg-foreground/[0.06]",
                  )}
                >
                  <div className="w-5 h-5 rounded bg-muted/70 border border-border/50 flex items-center justify-center flex-shrink-0">
                    <MessageSquarePlus className="h-2.5 w-2.5 text-muted-foreground/65" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span
                        className="truncate text-[12.5px] text-foreground/90"
                        style={{
                          fontFamily: "var(--font-body)",
                          fontWeight: 500,
                        }}
                      >
                        {chat.name?.trim() || "Untitled chat"}
                      </span>
                      <span
                        className="text-[10px] tabular-nums text-muted-foreground/45 flex-shrink-0"
                        style={{ fontFamily: "var(--font-mono)" }}
                      >
                        {formatRelative(chat.updatedAt)}
                      </span>
                    </div>
                    {chat.branch && (
                      <div className="flex items-center gap-1 text-[10px] text-muted-foreground/55 truncate mt-0.5">
                        <GitBranch className="h-2.5 w-2.5 flex-shrink-0" />
                        <span
                          className="truncate"
                          style={{ fontFamily: "var(--font-mono)" }}
                        >
                          {chat.branch}
                        </span>
                      </div>
                    )}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
