import { existsSync } from "node:fs"
import { basename, extname, join } from "node:path"

/** File extensions accepted as reference images across the app. */
export const IMAGE_EXTENSIONS = [
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "avif",
  "bmp",
]

/** True when a path's extension (case-insensitive) is in IMAGE_EXTENSIONS. */
export function isSupportedImagePath(path: string): boolean {
  const ext = extname(path).toLowerCase().replace(/^\./, "")
  return IMAGE_EXTENSIONS.includes(ext)
}

/**
 * A non-overwriting destination — suffixes "-2", "-3"… on collision.
 * Returns an absolute path inside `dir` for the given source filename.
 */
export function uniqueDestination(dir: string, fileName: string): string {
  const ext = extname(fileName)
  const stem = basename(fileName, ext)
  let candidate = join(dir, fileName)
  let n = 2
  while (existsSync(candidate)) {
    candidate = join(dir, `${stem}-${n}${ext}`)
    n += 1
  }
  return candidate
}
