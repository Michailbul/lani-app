/**
 * Stat-keyed cache for normalized `.lani.json` files (shotlist, multishot,
 * queue). Each `.read()` tRPC procedure is hit on a 1.5s renderer poll
 * (one cycle per open workdesk pane), and the file very rarely changes
 * between polls. Without a cache, every tick spends a full `readFile +
 * JSON.parse + normalize` for nothing.
 *
 * Cache key: absolute path + `(mtimeMs, size)` from `fs.stat`. A fresh
 * write changes one or both, so the next read drops the stale entry.
 *
 * Race safety: we stat → read → re-stat. If the file changed mid-read we
 * retry once. We never cache a parse/normalize failure (caller decides
 * what failure means — `null` shotlist, empty queue, etc.).
 *
 * Memory cap: a simple LRU at 256 entries — comfortable for projects with
 * ~200 scenes plus active+archive queue files.
 */

import { stat, readFile } from "node:fs/promises"

interface Entry<T> {
  mtimeMs: number
  size: number
  value: T
}

const MAX_ENTRIES = 256

// Per-helper-instance Map preserves insertion order, which we abuse for
// LRU eviction: on a hit, delete-and-set bumps the entry to the tail.
const cache = new Map<string, Entry<unknown>>()

/**
 * Read + parse + normalize `fullPath`, returning a cached value when the
 * file's `(mtimeMs, size)` match the prior read. The `normalize` callback
 * receives the parsed JSON and returns the in-memory shape callers want.
 *
 * If the file is modified between the leading and trailing `stat` calls,
 * we drop the cache entry and retry once — bounded so a hot-spinning
 * writer can't lock the cache up.
 */
export async function readCachedNormalizedJson<T>(
  fullPath: string,
  normalize: (raw: unknown) => T,
): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const before = await stat(fullPath)
    const hit = cache.get(fullPath) as Entry<T> | undefined
    if (
      hit &&
      hit.mtimeMs === before.mtimeMs &&
      hit.size === before.size
    ) {
      // LRU bump: refresh insertion order.
      cache.delete(fullPath)
      cache.set(fullPath, hit)
      return hit.value
    }

    const raw = await readFile(fullPath, "utf-8")
    const value = normalize(JSON.parse(raw))

    const after = await stat(fullPath)
    if (
      after.mtimeMs !== before.mtimeMs ||
      after.size !== before.size
    ) {
      // File changed mid-read — discard, retry once.
      cache.delete(fullPath)
      continue
    }

    cache.set(fullPath, {
      mtimeMs: after.mtimeMs,
      size: after.size,
      value,
    })
    evictIfFull()
    return value
  }

  // Two consecutive races — fall back to an uncached read so we still
  // return *something*. The next stable read repopulates the cache.
  const raw = await readFile(fullPath, "utf-8")
  return normalize(JSON.parse(raw))
}

/** Drop a single path from the cache. Call this from write paths after
 *  `writeFile` succeeds so the next reader gets the fresh value without
 *  waiting for the stat-key drift. */
export function invalidateCachedNormalizedJson(fullPath: string): void {
  cache.delete(fullPath)
}

function evictIfFull(): void {
  while (cache.size > MAX_ENTRIES) {
    // Map iterators yield in insertion order; the first key is the LRU.
    const oldest = cache.keys().next().value
    if (oldest === undefined) return
    cache.delete(oldest)
  }
}
