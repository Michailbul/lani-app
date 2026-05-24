# Lani — v1 PRD

> Last updated 2026-05-05. Owner: Michael. Status: scoping → execution.

## 1. Product framing

A local desktop app for screenwriters and AI filmmakers. The center pane is your screenplay artifact — Fountain or markdown — with live preview. The right rail is an AI assistant that edits the artifact in-place via Claude CLI. The left rail is a tree of "directions" — each direction is a git worktree, so exploring an alternate Act II is forking, and approving it is merging.

**Audience:** Michael + screenwriters who write with AI but refuse to hand the keyboard over. The product augments, never replaces.

**Why it doesn't exist yet:** Codex/Claude CLIs run in terminal. Cursor/Zed exist for code. There is no Cursor-for-screenwriting where the agent edits the artifact, you see the diff, and you can branch the *narrative*, not just the code.

## 2. Decisions locked

| Decision | Locked answer |
|---|---|
| Repo strategy | Hard fork of 1code (Apache 2.0). Preserve `LICENSE` + `NOTICE`. Own repo, no upstream sync obligation. |
| Agent backend (v1) | Claude CLI only (`@anthropic-ai/claude-agent-sdk`). Codex deferred to v1.5. |
| Auth | OAuth only. No API-key path. Multi-account support inherited from 1code's `anthropic_accounts` table. |
| Editor library | CodeMirror 6 with a custom Fountain mode. Lighter than Monaco, code-feel typewriter surface. |
| Auto-commit on agent edit | Yes. One commit per accepted edit. Branches are disposable, history is cheap, revert is free. |
| Scope | Single-window, multi-project, macOS first. No mobile, no Windows/Linux v1. |
| App name | Lani. |

## 3. Foundation: what 1code already provides

Verified by reading source. These survive the fork as-is.

| Capability | File |
|---|---|
| Electron three-process scaffold | `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/main.tsx` |
| tRPC modular routers | `src/main/lib/trpc/routers/` |
| Streaming agent output via observable() | `src/main/lib/trpc/routers/claude.ts` |
| Drizzle + SQLite + auto-migration | `src/main/lib/db/` + `drizzle/` |
| Worktree create / remove / diff / merge / push | `src/main/lib/git/worktree.ts` (1187 lines) |
| Branch checkout safety, default-branch detection | same |
| Git diff parser + viewer | `src/main/lib/git/diff-parser.ts`, `@git-diff-view/react` |
| File watcher infrastructure | `src/main/lib/git/watcher/` |
| safeStorage-encrypted credentials, OAuth flow | `src/main/lib/credential-manager.ts`, `src/main/lib/oauth.ts` |
| Auto-updater, window manager, theme scanner | `src/main/lib/`, `src/main/windows/` |
| Multi-account Anthropic OAuth | `anthropicAccounts` table + UI |

That is roughly 70% of the engineering done.

## 4. Data model — schema delta

Keep table names. Tweak fields only.

```ts
// projects — unchanged. A "project" is one screenplay/film/series.

// chats → conceptually "directions" (keep table name for migration ease)
//   ADD: kind text default "direction",       // "direction" | "main"
//        canonical integer (boolean) default false,

// subChats → "threads inside a direction" (keep name)
//   - existing sessionId column already typed for resume → reuse for Claude session ID
//   ADD: agentBackend text default "claude",  // "claude" v1 | "codex" v1.5
//        artifactPath text,                    // primary artifact relative to worktree
//        sandboxMode text default "workspace-write",
//        approvalPolicy text default "never",
//   REMOVE: mode "plan" | "agent" (Claude-Code-specific, replace with above)

// NEW table: artifacts
export const artifacts = sqliteTable("artifacts", {
  id: text("id").primaryKey().$defaultFn(createId),
  chatId: text("chat_id").notNull().references(() => chats.id, { onDelete: "cascade" }),
  relativePath: text("relative_path").notNull(),
  format: text("format").notNull(),  // "fountain" | "markdown" | "txt"
  isPrimary: integer("is_primary", { mode: "boolean" }).default(false),
  lastSeenContentHash: text("last_seen_content_hash"),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
})
```

Drizzle migrations: 1 additive migration on first launch.

## 5. Core flows

### 5.1 Start a new direction

```
User clicks "+ New Direction" on a project
  → tRPC: directions.create(projectId, fromBranch?, name?)
  → main: createWorktreeForChat(project.path, slug, chatId, fromBranch)  [exists]
  → main: copy primary artifact into the worktree if missing
  → DB: insert into chats (worktreePath, branch, baseBranch, kind:"direction")
  → renderer: branch tree updates, new tab opens with empty thread + preview
```

### 5.2 Send a message (Claude CLI)

```
User types in right rail → tRPC subscription claude.run({ subChatId, prompt, images? })
  → main: import("@anthropic-ai/claude-agent-sdk")  [existing flow]
  → main: query/resume with workingDirectory = chat.worktreePath
  → main: stream UIMessageChunk over observable.next()
  → DB: persist sessionId on first chunk
  → renderer: chat streams, file_change chunks surface diff badges
```

### 5.3 Edit artifact in place

```
Agent emits a file_change for the primary artifact
  → main: file watcher detects change in worktreePath/<artifact.relativePath>
  → main: emit `artifact.changed` over IPC with new content + git diff
  → renderer center pane:
       top half  — re-render Fountain preview from new content
       bottom half — show diff vs HEAD using @git-diff-view
  → renderer adds an "✓ Accept / ↶ Revert" toolbar above the diff
       Accept = stage + auto-commit with the agent message as commit msg
       Revert = `git checkout HEAD -- <path>`
```

### 5.4 Approve a direction back into main

```
User reviews direction, clicks "Merge into main"
  → tRPC: directions.merge(chatId)
  → main: if dirty, commitWorktreeChanges(...)  [exists]
  → main: mergeWorktreeToMain(project.path, chat.branch, project.canonicalBranch)  [exists]
  → on conflict: surface in UI, do not auto-resolve (writers want manual)
  → on success: optionally archive the direction (chats.archivedAt)
```

### 5.5 Discard a direction

```
User clicks "Discard direction"
  → confirm modal
  → tRPC: directions.discard(chatId)
  → main: removeWorktree(project.path, chat.worktreePath)  [exists]
  → DB: cascade delete subChats + artifacts
```

## 6. tRPC route surface

Keep all existing routers. Add `directions` and `artifacts`. Trim `claude` to screenwriter-relevant calls.

```ts
claude.run({ subChatId, prompt, images? })       // subscription, JSONL → UiChunk
claude.cancel({ subChatId })
claude.listSessions({ chatId })

directions.create({ projectId, fromDirectionId?, name? })
directions.list({ projectId })                   // tree view
directions.merge({ chatId, into })               // wraps mergeWorktreeToMain
directions.discard({ chatId })
directions.fork({ chatId, atMessageId? })        // worktree-from-worktree

artifacts.list({ chatId })
artifacts.read({ artifactId })
artifacts.write({ artifactId, content })          // user-side edits
artifacts.subscribe({ chatId })                   // file-watcher → render
```

## 7. Editor + preview decisions

- **Editor**: CodeMirror 6 with a Fountain mode. Tree-sitter Fountain parser exists; smaller bundle than Monaco. Monaco stays for diff display.
- **Preview**: `afterwriting-labs` for Fountain → screenplay HTML/PDF. Fallback is a hand-rolled Fountain renderer (~300 LOC).
- **Default format**: `.fountain` for screenplays, `.md` for treatments / character bibles / beat sheets. The `artifacts.format` field discriminates.

## 8. MCP tools to ship with v1

Each is a small Node stdio process, registered via Claude SDK MCP config.

| Tool | What it does | Why |
|---|---|---|
| `gallery-save` | Save a generated image, prompt, or shot description into laniameda.gallery | Studio system, agent saves directly without UI nav |
| `lock-read` | Read identity-lock blocks (character/world/style) from `_locks/*.md` | Critical for prompt consistency in downstream image/video gen |
| `lock-write` | Append to or amend an identity lock | Lets the agent maintain locks as the script evolves |
| `fountain-render` | Render a `.fountain` to HTML/PDF, return path | On-demand preview generation for the agent |
| `screenplay-stats` | Page count, scene count, character line counts, runtime estimate | Useful for "is Act II too long?" |

All shipped under `mcp/` in the repo, launched as child stdio processes when a thread starts.

## 9. Risks

- **Renderer chunk types couple to Claude SDK shape.** Acceptable in v1 since we are Claude-only. Becomes the integration boundary when Codex lands in v1.5.
- **Fountain ecosystem is small.** `afterwriting-labs` is solid but old. Budget 2 days for "preview ate my dialogue."
- **`claude.ts` router is 2419 lines.** Treat as a working example to learn from. Extract the streaming pattern into a thin wrapper, do not mutate the giant file in place.
- **OAuth flow is Anthropic-specific in 1code.** Strip the 21st.dev desktop-auth coupling that 1code uses for some token paths; keep the safeStorage + multi-account pattern.

## 10. Out of scope for v1

- Codex CLI backend
- Multi-window
- Windows/Linux builds
- Cloud sync, sharing, multi-user
- Voice input
- Plugin marketplace / 3rd-party MCP servers configured at runtime
- Mobile companion app
