import { existsSync } from "node:fs"
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { z } from "zod"
import {
  BACKLOT_HARNESS_VERSION,
  HARNESS_OVERRIDE_PATH,
  getDefaultHarnessBlock,
} from "../../claude/harness-prompt"
import { publicProcedure, router } from "../index"

/**
 * Harness router — read / write / reset the Backlot system prompt.
 *
 * The system prompt (the "harness block") ships as a default in
 * harness-prompt.ts. The user can override it from Settings → System
 * Prompt; their version persists at ~/.backlot/harness-prompt.md and
 * is picked up by buildBacklotHarnessBlock() on the next agent turn.
 *
 * This router is the only thing that touches the override file from
 * the renderer side.
 */
export const harnessRouter = router({
  /**
   * Current state of the harness prompt:
   *   - effective: the text the agent actually receives right now
   *   - default:   the shipped built-in text (the Reset target)
   *   - isCustomized: whether an override file exists
   *   - version:   the shipped harness version (informational)
   */
  get: publicProcedure.query(async () => {
    const defaultBlock = getDefaultHarnessBlock()
    let effective = defaultBlock
    let isCustomized = false
    if (existsSync(HARNESS_OVERRIDE_PATH)) {
      try {
        const custom = await readFile(HARNESS_OVERRIDE_PATH, "utf-8")
        if (custom.trim()) {
          effective = custom.trim()
          isCustomized = true
        }
      } catch (err) {
        console.warn("[harness.get] failed to read override:", err)
      }
    }
    return {
      effective,
      default: defaultBlock,
      isCustomized,
      version: BACKLOT_HARNESS_VERSION,
      overridePath: HARNESS_OVERRIDE_PATH,
    }
  }),

  /**
   * Save a custom harness prompt. Writes the override file. An empty
   * or whitespace-only body is treated as "reset" — the file is
   * removed so the shipped default takes over again.
   */
  set: publicProcedure
    .input(z.object({ content: z.string() }))
    .mutation(async ({ input }) => {
      const trimmed = input.content.trim()
      if (!trimmed) {
        if (existsSync(HARNESS_OVERRIDE_PATH)) {
          await unlink(HARNESS_OVERRIDE_PATH).catch(() => {})
        }
        return { saved: true, isCustomized: false as const }
      }
      await mkdir(dirname(HARNESS_OVERRIDE_PATH), { recursive: true })
      await writeFile(HARNESS_OVERRIDE_PATH, trimmed, "utf-8")
      return { saved: true, isCustomized: true as const }
    }),

  /**
   * Reset to the shipped default — removes the override file.
   * Idempotent: a no-op if no override exists.
   */
  reset: publicProcedure.mutation(async () => {
    if (existsSync(HARNESS_OVERRIDE_PATH)) {
      await unlink(HARNESS_OVERRIDE_PATH).catch(() => {})
    }
    return { reset: true }
  }),
})

export type HarnessRouter = typeof harnessRouter
