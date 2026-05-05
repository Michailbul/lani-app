import { existsSync } from "node:fs"
import { mkdir, readFile, stat, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { eq } from "drizzle-orm"
import { z } from "zod"
import { chats, getDatabase } from "../../db"
import { publicProcedure, router } from "../index"

/**
 * Backlot artifact router.
 *
 * The "artifact" is whatever screenplay file the agent edits in place.
 * Convention: each chat (= direction = git worktree) has a primary
 * artifact at <worktreePath>/screenplay.fountain. The agent is steered
 * (via system prompt in claude.ts) to use Edit/Write on this file
 * instead of pasting screenplay content into chat. Backlot's editor
 * pane reads the file and renders the result.
 *
 * Future: support multiple artifacts per direction (act files, character
 * bibles, beat sheets), with a primary marker. v1 does one file per
 * direction to keep the surface tight.
 */

const PRIMARY_ARTIFACT = "screenplay.fountain"
const ARTIFACT_PLACEHOLDER =
  "Title: Untitled\nCredit: Written by\nAuthor: \n\n# Act I\n\nFADE IN:\n\nINT. — — DAY\n\n"

interface WorktreeLookup {
  worktreePath: string | null
  chatName: string | null
}

function lookupWorktree(chatId: string): WorktreeLookup | null {
  const db = getDatabase()
  const row = db
    .select({
      worktreePath: chats.worktreePath,
      name: chats.name,
    })
    .from(chats)
    .where(eq(chats.id, chatId))
    .get()
  if (!row) return null
  return { worktreePath: row.worktreePath, chatName: row.name }
}

function resolveArtifactPath(worktreePath: string): string {
  return join(worktreePath, PRIMARY_ARTIFACT)
}

export const artifactsRouter = router({
  /**
   * Read the primary screenplay artifact for a chat. Returns null content
   * if the chat has no worktree (legacy chats from before worktree
   * isolation) or if the file does not exist yet. Callers should not
   * panic on null — they can call `ensure` to seed an empty artifact.
   */
  read: publicProcedure
    .input(z.object({ chatId: z.string() }))
    .query(async ({ input }) => {
      const lookup = lookupWorktree(input.chatId)
      if (!lookup?.worktreePath) {
        return {
          path: null as string | null,
          relativePath: PRIMARY_ARTIFACT,
          content: null as string | null,
          exists: false,
          mtime: null as number | null,
        }
      }
      const fullPath = resolveArtifactPath(lookup.worktreePath)
      if (!existsSync(fullPath)) {
        return {
          path: fullPath,
          relativePath: PRIMARY_ARTIFACT,
          content: null,
          exists: false,
          mtime: null,
        }
      }
      const [content, stats] = await Promise.all([
        readFile(fullPath, "utf-8"),
        stat(fullPath),
      ])
      return {
        path: fullPath,
        relativePath: PRIMARY_ARTIFACT,
        content,
        exists: true,
        mtime: stats.mtimeMs,
      }
    }),

  /**
   * Ensure the artifact exists. Idempotent — if the file is already there
   * we leave it alone. Used both by the chat pre-flight (so the agent has
   * a real file to Edit on the first turn) and by the renderer when the
   * user opens a fresh direction.
   */
  ensure: publicProcedure
    .input(z.object({ chatId: z.string() }))
    .mutation(async ({ input }) => {
      const lookup = lookupWorktree(input.chatId)
      if (!lookup?.worktreePath) {
        return { path: null, created: false }
      }
      const fullPath = resolveArtifactPath(lookup.worktreePath)
      if (existsSync(fullPath)) {
        return { path: fullPath, created: false }
      }
      await mkdir(dirname(fullPath), { recursive: true })
      await writeFile(fullPath, ARTIFACT_PLACEHOLDER, "utf-8")
      return { path: fullPath, created: true }
    }),

  /**
   * User-side write — for when the user types directly in the editor (the
   * real CodeMirror surface lands in Phase D2). The agent edits via the
   * SDK's Edit/Write tools; this is the parallel path for human edits.
   */
  write: publicProcedure
    .input(
      z.object({
        chatId: z.string(),
        content: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      const lookup = lookupWorktree(input.chatId)
      if (!lookup?.worktreePath) {
        throw new Error(
          "Chat has no worktree. Cannot save the screenplay artifact.",
        )
      }
      const fullPath = resolveArtifactPath(lookup.worktreePath)
      await mkdir(dirname(fullPath), { recursive: true })
      await writeFile(fullPath, input.content, "utf-8")
      const stats = await stat(fullPath)
      return { path: fullPath, mtime: stats.mtimeMs }
    }),
})

/**
 * Helper used by the chat router (claude.ts) to seed the artifact before
 * a turn fires. Ensures the agent's first Edit call has a real file to
 * land on. Mirrors `ensure` but callable from server code without going
 * through tRPC.
 */
export async function ensurePrimaryArtifact(
  worktreePath: string,
): Promise<{ path: string; relativePath: string; created: boolean }> {
  const fullPath = resolveArtifactPath(worktreePath)
  if (existsSync(fullPath)) {
    return { path: fullPath, relativePath: PRIMARY_ARTIFACT, created: false }
  }
  await mkdir(dirname(fullPath), { recursive: true })
  await writeFile(fullPath, ARTIFACT_PLACEHOLDER, "utf-8")
  return { path: fullPath, relativePath: PRIMARY_ARTIFACT, created: true }
}

export const PRIMARY_ARTIFACT_FILENAME = PRIMARY_ARTIFACT
