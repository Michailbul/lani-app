/**
 * Canvas image stitching — composites several image nodes into one PNG.
 *
 * Ported from the laniameda image-stitch project. Two modes:
 *  - "auto": a justified-rows layout (Google-Photos style) that packs the
 *    images into even rows scaled to a target height.
 *  - "manual": keeps every image exactly where it sits on the canvas and
 *    composites that arrangement, normalized to the bounding box.
 *
 * Compositing runs in the renderer with a `<canvas>`; the base64 PNG is
 * handed to the `canvas.stitch` tRPC mutation, which writes the file.
 */

export type StitchMode = "auto" | "manual"

export interface StitchSettings {
  // Auto-mode container width — sets how wide a row can grow before the
  // packer wraps to the next one. Higher = more images per row.
  containerWidth: number
  // Auto-mode target height for each justified row, in layout pixels.
  targetRowHeight: number
  // Gap between images, in layout pixels (auto mode).
  spacing: number
  // Fill behind the composite — a CSS color, or "transparent".
  background: string
}

export interface StitchSource {
  url: string
  // The image node's on-canvas rect (its image body, header excluded).
  rect: { x: number; y: number; width: number; height: number }
  // Cut-out images have transparent holes the rest of the composite is
  // meant to peek through, so they must paint last (on top) — otherwise
  // a replacement image placed over the hole would be hidden by the
  // cut-out's opaque area instead of filling the void.
  isCutout?: boolean
}

export interface StitchResult {
  base64: string
  width: number
  height: number
}

export interface StitchLayoutRect {
  x: number
  y: number
  width: number
  height: number
}

type Rect = StitchLayoutRect

// Electron caps canvas-backed textures; stay well under it.
const MAX_STITCH_DIMENSION = 4096

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    // The asset protocol sends Access-Control-Allow-Origin, so the pixels
    // read back clean — toDataURL would throw on a tainted canvas.
    img.crossOrigin = "anonymous"
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Could not load image: ${url}`))
    img.src = url
  })
}

/**
 * Pack images into justified rows: fill a row left-to-right until it
 * overflows the container width, then scale that row's height so it fits
 * exactly. The last, sparse row keeps the target height.
 */
export function justifiedLayout(
  aspects: number[],
  opts: { containerWidth: number; targetRowHeight: number; spacing: number },
): { rects: Rect[]; width: number; height: number } {
  const { containerWidth, targetRowHeight, spacing } = opts
  const rects: Rect[] = new Array(aspects.length)
  let y = 0
  let maxWidth = 0
  let i = 0

  while (i < aspects.length) {
    const row: number[] = []
    let aspectSum = 0
    while (i < aspects.length) {
      row.push(i)
      aspectSum += aspects[i]
      i += 1
      const naturalWidth =
        aspectSum * targetRowHeight + spacing * (row.length - 1)
      if (naturalWidth >= containerWidth) break
    }

    const totalSpacing = spacing * (row.length - 1)
    const naturalWidth = aspectSum * targetRowHeight + totalSpacing
    const rowHeight =
      naturalWidth >= containerWidth && aspectSum > 0
        ? (containerWidth - totalSpacing) / aspectSum
        : targetRowHeight

    let x = 0
    for (const idx of row) {
      const width = aspects[idx] * rowHeight
      rects[idx] = { x, y, width, height: rowHeight }
      x += width + spacing
    }
    maxWidth = Math.max(maxWidth, x - spacing)
    y += rowHeight + spacing
  }

  return { rects, width: maxWidth, height: Math.max(0, y - spacing) }
}

export async function composeStitch(input: {
  sources: StitchSource[]
  mode: StitchMode
  settings: StitchSettings
}): Promise<StitchResult> {
  const { sources, mode, settings } = input
  if (sources.length < 2) {
    throw new Error("Select at least two images to stitch.")
  }

  // Auto mode lays the images out in reading order (top-to-bottom,
  // then left-to-right) using their canvas positions as the sort key.
  // Manual mode preserves the array order but lifts cut-out images to
  // the end so they paint last — that's how a cut-out with a hole lets
  // a replacement positioned over it show through.
  const ordered =
    mode === "auto"
      ? [...sources].sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x)
      : [...sources].sort((a, b) => {
          const ac = a.isCutout ? 1 : 0
          const bc = b.isCutout ? 1 : 0
          return ac - bc
        })

  const images = await Promise.all(ordered.map((s) => loadImage(s.url)))

  let rects: Rect[]
  let layoutWidth: number
  let layoutHeight: number

  if (mode === "auto") {
    const aspects = images.map((img) =>
      img.naturalHeight > 0 ? img.naturalWidth / img.naturalHeight : 1,
    )
    const layout = justifiedLayout(aspects, {
      containerWidth: settings.containerWidth,
      targetRowHeight: settings.targetRowHeight,
      spacing: settings.spacing,
    })
    rects = layout.rects
    layoutWidth = layout.width
    layoutHeight = layout.height
  } else {
    const minX = Math.min(...ordered.map((s) => s.rect.x))
    const minY = Math.min(...ordered.map((s) => s.rect.y))
    rects = ordered.map((s) => ({
      x: s.rect.x - minX,
      y: s.rect.y - minY,
      width: s.rect.width,
      height: s.rect.height,
    }))
    layoutWidth = Math.max(...rects.map((r) => r.x + r.width))
    layoutHeight = Math.max(...rects.map((r) => r.y + r.height))
  }

  // Manual rects are small on-canvas sizes — upscale toward the images'
  // natural resolution so the output stays crisp. Then clamp the long
  // edge so the canvas never exceeds the texture limit.
  let scale = 1
  if (mode === "manual") {
    const ratios = rects.map((r, i) =>
      r.width > 0 ? images[i].naturalWidth / r.width : 1,
    )
    const avg = ratios.reduce((a, b) => a + b, 0) / ratios.length
    scale = Math.min(4, Math.max(1, avg))
  }
  const longEdge = Math.max(layoutWidth, layoutHeight) * scale
  if (longEdge > MAX_STITCH_DIMENSION) {
    scale *= MAX_STITCH_DIMENSION / longEdge
  }

  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.round(layoutWidth * scale))
  canvas.height = Math.max(1, Math.round(layoutHeight * scale))
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Could not get a 2D canvas context.")
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = "high"

  if (settings.background !== "transparent") {
    ctx.fillStyle = settings.background
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }

  images.forEach((img, i) => {
    const r = rects[i]
    ctx.drawImage(img, r.x * scale, r.y * scale, r.width * scale, r.height * scale)
  })

  const dataUrl = canvas.toDataURL("image/png")
  return {
    base64: dataUrl.slice(dataUrl.indexOf(",") + 1),
    width: canvas.width,
    height: canvas.height,
  }
}
