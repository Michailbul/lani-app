import { router } from "../index"
import { projectsRouter } from "./projects"
import { chatsRouter } from "./chats"
import { claudeRouter } from "./claude"
import { claudeCodeRouter } from "./claude-code"
import { claudeSettingsRouter } from "./claude-settings"
import { anthropicAccountsRouter } from "./anthropic-accounts"
import { codexRouter } from "./codex"
import { artifactsRouter } from "./artifacts"
import { canvasRouter } from "./canvas"
import { pathsRouter } from "./paths"
import { harnessRouter } from "./harness"
import { entitiesRouter } from "./entities"
import { shotlistsRouter } from "./shotlists"
import { terminalRouter } from "./terminal"
import { externalRouter } from "./external"
import { filesRouter } from "./files"
import { debugRouter } from "./debug"
import { skillsRouter } from "./skills"
import { agentsRouter } from "./agents"
import { worktreeConfigRouter } from "./worktree-config"
import { commandsRouter } from "./commands"
import { voiceRouter } from "./voice"
import { pluginsRouter } from "./plugins"
import { createGitRouter } from "../../git"
import { BrowserWindow } from "electron"

/**
 * Create the main app router
 * Uses getter pattern to avoid stale window references
 *
 * Stripped from upstream 1code: ollama (offline LLM fallback) and
 * sandboxImport (CodeSandbox import) — Backlot is online-only and
 * not a sandbox-clone tool.
 */
export function createAppRouter(getWindow: () => BrowserWindow | null) {
  return router({
    projects: projectsRouter,
    chats: chatsRouter,
    claude: claudeRouter,
    claudeCode: claudeCodeRouter,
    claudeSettings: claudeSettingsRouter,
    anthropicAccounts: anthropicAccountsRouter,
    codex: codexRouter,
    artifacts: artifactsRouter,
    canvas: canvasRouter,
    paths: pathsRouter,
    harness: harnessRouter,
    entities: entitiesRouter,
    shotlists: shotlistsRouter,
    terminal: terminalRouter,
    external: externalRouter,
    files: filesRouter,
    debug: debugRouter,
    skills: skillsRouter,
    agents: agentsRouter,
    worktreeConfig: worktreeConfigRouter,
    commands: commandsRouter,
    voice: voiceRouter,
    plugins: pluginsRouter,
    // Git operations - named "changes" to match Superset API
    changes: createGitRouter(),
  })
}

/**
 * Export the router type for client usage
 */
export type AppRouter = ReturnType<typeof createAppRouter>
