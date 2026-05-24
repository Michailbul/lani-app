/**
 * Read pixel dimensions straight from an image file's bytes.
 *
 * Dependency-free header parser for the four formats Lani accepts
 * onto the canvas — PNG, JPEG, GIF, WebP. Used by `importCanvasImage`
 * so an imported image node matches its source aspect instead of
 * snapping to a default rectangle.
 *
 * Returns `null` for anything it can't parse; the caller falls back to
 * a default node size in that case.
 */

export interface ImageDimensions {
  width: number
  height: number
}

export function readImageDimensions(buf: Buffer): ImageDimensions | null {
  if (buf.length < 24) return null

  // ─── PNG ────────────────────────────────────────────────────────────
  // 8-byte signature, then IHDR chunk (length 13). Width and height
  // are big-endian uint32 at fixed offsets 16 and 20.
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    const width = buf.readUInt32BE(16)
    const height = buf.readUInt32BE(20)
    if (width > 0 && height > 0) return { width, height }
    return null
  }

  // ─── GIF ────────────────────────────────────────────────────────────
  // "GIF87a" or "GIF89a" → logical screen descriptor follows with
  // width (uint16 LE) at offset 6, height at offset 8.
  if (
    buf[0] === 0x47 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x38 &&
    (buf[4] === 0x37 || buf[4] === 0x39) &&
    buf[5] === 0x61
  ) {
    const width = buf.readUInt16LE(6)
    const height = buf.readUInt16LE(8)
    if (width > 0 && height > 0) return { width, height }
    return null
  }

  // ─── JPEG ───────────────────────────────────────────────────────────
  // Scan marker segments until an SOF (Start of Frame) carries the
  // dimensions. Skip standalone markers, follow length fields for the
  // rest.
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2
    while (i < buf.length - 9) {
      // Each marker starts with one or more 0xFF bytes; skip them.
      if (buf[i] !== 0xff) {
        i += 1
        continue
      }
      while (i < buf.length && buf[i] === 0xff) i += 1
      if (i >= buf.length) return null
      const marker = buf[i]
      i += 1

      // SOI / EOI have no payload.
      if (marker === 0xd8 || marker === 0xd9) continue
      // RSTn and TEM also have no payload.
      if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) continue

      // SOF0–SOF15, excluding DHT (C4), JPG (C8), DAC (CC), carry the
      // frame's height and width.
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      ) {
        if (i + 7 > buf.length) return null
        // length (2) | precision (1) | height (2) | width (2)
        const height = buf.readUInt16BE(i + 3)
        const width = buf.readUInt16BE(i + 5)
        if (width > 0 && height > 0) return { width, height }
        return null
      }

      // Every other marker carries a 2-byte segment length (includes
      // those two bytes themselves) — skip past the payload.
      if (i + 2 > buf.length) return null
      const segLen = buf.readUInt16BE(i)
      if (segLen < 2) return null
      i += segLen
    }
    return null
  }

  // ─── WebP ───────────────────────────────────────────────────────────
  // RIFF wrapper with "WEBP" tag, then one of three chunk variants
  // each storing dimensions a little differently.
  if (
    buf.length >= 30 &&
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    const fourcc = buf.subarray(12, 16).toString("ascii")

    if (fourcc === "VP8 ") {
      // Lossy VP8 — width and height as 14-bit values at byte 26/28
      // (after the start code), little-endian.
      const width = buf.readUInt16LE(26) & 0x3fff
      const height = buf.readUInt16LE(28) & 0x3fff
      if (width > 0 && height > 0) return { width, height }
      return null
    }

    if (fourcc === "VP8L") {
      // Lossless — 14-bit width and height packed across bytes 21-24.
      const b0 = buf[21]
      const b1 = buf[22]
      const b2 = buf[23]
      const b3 = buf[24]
      const width = (((b1 & 0x3f) << 8) | b0) + 1
      const height = ((((b3 & 0x0f) << 10) | (b2 << 2)) | ((b1 >> 6) & 0x03)) + 1
      if (width > 0 && height > 0) return { width, height }
      return null
    }

    if (fourcc === "VP8X") {
      // Extended — width-1 (24-bit LE) at byte 24, height-1 at byte 27.
      const width =
        (buf[24] | (buf[25] << 8) | (buf[26] << 16)) + 1
      const height =
        (buf[27] | (buf[28] << 8) | (buf[29] << 16)) + 1
      if (width > 0 && height > 0) return { width, height }
      return null
    }
  }

  return null
}
