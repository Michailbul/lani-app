import { index, sqliteTable, text, integer } from "drizzle-orm/sqlite-core"
import { relations } from "drizzle-orm"
import { createId } from "../utils"

// ============ PROJECTS ============
export const projects = sqliteTable("projects", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  name: text("name").notNull(),
  path: text("path").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(
    () => new Date(),
  ),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(
    () => new Date(),
  ),
  // Git remote info (extracted from local .git)
  gitRemoteUrl: text("git_remote_url"),
  gitProvider: text("git_provider"), // "github" | "gitlab" | "bitbucket" | null
  gitOwner: text("git_owner"),
  gitRepo: text("git_repo"),
  // Custom project icon (absolute path to local image file)
  iconPath: text("icon_path"),
})

export const projectsRelations = relations(projects, ({ many }) => ({
  worktrees: many(worktrees),
}))

// ============ WORKTREES ============
export const worktrees = sqliteTable("worktrees", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  name: text("name"),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(
    () => new Date(),
  ),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(
    () => new Date(),
  ),
  archivedAt: integer("archived_at", { mode: "timestamp" }),
  provider: text("provider").notNull().default("claude-code"), // "claude-code" | "codex"
  // Filesystem worktree fields (git isolation for a project variation)
  worktreePath: text("worktree_path"),
  branch: text("branch"),
  baseBranch: text("base_branch"),
  // PR tracking fields
  prUrl: text("pr_url"),
  prNumber: integer("pr_number"),
  // ── Backlot Worktree tree (forking) ──────────────────────────────
  // The worktree this one was forked from. NULL means a root worktree
  // (the "main draft"). The tree is built by walking parentWorktreeId chains
  // up to a NULL parent.
  parentWorktreeId: text("parent_worktree_id"),
  // Git commit hash on the parent's worktree at the moment of fork —
  // the new worktree's branch is created off this commit.
  forkedAtCommit: text("forked_at_commit"),
  // How many of the parent's agent-thread messages were copied into the new
  // worktree. Lets us show "forked at message N of 47" in the tree
  // viz, and lets us re-derive what was inherited if needed.
  forkedAtMessageIndex: integer("forked_at_message_index"),
  // Hex colour for tree-viz badges. Picked from a small palette on
  // create so siblings stay distinguishable.
  directionColor: text("direction_color"),
}, (table) => [
  index("worktrees_worktree_path_idx").on(table.worktreePath),
  index("worktrees_parent_worktree_id_idx").on(table.parentWorktreeId),
])

export const worktreesRelations = relations(worktrees, ({ one, many }) => ({
  project: one(projects, {
    fields: [worktrees.projectId],
    references: [projects.id],
  }),
  agentThreads: many(agentThreads),
}))

// ============ AGENT THREADS ============
export const agentThreads = sqliteTable("agent_threads", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  name: text("name"),
  worktreeId: text("worktree_id")
    .notNull()
    .references(() => worktrees.id, { onDelete: "cascade" }),
  sessionId: text("session_id"), // Claude SDK session ID for resume
  streamId: text("stream_id"), // Track in-progress streams
  mode: text("mode").notNull().default("agent"), // "plan" | "agent"
  provider: text("provider").notNull().default("claude-code"), // "claude-code" | "codex"
  messages: text("messages").notNull().default("[]"), // JSON array
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(
    () => new Date(),
  ),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(
    () => new Date(),
  ),
})

export const agentThreadsRelations = relations(agentThreads, ({ one }) => ({
  worktree: one(worktrees, {
    fields: [agentThreads.worktreeId],
    references: [worktrees.id],
  }),
}))

// ============ CANVAS ============
// Canvas graph state is app-owned and DB-canonical. Image binaries stay in
// the project worktree under assets/canvas/* and are referenced by asset rows.
export const canvasDocuments = sqliteTable("canvas_documents", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  worktreeId: text("worktree_id")
    .notNull()
    .references(() => worktrees.id, { onDelete: "cascade" }),
  name: text("name").notNull().default("main"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(
    () => new Date(),
  ),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(
    () => new Date(),
  ),
}, (table) => [
  index("canvas_documents_worktree_id_idx").on(table.worktreeId),
])

export const canvasAssets = sqliteTable("canvas_assets", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  worktreeId: text("worktree_id")
    .notNull()
    .references(() => worktrees.id, { onDelete: "cascade" }),
  kind: text("kind").notNull().default("imported"), // "imported" | "generated"
  projectRelativePath: text("project_relative_path").notNull(),
  sourcePath: text("source_path"),
  mimeType: text("mime_type").notNull(),
  byteSize: integer("byte_size").notNull().default(0),
  sha256: text("sha256"),
  width: integer("width"),
  height: integer("height"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(
    () => new Date(),
  ),
}, (table) => [
  index("canvas_assets_worktree_id_idx").on(table.worktreeId),
  index("canvas_assets_project_relative_path_idx").on(table.projectRelativePath),
])

export const canvasNodes = sqliteTable("canvas_nodes", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  canvasId: text("canvas_id")
    .notNull()
    .references(() => canvasDocuments.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // "prompt" | "image" | "imageGeneration"
  x: integer("x").notNull().default(0),
  y: integer("y").notNull().default(0),
  width: integer("width").notNull().default(360),
  height: integer("height").notNull().default(240),
  data: text("data").notNull().default("{}"),
  locked: integer("locked", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(
    () => new Date(),
  ),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(
    () => new Date(),
  ),
}, (table) => [
  index("canvas_nodes_canvas_id_idx").on(table.canvasId),
])

export const canvasEdges = sqliteTable("canvas_edges", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  canvasId: text("canvas_id")
    .notNull()
    .references(() => canvasDocuments.id, { onDelete: "cascade" }),
  sourceNodeId: text("source_node_id")
    .notNull()
    .references(() => canvasNodes.id, { onDelete: "cascade" }),
  sourceHandle: text("source_handle").notNull(),
  targetNodeId: text("target_node_id")
    .notNull()
    .references(() => canvasNodes.id, { onDelete: "cascade" }),
  targetHandle: text("target_handle").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(
    () => new Date(),
  ),
}, (table) => [
  index("canvas_edges_canvas_id_idx").on(table.canvasId),
  index("canvas_edges_source_node_id_idx").on(table.sourceNodeId),
  index("canvas_edges_target_node_id_idx").on(table.targetNodeId),
])

export const canvasGenerationRuns = sqliteTable("canvas_generation_runs", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  canvasId: text("canvas_id")
    .notNull()
    .references(() => canvasDocuments.id, { onDelete: "cascade" }),
  nodeId: text("node_id")
    .notNull()
    .references(() => canvasNodes.id, { onDelete: "cascade" }),
  model: text("model").notNull(),
  status: text("status").notNull().default("queued"), // queued | running | succeeded | failed
  prompt: text("prompt"),
  inputAssetIds: text("input_asset_ids").notNull().default("[]"),
  outputAssetId: text("output_asset_id"),
  error: text("error"),
  startedAt: integer("started_at", { mode: "timestamp" }).$defaultFn(
    () => new Date(),
  ),
  completedAt: integer("completed_at", { mode: "timestamp" }),
}, (table) => [
  index("canvas_generation_runs_canvas_id_idx").on(table.canvasId),
  index("canvas_generation_runs_node_id_idx").on(table.nodeId),
])

export const canvasDocumentsRelations = relations(canvasDocuments, ({ one, many }) => ({
  worktree: one(worktrees, {
    fields: [canvasDocuments.worktreeId],
    references: [worktrees.id],
  }),
  nodes: many(canvasNodes),
  edges: many(canvasEdges),
}))

export const canvasNodesRelations = relations(canvasNodes, ({ one, many }) => ({
  canvas: one(canvasDocuments, {
    fields: [canvasNodes.canvasId],
    references: [canvasDocuments.id],
  }),
  generationRuns: many(canvasGenerationRuns),
}))

export const canvasEdgesRelations = relations(canvasEdges, ({ one }) => ({
  canvas: one(canvasDocuments, {
    fields: [canvasEdges.canvasId],
    references: [canvasDocuments.id],
  }),
}))

export const canvasAssetsRelations = relations(canvasAssets, ({ one }) => ({
  worktree: one(worktrees, {
    fields: [canvasAssets.worktreeId],
    references: [worktrees.id],
  }),
}))

// ============ CLAUDE CODE CREDENTIALS ============
// Stores encrypted OAuth token for Claude Code integration
// DEPRECATED: Use anthropicAccounts for multi-account support
export const claudeCodeCredentials = sqliteTable("claude_code_credentials", {
  id: text("id").primaryKey().default("default"), // Single row, always "default"
  oauthToken: text("oauth_token").notNull(), // Encrypted with safeStorage
  connectedAt: integer("connected_at", { mode: "timestamp" }).$defaultFn(
    () => new Date(),
  ),
  userId: text("user_id"), // Desktop auth user ID (for reference)
})

// ============ ANTHROPIC ACCOUNTS (Multi-account support) ============
// Stores multiple Anthropic OAuth accounts for quick switching
export const anthropicAccounts = sqliteTable("anthropic_accounts", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  email: text("email"), // User's email from OAuth (if available)
  displayName: text("display_name"), // User-editable label
  oauthToken: text("oauth_token").notNull(), // Encrypted with safeStorage
  connectedAt: integer("connected_at", { mode: "timestamp" }).$defaultFn(
    () => new Date(),
  ),
  lastUsedAt: integer("last_used_at", { mode: "timestamp" }),
  desktopUserId: text("desktop_user_id"), // Reference to legacy remote user
})

// Tracks which Anthropic account is currently active
export const anthropicSettings = sqliteTable("anthropic_settings", {
  id: text("id").primaryKey().default("singleton"), // Single row
  activeAccountId: text("active_account_id"), // References anthropicAccounts.id
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(
    () => new Date(),
  ),
})

// ============ TYPE EXPORTS ============
export type Project = typeof projects.$inferSelect
export type NewProject = typeof projects.$inferInsert
export type Worktree = typeof worktrees.$inferSelect
export type NewWorktree = typeof worktrees.$inferInsert
export type AgentThread = typeof agentThreads.$inferSelect
export type NewAgentThread = typeof agentThreads.$inferInsert
export type ClaudeCodeCredential = typeof claudeCodeCredentials.$inferSelect
export type NewClaudeCodeCredential = typeof claudeCodeCredentials.$inferInsert
export type AnthropicAccount = typeof anthropicAccounts.$inferSelect
export type NewAnthropicAccount = typeof anthropicAccounts.$inferInsert
export type AnthropicSettings = typeof anthropicSettings.$inferSelect
export type CanvasDocument = typeof canvasDocuments.$inferSelect
export type NewCanvasDocument = typeof canvasDocuments.$inferInsert
export type CanvasNode = typeof canvasNodes.$inferSelect
export type NewCanvasNode = typeof canvasNodes.$inferInsert
export type CanvasEdge = typeof canvasEdges.$inferSelect
export type NewCanvasEdge = typeof canvasEdges.$inferInsert
export type CanvasAsset = typeof canvasAssets.$inferSelect
export type NewCanvasAsset = typeof canvasAssets.$inferInsert
export type CanvasGenerationRun = typeof canvasGenerationRuns.$inferSelect
export type NewCanvasGenerationRun = typeof canvasGenerationRuns.$inferInsert

// Compatibility aliases while the renderer and older routers are migrated.
// The underlying DB table names are already `worktrees` and `agent_threads`.
export const chats = worktrees
export const subChats = agentThreads
export type Chat = Worktree
export type NewChat = NewWorktree
export type SubChat = AgentThread
export type NewSubChat = NewAgentThread
