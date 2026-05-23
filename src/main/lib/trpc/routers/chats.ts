import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm"
import * as fs from "fs/promises"
import * as path from "path"
import simpleGit from "simple-git"
import { z } from "zod"
import { getAuthManager } from "../../../index"
import {
  trackPRCreated,
  trackWorkspaceArchived,
  trackWorkspaceCreated,
  trackWorkspaceDeleted,
} from "../../analytics"
import { chats, getDatabase, projects, subChats } from "../../db"
import {
  fetchGitHubPRStatus,
  getWorktreeDiff,
  isExactGitRepoRoot,
  removeWorktree,
} from "../../git"
import { computeContentHash, gitCache } from "../../git/cache"
import { splitUnifiedDiffByFile } from "../../git/diff-parser"
import { execWithShellEnv } from "../../git/shell-env"
import { applyRollbackStash } from "../../git/stash"
import { terminalManager } from "../../terminal/manager"
import { publicProcedure, router } from "../index"
import { cleanupCodexProviderSession } from "./codex"

/**
 * Strip resume metadata (sessionId / sdkMessageUuid / shouldResume) from a
 * thread's serialized messages. Used when a new thread inherits another
 * thread's messages — the inheritor must start a fresh SDK session, so
 * stale resume pointers from the source are cleared.
 */
function stripForkedSessionMetadata(messagesJson: string): string {
  try {
    const messages = JSON.parse(messagesJson) as any[]
    if (!Array.isArray(messages)) return messagesJson

    return JSON.stringify(
      messages.map((message) => {
        if (!message?.metadata || typeof message.metadata !== "object") {
          return message
        }
        const {
          sessionId: _sessionId,
          sdkMessageUuid: _sdkMessageUuid,
          shouldResume: _shouldResume,
          threadId: _threadId,
          appServerSessionId: _appServerSessionId,
          providerTurnId: _providerTurnId,
          threadConfigFingerprint: _threadConfigFingerprint,
          ...metadata
        } = message.metadata
        return {
          ...message,
          metadata:
            Object.keys(metadata).length > 0 ? metadata : undefined,
        }
      }),
    )
  } catch {
    return messagesJson
  }
}

function getRollbackCheckpointId(message: any): string | undefined {
  const metadata = message?.metadata
  if (metadata && typeof metadata === "object") {
    if (typeof metadata.sdkMessageUuid === "string") {
      return metadata.sdkMessageUuid
    }
    if (typeof metadata.rollbackCheckpointId === "string") {
      return metadata.rollbackCheckpointId
    }
  }
  return typeof message?.id === "string" && message?.role === "assistant"
    ? message.id
    : undefined
}

// Fallback to truncated user message if AI generation fails
function getFallbackName(userMessage: string): string {
  const trimmed = userMessage.trim()
  if (trimmed.length <= 25) {
    return trimmed || "New Worktree"
  }
  return trimmed.substring(0, 25) + "..."
}

type AgentProviderId = "claude-code" | "codex"

// Ollama-backed offline generation helpers were stripped. Backlot is online-only.
// Procedures that previously fell back to Ollama for chat-name and commit-message
// generation now skip the offline path entirely; the Claude-backed path remains.
async function generateChatNameWithOllama(
  _userMessage: string,
  _model?: string | null
): Promise<string | null> {
  return null
}

async function generateCommitMessageWithOllama(
  _diff: string,
  _fileCount: number,
  _additions: number,
  _deletions: number,
  _model?: string | null
): Promise<string | null> {
  return null
}

export const chatsRouter = router({
  /**
   * List all non-archived chats (optionally filter by project)
   */
  list: publicProcedure
    .input(z.object({ projectId: z.string().optional() }))
    .query(({ input }) => {
      const db = getDatabase()
      const conditions = [isNull(chats.archivedAt)]
      if (input.projectId) {
        conditions.push(eq(chats.projectId, input.projectId))
      }
      return db
        .select()
        .from(chats)
        .where(and(...conditions))
        .orderBy(desc(chats.updatedAt))
        .all()
    }),

  /**
   * List archived chats (optionally filter by project)
   */
  listArchived: publicProcedure
    .input(z.object({ projectId: z.string().optional() }))
    .query(({ input }) => {
      const db = getDatabase()
      const conditions = [isNotNull(chats.archivedAt)]
      if (input.projectId) {
        conditions.push(eq(chats.projectId, input.projectId))
      }
      return db
        .select()
        .from(chats)
        .where(and(...conditions))
        .orderBy(desc(chats.archivedAt))
        .all()
    }),

  /**
   * Get a single chat with all sub-chats
   */
  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => {
      const db = getDatabase()
      const chat = db.select().from(chats).where(eq(chats.id, input.id)).get()
      if (!chat) return null

      // Archived threads are excluded — they no longer appear as tabs,
      // in history, or in the launch-time tab seed. They stay in the DB
      // and are recoverable via listArchivedSubChats / unarchiveSubChat.
      const chatSubChats = db
        .select()
        .from(subChats)
        .where(
          and(eq(subChats.worktreeId, input.id), isNull(subChats.archivedAt)),
        )
        .orderBy(subChats.createdAt)
        .all()

      const project = db
        .select()
        .from(projects)
        .where(eq(projects.id, chat.projectId))
        .get()

      return { ...chat, subChats: chatSubChats, project }
    }),

  /**
   * Create a new chat with optional git worktree
   */
  create: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        name: z.string().optional(),
        model: z.string().optional(),
        initialMessage: z.string().optional(),
        initialMessageParts: z
          .array(
            z.union([
              z.object({ type: z.literal("text"), text: z.string() }),
              z.object({
                type: z.literal("data-image"),
                data: z.object({
                  url: z.string(),
                  mediaType: z.string().optional(),
                  filename: z.string().optional(),
                  base64Data: z.string().optional(),
                }),
              }),
              // Hidden file content - sent to agent but not displayed in UI
              z.object({
                type: z.literal("file-content"),
                filePath: z.string(),
                content: z.string(),
              }),
            ]),
          )
          .optional(),
        mode: z.enum(["plan", "agent"]).default("agent"),
        provider: z.enum(["claude-code", "codex"]).optional(),
        // Kept for API compatibility — Backlot runs every chat directly in
        // the canonical project folder, so these are accepted but ignored.
        useWorktree: z.boolean().optional(),
        baseBranch: z.string().optional(),
        branchType: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      console.log("[chats.create] called with:", input)
      const db = getDatabase()

      // Get project path
      const project = db
        .select()
        .from(projects)
        .where(eq(projects.id, input.projectId))
        .get()
      console.log("[chats.create] found project:", project)
      if (!project) throw new Error("Project not found")

      const initialProvider: AgentProviderId =
        input.provider ??
        (input.model?.toLowerCase().includes("codex") ? "codex" : "claude-code")

      // Create chat (fast path)
      const chat = db
        .insert(chats)
        .values({
          name: input.name,
          projectId: input.projectId,
          provider: initialProvider,
        })
        .returning()
        .get()
      console.log("[chats.create] created chat:", chat)

      // Create initial sub-chat with user message (AI SDK format)
      // If initialMessageParts is provided, use it; otherwise fallback to text-only message
      let initialMessages = "[]"
      const initialMetadata = input.model
        ? { model: input.model, provider: initialProvider }
        : undefined

      if (input.initialMessageParts && input.initialMessageParts.length > 0) {
        initialMessages = JSON.stringify([
          {
            id: `msg-${Date.now()}`,
            role: "user",
            parts: input.initialMessageParts,
            ...(initialMetadata ? { metadata: initialMetadata } : {}),
          },
        ])
      } else if (input.initialMessage) {
        initialMessages = JSON.stringify([
          {
            id: `msg-${Date.now()}`,
            role: "user",
            parts: [{ type: "text", text: input.initialMessage }],
            ...(initialMetadata ? { metadata: initialMetadata } : {}),
          },
        ])
      }

      const subChat = db
        .insert(subChats)
        .values({
          worktreeId: chat.id,
          mode: input.mode,
          provider: initialProvider,
          messages: initialMessages,
        })
        .returning()
        .get()
      console.log("[chats.create] created subChat:", subChat)

      // Backlot runs every chat directly in the single canonical project
      // folder — no per-chat worktree copies. The `useWorktree`,
      // `baseBranch` and `branchType` inputs are kept on the schema for
      // API compatibility but are intentionally ignored.
      db.update(chats)
        .set({ worktreePath: project.path })
        .where(eq(chats.id, chat.id))
        .run()
      const worktreeResult: {
        worktreePath?: string
        branch?: string
        baseBranch?: string
      } = { worktreePath: project.path }

      const response = {
        ...chat,
        worktreePath: worktreeResult.worktreePath || project.path,
        branch: worktreeResult.branch,
        baseBranch: worktreeResult.baseBranch,
        subChats: [subChat],
      }

      // Track workspace created
      trackWorkspaceCreated({
        id: chat.id,
        projectId: input.projectId,
        useWorktree: false,
      })

      console.log("[chats.create] returning:", response)
      return response
    }),

  /**
   * Rename a chat
   */
  rename: publicProcedure
    .input(z.object({ id: z.string(), name: z.string().min(1) }))
    .mutation(({ input }) => {
      const db = getDatabase()
      return db
        .update(chats)
        .set({ name: input.name, updatedAt: new Date() })
        .where(eq(chats.id, input.id))
        .returning()
        .get()
    }),

  /**
   * Archive a chat (also kills any terminal processes in the workspace)
   * Optionally deletes the worktree to free disk space
   */
  archive: publicProcedure
    .input(
      z.object({
        id: z.string(),
        deleteWorktree: z.boolean().default(false),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDatabase()

      // Get chat to check for worktree (before archiving)
      const chat = db
        .select()
        .from(chats)
        .where(eq(chats.id, input.id))
        .get()

      // Archive immediately (optimistic)
      const result = db
        .update(chats)
        .set({ archivedAt: new Date() })
        .where(eq(chats.id, input.id))
        .returning()
        .get()

      // Track workspace archived
      trackWorkspaceArchived(input.id)

      // Kill terminal processes in background (don't await)
      terminalManager.killByWorkspaceId(input.id).then((killResult) => {
        if (killResult.killed > 0) {
          console.log(
            `[chats.archive] Killed ${killResult.killed} terminal session(s) for workspace ${input.id}`,
          )
        }
      }).catch((error) => {
        console.error(`[chats.archive] Error killing processes:`, error)
      })

      // Optionally delete worktree in background (don't await)
      if (input.deleteWorktree && chat?.worktreePath && chat?.branch) {
        const project = db
          .select()
          .from(projects)
          .where(eq(projects.id, chat.projectId))
          .get()

        if (project && await isExactGitRepoRoot(project.path)) {
          removeWorktree(project.path, chat.worktreePath).then((worktreeResult) => {
            if (worktreeResult.success) {
              console.log(
                `[chats.archive] Deleted worktree for workspace ${input.id}`,
              )
              // Clear worktreePath since it's deleted (keep branch for reference)
              db.update(chats)
                .set({ worktreePath: null })
                .where(eq(chats.id, input.id))
                .run()
            } else {
              console.warn(
                `[chats.archive] Failed to delete worktree: ${worktreeResult.error}`,
              )
            }
          }).catch((error) => {
            console.error(`[chats.archive] Error removing worktree:`, error)
          })
        } else {
          console.warn(
            `[chats.archive] Skipping worktree removal because project path is not an exact git repo root: ${project?.path}`,
          )
        }
      }

      // Invalidate git cache for this worktree
      if (chat?.worktreePath) {
        gitCache.invalidateStatus(chat.worktreePath)
        gitCache.invalidateParsedDiff(chat.worktreePath)
      }

      return result
    }),

  /**
   * Restore an archived chat
   */
  restore: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => {
      const db = getDatabase()
      return db
        .update(chats)
        .set({ archivedAt: null })
        .where(eq(chats.id, input.id))
        .returning()
        .get()
    }),

  /**
   * Archive multiple chats at once (also kills terminal processes in each workspace)
   */
  archiveBatch: publicProcedure
    .input(z.object({ chatIds: z.array(z.string()) }))
    .mutation(({ input }) => {
      const db = getDatabase()
      if (input.chatIds.length === 0) return []

      // Archive immediately (optimistic)
      const result = db
        .update(chats)
        .set({ archivedAt: new Date() })
        .where(inArray(chats.id, input.chatIds))
        .returning()
        .all()

      // Kill terminal processes for all workspaces in background (don't await)
      Promise.all(
        input.chatIds.map((id) => terminalManager.killByWorkspaceId(id)),
      ).then((killResults) => {
        const totalKilled = killResults.reduce((sum, r) => sum + r.killed, 0)
        if (totalKilled > 0) {
          console.log(
            `[chats.archiveBatch] Killed ${totalKilled} terminal session(s) for ${input.chatIds.length} workspace(s)`,
          )
        }
      }).catch((error) => {
        console.error(`[chats.archiveBatch] Error killing processes:`, error)
      })

      return result
    }),

  /**
   * Delete a chat permanently (with worktree cleanup)
   */
  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const db = getDatabase()

      // Get chat before deletion
      const chat = db.select().from(chats).where(eq(chats.id, input.id)).get()

      // Cleanup worktree if it was created (has branch = was a real worktree, not just project path)
      if (chat?.worktreePath && chat?.branch) {
        const project = db
          .select()
          .from(projects)
          .where(eq(projects.id, chat.projectId))
          .get()
        if (project && await isExactGitRepoRoot(project.path)) {
          const result = await removeWorktree(project.path, chat.worktreePath)
          if (!result.success) {
            console.warn(`[Worktree] Cleanup failed: ${result.error}`)
          }
        } else {
          console.warn(
            `[chats.delete] Skipping worktree removal because project path is not an exact git repo root: ${project?.path}`,
          )
        }
      }

      // Track workspace deleted
      trackWorkspaceDeleted(input.id)

      // Invalidate git cache for this worktree
      if (chat?.worktreePath) {
        gitCache.invalidateStatus(chat.worktreePath)
        gitCache.invalidateParsedDiff(chat.worktreePath)
      }

      return db.delete(chats).where(eq(chats.id, input.id)).returning().get()
    }),

  // ============ Sub-chat procedures ============

  /**
   * Get a single sub-chat
   */
  getSubChat: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => {
      const db = getDatabase()
      const subChat = db
        .select()
        .from(subChats)
        .where(eq(subChats.id, input.id))
        .get()

      if (!subChat) return null

      const chat = db
        .select()
        .from(chats)
        .where(eq(chats.id, subChat.worktreeId))
        .get()

      const project = chat
        ? db
            .select()
            .from(projects)
            .where(eq(projects.id, chat.projectId))
            .get()
        : null

      return { ...subChat, chat: chat ? { ...chat, project } : null }
    }),

  /**
   * Create a new sub-chat
   */
  createSubChat: publicProcedure
    .input(
      z.object({
        chatId: z.string(),
        name: z.string().optional(),
        mode: z.enum(["plan", "agent"]).default("agent"),
        sourceSubChatId: z.string().optional(),
        inheritMessages: z.boolean().default(false),
        provider: z.enum(["claude-code", "codex"]).optional(),
      }),
    )
    .mutation(({ input }) => {
      const db = getDatabase()
      let messages = "[]"
      let sourceSubChat: typeof subChats.$inferSelect | null = null
      const chat = db
        .select()
        .from(chats)
        .where(eq(chats.id, input.chatId))
        .get()

      if (!chat) {
        throw new Error("Session not found")
      }

      if (input.sourceSubChatId) {
        sourceSubChat = db
          .select()
          .from(subChats)
          .where(eq(subChats.id, input.sourceSubChatId))
          .get() ?? null

        if (!sourceSubChat) {
          throw new Error("Source thread not found")
        }
        if (sourceSubChat.worktreeId !== input.chatId) {
          throw new Error("Source thread belongs to a different worktree")
        }
      }

      const provider: AgentProviderId =
        input.provider ??
        (sourceSubChat
          ? sourceSubChat.provider === "codex"
            ? "codex"
            : "claude-code"
          : chat.provider === "codex"
            ? "codex"
            : "claude-code")

      if (input.inheritMessages && sourceSubChat) {
        messages = stripForkedSessionMetadata(sourceSubChat.messages || "[]")
      }

      return db
        .insert(subChats)
        .values({
          worktreeId: input.chatId,
          name: input.name,
          mode: input.mode,
          provider,
          messages,
        })
        .returning()
        .get()
    }),

  /**
   * Update sub-chat messages
   */
  updateSubChatMessages: publicProcedure
    .input(z.object({ id: z.string(), messages: z.string() }))
    .mutation(({ input }) => {
      const db = getDatabase()
      return db
        .update(subChats)
        .set({ messages: input.messages, updatedAt: new Date() })
        .where(eq(subChats.id, input.id))
        .returning()
        .get()
    }),

  /**
   * Rollback to a specific assistant message checkpoint.
   * Handles both git state rollback and message truncation
   * Git rollback is done first - if it fails, the whole operation aborts
   */
  rollbackToMessage: publicProcedure
    .input(
      z
        .object({
          subChatId: z.string(),
          sdkMessageUuid: z.string().optional(),
          checkpointId: z.string().optional(),
        })
        .refine((value) => Boolean(value.sdkMessageUuid || value.checkpointId), {
          message: "checkpointId is required",
        }),
    )
    .mutation(async ({ input }): Promise<
      | { success: false; error: string }
      | { success: true; messages: any[] }
    > => {
      const db = getDatabase()
      const checkpointId = input.checkpointId ?? input.sdkMessageUuid
      if (!checkpointId) {
        return { success: false, error: "Checkpoint ID is required" }
      }

      // 1. Get the sub-chat and its messages
      const subChat = db
        .select()
        .from(subChats)
        .where(eq(subChats.id, input.subChatId))
        .get()
      if (!subChat) {
        return { success: false, error: "Sub-chat not found" }
      }

      // 2. Parse messages and find the target message by checkpoint ID
      let messages: any[]
      try {
        const parsed = JSON.parse(subChat.messages || "[]")
        messages = Array.isArray(parsed) ? parsed : []
      } catch {
        return { success: false, error: "Stored messages are invalid" }
      }
      const targetIndex = messages.findIndex(
        (m: any) => getRollbackCheckpointId(m) === checkpointId,
      )

      if (targetIndex === -1) {
        return { success: false, error: "Message not found" }
      }
      const isCodexThread = subChat.provider === "codex"

      // 3. Get the parent chat for worktreePath
      const chat = db
        .select()
        .from(chats)
        .where(eq(chats.id, subChat.worktreeId))
        .get()

      // 4. Rollback git state first - if this fails, abort the whole operation
      if (chat?.worktreePath) {
        const res = await applyRollbackStash(chat.worktreePath, checkpointId)
        if (!res.success) {
          return { success: false, error: `Git rollback failed: ${res.error}` }
        }
        // If checkpoint wasn't found, we still fail because we can't safely rollback
        // without reverting the git state to match the message history
        if (!res.checkpointFound) {
          return { success: false, error: "Checkpoint not found - cannot rollback git state" }
        }
      }

      // 5. Truncate messages to include up to and including the target message
      let truncatedMessages = messages.slice(0, targetIndex + 1)

      // 5.5. Clear old resume flags. Claude can resume at a message UUID;
      // Codex is forced into a fresh session and receives the truncated local
      // transcript as context on the next send.
      truncatedMessages = truncatedMessages.map((m: any, i: number) => {
        const metadata = { ...(m.metadata || {}) }
        delete metadata.shouldResume
        if (isCodexThread) {
          delete metadata.sessionId
          delete metadata.threadId
          delete metadata.appServerSessionId
          delete metadata.providerTurnId
          delete metadata.threadConfigFingerprint
        } else if (i === truncatedMessages.length - 1) {
          metadata.shouldResume = true
        }
        return {
          ...m,
          metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
        }
      })

      // 6. Update the sub-chat with truncated messages
      db.update(subChats)
        .set({
          messages: JSON.stringify(truncatedMessages),
          sessionId: isCodexThread ? null : subChat.sessionId,
          streamId: null,
          updatedAt: new Date(),
        })
        .where(eq(subChats.id, input.subChatId))
        .returning()
        .get()

      if (isCodexThread) {
        cleanupCodexProviderSession(input.subChatId)
      }

      return {
        success: true,
        messages: truncatedMessages,
      }
    }),

  /**
   * Update sub-chat session ID (for Claude resume)
   */
  updateSubChatSession: publicProcedure
    .input(z.object({ id: z.string(), sessionId: z.string().nullable() }))
    .mutation(({ input }) => {
      const db = getDatabase()
      return db
        .update(subChats)
        .set({ sessionId: input.sessionId })
        .where(eq(subChats.id, input.id))
        .returning()
        .get()
    }),

  /**
   * Update sub-chat mode
   */
  updateSubChatMode: publicProcedure
    .input(z.object({ id: z.string(), mode: z.enum(["plan", "agent"]) }))
    .mutation(({ input }) => {
      const db = getDatabase()
      return db
        .update(subChats)
        .set({ mode: input.mode })
        .where(eq(subChats.id, input.id))
        .returning()
        .get()
    }),

  /**
   * Rename a sub-chat
   */
  renameSubChat: publicProcedure
    .input(z.object({ id: z.string(), name: z.string().min(1) }))
    .mutation(({ input }) => {
      const db = getDatabase()
      db.update(subChats)
        .set({ name: input.name })
        .where(eq(subChats.id, input.id))
        .run()
      return { id: input.id, name: input.name }
    }),

  /**
   * Permanently delete a sub-chat. Destructive — for a recoverable
   * removal use archiveSubChat instead.
   */
  deleteSubChat: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => {
      const db = getDatabase()
      return db
        .delete(subChats)
        .where(eq(subChats.id, input.id))
        .returning()
        .get()
    }),

  /**
   * Archive a sub-chat — a recoverable soft-remove. The thread drops out
   * of the tab strip, history, and launch-time seed but stays in the DB.
   */
  archiveSubChat: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => {
      const db = getDatabase()
      db.update(subChats)
        .set({ archivedAt: new Date() })
        .where(eq(subChats.id, input.id))
        .run()
      return { id: input.id }
    }),

  /**
   * Restore an archived sub-chat back into the active set.
   */
  unarchiveSubChat: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => {
      const db = getDatabase()
      db.update(subChats)
        .set({ archivedAt: null })
        .where(eq(subChats.id, input.id))
        .run()
      return { id: input.id }
    }),

  /**
   * List a worktree's archived sub-chats, most recently archived first.
   * Feeds the history popover's restore path.
   */
  listArchivedSubChats: publicProcedure
    .input(z.object({ chatId: z.string() }))
    .query(({ input }) => {
      const db = getDatabase()
      const rows = db
        .select()
        .from(subChats)
        .where(
          and(
            eq(subChats.worktreeId, input.chatId),
            isNotNull(subChats.archivedAt),
          ),
        )
        .orderBy(desc(subChats.archivedAt))
        .all()
      return rows.map((sc) => ({
        id: sc.id,
        name: sc.name ?? "New Chat",
        mode: (sc.mode as "plan" | "agent" | undefined) ?? "agent",
        provider:
          (sc.provider as "claude-code" | "codex" | undefined) ??
          "claude-code",
        created_at: sc.createdAt?.toISOString(),
        updated_at: sc.updatedAt?.toISOString(),
        archived: true as const,
      }))
    }),

  /**
   * Get git diff for a chat's worktree
   */
  getDiff: publicProcedure
    .input(z.object({ chatId: z.string() }))
    .query(async ({ input }) => {
      const db = getDatabase()
      const chat = db
        .select()
        .from(chats)
        .where(eq(chats.id, input.chatId))
        .get()

      if (!chat?.worktreePath) {
        return { diff: null, error: "No worktree path" }
      }

      const result = await getWorktreeDiff(
        chat.worktreePath,
        chat.baseBranch ?? undefined,
      )

      if (!result.success) {
        return { diff: null, error: result.error }
      }

      return { diff: result.diff || "" }
    }),

  /**
   * Get parsed diff with prefetched file contents
   * This endpoint does all diff parsing on the server side to avoid blocking UI
   * Uses GitCache for instant responses when diff hasn't changed
   */
  getParsedDiff: publicProcedure
    .input(z.object({ chatId: z.string() }))
    .query(async ({ input }) => {
      const db = getDatabase()
      const chat = db
        .select()
        .from(chats)
        .where(eq(chats.id, input.chatId))
        .get()

      if (!chat?.worktreePath) {
        return {
          files: [],
          totalAdditions: 0,
          totalDeletions: 0,
          fileContents: {},
          error: "No worktree path",
        }
      }

      // 1. Get raw diff (only uncommitted changes - don't show branch diff after commit)
      const result = await getWorktreeDiff(
        chat.worktreePath,
        chat.baseBranch ?? undefined,
        { onlyUncommitted: true },
      )

      if (!result.success) {
        return {
          files: [],
          totalAdditions: 0,
          totalDeletions: 0,
          fileContents: {},
          error: result.error,
        }
      }

      // 2. Check cache using diff hash
      const diffHash = computeContentHash(result.diff || "")
      type ParsedDiffResponse = {
        files: ReturnType<typeof splitUnifiedDiffByFile>
        totalAdditions: number
        totalDeletions: number
        fileContents: Record<string, string>
      }
      const cached = gitCache.getParsedDiff<ParsedDiffResponse>(chat.worktreePath, diffHash)
      if (cached) {
        return cached
      }

      // 3. Parse diff into files
      const files = splitUnifiedDiffByFile(result.diff || "")

      // 4. Calculate totals
      const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0)
      const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0)

      // 5. Prefetch file contents (first 20 files, non-deleted, non-binary)
      const MAX_PREFETCH = 20
      const MAX_FILE_SIZE = 2 * 1024 * 1024 // 2MB

      const filesToFetch = files
        .filter((f) => !f.isBinary && !f.isDeletedFile)
        .slice(0, MAX_PREFETCH)
        .map((f) => ({
          key: f.key,
          filePath: f.newPath !== "/dev/null" ? f.newPath : f.oldPath,
        }))
        .filter((f) => f.filePath && f.filePath !== "/dev/null")

      const fileContents: Record<string, string> = {}

      // Read files in parallel
      await Promise.all(
        filesToFetch.map(async ({ key, filePath }) => {
          try {
            const fullPath = path.join(chat.worktreePath!, filePath)

            // Check file size first
            const stats = await fs.stat(fullPath)
            if (stats.size > MAX_FILE_SIZE) {
              return // Skip large files
            }

            const content = await fs.readFile(fullPath, "utf-8")

            // Quick binary check (NUL bytes in first 8KB)
            const checkLength = Math.min(content.length, 8192)
            for (let i = 0; i < checkLength; i++) {
              if (content.charCodeAt(i) === 0) {
                return // Skip binary files
              }
            }

            fileContents[key] = content
          } catch {
            // File might not exist or be unreadable - skip
          }
        }),
      )

      const response: ParsedDiffResponse = {
        files,
        totalAdditions,
        totalDeletions,
        fileContents,
      }

      // 6. Store in cache
      gitCache.setParsedDiff(chat.worktreePath, diffHash, response)
      return response
    }),

  /**
   * Generate a commit message using AI based on the diff
   * @param chatId - The chat ID to get worktree path from
   * @param filePaths - Optional list of file paths to generate message for (if not provided, uses all changed files)
   * @param ollamaModel - Optional Ollama model for offline generation
   */
  generateCommitMessage: publicProcedure
    .input(z.object({
      chatId: z.string(),
      filePaths: z.array(z.string()).optional(),
      ollamaModel: z.string().nullish(), // Optional model for offline mode
    }))
    .mutation(async ({ input }) => {
      const db = getDatabase()
      const chat = db
        .select()
        .from(chats)
        .where(eq(chats.id, input.chatId))
        .get()

      if (!chat?.worktreePath) {
        throw new Error("No worktree path")
      }

      // Get the diff to understand what changed
      const result = await getWorktreeDiff(
        chat.worktreePath,
        chat.baseBranch ?? undefined,
      )

      if (!result.success || !result.diff) {
        throw new Error("Failed to get diff")
      }

      // Parse diff to get file list
      let files = splitUnifiedDiffByFile(result.diff)

      // Filter to only selected files if filePaths provided
      if (input.filePaths && input.filePaths.length > 0) {
        const selectedPaths = new Set(input.filePaths)
        files = files.filter((f) => {
          const filePath = f.newPath !== "/dev/null" ? f.newPath : f.oldPath
          // Match by exact path or by path suffix (handle different path formats)
          return selectedPaths.has(filePath) ||
            [...selectedPaths].some(sp => filePath.endsWith(sp) || sp.endsWith(filePath))
        })
        console.log(`[generateCommitMessage] Filtered ${files.length} files from ${input.filePaths.length} selected paths`)
      }

      if (files.length === 0) {
        throw new Error("No changes to commit")
      }

      // Build filtered diff text for API (only selected files)
      const filteredDiff = files.map(f => f.diffText).join('\n')
      const additions = files.reduce((sum, f) => sum + f.additions, 0)
      const deletions = files.reduce((sum, f) => sum + f.deletions, 0)

      // Backlot is online-only — Ollama offline fallback was stripped.
      // Reference the helper to satisfy the unused-import linter without
      // executing the (always-null) offline path.
      void generateCommitMessageWithOllama
      const hasInternet = true

      if (!hasInternet) {
        // Unreachable — kept as a structural placeholder for the upstream diff.
      } else {
        // Online - call web API to generate commit message
        let apiError: string | null = null
        try {
          const authManager = getAuthManager()
          const token = await authManager.getValidToken()
          // Use localhost in dev, production otherwise
          const apiUrl = process.env.NODE_ENV === "development" ? "http://localhost:3000" : "https://21st.dev"

          if (!token) {
            apiError = "No auth token available"
          } else {
            const response = await fetch(
              `${apiUrl}/api/agents/generate-commit-message`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "X-Desktop-Token": token,
                },
                body: JSON.stringify({
                  diff: filteredDiff.slice(0, 10000), // Limit diff size, use filtered diff
                  fileCount: files.length,
                  additions,
                  deletions,
                }),
              },
            )

            if (response.ok) {
              const data = await response.json()
              if (data.message) {
                return { message: data.message }
              }
              apiError = "API returned ok but no message in response"
            } else {
              apiError = `API returned ${response.status}`
            }
          }
        } catch (error) {
          apiError = `API call failed: ${error instanceof Error ? error.message : String(error)}`
        }

        if (apiError) {
          console.log("[generateCommitMessage] API error:", apiError)
        }
      }

      // Fallback: Generate commit message with conventional commits style
      const fileNames = files.map((f) => {
        const filePath = f.newPath !== "/dev/null" ? f.newPath : f.oldPath
        // Note: Git diff paths always use forward slashes
        return path.posix.basename(filePath) || filePath
      })

      // Detect commit type from file changes
      const hasNewFiles = files.some((f) => f.oldPath === "/dev/null")
      const hasDeletedFiles = files.some((f) => f.newPath === "/dev/null")
      const hasOnlyDeletions = files.every((f) => f.additions === 0 && f.deletions > 0)

      // Detect type from file paths
      const allPaths = files.map((f) => f.newPath !== "/dev/null" ? f.newPath : f.oldPath)
      const hasTestFiles = allPaths.some((p) => p.includes("test") || p.includes("spec"))
      const hasDocFiles = allPaths.some((p) => p.endsWith(".md") || p.includes("doc"))
      const hasConfigFiles = allPaths.some((p) =>
        p.includes("config") ||
        p.endsWith(".json") ||
        p.endsWith(".yaml") ||
        p.endsWith(".yml") ||
        p.endsWith(".toml")
      )

      // Determine commit type prefix
      let prefix = "chore"
      if (hasNewFiles && !hasDeletedFiles) {
        prefix = "feat"
      } else if (hasOnlyDeletions) {
        prefix = "chore"
      } else if (hasTestFiles && !hasDocFiles && !hasConfigFiles) {
        prefix = "test"
      } else if (hasDocFiles && !hasTestFiles && !hasConfigFiles) {
        prefix = "docs"
      } else if (allPaths.some((p) => p.includes("fix") || p.includes("bug"))) {
        prefix = "fix"
      } else if (files.length > 0 && files.every((f) => f.additions > 0 || f.deletions > 0)) {
        // Default to fix for modifications (most common case)
        prefix = "fix"
      }

      const uniqueFileNames = [...new Set(fileNames)]
      let message: string

      if (uniqueFileNames.length === 1) {
        message = `${prefix}: update ${uniqueFileNames[0]}`
      } else if (uniqueFileNames.length <= 3) {
        message = `${prefix}: update ${uniqueFileNames.join(", ")}`
      } else {
        message = `${prefix}: update ${uniqueFileNames.length} files`
      }

      console.log("[generateCommitMessage] Generated fallback message:", message)
      return { message }
    }),

  /**
   * Generate a name for a sub-chat without blocking agent startup.
   */
  generateSubChatName: publicProcedure
    .input(z.object({
      userMessage: z.string(),
      ollamaModel: z.string().nullish(),
    }))
    .mutation(({ input }) => {
      void generateChatNameWithOllama
      return { name: getFallbackName(input.userMessage) }
    }),

  // ============ PR-related procedures ============

  /**
   * Get PR context for message generation (branch info, uncommitted changes, etc.)
   */
  getPrContext: publicProcedure
    .input(z.object({ chatId: z.string() }))
    .query(async ({ input }) => {
      const db = getDatabase()
      const chat = db
        .select()
        .from(chats)
        .where(eq(chats.id, input.chatId))
        .get()

      if (!chat?.worktreePath) {
        return null
      }

      try {
        const git = simpleGit(chat.worktreePath)
        const status = await git.status()

        // Check if upstream exists
        let hasUpstream = false
        try {
          const tracking = await git.raw([
            "rev-parse",
            "--abbrev-ref",
            "@{upstream}",
          ])
          hasUpstream = !!tracking.trim()
        } catch {
          hasUpstream = false
        }

        return {
          branch: chat.branch || status.current || "unknown",
          baseBranch: chat.baseBranch || "main",
          uncommittedCount: status.files.length,
          hasUpstream,
        }
      } catch (error) {
        console.error("[getPrContext] Error:", error)
        return null
      }
    }),

  /**
   * Update PR info after Claude creates a PR
   */
  updatePrInfo: publicProcedure
    .input(
      z.object({
        chatId: z.string(),
        prUrl: z.string(),
        prNumber: z.number(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDatabase()
      const result = db
        .update(chats)
        .set({
          prUrl: input.prUrl,
          prNumber: input.prNumber,
          updatedAt: new Date(),
        })
        .where(eq(chats.id, input.chatId))
        .returning()
        .get()

      // Track PR created
      trackPRCreated({
        workspaceId: input.chatId,
        prNumber: input.prNumber,
      })

      return result
    }),

  /**
   * Get PR status from GitHub (via gh CLI)
   */
  getPrStatus: publicProcedure
    .input(z.object({ chatId: z.string() }))
    .query(async ({ input }) => {
      const db = getDatabase()
      const chat = db
        .select()
        .from(chats)
        .where(eq(chats.id, input.chatId))
        .get()

      if (!chat?.worktreePath) {
        return null
      }

      return await fetchGitHubPRStatus(chat.worktreePath)
    }),

  /**
   * Merge PR via gh CLI
   * First checks if PR is mergeable, returns helpful error if conflicts exist
   */
  mergePr: publicProcedure
    .input(
      z.object({
        chatId: z.string(),
        method: z.enum(["merge", "squash", "rebase"]).default("squash"),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDatabase()
      const chat = db
        .select()
        .from(chats)
        .where(eq(chats.id, input.chatId))
        .get()

      if (!chat?.worktreePath || !chat?.prNumber) {
        throw new Error("No PR to merge")
      }

      // Check PR mergeability before attempting merge
      const prStatus = await fetchGitHubPRStatus(chat.worktreePath)
      if (prStatus?.pr?.mergeable === "CONFLICTING") {
        throw new Error(
          "MERGE_CONFLICT: This PR has merge conflicts with the base branch. " +
          "Please sync your branch with the latest changes from main to resolve conflicts."
        )
      }

      try {
        await execWithShellEnv(
          "gh",
          [
            "pr",
            "merge",
            String(chat.prNumber),
            `--${input.method}`,
            "--delete-branch",
          ],
          { cwd: chat.worktreePath },
        )
        return { success: true }
      } catch (error) {
        console.error("[mergePr] Error:", error)
        const errorMsg = error instanceof Error ? error.message : "Failed to merge PR"

        // Check for conflict-related error messages from gh CLI
        if (
          errorMsg.includes("not mergeable") ||
          errorMsg.includes("merge conflict") ||
          errorMsg.includes("cannot be cleanly created") ||
          errorMsg.includes("CONFLICTING")
        ) {
          throw new Error(
            "MERGE_CONFLICT: This PR has merge conflicts with the base branch. " +
            "Please sync your branch with the latest changes from main to resolve conflicts."
          )
        }

        throw new Error(errorMsg)
      }
    }),

  /**
   * Get file change stats for workspaces
   * Parses messages from specified sub-chats and aggregates Edit/Write tool calls
   * Supports two modes:
   * - openSubChatIds: query specific sub-chats (used by main sidebar)
   * - chatIds: query all sub-chats for given chats (used by archive popover)
   */
  getFileStats: publicProcedure
    .input(z.object({
      openSubChatIds: z.array(z.string()).optional(),
      chatIds: z.array(z.string()).optional(),
    }))
    .query(({ input }) => {
    const db = getDatabase()

    // Early return if nothing to check
    if ((!input.openSubChatIds || input.openSubChatIds.length === 0) &&
        (!input.chatIds || input.chatIds.length === 0)) {
      return []
    }

    // Query sub-chats based on input mode
    let allChats: Array<{ chatId: string | null; subChatId: string; messages: string | null }>

    if (input.chatIds && input.chatIds.length > 0) {
      // Archive mode: query all sub-chats for given chat IDs
      allChats = db
        .select({
          chatId: subChats.worktreeId,
          subChatId: subChats.id,
          messages: subChats.messages,
        })
        .from(subChats)
        .where(inArray(subChats.worktreeId, input.chatIds))
        .all()
    } else {
      // Main sidebar mode: query specific sub-chats
      allChats = db
        .select({
          chatId: subChats.worktreeId,
          subChatId: subChats.id,
          messages: subChats.messages,
        })
        .from(subChats)
        .where(inArray(subChats.id, input.openSubChatIds!))
        .all()
    }

    // Aggregate stats per workspace (chatId)
    const statsMap = new Map<
      string,
      { additions: number; deletions: number; fileCount: number }
    >()

    for (const row of allChats) {
      if (!row.messages || !row.chatId) continue
      const chatId = row.chatId // TypeScript narrowing

      try {
        const messages = JSON.parse(row.messages) as Array<{
          role: string
          parts?: Array<{
            type: string
            input?: {
              file_path?: string
              old_string?: string
              new_string?: string
              content?: string
            }
          }>
        }>

        // Track file states for this sub-chat
        const fileStates = new Map<
          string,
          { originalContent: string | null; currentContent: string }
        >()

        for (const msg of messages) {
          if (msg.role !== "assistant") continue
          for (const part of msg.parts || []) {
            if (part.type === "tool-Edit" || part.type === "tool-Write") {
              const filePath = part.input?.file_path
              if (!filePath) continue
              // Skip session files
              if (
                filePath.includes("claude-sessions") ||
                filePath.includes("Application Support")
              )
                continue

              const oldString = part.input?.old_string || ""
              const newString =
                part.input?.new_string || part.input?.content || ""

              const existing = fileStates.get(filePath)
              if (existing) {
                existing.currentContent = newString
              } else {
                fileStates.set(filePath, {
                  originalContent: part.type === "tool-Write" ? null : oldString,
                  currentContent: newString,
                })
              }
            }
          }
        }

        // Calculate stats for this sub-chat and add to workspace total
        let subChatAdditions = 0
        let subChatDeletions = 0
        let subChatFileCount = 0

        for (const [, state] of fileStates) {
          const original = state.originalContent || ""
          if (original === state.currentContent) continue

          const oldLines = original ? original.split("\n").length : 0
          const newLines = state.currentContent
            ? state.currentContent.split("\n").length
            : 0

          if (!original) {
            // New file
            subChatAdditions += newLines
          } else {
            subChatAdditions += newLines
            subChatDeletions += oldLines
          }
          subChatFileCount += 1
        }

        // Add to workspace total
        const existing = statsMap.get(chatId) || {
          additions: 0,
          deletions: 0,
          fileCount: 0,
        }
        existing.additions += subChatAdditions
        existing.deletions += subChatDeletions
        existing.fileCount += subChatFileCount
        statsMap.set(chatId, existing)
      } catch {
        // Skip invalid JSON
      }
    }

    // Convert to array for easier consumption
    return Array.from(statsMap.entries()).map(([chatId, stats]) => ({
      chatId,
      ...stats,
    }))
  }),

  /**
   * Get sub-chats with pending plan approvals
   * Uses mode field as source of truth: mode="plan" + completed ExitPlanMode = pending approval
   * Logic must match active-chat.tsx hasUnapprovedPlan
   * REQUIRES openSubChatIds to avoid loading all sub-chats (performance optimization)
   */
  getPendingPlanApprovals: publicProcedure
    .input(z.object({ openSubChatIds: z.array(z.string()) }))
    .query(({ input }) => {
    const db = getDatabase()

    // Early return if no sub-chats to check
    if (input.openSubChatIds.length === 0) {
      return []
    }

    // Query only the specified sub-chats, including mode for filtering
    const allSubChats = db
      .select({
        chatId: subChats.worktreeId,
        subChatId: subChats.id,
        mode: subChats.mode,
        messages: subChats.messages,
      })
      .from(subChats)
      .where(inArray(subChats.id, input.openSubChatIds))
      .all()

    const pendingApprovals: Array<{ subChatId: string; chatId: string }> = []

    for (const row of allSubChats) {
      if (!row.subChatId || !row.chatId) continue

      // If mode is "agent", plan is already approved - skip
      if (row.mode === "agent") continue

      // Only check for ExitPlanMode in plan mode sub-chats
      if (!row.messages) continue

      try {
        const messages = JSON.parse(row.messages) as Array<{
          role: string
          content?: string
          parts?: Array<{
            type: string
            text?: string
            output?: unknown
          }>
        }>

        // Check if there's a completed ExitPlanMode in messages
        const hasCompletedExitPlanMode = (): boolean => {
          for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i]
            if (!msg) continue

            // If assistant message with completed ExitPlanMode, we found an unapproved plan
            if (msg.role === "assistant" && msg.parts) {
              const exitPlanPart = msg.parts.find(
                (p) => p.type === "tool-ExitPlanMode"
              )
              // Check if ExitPlanMode is completed (has output, even if empty)
              if (exitPlanPart && exitPlanPart.output !== undefined) {
                return true
              }
            }
          }
          return false
        }

        if (hasCompletedExitPlanMode()) {
          pendingApprovals.push({
            subChatId: row.subChatId,
            chatId: row.chatId,
          })
        }
      } catch {
        // Skip invalid JSON
      }
    }

    return pendingApprovals
  }),

  /**
   * Get worktree status for archive dialog
   * Returns whether workspace has a worktree and uncommitted changes count
   */
  getWorktreeStatus: publicProcedure
    .input(z.object({ chatId: z.string() }))
    .query(async ({ input }) => {
      const db = getDatabase()
      const chat = db
        .select()
        .from(chats)
        .where(eq(chats.id, input.chatId))
        .get()

      // No worktree if no branch (local mode)
      if (!chat?.worktreePath || !chat?.branch) {
        return { hasWorktree: false, uncommittedCount: 0 }
      }

      try {
        const git = simpleGit(chat.worktreePath)
        const status = await git.status()

        return {
          hasWorktree: true,
          uncommittedCount: status.files.length,
        }
      } catch (error) {
        // Worktree path doesn't exist or git error
        console.warn("[getWorktreeStatus] Error checking worktree:", error)
        return { hasWorktree: false, uncommittedCount: 0 }
      }
    }),

  /**
   * Export a chat conversation to various formats.
   * Supports exporting entire workspace or a single sub-chat.
   * Useful for sharing, backup, or importing into other tools.
   */
  exportChat: publicProcedure
    .input(
      z.object({
        chatId: z.string(),
        subChatId: z.string().optional(), // If provided, export only this sub-chat
        format: z.enum(["json", "markdown", "text"]).default("markdown"),
      }),
    )
    .query(async ({ input }) => {
      const db = getDatabase()
      const chat = db
        .select()
        .from(chats)
        .where(eq(chats.id, input.chatId))
        .get()

      if (!chat) {
        throw new Error("Chat not found")
      }

      const project = db
        .select()
        .from(projects)
        .where(eq(projects.id, chat.projectId))
        .get()

      // Query sub-chats: either a specific one or all for the chat
      let chatSubChats
      if (input.subChatId) {
        // Export single sub-chat
        const singleSubChat = db
          .select()
          .from(subChats)
          .where(and(
            eq(subChats.id, input.subChatId),
            eq(subChats.worktreeId, input.chatId) // Ensure sub-chat belongs to this worktree
          ))
          .get()

        if (!singleSubChat) {
          throw new Error("Sub-chat not found")
        }
        chatSubChats = [singleSubChat]
      } else {
        // Export all sub-chats
        chatSubChats = db
          .select()
          .from(subChats)
          .where(eq(subChats.worktreeId, input.chatId))
          .orderBy(subChats.createdAt)
          .all()
      }

      // parse messages from sub-chats
      const allMessages: Array<{
        subChatId: string
        subChatName: string | null
        messages: Array<{
          id: string
          role: string
          parts: Array<{ type: string; text?: string; [key: string]: any }>
          metadata?: any
        }>
      }> = []

      for (const subChat of chatSubChats) {
        try {
          const messages = JSON.parse(subChat.messages || "[]")
          allMessages.push({
            subChatId: subChat.id,
            subChatName: subChat.name,
            messages,
          })
        } catch {
          // skip invalid json
        }
      }

      // Sanitize filename - remove characters that are invalid on Windows/macOS/Linux
      const sanitizeFilename = (name: string): string => {
        return name
          .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_") // Invalid chars
          .replace(/\s+/g, "_") // Replace spaces with underscores
          .replace(/_+/g, "_") // Collapse multiple underscores
          .replace(/^_|_$/g, "") // Trim underscores from ends
          .slice(0, 100) // Limit length
          || "chat" // Fallback if empty
      }

      // Use sub-chat name if exporting single sub-chat, otherwise use chat name
      const exportName = input.subChatId && chatSubChats[0]?.name
        ? `${chat.name || "chat"}-${chatSubChats[0].name}`
        : (chat.name || "chat")
      const safeFilename = sanitizeFilename(exportName)

      if (input.format === "json") {
        return {
          format: "json" as const,
          content: JSON.stringify(
            {
              exportedAt: new Date().toISOString(),
              chat: {
                id: chat.id,
                name: chat.name,
                createdAt: chat.createdAt,
                branch: chat.branch,
                baseBranch: chat.baseBranch,
                prUrl: chat.prUrl,
              },
              project: project
                ? {
                    id: project.id,
                    name: project.name,
                    path: project.path,
                  }
                : null,
              conversations: allMessages,
            },
            null,
            2,
          ),
          filename: `${safeFilename}-${chat.id.slice(0, 8)}.json`,
        }
      }

      if (input.format === "text") {
        // plain text format
        let text = `# ${chat.name || "Untitled Chat"}\n`
        text += `exported: ${new Date().toISOString()}\n`
        if (project) {
          text += `project: ${project.name}\n`
        }
        text += `\n---\n\n`

        for (const subChatData of allMessages) {
          if (subChatData.subChatName) {
            text += `## ${subChatData.subChatName}\n\n`
          }

          for (const msg of subChatData.messages) {
            const role = msg.role === "user" ? "You" : "Assistant"
            text += `${role}:\n`

            for (const part of msg.parts || []) {
              if (part.type === "text" && part.text) {
                text += `${part.text}\n`
              } else if (part.type?.startsWith("tool-") && part.toolName) {
                text += `[used ${part.toolName} tool]\n`
              }
            }
            text += "\n"
          }
        }

        return {
          format: "text" as const,
          content: text,
          filename: `${safeFilename}-${chat.id.slice(0, 8)}.txt`,
        }
      }

      // markdown format (default)
      let markdown = `# ${chat.name || "Untitled Chat"}\n\n`
      markdown += `**Exported:** ${new Date().toISOString()}\n\n`
      if (project) {
        markdown += `**Project:** ${project.name}\n\n`
      }
      if (chat.branch) {
        markdown += `**Branch:** \`${chat.branch}\`\n\n`
      }
      if (chat.prUrl) {
        markdown += `**PR:** [${chat.prUrl}](${chat.prUrl})\n\n`
      }
      markdown += `---\n\n`

      for (const subChatData of allMessages) {
        if (subChatData.subChatName) {
          markdown += `## ${subChatData.subChatName}\n\n`
        }

        for (const msg of subChatData.messages) {
          const role = msg.role === "user" ? "**You**" : "**Assistant**"
          markdown += `### ${role}\n\n`

          for (const part of msg.parts || []) {
            if (part.type === "text" && part.text) {
              markdown += `${part.text}\n\n`
            } else if (part.type?.startsWith("tool-") && part.toolName) {
              const toolName = part.toolName
              if (toolName === "Bash" && part.input?.command) {
                markdown += `\`\`\`bash\n${part.input.command}\n\`\`\`\n\n`
              } else if (
                (toolName === "Edit" || toolName === "Write") &&
                part.input?.file_path
              ) {
                markdown += `> Modified: \`${part.input.file_path}\`\n\n`
              } else if (toolName === "Read" && part.input?.file_path) {
                markdown += `> Read: \`${part.input.file_path}\`\n\n`
              } else {
                markdown += `> *Used ${toolName} tool*\n\n`
              }
            }
          }
        }
      }

      return {
        format: "markdown" as const,
        content: markdown,
        filename: `${safeFilename}-${chat.id.slice(0, 8)}.md`,
      }
    }),

  /**
   * Get basic stats for a chat (message count, tool usage, etc.)
   * Supports both full chat stats and individual sub-chat stats.
   * Useful for showing chat summary in sidebar or export dialogs.
   */
  getChatStats: publicProcedure
    .input(z.object({
      chatId: z.string(),
      subChatId: z.string().optional(), // If provided, return stats for only this sub-chat
    }))
    .query(({ input }) => {
      const db = getDatabase()

      let chatSubChats
      if (input.subChatId) {
        // Get stats for a single sub-chat
        const singleSubChat = db
          .select()
          .from(subChats)
          .where(and(
            eq(subChats.id, input.subChatId),
            eq(subChats.worktreeId, input.chatId)
          ))
          .get()

        chatSubChats = singleSubChat ? [singleSubChat] : []
      } else {
        // Get stats for all sub-chats
        chatSubChats = db
          .select()
          .from(subChats)
          .where(eq(subChats.worktreeId, input.chatId))
          .all()
      }

      let messageCount = 0
      let userMessageCount = 0
      let assistantMessageCount = 0
      let toolCalls = 0
      const toolUsage: Record<string, number> = {}
      let totalInputTokens = 0
      let totalOutputTokens = 0

      for (const subChat of chatSubChats) {
        try {
          const messages = JSON.parse(subChat.messages || "[]") as Array<{
            role: string
            parts?: Array<{ type: string; toolName?: string }>
            metadata?: { usage?: { inputTokens?: number; outputTokens?: number } }
          }>

          for (const msg of messages) {
            messageCount++
            if (msg.role === "user") {
              userMessageCount++
            } else if (msg.role === "assistant") {
              assistantMessageCount++

              // count tool calls
              for (const part of msg.parts || []) {
                if (part.type?.startsWith("tool-") && part.toolName) {
                  toolCalls++
                  toolUsage[part.toolName] = (toolUsage[part.toolName] || 0) + 1
                }
              }

              // aggregate token usage
              if (msg.metadata?.usage) {
                totalInputTokens += msg.metadata.usage.inputTokens || 0
                totalOutputTokens += msg.metadata.usage.outputTokens || 0
              }
            }
          }
        } catch {
          // skip invalid json
        }
      }

      return {
        messageCount,
        userMessageCount,
        assistantMessageCount,
        toolCalls,
        toolUsage,
        totalInputTokens,
        totalOutputTokens,
        subChatCount: chatSubChats.length,
      }
    }),
})
