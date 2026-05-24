/**
 * In-canvas crop overlay — rendered on top of an image node while the
 * user is cropping it. The user drags out a freeform rectangle on the
 * image; once drawn, that rect can be moved by its body or resized
 * from 8 handles. Pressing on the dim outside the rect starts a fresh
 * drag-out, replacing whatever rect was there. While no rect exists
 * yet, the whole image area is a crosshair zone.
 *
 * Coordinates are kept in NORMALIZED (0..1) form against the natural
 * image, so the parent can apply the crop without knowing anything
 * about display sizes or canvas zoom.
 */

import type { PointerEvent as ReactPointerEvent } from "react"
import { useEffect, useState } from "react"
import { cn } from "../../lib/utils"

export interface CropRect {
  x: number
  y: number
  width: number
  height: number
}

type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "move"

export function InCanvasCropOverlay({
  imageUrl,
  containerWidth,
  containerHeight,
  zoom,
  cropRect,
  onCropRectChange,
}: {
  imageUrl: string
  containerWidth: number
  containerHeight: number
  zoom: number
  cropRect: CropRect | null
  onCropRectChange: (next: CropRect | null) => void
}) {
  const [naturalAspect, setNaturalAspect] = useState<number | null>(null)

  // Learn the image's natural aspect — needed to map the on-screen
  // letterbox layout to the underlying pixels.
  useEffect(() => {
    const img = new Image()
    img.crossOrigin = "anonymous"
    img.onload = () => {
      if (img.naturalHeight > 0) {
        setNaturalAspect(img.naturalWidth / img.naturalHeight)
      }
    }
    img.src = imageUrl
  }, [imageUrl])

  // Crop starts empty — the user drags out a rectangle on the image to
  // define the region. No auto-fill; an empty rect is what makes drag-
  // out feel like Photoshop/Figma instead of "drag the pre-filled box".

  if (!naturalAspect || containerWidth <= 0 || containerHeight <= 0) {
    return null
  }

  // Object-contain layout — figure out where the actual pixels sit
  // inside the card body.
  const containerAspect = containerWidth / containerHeight
  const rendered =
    naturalAspect > containerAspect
      ? {
          x: 0,
          y: (containerHeight - containerWidth / naturalAspect) / 2,
          width: containerWidth,
          height: containerWidth / naturalAspect,
        }
      : {
          x: (containerWidth - containerHeight * naturalAspect) / 2,
          y: 0,
          width: containerHeight * naturalAspect,
          height: containerHeight,
        }

  // Minimum normalized size — keeps the rect from collapsing to a
  // point. Floor of 24 display-px when the image is large, easing up
  // to 5% on small nodes.
  const minN = Math.min(
    0.1,
    Math.max(0.02, 24 / Math.max(1, Math.min(rendered.width, rendered.height))),
  )

  // Translate a pointer event's screen coordinates into a normalized
  // position inside the rendered image rect (0..1 on each axis). Uses
  // the captured element's live screen rect so canvas zoom and pan
  // wash out — what we read is "where on the image is the cursor".
  const normalizedFromEvent = (
    pointerEvent: PointerEvent | ReactPointerEvent<HTMLDivElement>,
    element: HTMLElement,
  ): { x: number; y: number } => {
    const box = element.getBoundingClientRect()
    if (box.width <= 0 || box.height <= 0) return { x: 0, y: 0 }
    return {
      x: Math.max(0, Math.min(1, (pointerEvent.clientX - box.left) / box.width)),
      y: Math.max(0, Math.min(1, (pointerEvent.clientY - box.top) / box.height)),
    }
  }

  // Drag-out a fresh rect from the press point. Used both when the
  // overlay has no rect yet and when the user presses outside an
  // existing rect to start over.
  const beginDraw = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()

    const element = event.currentTarget
    const origin = normalizedFromEvent(event, element)
    element.setPointerCapture(event.pointerId)
    // Seed an empty rect at the origin — Apply stays disabled until the
    // pointer moves enough for a real region.
    onCropRectChange({ x: origin.x, y: origin.y, width: 0, height: 0 })

    const onMove = (move: PointerEvent) => {
      const point = normalizedFromEvent(move, element)
      onCropRectChange({
        x: Math.min(origin.x, point.x),
        y: Math.min(origin.y, point.y),
        width: Math.abs(point.x - origin.x),
        height: Math.abs(point.y - origin.y),
      })
    }

    const onUp = (up: PointerEvent) => {
      const point = normalizedFromEvent(up, element)
      const width = Math.abs(point.x - origin.x)
      const height = Math.abs(point.y - origin.y)
      element.releasePointerCapture(event.pointerId)
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      window.removeEventListener("pointercancel", onUp)
      // A tap (no real drag) clears the rect so the next press can
      // start a fresh one — without this, every accidental click would
      // leave a sub-minimum rect that Apply refuses to act on.
      if (width < minN || height < minN) {
        onCropRectChange(null)
      }
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
    window.addEventListener("pointercancel", onUp)
  }

  const beginDrag =
    (handle: Handle, currentRect: CropRect) =>
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      event.stopPropagation()

      const start = {
        px: event.clientX,
        py: event.clientY,
        crop: { ...currentRect },
      }
      const element = event.currentTarget
      element.setPointerCapture(event.pointerId)

      const onMove = (move: PointerEvent) => {
        // Client-px delta → node-local px (divide by canvas zoom) →
        // normalized of the rendered image rect.
        const dxN = (move.clientX - start.px) / Math.max(1e-6, zoom * rendered.width)
        const dyN = (move.clientY - start.py) / Math.max(1e-6, zoom * rendered.height)
        const next: CropRect = { ...start.crop }

        if (handle === "move") {
          next.x = Math.min(1 - next.width, Math.max(0, start.crop.x + dxN))
          next.y = Math.min(1 - next.height, Math.max(0, start.crop.y + dyN))
          onCropRectChange(next)
          return
        }

        if (handle.includes("w")) {
          const newX = Math.min(
            start.crop.x + start.crop.width - minN,
            Math.max(0, start.crop.x + dxN),
          )
          next.width = start.crop.width + (start.crop.x - newX)
          next.x = newX
        } else if (handle.includes("e")) {
          next.width = Math.min(
            1 - start.crop.x,
            Math.max(minN, start.crop.width + dxN),
          )
        }
        if (handle.includes("n")) {
          const newY = Math.min(
            start.crop.y + start.crop.height - minN,
            Math.max(0, start.crop.y + dyN),
          )
          next.height = start.crop.height + (start.crop.y - newY)
          next.y = newY
        } else if (handle.includes("s")) {
          next.height = Math.min(
            1 - start.crop.y,
            Math.max(minN, start.crop.height + dyN),
          )
        }
        onCropRectChange(next)
      }

      const onUp = () => {
        element.releasePointerCapture(event.pointerId)
        window.removeEventListener("pointermove", onMove)
        window.removeEventListener("pointerup", onUp)
        window.removeEventListener("pointercancel", onUp)
      }
      window.addEventListener("pointermove", onMove)
      window.addEventListener("pointerup", onUp)
      window.addEventListener("pointercancel", onUp)
    }

  // Display rect — only computed when a crop exists.
  const display = cropRect
    ? {
        x: cropRect.x * rendered.width,
        y: cropRect.y * rendered.height,
        width: cropRect.width * rendered.width,
        height: cropRect.height * rendered.height,
      }
    : null

  return (
    <div className="pointer-events-none absolute inset-0">
      <div
        className="pointer-events-auto absolute"
        style={{
          left: rendered.x,
          top: rendered.y,
          width: rendered.width,
          height: rendered.height,
          cursor: "crosshair",
        }}
        onPointerDown={beginDraw}
      >
        {cropRect && display ? (
          <>
            {/* Dim the area outside the chosen crop — four panels. */}
            <div
              className="pointer-events-none absolute bg-background/70"
              style={{ left: 0, top: 0, width: rendered.width, height: display.y }}
            />
            <div
              className="pointer-events-none absolute bg-background/70"
              style={{
                left: 0,
                top: display.y + display.height,
                width: rendered.width,
                height: rendered.height - (display.y + display.height),
              }}
            />
            <div
              className="pointer-events-none absolute bg-background/70"
              style={{ left: 0, top: display.y, width: display.x, height: display.height }}
            />
            <div
              className="pointer-events-none absolute bg-background/70"
              style={{
                left: display.x + display.width,
                top: display.y,
                width: rendered.width - (display.x + display.width),
                height: display.height,
              }}
            />

            {/* The crop rect — body drags, 8 handles resize. */}
            <div
              className="absolute border-2 border-primary"
              style={{
                left: display.x,
                top: display.y,
                width: display.width,
                height: display.height,
                cursor: "move",
                boxShadow: "0 0 0 1px hsl(var(--background))",
              }}
              onPointerDown={beginDrag("move", cropRect)}
            >
              {(["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const).map(
                (handle) => (
                  <CropHandleDot
                    key={handle}
                    handle={handle}
                    onPointerDown={beginDrag(handle, cropRect)}
                  />
                ),
              )}
            </div>
          </>
        ) : (
          // No rect yet — a faint dim across the whole image plus a
          // discreet hint, so the user knows where to drag.
          <>
            <div className="pointer-events-none absolute inset-0 bg-background/35" />
            <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center">
              <span className="rounded-full bg-background/85 px-2.5 py-1 text-[11px] font-medium text-foreground/90 shadow-sm backdrop-blur-sm">
                Drag to select a crop area
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function CropHandleDot({
  handle,
  onPointerDown,
}: {
  handle: Exclude<Handle, "move">
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
}) {
  const cursors: Record<Exclude<Handle, "move">, string> = {
    nw: "nwse-resize",
    n: "ns-resize",
    ne: "nesw-resize",
    e: "ew-resize",
    se: "nwse-resize",
    s: "ns-resize",
    sw: "nesw-resize",
    w: "ew-resize",
  }
  const isCorner = handle.length === 2
  const size = isCorner ? 11 : 9
  const half = size / 2

  const style: React.CSSProperties = {
    width: size,
    height: size,
    cursor: cursors[handle],
  }
  if (handle.includes("n")) style.top = -half
  if (handle.includes("s")) style.bottom = -half
  if (handle.includes("w")) style.left = -half
  if (handle.includes("e")) style.right = -half
  if (handle === "n" || handle === "s") {
    style.left = "50%"
    style.transform = "translateX(-50%)"
  }
  if (handle === "e" || handle === "w") {
    style.top = "50%"
    style.transform = "translateY(-50%)"
  }

  return (
    <div
      onPointerDown={onPointerDown}
      className={cn(
        "absolute rounded-sm border border-background bg-primary",
        isCorner ? "shadow-sm" : "",
      )}
      style={style}
    />
  )
}
