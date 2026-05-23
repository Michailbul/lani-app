"use client"

import { useEffect, useCallback, useState, useRef } from "react"
import { createPortal } from "react-dom"
import { useTextSelection, type TextSelectionSource } from "../context/text-selection-context"

interface TextSelectionPopoverProps {
  onAddToContext: (text: string, source: TextSelectionSource) => void
  onQuickComment?: (text: string, source: TextSelectionSource, rect: DOMRect) => void
  onFocusInput?: () => void
}

export function TextSelectionPopover({
  onAddToContext,
  onQuickComment,
  onFocusInput,
}: TextSelectionPopoverProps) {
  const { selectedText, source, selectionRect, clearSelection } =
    useTextSelection()
  const [isVisible, setIsVisible] = useState(false)
  const [isMouseDown, setIsMouseDown] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)

  const handleAddToContext = useCallback(() => {
    if (selectedText && source) {
      onAddToContext(selectedText, source)
      clearSelection()
      setIsVisible(false)
      // Focus the chat input after adding to context
      requestAnimationFrame(() => {
        onFocusInput?.()
      })
    }
  }, [selectedText, source, onAddToContext, clearSelection, onFocusInput])

  const handleQuickComment = useCallback(() => {
    if (selectedText && source && selectionRect && onQuickComment) {
      onQuickComment(selectedText, source, selectionRect)
      setIsVisible(false)
      // Don't clear selection - QuickCommentInput will handle it after submit
    }
  }, [selectedText, source, selectionRect, onQuickComment])

  // Track mouse down/up to know when selection is complete
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      // Ignore clicks on the popover itself
      if (popoverRef.current?.contains(e.target as Node)) {
        return
      }
      setIsMouseDown(true)
      setIsVisible(false) // Hide while selecting
    }

    const handleMouseUp = (e: MouseEvent) => {
      // Ignore clicks on the popover itself
      if (popoverRef.current?.contains(e.target as Node)) {
        return
      }
      setIsMouseDown(false)
    }

    document.addEventListener("mousedown", handleMouseDown)
    document.addEventListener("mouseup", handleMouseUp)

    return () => {
      document.removeEventListener("mousedown", handleMouseDown)
      document.removeEventListener("mouseup", handleMouseUp)
    }
  }, [])

  // Show popover only when mouse is up and we have a valid selection
  useEffect(() => {
    if (!isMouseDown && selectedText && source && selectionRect) {
      setIsVisible(true)
    } else if (!selectedText || !source || !selectionRect) {
      setIsVisible(false)
    }
  }, [isMouseDown, selectedText, source, selectionRect])

  // Cmd+L / Ctrl+L — keyboard shortcut for "Add to context". Equivalent
  // to clicking the popover button; works whenever a selection exists,
  // even if the popover is briefly hidden (e.g. while dragging). The
  // shortcut is captured at the window level so it works regardless of
  // which surface holds focus.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isCmdL =
        (e.metaKey || e.ctrlKey) &&
        !e.altKey &&
        !e.shiftKey &&
        (e.key === "l" || e.key === "L")
      if (!isCmdL) return
      if (!selectedText || !source) return
      e.preventDefault()
      e.stopPropagation()
      handleAddToContext()
    }
    window.addEventListener("keydown", handleKeyDown, true)
    return () => window.removeEventListener("keydown", handleKeyDown, true)
  }, [selectedText, source, handleAddToContext])

  // Don't render if not visible or if source is file-viewer (uses context menu instead).
  // The canvas owns its own interactions (clicking a node to focus, drag-to-connect),
  // so a floating popover over a selection inside a text block is wrong here.
  const isCanvasCenterPane =
    source?.type === "center-pane" && source.mode?.startsWith("canvas")
  if (
    !isVisible ||
    !selectedText ||
    !source ||
    !selectionRect ||
    source.type === "file-viewer" ||
    isCanvasCenterPane
  ) {
    return null
  }

  // Position the popover above the selection by default (below if there
  // isn't room above). Centering is done via CSS transform — we don't
  // know the popover's exact width yet, and a hand-rolled width estimate
  // (the old approach) was off by 20–40px depending on what buttons
  // happen to be rendered, which made the chip drift sideways and float
  // over neighbouring controls.
  const POPOVER_HEIGHT = 28
  const EDGE_PAD = 12
  const viewportWidth = window.innerWidth
  const rawCenterX = selectionRect.left + selectionRect.width / 2
  const centerX = Math.max(
    EDGE_PAD,
    Math.min(rawCenterX, viewportWidth - EDGE_PAD),
  )

  const spaceAbove = selectionRect.top
  const showAbove = spaceAbove > POPOVER_HEIGHT + 8

  const top = showAbove
    ? selectionRect.top - POPOVER_HEIGHT - 6
    : selectionRect.bottom + 6

  const style: React.CSSProperties = {
    position: "fixed",
    top,
    left: centerX,
    transform: "translateX(-50%)",
    zIndex: 100000,
  }

  const animationClass = showAbove
    ? "animate-in fade-in-0 zoom-in-95 origin-bottom duration-100"
    : "animate-in fade-in-0 zoom-in-95 origin-top duration-100"

  const popoverContent = (
    <div
      ref={popoverRef}
      style={style}
      className={animationClass}
    >
      <div
        className={
          "flex items-center gap-px whitespace-nowrap rounded-lg border border-border/80 " +
          "bg-popover/95 px-1 py-1 shadow-[0_8px_24px_-12px_rgba(0,0,0,0.35),0_2px_6px_-2px_rgba(0,0,0,0.15)] " +
          "backdrop-blur-md"
        }
      >
        <button
          onClick={handleAddToContext}
          className={
            "press inline-flex items-center gap-2 rounded-md px-2 py-1 " +
            "text-[12px] font-medium text-popover-foreground " +
            "transition-colors duration-100 hover:bg-foreground/[0.07]"
          }
        >
          <span>Add to context</span>
          <kbd
            className={
              "rounded border border-border/60 bg-foreground/[0.05] px-1 " +
              "font-mono text-[10px] font-medium text-popover-foreground/60"
            }
          >
            ⌘L
          </kbd>
        </button>
        {/* Quick comment button shows for diff and tool-edit selections */}
        {onQuickComment &&
          (source.type === "diff" || source.type === "tool-edit") && (
            <>
              <span aria-hidden className="mx-0.5 h-3.5 w-px bg-border/70" />
              <button
                onClick={handleQuickComment}
                className={
                  "press rounded-md px-2 py-1 text-[12px] font-medium " +
                  "text-popover-foreground transition-colors duration-100 " +
                  "hover:bg-foreground/[0.07]"
                }
              >
                Reply
              </button>
            </>
          )}
      </div>
    </div>
  )

  return createPortal(popoverContent, document.body)
}
