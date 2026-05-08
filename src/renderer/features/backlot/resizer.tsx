"use client"

/**
 * Resizer — a thin draggable handle for resizing a sibling pane.
 *
 * Two flavours:
 *   - `axis="x"` → vertical bar, drag horizontally → call onResize(delta)
 *   - `axis="y"` → horizontal bar, drag vertically → call onResize(delta)
 *
 * The parent component owns the dimension value (typically in a jotai
 * atom). Resizer just reports deltas; the parent clamps + persists.
 *
 * Visual: 1 px painted line, 4 px hit area, hover lights up Coral.
 */

import { useEffect, useRef, useState } from "react"
import { cn } from "../../lib/utils"

export interface ResizerProps {
  axis: "x" | "y"
  /** Called with delta in pixels (signed) every mousemove during drag. */
  onResize: (delta: number) => void
  /** Optional callback fired once on mouseup. */
  onResizeEnd?: () => void
  className?: string
}

export function Resizer({ axis, onResize, onResizeEnd, className }: ResizerProps) {
  const [active, setActive] = useState(false)
  const lastRef = useRef<number | null>(null)

  useEffect(() => {
    if (!active) return
    const onMove = (e: MouseEvent) => {
      const cur = axis === "x" ? e.clientX : e.clientY
      if (lastRef.current == null) {
        lastRef.current = cur
        return
      }
      const delta = cur - lastRef.current
      lastRef.current = cur
      if (delta !== 0) onResize(delta)
    }
    const onUp = () => {
      setActive(false)
      lastRef.current = null
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
      onResizeEnd?.()
    }
    document.body.style.cursor = axis === "x" ? "col-resize" : "row-resize"
    document.body.style.userSelect = "none"
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
    return () => {
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    }
  }, [active, axis, onResize, onResizeEnd])

  return (
    <div
      role="separator"
      aria-orientation={axis === "x" ? "vertical" : "horizontal"}
      onMouseDown={(e) => {
        e.preventDefault()
        lastRef.current = axis === "x" ? e.clientX : e.clientY
        setActive(true)
      }}
      className={cn(
        "shrink-0 relative group",
        // Slow fade on the hover affordance — drag handles shouldn't snap
        // to color, they should warm up under the cursor like a real
        // physical handle.
        "transition-[background-color] duration-200 [transition-timing-function:var(--ease-natural)]",
        axis === "x"
          ? "w-1.5 h-full cursor-col-resize hover:bg-primary/15"
          : "h-1.5 w-full cursor-row-resize hover:bg-primary/15",
        active && "bg-primary/25",
        className,
      )}
    >
      {/* Painted hairline */}
      <div
        className={cn(
          "absolute bg-border group-hover:bg-primary/60",
          "transition-[background-color] duration-200 [transition-timing-function:var(--ease-natural)]",
          axis === "x"
            ? "inset-y-0 left-1/2 -translate-x-1/2 w-px"
            : "inset-x-0 top-1/2 -translate-y-1/2 h-px",
          active && "bg-primary",
        )}
      />
    </div>
  )
}
