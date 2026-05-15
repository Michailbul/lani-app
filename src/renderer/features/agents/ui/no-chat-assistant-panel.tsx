"use client"

/**
 * NoChatAssistantPanel — what fills the right-rail "assistant" slot of
 * the ScreenplayWorkspace when a project is open but no chat is active.
 *
 * Visual contract: matches the settings-tab card idiom. White-on-grey
 * cards with `border-t` separators, `text-sm font-medium` labels,
 * `text-xs text-muted-foreground` descriptions, ChevronRight on right.
 * Same components as agents-plugins-tab and agents-skills-tab so the
 * whole app reads as one product, not a salad of micro-systems.
 */

import { useMemo } from "react"
import { useSetAtom, useAtomValue } from "jotai"
import { ChevronRight, GitBranch, Loader2 } from "lucide-react"
import { trpc } from "../../../lib/trpc"
import { Skeleton } from "../../../components/ui/skeleton"
import { ClaudeCodeIcon, CodexIcon } from "../../../components/ui/icons"
import { cn } from "../../../lib/utils"
import {
  lastSelectedAgentIdAtom,
  selectedAgentChatIdAtom,
  selectedChatIsRemoteAtom,
  selectedProjectAtom,
} from "../atoms"
import { chatSourceModeAtom } from "../../../lib/atoms"

type SessionProvider = "claude-code" | "codex"

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

type ProviderRowProps = {
  icon: React.ComponentType<{ className?: string }>
  label: string
  description: string
  pending: boolean
  disabled: boolean
  onClick: () => void
  borderTop?: boolean
}

function ProviderRow({
  icon: Icon,
  label,
  description,
  pending,
  disabled,
  onClick,
  borderTop,
}: ProviderRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "group w-full flex items-center justify-between p-4 text-left",
        "transition-colors duration-150 hover:bg-foreground/[0.03]",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring/70 focus-visible:-outline-offset-2",
        "disabled:opacity-60 disabled:pointer-events-none",
        borderTop && "border-t border-border",
      )}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-7 h-7 rounded-md bg-muted/70 border border-border/60 flex items-center justify-center flex-shrink-0">
          <Icon className="h-3.5 w-3.5 text-foreground" />
        </div>
        <div className="flex flex-col space-y-0.5 min-w-0">
          <span className="text-sm font-medium text-foreground truncate">
            {label}
          </span>
          <span className="text-xs text-muted-foreground truncate">
            {description}
          </span>
        </div>
      </div>
      {pending ? (
        <Loader2 className="h-4 w-4 text-muted-foreground/60 shrink-0 animate-spin" />
      ) : (
        <ChevronRight className="h-4 w-4 text-muted-foreground/40 shrink-0 transition-transform duration-150 group-hover:translate-x-0.5" />
      )}
    </button>
  )
}

export function NoChatAssistantPanel() {
  const selectedProject = useAtomValue(selectedProjectAtom)
  const setSelectedChatId = useSetAtom(selectedAgentChatIdAtom)
  const setSelectedChatIsRemote = useSetAtom(selectedChatIsRemoteAtom)
  const setChatSourceMode = useSetAtom(chatSourceModeAtom)
  const setLastSelectedAgentId = useSetAtom(lastSelectedAgentIdAtom)
  const utils = trpc.useUtils()
  const createSession = trpc.chats.create.useMutation({
    onSuccess: (session) => {
      utils.chats.list.invalidate()
      setSelectedChatIsRemote(false)
      setChatSourceMode("local")
      setSelectedChatId(session.id)
    },
  })

  const projectId = selectedProject?.id

  const { data: chats, isLoading } = trpc.chats.list.useQuery(
    { projectId: projectId ?? "" },
    { enabled: !!projectId },
  )

  const recentChats = useMemo(() => {
    if (!chats) return []
    return chats.slice(0, 6)
  }, [chats])

  // Track which provider is currently spinning so we can show a row-level
  // loader and disable both rows during a create. Avoids the user firing
  // two creates in a race.
  const pendingProvider: SessionProvider | null =
    createSession.isPending && createSession.variables
      ? ((createSession.variables as { provider?: SessionProvider })
          .provider ?? "claude-code")
      : null

  const handleStart = (provider: SessionProvider) => {
    if (!selectedProject || createSession.isPending) return
    setLastSelectedAgentId(provider)
    createSession.mutate({
      projectId: selectedProject.id,
      name: provider === "codex" ? "Codex Session" : "Claude Session",
      provider,
      useWorktree: false,
      mode: "agent",
    })
  }
  const handleResume = (chatId: string) => setSelectedChatId(chatId)

  return (
    <div className="h-full w-full flex flex-col overflow-hidden bg-background">
      {/* ── Header ── */}
      <div className="flex flex-col space-y-1.5 px-4 pt-5 pb-4 shrink-0">
        <h3 className="text-sm font-semibold text-foreground">Assistant</h3>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Browsing{" "}
          <span className="text-foreground font-medium">
            {selectedProject?.name ?? "this project"}
          </span>
          . Start a session when you want an agent on the page.
        </p>
      </div>

      {/* ── Scroll body ── */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-6 space-y-5">
        {/* Start a session — single card, two rows */}
        <div className="space-y-2">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-1">
            Start a session
          </p>
          <div className="bg-background rounded-lg border border-border overflow-hidden">
            <ProviderRow
              icon={ClaudeCodeIcon}
              label="Claude Code"
              description="Anthropic Claude — recommended"
              pending={pendingProvider === "claude-code"}
              disabled={createSession.isPending}
              onClick={() => handleStart("claude-code")}
            />
            <ProviderRow
              icon={CodexIcon}
              label="Codex"
              description="OpenAI Codex CLI"
              pending={pendingProvider === "codex"}
              disabled={createSession.isPending}
              onClick={() => handleStart("codex")}
              borderTop
            />
          </div>
        </div>

        {/* Recent sessions */}
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              Recent sessions
            </span>
            {!isLoading && recentChats.length > 0 && (
              <span className="text-xs tabular-nums text-muted-foreground/55">
                {recentChats.length}
              </span>
            )}
          </div>

          {isLoading ? (
            <div className="bg-background rounded-lg border border-border overflow-hidden">
              {Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className={cn(
                    "flex items-center gap-2.5 px-3 py-2.5",
                    i > 0 && "border-t border-border",
                  )}
                >
                  <Skeleton className="h-5 w-5 rounded" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3 w-32" />
                    <Skeleton className="h-2 w-20" />
                  </div>
                  <Skeleton className="h-2.5 w-8" />
                </div>
              ))}
            </div>
          ) : recentChats.length === 0 ? (
            <div className="bg-background rounded-lg border border-border p-4">
              <p className="text-xs text-muted-foreground leading-relaxed">
                No sessions yet — start one above.
              </p>
            </div>
          ) : (
            <div className="bg-background rounded-lg border border-border overflow-hidden">
              {recentChats.map((chat, i) => {
                const isCodex = (chat as { provider?: string }).provider === "codex"
                const ChatIcon = isCodex ? CodexIcon : ClaudeCodeIcon
                return (
                  <button
                    type="button"
                    key={chat.id}
                    onClick={() => handleResume(chat.id)}
                    className={cn(
                      "group w-full flex items-center justify-between p-3 text-left",
                      "transition-colors duration-150 hover:bg-foreground/[0.03]",
                      "focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring/70 focus-visible:-outline-offset-2",
                      i > 0 && "border-t border-border",
                    )}
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <div className="w-5 h-5 rounded bg-muted/70 border border-border/50 flex items-center justify-center flex-shrink-0">
                        <ChatIcon className="h-2.5 w-2.5 text-muted-foreground" />
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className="text-sm font-medium text-foreground truncate">
                          {chat.name?.trim() || "Untitled chat"}
                        </span>
                        {chat.branch && (
                          <span className="flex items-center gap-1 text-xs text-muted-foreground truncate">
                            <GitBranch className="h-2.5 w-2.5 flex-shrink-0" />
                            <span className="truncate font-mono text-[11px]">
                              {chat.branch}
                            </span>
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="text-xs tabular-nums text-muted-foreground/55 shrink-0 ml-2">
                      {formatRelative(chat.updatedAt)}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
