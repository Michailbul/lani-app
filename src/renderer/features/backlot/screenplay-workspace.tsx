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

import { type ReactNode } from "react"
import { useAtom } from "jotai"
import { atomWithStorage } from "jotai/utils"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { ScreenplayPane } from "./screenplay-pane"
import { cn } from "../../lib/utils"

const ASSISTANT_RAIL_OPEN_ATOM = atomWithStorage("backlot:assistant-rail-open", true)

const RAIL_WIDTH = 420 // px — wide enough for chat bubbles + tool chips, narrow enough that the screenplay still breathes

interface ScreenplayWorkspaceProps {
  directionName?: string | null
  artifactPath?: string | null
  /** The existing 1code <ChatView /> goes here. */
  assistant: ReactNode
}

export function ScreenplayWorkspace({
  directionName,
  artifactPath,
  assistant,
}: ScreenplayWorkspaceProps) {
  const [railOpen, setRailOpen] = useAtom(ASSISTANT_RAIL_OPEN_ATOM)

  return (
    <div className="flex h-full w-full overflow-hidden">
      {/* Center — screenplay artifact */}
      <div className="flex-1 min-w-0 relative">
        <ScreenplayPane
          directionName={directionName}
          artifactPath={artifactPath}
        />

        {/* Toggle handle (only visible when rail is closed). */}
        {!railOpen && (
          <button
            type="button"
            onClick={() => setRailOpen(true)}
            className={cn(
              "absolute top-1/2 -translate-y-1/2 right-0",
              "flex items-center justify-center",
              "w-6 h-16 rounded-l-md border border-r-0 border-border",
              "bg-card hover:bg-secondary text-muted-foreground hover:text-foreground",
              "transition-colors shadow-sm",
            )}
            aria-label="Show assistant"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Right rail — assistant. Resizable later; fixed width for v1. */}
      {railOpen && (
        <aside
          className="border-l border-border bg-background/40 relative shrink-0 flex flex-col"
          style={{ width: RAIL_WIDTH }}
        >
          {/* Rail header */}
          <div className="flex items-center justify-between h-9 px-3 border-b border-border bg-card/40 select-none shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 font-mono">
                Assistant
              </span>
            </div>
            <button
              type="button"
              onClick={() => setRailOpen(false)}
              className="text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Hide assistant"
            >
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
