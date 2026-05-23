import React, { useMemo, useCallback } from "react"
import { useAtom } from "jotai"
import { Check } from "lucide-react"
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
} from "../../../components/ui/context-menu"
import { Kbd } from "../../../components/ui/kbd"
import { cn, isMac } from "../../../lib/utils"
import { isDesktopApp } from "../../../lib/utils/platform"
import type { SubChatMeta } from "../stores/sub-chat-store"
import { useResolvedHotkeyDisplay } from "../../../lib/hotkeys"
import { exportChat, copyChat, type ExportFormat } from "../lib/export-chat"
import { threadColorsAtom } from "../../backlot/atoms"

// Curated thread-accent palette — the studio's warm set plus the kiwi
// app accent. Picked from the tab context menu; see threadColorsAtom.
const THREAD_COLORS = [
  "#C9E34B",
  "#F26157",
  "#FF8C42",
  "#E8A838",
  "#79B791",
  "#5E91A8",
  "#A87BB8",
  "#C77B9C",
] as const

const openInNewWindow = (chatId: string, subChatId: string) => {
  window.desktopApi?.newWindow({ chatId, subChatId })
}

// Platform-aware keyboard shortcut for close tab
// Uses custom hotkey from settings if configured
const useCloseTabShortcut = () => {
  const archiveAgentHotkey = useResolvedHotkeyDisplay("archive-agent")
  return useMemo(() => {
    if (!isMac) return "Alt+Ctrl+W"
    return archiveAgentHotkey || "⌘W"
  }, [archiveAgentHotkey])
}

interface SubChatContextMenuProps {
  subChat: SubChatMeta
  isPinned: boolean
  onTogglePin: (subChatId: string) => void
  onRename: (subChat: SubChatMeta) => void
  onArchive: (subChatId: string) => void
  onArchiveOthers: (subChatId: string) => void
  onArchiveAllBelow?: (subChatId: string) => void
  isOnlyChat: boolean
  currentIndex?: number
  totalCount?: number
  showCloseTabOptions?: boolean
  onCloseTab?: (subChatId: string) => void
  onCloseOtherTabs?: (subChatId: string) => void
  onCloseTabsToRight?: (subChatId: string, visualIndex: number) => void
  visualIndex?: number
  hasTabsToRight?: boolean
  canCloseOtherTabs?: boolean
  /** Hard-delete the thread from the workspace (not just close the tab). */
  onDeleteThread?: (subChat: SubChatMeta) => void
  /** Parent chat ID for export functionality */
  chatId?: string | null
}

export function SubChatContextMenu({
  subChat,
  isPinned,
  onTogglePin,
  onRename,
  onArchive,
  onArchiveOthers,
  onArchiveAllBelow,
  isOnlyChat,
  currentIndex,
  totalCount,
  showCloseTabOptions = false,
  onCloseTab,
  onCloseOtherTabs,
  onCloseTabsToRight,
  visualIndex = 0,
  hasTabsToRight = false,
  canCloseOtherTabs = false,
  onDeleteThread,
  chatId,
}: SubChatContextMenuProps) {
  const closeTabShortcut = useCloseTabShortcut()

  const [threadColors, setThreadColors] = useAtom(threadColorsAtom)
  const currentColor = threadColors[subChat.id]
  const setThreadColor = useCallback(
    (color: string | null) => {
      setThreadColors((prev) => {
        if (!color) {
          const next = { ...prev }
          delete next[subChat.id]
          return next
        }
        return { ...prev, [subChat.id]: color }
      })
    },
    [setThreadColors, subChat.id],
  )

  const handleExport = useCallback((format: ExportFormat) => {
    if (!chatId) return
    exportChat({ chatId, subChatId: subChat.id, format })
  }, [chatId, subChat.id])

  const handleCopy = useCallback((format: ExportFormat) => {
    if (!chatId) return
    copyChat({ chatId, subChatId: subChat.id, format })
  }, [chatId, subChat.id])

  return (
    <ContextMenuContent className="w-48">
      <ContextMenuItem onClick={() => onTogglePin(subChat.id)}>
        {isPinned ? "Unpin chat" : "Pin chat"}
      </ContextMenuItem>
      <ContextMenuItem onClick={() => onRename(subChat)}>
        Rename chat
      </ContextMenuItem>
      <ContextMenuSub>
        <ContextMenuSubTrigger>
          <span className="flex items-center gap-2">
            <span
              className="h-3 w-3 rounded-full border border-border/60 shrink-0"
              style={
                currentColor
                  ? { backgroundColor: currentColor }
                  : { backgroundColor: "hsl(var(--muted))" }
              }
            />
            Thread color
          </span>
        </ContextMenuSubTrigger>
        <ContextMenuSubContent
          sideOffset={6}
          alignOffset={-4}
          className="w-[184px] p-2"
        >
          <div className="flex flex-wrap gap-1.5">
            {THREAD_COLORS.map((color) => {
              const selected = currentColor === color
              return (
                <ContextMenuItem
                  key={color}
                  onClick={() => setThreadColor(color)}
                  className={cn(
                    "h-7 w-7 p-0 rounded-full flex items-center justify-center",
                    "cursor-pointer transition-transform duration-100 hover:scale-110",
                    "focus:scale-110",
                  )}
                  style={{
                    backgroundColor: color,
                    boxShadow: selected
                      ? `0 0 0 2px hsl(var(--popover)), 0 0 0 4px ${color}`
                      : undefined,
                  }}
                >
                  {selected && (
                    <Check
                      className="h-3.5 w-3.5 text-white"
                      style={{ filter: "drop-shadow(0 1px 1px rgba(0,0,0,0.4))" }}
                    />
                  )}
                </ContextMenuItem>
              )
            })}
          </div>
          <ContextMenuSeparator />
          <ContextMenuItem
            onClick={() => setThreadColor(null)}
            disabled={!currentColor}
          >
            Clear color
          </ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>
      {chatId && (
        <ContextMenuSub>
          <ContextMenuSubTrigger>Export chat</ContextMenuSubTrigger>
          <ContextMenuSubContent sideOffset={6} alignOffset={-4}>
            <ContextMenuItem onClick={() => handleExport("markdown")}>
              Download as Markdown
            </ContextMenuItem>
            <ContextMenuItem onClick={() => handleExport("json")}>
              Download as JSON
            </ContextMenuItem>
            <ContextMenuItem onClick={() => handleExport("text")}>
              Download as Text
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => handleCopy("markdown")}>
              Copy as Markdown
            </ContextMenuItem>
            <ContextMenuItem onClick={() => handleCopy("json")}>
              Copy as JSON
            </ContextMenuItem>
            <ContextMenuItem onClick={() => handleCopy("text")}>
              Copy as Text
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
      )}
      {isDesktopApp() && chatId && (
        <ContextMenuItem onClick={() => openInNewWindow(chatId, subChat.id)}>
          Open in new window
        </ContextMenuItem>
      )}
      <ContextMenuSeparator />

      {showCloseTabOptions ? (
        <>
          <ContextMenuItem
            onClick={() => onCloseTab?.(subChat.id)}
            className="justify-between"
            disabled={isOnlyChat}
          >
            Archive chat
            {!isOnlyChat && <Kbd>{closeTabShortcut}</Kbd>}
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => onCloseOtherTabs?.(subChat.id)}
            disabled={!canCloseOtherTabs}
          >
            Archive other chats
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => onCloseTabsToRight?.(subChat.id, visualIndex)}
            disabled={!hasTabsToRight}
          >
            Archive chats to the right
          </ContextMenuItem>
          {onDeleteThread && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem
                onClick={() => onDeleteThread(subChat)}
                className="text-destructive focus:text-destructive"
              >
                Delete permanently
              </ContextMenuItem>
            </>
          )}
        </>
      ) : (
        <>
          <ContextMenuItem
            onClick={() => onArchive(subChat.id)}
            className="justify-between"
            disabled={isOnlyChat}
          >
            Archive chat
            {!isOnlyChat && <Kbd>{closeTabShortcut}</Kbd>}
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => onArchiveAllBelow?.(subChat.id)}
            disabled={
              currentIndex === undefined ||
              currentIndex >= (totalCount || 0) - 1
            }
          >
            Archive chats below
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => onArchiveOthers(subChat.id)}
            disabled={isOnlyChat}
          >
            Archive other chats
          </ContextMenuItem>
        </>
      )}
    </ContextMenuContent>
  )
}
