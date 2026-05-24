import { createACPProvider, type ACPProvider } from "@mcpc-tech/acp-ai-provider"
import { observable } from "@trpc/server/observable"
import { streamText } from "ai"
import { eq } from "drizzle-orm"
import { app } from "electron"
import { execFileSync, spawn, type ChildProcess } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { accessSync, constants, existsSync } from "node:fs"
import { readdir, readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { basename, dirname, join, sep } from "node:path"
import { z } from "zod"
import {
  normalizeCodexAssistantMessage,
  normalizeCodexStreamChunk,
} from "../../../../shared/codex-tool-normalizer"
import { getClaudeShellEnvironment } from "../../claude/env"
import {
  clearStoredCodexApiKey,
  hasStoredCodexApiKey,
  isCodexApiKeyEncryptionAvailable,
  loadStoredCodexApiKey,
  saveStoredCodexApiKey,
} from "../../codex/credentials"
import {
  buildCodexAgentBridge,
  buildCodexAgentMentionInstruction,
} from "../../codex/agents"
import { buildActiveFocusBlock, buildLaniHarnessBlock } from "../../claude/harness-prompt"
import { HARNESS_FOCUS_REQUEST_PATH } from "../../harness/focus-request"
import { resolveProjectPathFromWorktree } from "../../claude-config"
import { parseMentions } from "../../agent-mentions"
import { getDatabase, getDatabasePath, projects as projectsTable, subChats } from "../../db"
import { createRollbackStash } from "../../git/stash"
import {
  fetchMcpTools,
  fetchMcpToolsStdio,
  type McpToolInfo,
} from "../../mcp-auth"
import { CodexAppServerClient, type CodexAppServerIncomingNotification, type CodexAppServerIncomingRequest } from "../../codex/app-server-client"
import {
  LANI_PLUGIN_NAME,
  ensureLaniPlugin,
  getLaniCodexPluginKey,
  getLaniPluginPath,
  listLaniSkills,
} from "../../skills/library"
import { publicProcedure, router } from "../index"

const imageAttachmentSchema = z.object({
  base64Data: z.string(),
  mediaType: z.string(),
  filename: z.string().optional(),
})

type CodexProviderSession = {
  provider: ACPProvider
  cwd: string
  authFingerprint: string | null
  mcpFingerprint: string
}

type CodexLoginSessionState =
  | "running"
  | "success"
  | "error"
  | "cancelled"

type CodexLoginSession = {
  id: string
  process: ChildProcess | null
  state: CodexLoginSessionState
  output: string
  url: string | null
  error: string | null
  exitCode: number | null
}

type CodexIntegrationState =
  | "connected_chatgpt"
  | "connected_api_key"
  | "not_logged_in"
  | "unknown"

type CodexMcpServerForSession =
  | {
      name: string
      type: "stdio"
      command: string
      args: string[]
      env: Array<{ name: string; value: string }>
    }
  | {
      name: string
      type: "http"
      url: string
      headers: Array<{ name: string; value: string }>
    }

type CodexMcpServerForSettings = {
  name: string
  status: "connected" | "failed" | "pending" | "needs-auth"
  tools: McpToolInfo[]
  needsAuth: boolean
  config: Record<string, unknown>
}

type CodexMcpSnapshot = {
  mcpServersForSession: CodexMcpServerForSession[]
  groups: Array<{
    groupName: string
    projectPath: string | null
    mcpServers: CodexMcpServerForSettings[]
  }>
  fingerprint: string
  fetchedAt: number
  toolsResolved: boolean
}

function getBuiltinCanvasMcpServerForCodex(input: {
  worktreeId: string
  cwd: string
}): CodexMcpServerForSession {
  const serverPath = app.isPackaged
    ? join(process.resourcesPath, "mcp", "canvas", "index.mjs")
    : join(__dirname, "../../mcp/canvas/index.mjs")

  return {
    name: "lani-canvas",
    type: "stdio",
    command: process.env.LANI_NODE_PATH || process.execPath,
    args: [serverPath],
    env: [
      { name: "ELECTRON_RUN_AS_NODE", value: "1" },
      ...(app.isPackaged
        ? [
            {
              name: "NODE_PATH",
              value: join(process.resourcesPath, "app.asar", "node_modules"),
            },
          ]
        : []),
      { name: "LANI_DB_PATH", value: getDatabasePath() },
      { name: "LANI_CANVAS_WORKTREE_ID", value: input.worktreeId },
      { name: "LANI_CANVAS_CHAT_ID", value: input.worktreeId },
      { name: "LANI_WORKTREE_PATH", value: input.cwd },
      ...(process.env.OPENAI_API_KEY
        ? [{ name: "OPENAI_API_KEY", value: process.env.OPENAI_API_KEY }]
        : []),
      ...(process.env.LANI_CANVAS_IMAGE_MODEL
        ? [
            {
              name: "LANI_CANVAS_IMAGE_MODEL",
              value: process.env.LANI_CANVAS_IMAGE_MODEL,
            },
          ]
        : []),
    ],
  }
}

function getBuiltinHarnessMcpServerForCodex(): CodexMcpServerForSession {
  const serverPath = app.isPackaged
    ? join(process.resourcesPath, "mcp", "harness", "index.mjs")
    : join(__dirname, "../../mcp/harness/index.mjs")

  return {
    name: "lani-harness",
    type: "stdio",
    command: process.env.LANI_NODE_PATH || process.execPath,
    args: [serverPath],
    env: [
      { name: "ELECTRON_RUN_AS_NODE", value: "1" },
      ...(app.isPackaged
        ? [
            {
              name: "NODE_PATH",
              value: join(process.resourcesPath, "app.asar", "node_modules"),
            },
          ]
        : []),
      {
        name: "LANI_HARNESS_REQUEST_PATH",
        value: HARNESS_FOCUS_REQUEST_PATH,
      },
    ],
  }
}

function getBuiltinCodexMcpServers(input: {
  worktreeId: string
  cwd: string
  resolvedNames: Set<string>
}): CodexMcpServerForSession[] {
  const servers: CodexMcpServerForSession[] = []
  if (!input.resolvedNames.has("lani-canvas")) {
    servers.push(
      getBuiltinCanvasMcpServerForCodex({
        worktreeId: input.worktreeId,
        cwd: input.cwd,
      }),
    )
  }
  if (!input.resolvedNames.has("lani-harness")) {
    servers.push(getBuiltinHarnessMcpServerForCodex())
  }
  return servers
}

const providerSessions = new Map<string, CodexProviderSession>()
type ActiveCodexStream = {
  runId: string
  controller: AbortController
  cancelRequested: boolean
}

const activeStreams = new Map<string, ActiveCodexStream>()

type CodexRuntimeId = "acp" | "app-server"

type CodexAppServerThreadSession = {
  threadId: string
  sessionId: string | null
  cwd: string
  authFingerprint: string | null
  threadConfigFingerprint: string
}

type ActiveCodexAppServerTurn = {
  runId: string
  controller: AbortController
  cancelRequested: boolean
  mode: "plan" | "agent"
  threadId?: string
  turnId?: string
  interrupt?: () => Promise<void>
  flushPartial?: () => Promise<void>
}

type CodexAppServerRuntime = {
  identity: string
  client: CodexAppServerClient
  account: any
  models: any[]
  initializedAt: number
}

const appServerThreads = new Map<string, CodexAppServerThreadSession>()
const activeAppServerTurns = new Map<string, ActiveCodexAppServerTurn>()
let appServerRuntime: CodexAppServerRuntime | null = null
let didInstallAppQuitHook = false

function getCodexRuntimeId(): CodexRuntimeId {
  return process.env.LANI_CODEX_RUNTIME === "app-server"
    ? "app-server"
    : "acp"
}

function resolveCodexAppServerBinaryPath(): string {
  return resolveBundledCodexCliPath()
}

function disposeCodexAppServerRuntime(): void {
  if (!appServerRuntime) return
  appServerRuntime.client.dispose()
  appServerRuntime = null
  appServerThreads.clear()
}

function ensureCodexAppQuitHook(): void {
  if (didInstallAppQuitHook) return
  didInstallAppQuitHook = true
  app.once("before-quit", () => {
    disposeCodexAppServerRuntime()
  })
}

function getApprovalModeForRequest(
  request: CodexAppServerIncomingRequest,
): "plan" | "agent" {
  const params = request.params as any
  const threadId = typeof params?.threadId === "string" ? params.threadId : undefined
  const turnId = typeof params?.turnId === "string" ? params.turnId : undefined

  for (const turn of activeAppServerTurns.values()) {
    if (turnId && turn.turnId === turnId) return turn.mode
    if (threadId && turn.threadId === threadId) return turn.mode
  }

  return "agent"
}

async function handleCodexAppServerRequest(
  request: CodexAppServerIncomingRequest,
): Promise<unknown> {
  const mode = getApprovalModeForRequest(request)
  const shouldAccept = mode === "agent"

  switch (request.method) {
    case "item/commandExecution/requestApproval":
      return { decision: shouldAccept ? "accept" : "decline" }
    case "item/fileChange/requestApproval":
      return { decision: shouldAccept ? "accept" : "decline" }
    case "item/permissions/requestApproval":
      return {
        permissions: {},
        scope: shouldAccept ? "session" : "turn",
        strictAutoReview: false,
      }
    case "item/tool/requestUserInput":
      return { answers: {} }
    case "mcpServer/elicitation/request":
      return { action: "decline", content: null, _meta: null }
    case "execCommandApproval":
    case "applyPatchApproval":
      return { decision: shouldAccept ? "approved" : "denied" }
    default:
      throw new Error(`Unhandled Codex app-server request: ${request.method}`)
  }
}

/** Check if there are any active Codex streaming sessions */
export function hasActiveCodexStreams(): boolean {
  return activeStreams.size > 0 || activeAppServerTurns.size > 0
}

/** Abort all active Codex streams so their cleanup saves partial state */
export function abortAllCodexStreams(): void {
  for (const [subChatId, stream] of activeStreams) {
    console.log(`[codex] Aborting stream ${subChatId} before reload`)
    stream.controller.abort()
  }
  activeStreams.clear()
  for (const [subChatId, turn] of activeAppServerTurns) {
    console.log(`[codex] Interrupting app-server turn ${subChatId} before reload`)
    turn.cancelRequested = true
    turn.controller.abort()
    void turn.interrupt?.().catch((error) => {
      console.warn("[codex] Failed to interrupt app-server turn:", error)
    })
    void turn.flushPartial?.().catch((error) => {
      console.warn("[codex] Failed to flush app-server partial turn:", error)
    })
  }
  activeAppServerTurns.clear()
}
const loginSessions = new Map<string, CodexLoginSession>()
const codexMcpCache = new Map<string, CodexMcpSnapshot>()

const URL_CANDIDATE_REGEX = /https?:\/\/[^\s]+/g
const ANSI_ESCAPE_REGEX = /\u001B\[[0-?]*[ -/]*[@-~]/g
const ANSI_OSC_REGEX = /\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g

const AUTH_HINTS = [
  "not logged in",
  "authentication required",
  "auth required",
  "login required",
  "missing credentials",
  "no credentials",
  "unauthorized",
  "forbidden",
  "codex login",
  "401",
  "403",
]
const DEFAULT_CODEX_MODEL = "gpt-5.5/high"
const CODEX_MCP_TOOLS_FETCH_TIMEOUT_MS = 40_000
const CODEX_USAGE_POLL_ATTEMPTS = 3
const CODEX_USAGE_POLL_INTERVAL_MS = 200
const CODEX_ENV_KEYS = [
  "CODEX_API_KEY",
  "OPENAI_API_KEY",
  "OPENAI_ORGANIZATION",
  "OPENAI_PROJECT",
  "CODEX_HOME",
] as const

let cachedCodexCliPath: string | null = null
let didResolveCodexCliPath = false
let cachedCodexShellEnv: Record<string, string> | null = null

type CodexTokenUsage = {
  input_tokens?: number
  cached_input_tokens?: number
  output_tokens?: number
  total_tokens?: number
}

type CodexTokenCountInfo = {
  last_token_usage?: CodexTokenUsage
  model_context_window?: number
}

type CodexUsageMetadata = {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  modelContextWindow?: number
}

const codexMcpListEntrySchema = z
  .object({
    name: z.string(),
    enabled: z.boolean(),
    disabled_reason: z.string().nullable().optional(),
    transport: z
      .object({
        type: z.string(),
        command: z.string().nullable().optional(),
        args: z.array(z.string()).nullable().optional(),
        env: z.record(z.string(), z.string()).nullable().optional(),
        env_vars: z.array(z.string()).nullable().optional(),
        cwd: z.string().nullable().optional(),
        url: z.string().nullable().optional(),
        bearer_token_env_var: z.string().nullable().optional(),
        http_headers: z.record(z.string(), z.string()).nullable().optional(),
        env_http_headers: z.record(z.string(), z.string()).nullable().optional(),
      })
      .passthrough(),
    auth_status: z.string().nullable().optional(),
  })
  .passthrough()

type CodexMcpListEntry = z.infer<typeof codexMcpListEntrySchema>

function getCodexPackageName(): string {
  const platform = process.platform
  const arch = process.arch

  if (platform === "darwin") {
    if (arch === "arm64") return "@zed-industries/codex-acp-darwin-arm64"
    if (arch === "x64") return "@zed-industries/codex-acp-darwin-x64"
  }

  if (platform === "linux") {
    if (arch === "arm64") return "@zed-industries/codex-acp-linux-arm64"
    if (arch === "x64") return "@zed-industries/codex-acp-linux-x64"
  }

  if (platform === "win32") {
    if (arch === "arm64") return "@zed-industries/codex-acp-win32-arm64"
    if (arch === "x64") return "@zed-industries/codex-acp-win32-x64"
  }

  throw new Error(`Unsupported platform/arch for codex-acp: ${platform}/${arch}`)
}

function toUnpackedAsarPath(filePath: string): string {
  const unpackedPath = filePath.replace(
    `${sep}app.asar${sep}`,
    `${sep}app.asar.unpacked${sep}`,
  )

  if (unpackedPath !== filePath && existsSync(unpackedPath)) {
    return unpackedPath
  }

  return filePath
}

function resolveCodexAcpBinaryPath(): string {
  const packageName = getCodexPackageName()
  const binaryName = process.platform === "win32" ? "codex-acp.exe" : "codex-acp"
  const codexPackageRoot = dirname(
    require.resolve("@zed-industries/codex-acp/package.json"),
  )
  const resolvedPath = require.resolve(`${packageName}/bin/${binaryName}`, {
    // Resolve relative to the wrapper package so nested optional deps work in packaged apps.
    paths: [codexPackageRoot],
  })

  return toUnpackedAsarPath(resolvedPath)
}

function isExecutableFile(filePath: string | null | undefined): filePath is string {
  if (!filePath) return false
  try {
    accessSync(filePath, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function readCodexShellEnv(): Record<string, string> {
  if (cachedCodexShellEnv) {
    return { ...cachedCodexShellEnv }
  }

  const shellEnv: Record<string, string> = {}
  cachedCodexShellEnv = shellEnv

  if (process.platform === "win32") {
    return shellEnv
  }

  const shell = process.env.SHELL || (process.platform === "darwin" ? "/bin/zsh" : "/bin/sh")
  const script = `
for key in ${CODEX_ENV_KEYS.join(" ")}; do
  value="$(printenv "$key" 2>/dev/null || true)"
  if [ -n "$value" ]; then
    printf '%s=%s\\n' "$key" "$value"
  fi
done
`

  try {
    const output = execFileSync(shell, ["-ilc", script], {
      encoding: "utf8",
      env: {
        HOME: homedir(),
        USER: process.env.USER || "",
        SHELL: shell,
        DISABLE_AUTO_UPDATE: "true",
      },
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5_000,
    })

    for (const line of output.split("\n")) {
      const separatorIndex = line.indexOf("=")
      if (separatorIndex <= 0) continue
      const key = line.slice(0, separatorIndex)
      const value = line.slice(separatorIndex + 1)
      if (
        (CODEX_ENV_KEYS as readonly string[]).includes(key) &&
        value.length > 0
      ) {
        shellEnv[key] = value
      }
    }
  } catch {
    // Finder-launched apps often have sparse env. Best effort is enough here.
  }

  cachedCodexShellEnv = shellEnv
  return { ...shellEnv }
}

function buildCodexBaseEnv(): Record<string, string> {
  const env: Record<string, string> = {}

  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") {
      env[key] = value
    }
  }

  // Prefer login-shell values for PATH and MCP command lookup parity.
  for (const [key, value] of Object.entries(getClaudeShellEnvironment())) {
    if (typeof value === "string") {
      env[key] = value
    }
  }

  // Claude env deliberately strips OPENAI_API_KEY. Restore Codex-specific
  // credentials from the login shell without logging their values.
  for (const [key, value] of Object.entries(readCodexShellEnv())) {
    if (typeof value === "string" && value.length > 0) {
      env[key] = value
    }
  }

  // Explicit process env still wins over shell discovery.
  for (const key of CODEX_ENV_KEYS) {
    const value = process.env[key]?.trim()
    if (value) {
      env[key] = value
    }
  }

  return env
}

function findCodexOnPath(env: Record<string, string>): string | null {
  try {
    if (process.platform === "win32") {
      const output = execFileSync("where.exe", ["codex"], {
        encoding: "utf8",
        env,
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 2_000,
      })
      return output.split(/\r?\n/).find((line) => isExecutableFile(line.trim())) || null
    }

    const output = execFileSync("/bin/sh", ["-lc", "command -v codex"], {
      encoding: "utf8",
      env,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2_000,
    })
    return output.split("\n").find((line) => isExecutableFile(line.trim())) || null
  } catch {
    return null
  }
}

function resolveInstalledCodexCliPath(): string | null {
  const env = buildCodexBaseEnv()
  const explicitCandidates = [
    process.env.LANI_CODEX_EXECUTABLE,
    process.env.CODEX_EXECUTABLE,
    process.env.CODEX_CLI_PATH,
    env.LANI_CODEX_EXECUTABLE,
    env.CODEX_EXECUTABLE,
    env.CODEX_CLI_PATH,
  ]

  for (const candidate of explicitCandidates) {
    if (isExecutableFile(candidate?.trim())) {
      return candidate!.trim()
    }
  }

  const pathCandidate = findCodexOnPath(env)
  if (pathCandidate) {
    return pathCandidate.trim()
  }

  const binaryName = process.platform === "win32" ? "codex.exe" : "codex"
  const appLocalData = process.env.LOCALAPPDATA || ""
  const fallbackCandidates =
    process.platform === "darwin"
      ? [
          "/Applications/Codex.app/Contents/Resources/codex",
          "/opt/homebrew/bin/codex",
          "/usr/local/bin/codex",
          join(homedir(), ".local", "bin", "codex"),
        ]
      : process.platform === "win32"
        ? [
            appLocalData ? join(appLocalData, "Programs", "Codex", binaryName) : "",
          ]
        : [
            "/usr/local/bin/codex",
            "/usr/bin/codex",
            join(homedir(), ".local", "bin", "codex"),
          ]

  return fallbackCandidates.find((candidate) => isExecutableFile(candidate)) || null
}

function resolveBundledCodexCliPath(): string {
  if (didResolveCodexCliPath) {
    if (cachedCodexCliPath) return cachedCodexCliPath
  }

  const binaryName = process.platform === "win32" ? "codex.exe" : "codex"
  const resourcesDir = app.isPackaged
    ? join(process.resourcesPath, "bin")
    : join(
        app.getAppPath(),
        "resources",
        "bin",
        `${process.platform}-${process.arch}`,
      )

  const binaryPath = join(resourcesDir, binaryName)
  if (existsSync(binaryPath)) {
    cachedCodexCliPath = binaryPath
    didResolveCodexCliPath = true
    return binaryPath
  }

  const installedPath = resolveInstalledCodexCliPath()
  if (installedPath) {
    console.warn(
      `[codex] Bundled Codex CLI not found at ${binaryPath}; using installed CLI at ${installedPath}.`,
    )
    cachedCodexCliPath = installedPath
    didResolveCodexCliPath = true
    return installedPath
  }

  didResolveCodexCliPath = true

  const hint = app.isPackaged
    ? "Binary is missing from bundled resources."
    : "Run `bun run codex:download` to download it for local dev."

  throw new Error(
    `[codex] Bundled Codex CLI not found at ${binaryPath}. ${hint}`,
  )
}

function stripAnsi(input: string): string {
  return input.replace(ANSI_OSC_REGEX, "").replace(ANSI_ESCAPE_REGEX, "")
}

function isLocalhostHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase()
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "[::1]" ||
    normalized.endsWith(".localhost")
  )
}

function extractFirstNonLocalhostUrl(output: string): string | null {
  const matches = stripAnsi(output).match(URL_CANDIDATE_REGEX)
  if (!matches) return null

  for (const match of matches) {
    try {
      const parsedUrl = new URL(match.trim().replace(/[),.;!?]+$/, ""))
      if (!isLocalhostHostname(parsedUrl.hostname)) {
        return parsedUrl.toString()
      }
    } catch {
      // Ignore invalid URL candidates.
    }
  }

  return null
}

function appendLoginOutput(session: CodexLoginSession, chunk: string): void {
  const cleanChunk = stripAnsi(chunk)
  if (!cleanChunk) return

  session.output += cleanChunk

  if (!session.url) {
    session.url = extractFirstNonLocalhostUrl(session.output)
  }
}

function toLoginSessionResponse(session: CodexLoginSession) {
  return {
    sessionId: session.id,
    state: session.state,
    url: session.url,
    output: session.output,
    error: session.error,
    exitCode: session.exitCode,
  }
}

function getActiveLoginSession(): CodexLoginSession | null {
  for (const session of loginSessions.values()) {
    if (session.state === "running" && session.process && !session.process.killed) {
      return session
    }
  }

  return null
}

function extractCodexError(error: unknown): { message: string; code?: string } {
  const anyError = error as any
  const message =
    anyError?.data?.message ||
    anyError?.errorText ||
    anyError?.message ||
    anyError?.error ||
    String(error)
  const code = anyError?.data?.code || anyError?.code

  return {
    message: typeof message === "string" ? message : String(message),
    code: typeof code === "string" ? code : undefined,
  }
}

function isCodexAuthError(params: {
  message?: string | null
  code?: string | null
}): boolean {
  const searchableText = `${params.code || ""} ${params.message || ""}`.toLowerCase()
  return AUTH_HINTS.some((hint) => searchableText.includes(hint))
}

type RunCodexCliOptions = {
  cwd?: string
}

async function runCodexCli(
  args: string[],
  options?: RunCodexCliOptions,
): Promise<{
  stdout: string
  stderr: string
  exitCode: number | null
}> {
  const codexCliPath = resolveBundledCodexCliPath()
  const cwd = options?.cwd?.trim()

  return await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(codexCliPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: cwd && cwd.length > 0 ? cwd : undefined,
      env: buildCodexBaseEnv(),
      windowsHide: true,
    })

    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8")
    })

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8")
    })

    child.once("error", (error) => {
      rejectPromise(
        new Error(
          `[codex] Failed to execute \`codex ${args.join(" ")}\`: ${error.message}`,
        ),
      )
    })

    child.once("close", (exitCode) => {
      resolvePromise({
        stdout: stripAnsi(stdout),
        stderr: stripAnsi(stderr),
        exitCode,
      })
    })
  })
}

async function runCodexCliChecked(
  args: string[],
  options?: RunCodexCliOptions,
): Promise<{
  stdout: string
  stderr: string
}> {
  const result = await runCodexCli(args, options)
  if (result.exitCode === 0) {
    return {
      stdout: result.stdout,
      stderr: result.stderr,
    }
  }

  const message =
    result.stderr.trim() ||
    result.stdout.trim() ||
    `Codex command failed with exit code ${result.exitCode ?? "unknown"}`
  throw new Error(message)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

function toNonNegativeInt(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined
  }
  return Math.trunc(value)
}

function toTimestampMs(value: unknown): number | undefined {
  if (typeof value !== "string") {
    return undefined
  }
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) {
    return undefined
  }
  return parsed
}

function resolveSessionsRoot(): string {
  const codexHome = buildCodexBaseEnv().CODEX_HOME?.trim()
  if (codexHome) {
    return join(codexHome, "sessions")
  }

  return join(homedir(), ".codex", "sessions")
}

async function findSessionFileById(sessionId: string): Promise<string | null> {
  const sessionsRoot = resolveSessionsRoot()
  const fileSuffix = `-${sessionId}.jsonl`
  const sortDesc = (values: string[]) =>
    values.sort((left, right) =>
      right.localeCompare(left, undefined, { numeric: true }),
    )
  const listNames = async (dirPath: string): Promise<string[]> => {
    try {
      return await readdir(dirPath, { encoding: "utf8" })
    } catch {
      return []
    }
  }
  const years = sortDesc(
    (await listNames(sessionsRoot)).filter((name) => /^\d{4}$/.test(name)),
  )

  for (const year of years) {
    const yearPath = join(sessionsRoot, year)
    const months = sortDesc(
      (await listNames(yearPath)).filter((name) => /^\d{2}$/.test(name)),
    )
    for (const month of months) {
      const monthPath = join(yearPath, month)
      const days = sortDesc(
        (await listNames(monthPath)).filter((name) => /^\d{2}$/.test(name)),
      )
      for (const day of days) {
        const dayPath = join(monthPath, day)
        const fileName = (await listNames(dayPath)).find((name) =>
          name.endsWith(fileSuffix),
        )
        if (fileName) {
          return join(dayPath, fileName)
        }
      }
    }
  }

  return null
}

async function readLatestTokenCountInfo(
  filePath: string,
  options?: { notBeforeTimestampMs?: number },
): Promise<CodexTokenCountInfo | null> {
  let rawContent = ""
  try {
    rawContent = await readFile(filePath, "utf8")
  } catch {
    return null
  }

  const lines = rawContent.split("\n")
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const rawLine = lines[index]?.trim()
    if (!rawLine) continue

    let parsedLine: any
    try {
      parsedLine = JSON.parse(rawLine)
    } catch {
      continue
    }

    if (
      parsedLine?.type !== "event_msg" ||
      parsedLine?.payload?.type !== "token_count"
    ) {
      continue
    }

    const eventTimestampMs = toTimestampMs(parsedLine?.timestamp)
    const notBeforeTimestampMs = options?.notBeforeTimestampMs
    if (
      notBeforeTimestampMs !== undefined &&
      (eventTimestampMs === undefined || eventTimestampMs < notBeforeTimestampMs)
    ) {
      continue
    }

    const rawInfo = parsedLine.payload?.info
    if (!rawInfo || typeof rawInfo !== "object") continue

    const rawTokenUsage = (rawInfo as any).last_token_usage
    let lastTokenUsage: CodexTokenUsage | undefined
    if (rawTokenUsage && typeof rawTokenUsage === "object") {
      const tokenUsage = rawTokenUsage as any
      const parsedTokenUsage: CodexTokenUsage = {
        input_tokens: toNonNegativeInt(tokenUsage.input_tokens),
        cached_input_tokens: toNonNegativeInt(tokenUsage.cached_input_tokens),
        output_tokens: toNonNegativeInt(tokenUsage.output_tokens),
        total_tokens: toNonNegativeInt(tokenUsage.total_tokens),
      }
      if (Object.values(parsedTokenUsage).some((tokenCount) => tokenCount !== undefined)) {
        lastTokenUsage = parsedTokenUsage
      }
    }

    const modelContextWindow = toNonNegativeInt(
      (rawInfo as any).model_context_window,
    )

    const info: CodexTokenCountInfo = {
      last_token_usage: lastTokenUsage,
      model_context_window: modelContextWindow,
    }
    if (!info.last_token_usage && info.model_context_window === undefined) continue

    return info
  }

  return null
}

function mapToUsageMetadata(info: CodexTokenCountInfo): CodexUsageMetadata | null {
  const perMessageUsage = info.last_token_usage

  if (!perMessageUsage && info.model_context_window === undefined) {
    return null
  }

  const inputTokens =
    perMessageUsage?.input_tokens !== undefined
      ? Math.max(
          0,
          perMessageUsage.input_tokens - (perMessageUsage.cached_input_tokens ?? 0),
        )
      : undefined
  const outputTokens = perMessageUsage?.output_tokens
  const totalTokens =
    perMessageUsage?.total_tokens ??
    (perMessageUsage?.input_tokens !== undefined || perMessageUsage?.output_tokens !== undefined
      ? (perMessageUsage?.input_tokens ?? 0) + (perMessageUsage?.output_tokens ?? 0)
      : undefined
    )

  const usageMetadata: CodexUsageMetadata = {}
  if (inputTokens !== undefined) usageMetadata.inputTokens = inputTokens
  if (outputTokens !== undefined) usageMetadata.outputTokens = outputTokens
  if (totalTokens !== undefined) usageMetadata.totalTokens = totalTokens
  if (info.model_context_window !== undefined) {
    usageMetadata.modelContextWindow = info.model_context_window
  }

  return Object.keys(usageMetadata).length > 0 ? usageMetadata : null
}

async function pollUsage(
  sessionId: string,
  options?: { notBeforeTimestampMs?: number },
): Promise<CodexUsageMetadata | null> {
  let sessionFilePath: string | null = null

  for (let attempt = 0; attempt < CODEX_USAGE_POLL_ATTEMPTS; attempt += 1) {
    if (!sessionFilePath) {
      sessionFilePath = await findSessionFileById(sessionId)
    }

    if (sessionFilePath) {
      const latestInfo = await readLatestTokenCountInfo(sessionFilePath, options)
      if (latestInfo) {
        const usageMetadata = mapToUsageMetadata(latestInfo)
        if (usageMetadata) {
          return usageMetadata
        }
      }
    }

    if (attempt < CODEX_USAGE_POLL_ATTEMPTS - 1) {
      await sleep(CODEX_USAGE_POLL_INTERVAL_MS)
    }
  }

  return null
}

function getCodexMcpAuthState(authStatus: string | null | undefined): {
  supportsAuth: boolean
  authenticated: boolean
  needsAuth: boolean
} {
  const normalized = (authStatus || "").trim().toLowerCase()

  // Exact CLI values from codex-rs/protocol/src/protocol.rs (McpAuthStatus):
  // unsupported | not_logged_in | bearer_token | o_auth
  switch (normalized) {
    case "":
    case "none":
    case "unsupported":
      return { supportsAuth: false, authenticated: false, needsAuth: false }
    case "not_logged_in":
      return { supportsAuth: true, authenticated: false, needsAuth: true }
    case "bearer_token":
    case "o_auth":
      return { supportsAuth: true, authenticated: true, needsAuth: false }
    default:
      // Unknown/forward-compatible value: don't force needs-auth.
      return { supportsAuth: true, authenticated: false, needsAuth: false }
  }
}

function objectToPairs(
  value: Record<string, string> | null | undefined,
): Array<{ name: string; value: string }> | undefined {
  if (!value) return undefined
  const pairs = Object.entries(value)
    .filter(([name, val]) => typeof name === "string" && typeof val === "string")
    .map(([name, val]) => ({ name, value: val }))

  return pairs.length > 0 ? pairs : undefined
}

function resolveCodexStdioEnv(
  transport: CodexMcpListEntry["transport"],
): Record<string, string> | undefined {
  const merged: Record<string, string> = {}

  if (transport.env) {
    for (const [name, value] of Object.entries(transport.env)) {
      if (typeof name === "string" && typeof value === "string") {
        merged[name] = value
      }
    }
  }

  if (Array.isArray(transport.env_vars)) {
    const inheritedEnv = buildCodexBaseEnv()
    for (const envName of transport.env_vars) {
      const value = inheritedEnv[envName]
      if (typeof value === "string" && value.length > 0 && !merged[envName]) {
        merged[envName] = value
      }
    }
  }

  return Object.keys(merged).length > 0 ? merged : undefined
}

function resolveCodexHttpHeaders(
  transport: CodexMcpListEntry["transport"],
): Record<string, string> | undefined {
  const merged: Record<string, string> = {}

  if (transport.http_headers) {
    for (const [name, value] of Object.entries(transport.http_headers)) {
      if (typeof name === "string" && typeof value === "string") {
        merged[name] = value
      }
    }
  }

  if (transport.env_http_headers) {
    const inheritedEnv = buildCodexBaseEnv()
    for (const [headerName, envName] of Object.entries(transport.env_http_headers)) {
      if (typeof headerName !== "string" || typeof envName !== "string") continue
      const value = inheritedEnv[envName]
      if (typeof value === "string" && value.length > 0) {
        merged[headerName] = value
      }
    }
  }

  const bearerEnvVar = transport.bearer_token_env_var?.trim()
  if (bearerEnvVar && !merged.Authorization) {
    const token = buildCodexBaseEnv()[bearerEnvVar]?.trim()
    if (token) {
      merged.Authorization = `Bearer ${token}`
    }
  }

  return Object.keys(merged).length > 0 ? merged : undefined
}

function normalizeCodexTools(tools: McpToolInfo[]): McpToolInfo[] {
  const unique = new Map<string, McpToolInfo>()
  for (const tool of tools) {
    if (typeof tool?.name === "string" && tool.name.trim()) {
      const name = tool.name.trim()
      unique.set(name, {
        name,
        ...(tool.description ? { description: tool.description } : {}),
      })
    }
  }
  return [...unique.values()]
}

async function fetchCodexMcpTools(entry: CodexMcpListEntry): Promise<McpToolInfo[]> {
  const transportType = entry.transport.type.trim().toLowerCase()
  const timeoutPromise = new Promise<McpToolInfo[]>((_, reject) =>
    setTimeout(() => reject(new Error("Timeout")), CODEX_MCP_TOOLS_FETCH_TIMEOUT_MS),
  )

  const fetchPromise = (async (): Promise<McpToolInfo[]> => {
    if (transportType === "stdio") {
      const command = entry.transport.command?.trim()
      if (!command) return []
      return await fetchMcpToolsStdio({
        command,
        args: entry.transport.args || undefined,
        env: resolveCodexStdioEnv(entry.transport),
      })
    }

    if (
      transportType === "streamable_http" ||
      transportType === "http" ||
      transportType === "sse"
    ) {
      const url = entry.transport.url?.trim()
      if (!url) return []
      return await fetchMcpTools(url, resolveCodexHttpHeaders(entry.transport))
    }

    return []
  })()

  try {
    const tools = await Promise.race([fetchPromise, timeoutPromise])
    return normalizeCodexTools(tools)
  } catch {
    return []
  }
}

function resolveCodexLookupPath(pathCandidate: string | null | undefined): string {
  return pathCandidate && pathCandidate.trim() ? pathCandidate.trim() : "__global__"
}

function getCodexMcpFingerprint(servers: CodexMcpServerForSession[]): string {
  return createHash("sha256").update(JSON.stringify(servers)).digest("hex")
}

async function resolveCodexMcpSnapshot(params: {
  lookupPath?: string | null
  forceRefresh?: boolean
  includeTools?: boolean
}): Promise<CodexMcpSnapshot> {
  const lookupPath = resolveCodexLookupPath(params.lookupPath)
  const cached = codexMcpCache.get(lookupPath)
  const shouldIncludeTools = Boolean(params.includeTools)
  if (
    cached &&
    !params.forceRefresh &&
    (!shouldIncludeTools || cached.toolsResolved)
  ) {
    return cached
  }

  const result = await runCodexCliChecked(["mcp", "list", "--json"], {
    cwd: lookupPath === "__global__" ? undefined : lookupPath,
  })

  let parsed: unknown
  try {
    parsed = JSON.parse(result.stdout)
  } catch {
    throw new Error("Failed to parse Codex MCP list JSON output.")
  }

  const entries = z.array(codexMcpListEntrySchema).parse(parsed)
  const mcpServersForSession: CodexMcpServerForSession[] = []
  const mcpServersForSettings: CodexMcpServerForSettings[] = []

  const convertedEntries = await Promise.all(
    entries.map(async (entry) => {
      const transportType = entry.transport.type.trim().toLowerCase()
      const authState = getCodexMcpAuthState(entry.auth_status)
      const includeInSession = entry.enabled
      const resolvedStdioEnv = resolveCodexStdioEnv(entry.transport)
      const resolvedHttpHeaders = resolveCodexHttpHeaders(entry.transport)
      let status: CodexMcpServerForSettings["status"] = !entry.enabled
        ? "failed"
        : authState.needsAuth
          ? "needs-auth"
          : "connected"

      const settingsConfig: Record<string, unknown> = {
        transportType: entry.transport.type,
        authStatus: entry.auth_status ?? "unknown",
        enabled: entry.enabled,
        disabledReason: entry.disabled_reason ?? undefined,
      }

      let sessionServer: CodexMcpServerForSession | null = null
      if (transportType === "stdio") {
        const command = entry.transport.command || undefined
        const args = entry.transport.args || undefined
        if (includeInSession && command) {
          const envPairs = objectToPairs(resolvedStdioEnv) || []
          sessionServer = {
            name: entry.name,
            type: "stdio",
            command,
            args: Array.isArray(args) ? args : [],
            env: envPairs,
          }
        }

        settingsConfig.command = command
        settingsConfig.args = args
        settingsConfig.env = entry.transport.env || undefined
        settingsConfig.envVars = entry.transport.env_vars || undefined
      } else if (
        transportType === "streamable_http" ||
        transportType === "http" ||
        transportType === "sse"
      ) {
        const url = entry.transport.url || undefined
        const headers = objectToPairs(resolvedHttpHeaders)
        if (includeInSession && url) {
          sessionServer = {
            name: entry.name,
            type: "http",
            url,
            headers: headers || [],
          }
        }

        settingsConfig.url = url
        settingsConfig.headers = entry.transport.http_headers || undefined
        settingsConfig.envHttpHeaders = entry.transport.env_http_headers || undefined
        settingsConfig.bearerTokenEnvVar =
          entry.transport.bearer_token_env_var || undefined
      }

      const shouldProbeTools =
        shouldIncludeTools &&
        includeInSession &&
        !authState.needsAuth &&
        (
          // Probe unauthenticated/public servers and stdio servers.
          !authState.supportsAuth ||
          transportType === "stdio" ||
          // For auth-capable HTTP, only probe if explicit auth header is available.
          Boolean(resolvedHttpHeaders?.Authorization)
        )
      const tools = shouldProbeTools ? await fetchCodexMcpTools(entry) : []
      if (shouldProbeTools && tools.length === 0) {
        status = "failed"
      }

      return {
        sessionServer,
        settingsServer: {
          name: entry.name,
          status,
          tools,
          needsAuth: authState.needsAuth,
          config: settingsConfig,
        } satisfies CodexMcpServerForSettings,
      }
    }),
  )

  for (const converted of convertedEntries) {
    if (converted.sessionServer) {
      mcpServersForSession.push(converted.sessionServer)
    }
    mcpServersForSettings.push(converted.settingsServer)
  }

  const snapshot: CodexMcpSnapshot = {
    mcpServersForSession,
    groups: [
      {
        groupName: "Global",
        projectPath: null,
        mcpServers: mcpServersForSettings,
      },
    ],
    fingerprint: getCodexMcpFingerprint(mcpServersForSession),
    fetchedAt: Date.now(),
    toolsResolved: shouldIncludeTools,
  }

  codexMcpCache.set(lookupPath, snapshot)
  return snapshot
}

function clearCodexMcpCache(): void {
  codexMcpCache.clear()
}

function getCodexServerIdentity(
  server: CodexMcpServerForSettings,
): string {
  const config = server.config as Record<string, unknown>
  return JSON.stringify({
    enabled: config.enabled ?? null,
    disabledReason: config.disabledReason ?? null,
    transportType: config.transportType ?? null,
    command: config.command ?? null,
    args: config.args ?? null,
    env: config.env ?? null,
    envVars: config.envVars ?? null,
    url: config.url ?? null,
    headers: config.headers ?? null,
    envHttpHeaders: config.envHttpHeaders ?? null,
    bearerTokenEnvVar: config.bearerTokenEnvVar ?? null,
    authStatus: config.authStatus ?? null,
  })
}

export async function getAllCodexMcpConfigHandler() {
  const globalSnapshot = await resolveCodexMcpSnapshot({ includeTools: true })
  const globalServers = globalSnapshot.groups[0]?.mcpServers || []
  const globalByName = new Map(
    globalServers.map((server) => [server.name, getCodexServerIdentity(server)]),
  )

  const groups: CodexMcpSnapshot["groups"] = [...globalSnapshot.groups]

  // Only enumerate projects the app knows about (DB-backed projects).
  // Do not scan ~/.codex/config.toml project entries.
  const projectPathSet = new Set<string>()

  try {
    const db = getDatabase()
    const dbProjects = db.select({ path: projectsTable.path }).from(projectsTable).all()
    for (const project of dbProjects) {
      if (typeof project.path === "string" && project.path.trim().length > 0) {
        projectPathSet.add(project.path)
      }
    }
  } catch (error) {
    console.error("[codex.getAllMcpConfig] Failed to read projects from DB:", error)
  }

  const projectPaths = [...projectPathSet].sort((a, b) => a.localeCompare(b))
  const projectResults = await Promise.allSettled(
    projectPaths.map(async (projectPath) => {
      const projectSnapshot = await resolveCodexMcpSnapshot({
        lookupPath: projectPath,
        includeTools: true,
      })
      const effectiveServers = projectSnapshot.groups[0]?.mcpServers || []
      const projectOnlyServers = effectiveServers.filter((server) => {
        const globalIdentity = globalByName.get(server.name)
        if (!globalIdentity) return true
        return globalIdentity !== getCodexServerIdentity(server)
      })

      if (projectOnlyServers.length === 0) {
        return null
      }

      return {
        groupName: basename(projectPath) || projectPath,
        projectPath,
        mcpServers: projectOnlyServers,
      }
    }),
  )

  for (const result of projectResults) {
    if (result.status === "fulfilled" && result.value) {
      groups.push(result.value)
      continue
    }
    if (result.status === "rejected") {
      console.error("[codex.getAllMcpConfig] Failed to resolve project MCP snapshot:", result.reason)
    }
  }

  return { groups }
}

function normalizeCodexIntegrationState(rawOutput: string): CodexIntegrationState {
  const normalizedOutput = rawOutput.toLowerCase()

  if (normalizedOutput.includes("logged in using chatgpt")) {
    return "connected_chatgpt"
  }

  if (
    normalizedOutput.includes("logged in using an api key") ||
    normalizedOutput.includes("logged in using api key")
  ) {
    return "connected_api_key"
  }

  if (normalizedOutput.includes("not logged in")) {
    return "not_logged_in"
  }

  return "unknown"
}

function parseStoredMessages(raw: string | null | undefined): any[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function extractPromptFromStoredMessage(message: any): string {
  if (!message || !Array.isArray(message.parts)) return ""

  const textParts: string[] = []
  const fileContents: string[] = []

  for (const part of message.parts) {
    if (part?.type === "text" && typeof part.text === "string") {
      textParts.push(part.text)
    } else if (part?.type === "file-content") {
      const filePath =
        typeof part.filePath === "string" ? part.filePath : undefined
      const fileName = filePath?.split("/").pop() || filePath || "file"
      const content = typeof part.content === "string" ? part.content : ""
      fileContents.push(`\n--- ${fileName} ---\n${content}`)
    }
  }

  return textParts.join("\n") + fileContents.join("")
}

function textFromStoredMessage(message: any): string {
  if (!message || !Array.isArray(message.parts)) return ""
  if (message.role === "user") return extractPromptFromStoredMessage(message)

  const textParts: string[] = []
  const toolParts: string[] = []

  for (const part of message.parts) {
    if (part?.type === "text" && typeof part.text === "string") {
      textParts.push(part.text)
      continue
    }
    if (typeof part?.type === "string" && part.type.startsWith("tool-")) {
      const toolName = part.toolName || part.type.replace(/^tool-/, "")
      const detail =
        part.input?.file_path ||
        part.input?.path ||
        part.input?.command ||
        part.input?.cmd
      toolParts.push(detail ? `[Used ${toolName}: ${detail}]` : `[Used ${toolName}]`)
    }
  }

  return [...textParts, ...toolParts].join("\n").trim()
}

function buildLocalHistoryContext(messages: any[], currentPrompt: string): string {
  const withoutCurrent = [...messages]
  const last = withoutCurrent[withoutCurrent.length - 1]
  if (
    last?.role === "user" &&
    textFromStoredMessage(last).trim() === currentPrompt.trim()
  ) {
    withoutCurrent.pop()
  }

  const rows = withoutCurrent
    .slice(-16)
    .map((message) => {
      const text = textFromStoredMessage(message)
      if (!text) return null
      const role = message.role === "assistant" ? "Assistant" : "User"
      return `${role}: ${text}`
    })
    .filter((row): row is string => !!row)

  if (rows.length === 0) return ""

  let body = rows.join("\n\n")
  if (body.length > 12000) {
    body = `...(earlier inherited messages truncated)...\n\n${body.slice(-12000)}`
  }

  return `[INHERITED LANI CODEX THREAD CONTEXT]
This thread was restored without a Codex session to resume. Use this local transcript as context, but treat the current request as authoritative.

${body}
[/INHERITED LANI CODEX THREAD CONTEXT]

`
}

function getLastSessionId(messages: any[]): string | undefined {
  const lastAssistant = [...messages].reverse().find((message) => message?.role === "assistant")
  const sessionId = lastAssistant?.metadata?.sessionId
  return typeof sessionId === "string" ? sessionId : undefined
}

function extractCodexModelId(rawModel: unknown): string | undefined {
  if (typeof rawModel !== "string" || rawModel.length === 0) {
    return undefined
  }

  const normalizedModel = rawModel.trim()

  if (!normalizedModel || normalizedModel === "codex") {
    return undefined
  }

  return normalizedModel
}

function preprocessCodexModelName(params: {
  modelId: string
  authConfig?: { apiKey: string }
}): string {
  const hasAppManagedApiKey = Boolean(params.authConfig?.apiKey?.trim())
  if (!hasAppManagedApiKey) {
    return params.modelId
  }

  // All model IDs now match the real API; pass through as-is
  return params.modelId
}

function getAuthFingerprint(authConfig?: { apiKey: string }): string | null {
  const apiKey = authConfig?.apiKey?.trim()
  if (!apiKey) return null
  return createHash("sha256").update(apiKey).digest("hex")
}

function buildCodexProviderEnv(authConfig?: { apiKey: string }): Record<string, string> {
  const env = buildCodexBaseEnv()
  const apiKey = authConfig?.apiKey?.trim()
  if (apiKey) {
    env.CODEX_API_KEY = apiKey
  }

  return env
}

function getCodexAppServerIdentity(params: {
  binaryPath: string
  env: Record<string, string>
  authFingerprint: string | null
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        binaryPath: params.binaryPath,
        codexHome: params.env.CODEX_HOME || null,
        authFingerprint: params.authFingerprint,
      }),
    )
    .digest("hex")
}

async function getOrCreateCodexAppServerRuntime(params: {
  authConfig?: { apiKey: string }
}): Promise<CodexAppServerRuntime> {
  ensureCodexAppQuitHook()

  const binaryPath = resolveCodexAppServerBinaryPath()
  const env = buildCodexProviderEnv(params.authConfig)
  const authFingerprint = getAuthFingerprint(params.authConfig)
  const identity = getCodexAppServerIdentity({
    binaryPath,
    env,
    authFingerprint,
  })

  if (appServerRuntime?.identity === identity) {
    return appServerRuntime
  }

  disposeCodexAppServerRuntime()

  const client = new CodexAppServerClient({
    command: binaryPath,
    args: ["app-server"],
    env,
    onRequest: handleCodexAppServerRequest,
  })

  const runtime: CodexAppServerRuntime = {
    identity,
    client,
    account: null,
    models: [],
    initializedAt: Date.now(),
  }

  client.onClose(() => {
    if (appServerRuntime?.client === client) {
      appServerRuntime = null
      appServerThreads.clear()
    }
  })

  await client.request("initialize", {
    clientInfo: {
      name: "lani",
      title: "Lani",
      version: app.getVersion(),
    },
    capabilities: {
      experimentalApi: true,
      optOutNotificationMethods: null,
    },
  })
  client.notify("initialized")

  runtime.account = await client
    .request("account/read", { refreshToken: false }, 30_000)
    .catch((error) => {
      console.warn("[codex] account/read failed:", error)
      return null
    })

  const modelResponse: any = await client
    .request("model/list", { includeHidden: true }, 30_000)
    .catch((error) => {
      console.warn("[codex] model/list failed:", error)
      return null
    })
  runtime.models = Array.isArray(modelResponse?.data) ? modelResponse.data : []

  appServerRuntime = runtime
  return runtime
}

function getCodexAppServerAccountState(accountResponse: any): CodexIntegrationState {
  const account = accountResponse?.account
  if (account?.type === "chatgpt") return "connected_chatgpt"
  if (account?.type === "apiKey") return "connected_api_key"
  if (accountResponse?.requiresOpenaiAuth === true) return "not_logged_in"
  return "unknown"
}

function splitCodexModelSelection(rawModel: string): {
  model: string
  effort?: string
} {
  const [model, effort] = rawModel.split("/")
  const normalizedModel = model?.trim() || DEFAULT_CODEX_MODEL.split("/")[0]
  const normalizedEffort = effort?.trim()
  if (
    normalizedEffort &&
    ["minimal", "low", "medium", "high", "xhigh"].includes(normalizedEffort)
  ) {
    return { model: normalizedModel, effort: normalizedEffort }
  }
  return { model: normalizedModel }
}

function getCodexSandboxForMode(mode: "plan" | "agent"): {
  threadSandbox: string
  turnSandboxPolicy: any
} {
  if (mode === "plan") {
    return {
      threadSandbox: "read-only",
      turnSandboxPolicy: { type: "readOnly", networkAccess: true },
    }
  }

  return {
    threadSandbox: "danger-full-access",
    turnSandboxPolicy: { type: "dangerFullAccess" },
  }
}

function codexMcpServersToConfig(
  servers: CodexMcpServerForSession[],
): Record<string, any> {
  const config: Record<string, any> = {}
  for (const server of servers) {
    if (server.type === "stdio") {
      config[server.name] = {
        command: server.command,
        args: server.args,
        env: Object.fromEntries(server.env.map((entry) => [entry.name, entry.value])),
      }
    } else {
      config[server.name] = {
        url: server.url,
        http_headers: Object.fromEntries(
          server.headers.map((entry) => [entry.name, entry.value]),
        ),
      }
    }
  }
  return config
}

async function resolveCodexLaniSkills(skillMentions: string[]): Promise<{
  allSkillNames: string[]
  enabledSkillNames: string[]
  mentionedInputs: Array<{ type: "skill"; name: string; path: string }>
  disabledSkillConfig: Array<{ path: string; enabled: false }>
  fingerprint: string
}> {
  await ensureLaniPlugin()
  const skills = await listLaniSkills()
  const byName = new Map<string, (typeof skills)[number]>()
  for (const skill of skills) {
    byName.set(skill.slug.toLowerCase(), skill)
    byName.set(skill.name.toLowerCase(), skill)
    byName.set(`${LANI_PLUGIN_NAME}:${skill.slug}`.toLowerCase(), skill)
    byName.set(`lani:${skill.name}`.toLowerCase(), skill)
  }

  const mentionedInputs: Array<{ type: "skill"; name: string; path: string }> = []
  for (const mention of skillMentions) {
    const skill = byName.get(mention.trim().toLowerCase())
    if (!skill || !skill.enabled) continue
    mentionedInputs.push({
      type: "skill",
      name: skill.name || skill.slug,
      path: join(skill.dir, "SKILL.md"),
    })
  }

  const disabledSkillConfig = skills
    .filter((skill) => !skill.enabled)
    .map((skill) => ({
      path: join(skill.dir, "SKILL.md"),
      enabled: false as const,
    }))

  return {
    allSkillNames: skills.map((skill) => skill.name || skill.slug),
    enabledSkillNames: skills
      .filter((skill) => skill.enabled)
      .map((skill) => skill.name || skill.slug),
    mentionedInputs,
    disabledSkillConfig,
    fingerprint: createHash("sha256")
      .update(
        JSON.stringify(
          skills.map((skill) => ({
            slug: skill.slug,
            name: skill.name,
            enabled: skill.enabled,
            dir: skill.dir,
          })),
        ),
      )
      .digest("hex"),
  }
}

function buildCodexAppServerConfig(params: {
  mcpServers: CodexMcpServerForSession[]
  disabledSkills: Array<{ path: string; enabled: false }>
  agents: Record<string, unknown>
}): Record<string, unknown> {
  const config: Record<string, unknown> = {
    mcp_servers: codexMcpServersToConfig(params.mcpServers),
    features: {
      plugins: true,
    },
    marketplaces: {
      lani: {
        source_type: "local",
        source: getLaniPluginPath(),
      },
    },
    plugins: {
      [getLaniCodexPluginKey()]: {
        enabled: true,
      },
    },
    skills: {
      include_instructions: true,
      config: params.disabledSkills,
    },
  }
  if (Object.keys(params.agents).length > 0) {
    config.agents = params.agents
  }
  return config
}

function getCodexAuthMethodId(
  authConfig?: { apiKey: string },
  env: Record<string, string> = buildCodexBaseEnv(),
): "chatgpt" | "codex-api-key" | "openai-api-key" {
  if (authConfig?.apiKey?.trim() || env.CODEX_API_KEY?.trim()) {
    return "codex-api-key"
  }

  if (env.OPENAI_API_KEY?.trim()) {
    return "openai-api-key"
  }

  // codex-acp advertises auth methods:
  // - chatgpt
  // - codex-api-key
  // - openai-api-key
  // Default subscription auth should be explicit too, otherwise the provider
  // logs a lazy-auth warning before choosing the same method.
  return "chatgpt"
}

function buildUserParts(
  prompt: string,
  images:
    | Array<{
        base64Data?: string
        mediaType?: string
        filename?: string
      }>
    | undefined,
): any[] {
  const parts: any[] = [{ type: "text", text: prompt }]

  if (images && images.length > 0) {
    for (const image of images) {
      if (!image.base64Data || !image.mediaType) continue
      parts.push({
        type: "data-image",
        data: {
          base64Data: image.base64Data,
          mediaType: image.mediaType,
          filename: image.filename,
        },
      })
    }
  }

  return parts
}

function buildModelMessageContent(
  prompt: string,
  images:
    | Array<{
        base64Data?: string
        mediaType?: string
        filename?: string
      }>
    | undefined,
): any[] {
  const content: any[] = [{ type: "text", text: prompt }]

  if (images && images.length > 0) {
    for (const image of images) {
      if (!image.base64Data || !image.mediaType) continue
      content.push({
        type: "file",
        mediaType: image.mediaType,
        data: image.base64Data,
        ...(image.filename ? { filename: image.filename } : {}),
      })
    }
  }

  return content
}

function getItemToolName(item: any): string {
  if (item?.type === "collabAgentToolCall") return "Task"
  if (item?.type === "commandExecution") return "Bash"
  if (item?.type === "fileChange") return "Edit"
  if (item?.type === "mcpToolCall") {
    const server = String(item.server || "mcp").replaceAll("-", "_")
    const tool = String(item.tool || "tool").replaceAll("-", "_")
    return `mcp__${server}__${tool}`
  }
  if (item?.type === "dynamicToolCall") return String(item.tool || "Tool")
  return String(item?.type || "Codex")
}

function getItemToolInput(item: any): unknown {
  if (item?.type === "collabAgentToolCall") {
    return {
      subagent_type: item.tool || "codex-subagent",
      description:
        item.prompt ||
        `${item.tool || "Codex subagent"}${item.model ? ` (${item.model})` : ""}`,
      model: item.model,
      reasoning_effort: item.reasoningEffort,
      receiver_thread_ids: item.receiverThreadIds || [],
    }
  }
  if (item?.type === "commandExecution") {
    return {
      command: item.command,
      cwd: item.cwd,
    }
  }
  if (item?.type === "fileChange") {
    return {
      changes: item.changes || [],
      status: item.status,
    }
  }
  if (item?.type === "mcpToolCall") {
    return item.arguments || {}
  }
  if (item?.type === "dynamicToolCall") {
    return item.arguments || {}
  }
  return item || {}
}

function getItemToolOutput(item: any, accumulatedOutput?: string): unknown {
  if (item?.type === "collabAgentToolCall") {
    return {
      status: item.status,
      agentsStates: item.agentsStates || {},
      receiverThreadIds: item.receiverThreadIds || [],
    }
  }
  if (item?.type === "commandExecution") {
    return {
      output: item.aggregatedOutput ?? accumulatedOutput ?? "",
      exitCode: item.exitCode ?? null,
      status: item.status,
      durationMs: item.durationMs ?? null,
    }
  }
  if (item?.type === "fileChange") {
    return {
      changes: item.changes || [],
      status: item.status,
    }
  }
  if (item?.type === "mcpToolCall") {
    return item.error || item.result || { status: item.status }
  }
  if (item?.type === "dynamicToolCall") {
    return item.contentItems || { success: item.success, status: item.status }
  }
  return item
}

class CodexAppServerMessageAccumulator {
  private readonly messageId = randomUUID()
  private readonly textId = `text-${randomUUID()}`
  private readonly startedToolIds = new Set<string>()
  private readonly toolOutputs = new Map<string, string>()
  private readonly toolParts = new Map<string, any>()
  private readonly reasoningByItem = new Map<string, string>()
  private text = ""
  private started = false
  private textStarted = false

  constructor(private readonly emitChunk: (chunk: any) => void) {}

  handleNotification(notification: CodexAppServerIncomingNotification): void {
    const params = notification.params as any
    switch (notification.method) {
      case "item/agentMessage/delta":
        this.appendText(String(params?.delta || ""))
        return
      case "item/reasoning/textDelta":
      case "item/reasoning/summaryTextDelta":
        this.appendReasoning(
          String(params?.itemId || "reasoning"),
          String(params?.delta || ""),
        )
        return
      case "item/commandExecution/outputDelta":
      case "item/fileChange/outputDelta":
        this.appendToolOutput(
          String(params?.itemId || ""),
          String(params?.delta || ""),
        )
        return
      case "item/started":
        this.startItem(params?.item)
        return
      case "item/completed":
        this.completeItem(params?.item)
        return
      case "turn/plan/updated":
        if (typeof params?.explanation === "string" && params.explanation) {
          this.appendReasoning("plan", params.explanation)
        }
        return
      case "error":
        this.emitChunk({
          type: "error",
          errorText:
            params?.error?.message ||
            params?.error?.details ||
            "Codex turn failed",
        })
        return
    }
  }

  finishMetadata(params: {
    metadataModel: string
    threadId: string
    sessionId?: string | null
    turnId?: string | null
    startedAt: number
    resultSubtype: string
    rollbackCheckpointId?: string
    threadConfigFingerprint: string
    usageMetadata?: CodexUsageMetadata | null
  }): any {
    return {
      model: params.metadataModel,
      sessionId: params.threadId,
      threadId: params.threadId,
      appServerSessionId: params.sessionId || undefined,
      providerTurnId: params.turnId || undefined,
      threadConfigFingerprint: params.threadConfigFingerprint,
      durationMs: Date.now() - params.startedAt,
      resultSubtype: params.resultSubtype,
      ...(params.rollbackCheckpointId
        ? { rollbackCheckpointId: params.rollbackCheckpointId }
        : {}),
      ...(params.usageMetadata || {}),
    }
  }

  closeOpenParts(): void {
    if (this.textStarted) {
      this.emitChunk({ type: "text-end", id: this.textId })
      this.textStarted = false
    }
    if (this.started) {
      this.emitChunk({ type: "finish-step" })
    }
  }

  toAssistantMessage(metadata: any): any | null {
    const parts: any[] = []
    if (this.text.trim().length > 0) {
      parts.push({ type: "text", text: this.text })
    }

    for (const [itemId, text] of this.reasoningByItem) {
      if (!text.trim()) continue
      parts.push({
        type: "reasoning",
        id: itemId,
        text,
      })
    }

    for (const part of this.toolParts.values()) {
      parts.push(part)
    }

    if (parts.length === 0) {
      return null
    }

    return normalizeCodexAssistantMessage(
      {
        id: this.messageId,
        role: "assistant",
        parts,
        metadata,
      },
      { normalizeState: true },
    )
  }

  private ensureStarted(): void {
    if (this.started) return
    this.started = true
    this.emitChunk({ type: "start", messageId: this.messageId })
    this.emitChunk({ type: "start-step" })
  }

  private ensureTextStarted(): void {
    this.ensureStarted()
    if (this.textStarted) return
    this.textStarted = true
    this.emitChunk({ type: "text-start", id: this.textId })
  }

  private appendText(delta: string): void {
    if (!delta) return
    this.ensureTextStarted()
    this.text += delta
    this.emitChunk({ type: "text-delta", id: this.textId, delta })
  }

  private appendReasoning(itemId: string, delta: string): void {
    if (!delta) return
    this.ensureStarted()
    const previous = this.reasoningByItem.get(itemId) || ""
    this.reasoningByItem.set(itemId, previous + delta)
    this.emitChunk({ type: "reasoning-delta", id: itemId, delta })
  }

  private appendToolOutput(itemId: string, delta: string): void {
    if (!itemId || !delta) return
    const previous = this.toolOutputs.get(itemId) || ""
    this.toolOutputs.set(itemId, previous + delta)
  }

  private startItem(item: any): void {
    if (!item?.id) return
    if (
      item.type !== "commandExecution" &&
      item.type !== "fileChange" &&
      item.type !== "mcpToolCall" &&
      item.type !== "dynamicToolCall" &&
      item.type !== "collabAgentToolCall"
    ) {
      return
    }
    if (this.startedToolIds.has(item.id)) return
    this.ensureStarted()
    this.startedToolIds.add(item.id)
    this.toolParts.set(item.id, {
      type: `tool-${getItemToolName(item)}`,
      toolCallId: item.id,
      state: "input-available",
      input: getItemToolInput(item),
    })
    this.emitChunk({
      type: "tool-input-available",
      toolCallId: item.id,
      toolName: getItemToolName(item),
      input: getItemToolInput(item),
    })
  }

  private completeItem(item: any): void {
    if (!item?.id) return

    if (item.type === "agentMessage" && typeof item.text === "string") {
      if (!this.text && item.text) {
        this.appendText(item.text)
      }
      return
    }

    if (
      item.type !== "commandExecution" &&
      item.type !== "fileChange" &&
      item.type !== "mcpToolCall" &&
      item.type !== "dynamicToolCall" &&
      item.type !== "collabAgentToolCall"
    ) {
      return
    }

    this.startItem(item)
    const output = getItemToolOutput(
      item,
      this.toolOutputs.get(item.id) || undefined,
    )
    this.toolParts.set(item.id, {
      ...(this.toolParts.get(item.id) || {
        type: `tool-${getItemToolName(item)}`,
        toolCallId: item.id,
        input: getItemToolInput(item),
      }),
      state: item.error ? "output-error" : "output-available",
      ...(item.error ? { errorText: item.error?.message || JSON.stringify(item.error) } : { output }),
    })
    this.emitChunk({
      type: item.error ? "tool-output-error" : "tool-output-available",
      toolCallId: item.id,
      ...(item.error
        ? { errorText: item.error?.message || JSON.stringify(item.error) }
        : { output }),
    })
  }
}

function getOrCreateProvider(params: {
  subChatId: string
  cwd: string
  mcpServers: CodexMcpServerForSession[]
  mcpFingerprint: string
  configArgs?: string[]
  existingSessionId?: string
  authConfig?: {
    apiKey: string
  }
}): ACPProvider {
  const authFingerprint = getAuthFingerprint(params.authConfig)
  const existing = providerSessions.get(params.subChatId)

  if (
    existing &&
    existing.cwd === params.cwd &&
    existing.authFingerprint === authFingerprint &&
    existing.mcpFingerprint === params.mcpFingerprint
  ) {
    return existing.provider
  }

  if (existing) {
    existing.provider.cleanup()
    providerSessions.delete(params.subChatId)
  }

  const providerEnv = buildCodexProviderEnv(params.authConfig)
  const usesKeyAuth =
    Boolean(params.authConfig?.apiKey?.trim()) ||
    Boolean(providerEnv.CODEX_API_KEY?.trim()) ||
    Boolean(providerEnv.OPENAI_API_KEY?.trim())
  // When key auth is used, avoid resuming older persisted session IDs.
  // Those can be tied to unauthenticated/CLI-auth state and trigger auth loops.
  const existingSessionIdForProvider = usesKeyAuth
    ? undefined
    : params.existingSessionId

  const provider = createACPProvider({
    command: resolveCodexAcpBinaryPath(),
    ...(params.configArgs && params.configArgs.length > 0
      ? { args: params.configArgs }
      : {}),
    env: providerEnv,
    authMethodId: getCodexAuthMethodId(params.authConfig, providerEnv),
    session: {
      cwd: params.cwd,
      mcpServers: params.mcpServers,
    },
    ...(existingSessionIdForProvider
      ? { existingSessionId: existingSessionIdForProvider }
      : {}),
    persistSession: true,
  })

  providerSessions.set(params.subChatId, {
    provider,
    cwd: params.cwd,
    authFingerprint,
    mcpFingerprint: params.mcpFingerprint,
  })

  return provider
}

export function cleanupCodexProviderSession(subChatId: string): void {
  appServerThreads.delete(subChatId)
  const activeAppServerTurn = activeAppServerTurns.get(subChatId)
  if (activeAppServerTurn) {
    activeAppServerTurn.controller.abort()
    void activeAppServerTurn.interrupt?.().catch(() => {
      // No-op.
    })
    void activeAppServerTurn.flushPartial?.().catch(() => {
      // No-op.
    })
    activeAppServerTurns.delete(subChatId)
  }

  const existing = providerSessions.get(subChatId)
  if (!existing) return

  existing.provider.cleanup()
  providerSessions.delete(subChatId)
}

function cleanupProvider(subChatId: string): void {
  cleanupCodexProviderSession(subChatId)
}

function mapAppServerUsage(tokenUsage: any): CodexUsageMetadata | null {
  const last = tokenUsage?.last
  if (!last || typeof last !== "object") return null

  const inputTokens =
    typeof last.inputTokens === "number"
      ? Math.max(0, last.inputTokens - (last.cachedInputTokens || 0))
      : undefined
  const outputTokens =
    typeof last.outputTokens === "number" ? last.outputTokens : undefined
  const totalTokens =
    typeof last.totalTokens === "number"
      ? last.totalTokens
      : inputTokens !== undefined || outputTokens !== undefined
        ? (inputTokens || 0) + (outputTokens || 0)
        : undefined
  const modelContextWindow =
    typeof tokenUsage?.modelContextWindow === "number"
      ? tokenUsage.modelContextWindow
      : undefined

  const usage: CodexUsageMetadata = {}
  if (inputTokens !== undefined) usage.inputTokens = inputTokens
  if (outputTokens !== undefined) usage.outputTokens = outputTokens
  if (totalTokens !== undefined) usage.totalTokens = totalTokens
  if (modelContextWindow !== undefined) usage.modelContextWindow = modelContextWindow

  return Object.keys(usage).length > 0 ? usage : null
}

function createCodexAppServerSubscription(input: any, emit: any) {
  const existingTurn = activeAppServerTurns.get(input.subChatId)
  if (existingTurn) {
    existingTurn.cancelRequested = true
    existingTurn.controller.abort()
    void existingTurn.interrupt?.().catch((error) => {
      console.warn("[codex] Failed to interrupt superseded app-server turn:", error)
    })
    void existingTurn.flushPartial?.().catch((error) => {
      console.warn("[codex] Failed to flush superseded app-server turn:", error)
    })
  }

  const abortController = new AbortController()
  activeAppServerTurns.set(input.subChatId, {
    runId: input.runId,
    controller: abortController,
    cancelRequested: false,
    mode: input.mode || "agent",
  })

  let isActive = true

  const safeEmit = (chunk: any) => {
    if (!isActive) return
    try {
      emit.next(chunk)
    } catch {
      isActive = false
    }
  }

  const safeComplete = () => {
    if (!isActive) return
    isActive = false
    try {
      emit.complete()
    } catch {
      // Ignore double completion.
    }
  }

  ;(async () => {
    let unsubscribeNotifications: (() => void) | null = null
    let accumulator: CodexAppServerMessageAccumulator | null = null
    let messagesForStream: any[] = []
    let persistSubChatMessages: ((messages: any[]) => boolean) | null = null
    let rollbackCheckpointId: string | undefined
    let threadId: string | null = null
    let sessionId: string | null = null
    let turnId: string | null = null
    let metadataModel = DEFAULT_CODEX_MODEL
    let selectedModelId = DEFAULT_CODEX_MODEL
    let threadConfigFingerprint = ""
    let startedAt = Date.now()
    let usageMetadata: CodexUsageMetadata | null = null
    let finished = false

    const flushPartial = async (resultSubtype = "cancelled") => {
      if (!accumulator || !persistSubChatMessages || !threadId) return
      accumulator.closeOpenParts()
      const metadata = accumulator.finishMetadata({
        metadataModel,
        threadId,
        sessionId,
        turnId,
        startedAt,
        resultSubtype,
        rollbackCheckpointId,
        threadConfigFingerprint,
        usageMetadata,
      })
      const assistantMessage = accumulator.toAssistantMessage(metadata)
      if (!assistantMessage) {
        persistSubChatMessages(messagesForStream)
        return
      }
      persistSubChatMessages([...messagesForStream, assistantMessage])
    }

    try {
      const db = getDatabase()
      const existingSubChat = db
        .select()
        .from(subChats)
        .where(eq(subChats.id, input.subChatId))
        .get()

      if (!existingSubChat) {
        throw new Error("Sub-chat not found")
      }

      const existingMessages = parseStoredMessages(existingSubChat.messages)
      const requestedModelId =
        extractCodexModelId(input.model) || DEFAULT_CODEX_MODEL
      const storedApiKey = loadStoredCodexApiKey()
      const effectiveAuthConfig =
        input.authConfig || (storedApiKey ? { apiKey: storedApiKey } : undefined)
      selectedModelId = preprocessCodexModelName({
        modelId: requestedModelId,
        authConfig: effectiveAuthConfig,
      })
      metadataModel = selectedModelId
      const modelSelection = splitCodexModelSelection(selectedModelId)
      const historyEnabled = input.historyEnabled === true
      rollbackCheckpointId = historyEnabled ? randomUUID() : undefined

      const lastMessage = existingMessages[existingMessages.length - 1]
      const isDuplicatePrompt =
        lastMessage?.role === "user" &&
        extractPromptFromStoredMessage(lastMessage) === input.prompt

      messagesForStream = existingMessages
      const isAuthoritativeRun = () => {
        const currentTurn = activeAppServerTurns.get(input.subChatId)
        return !currentTurn || currentTurn.runId === input.runId
      }

      persistSubChatMessages = (messages: any[]) => {
        if (!isAuthoritativeRun()) {
          return false
        }
        db.update(subChats)
          .set({
            messages: JSON.stringify(messages),
            updatedAt: new Date(),
          })
          .where(eq(subChats.id, input.subChatId))
          .run()
        return true
      }

      if (!isDuplicatePrompt) {
        const userMessage = {
          id: randomUUID(),
          role: "user",
          parts: buildUserParts(input.prompt, input.images),
          metadata: { model: metadataModel },
        }
        messagesForStream = [...existingMessages, userMessage]
        persistSubChatMessages(messagesForStream)
      }

      if (input.forceNewSession) {
        appServerThreads.delete(input.subChatId)
      }

      const parsedMentions = parseMentions(input.prompt)
      const [laniSkills, codexAgents] = await Promise.all([
        resolveCodexLaniSkills(parsedMentions.skillMentions),
        buildCodexAgentBridge({
          cwd: input.cwd,
          mentionedAgentNames: parsedMentions.agentMentions,
        }),
      ])

      let mcpSnapshot: CodexMcpSnapshot = {
        mcpServersForSession: [],
        groups: [],
        fingerprint: getCodexMcpFingerprint([]),
        fetchedAt: Date.now(),
        toolsResolved: false,
      }
      try {
        const resolvedProjectPathFromCwd = resolveProjectPathFromWorktree(input.cwd)
        const mcpLookupPath =
          input.projectPath || resolvedProjectPathFromCwd || input.cwd
        mcpSnapshot = await resolveCodexMcpSnapshot({
          lookupPath: mcpLookupPath,
        })
      } catch (mcpError) {
        console.error("[codex] Failed to resolve MCP servers:", mcpError)
      }

      const resolvedNames = new Set(
        mcpSnapshot.mcpServersForSession.map((server) => server.name),
      )
      const builtinCodexServers = getBuiltinCodexMcpServers({
        worktreeId: input.chatId,
        cwd: input.cwd,
        resolvedNames,
      })
      const sessionMcpServers = [
        ...builtinCodexServers,
        ...mcpSnapshot.mcpServersForSession,
      ]
      const appServerConfig = buildCodexAppServerConfig({
        mcpServers: sessionMcpServers,
        disabledSkills: laniSkills.disabledSkillConfig,
        agents: codexAgents.appServerConfig,
      })
      const laniHarnessBlock = buildLaniHarnessBlock()
      threadConfigFingerprint = createHash("sha256")
        .update(
          JSON.stringify({
            harness: laniHarnessBlock,
            mcp: getCodexMcpFingerprint(sessionMcpServers),
            skills: laniSkills.fingerprint,
            agents: codexAgents.fingerprint,
            config: appServerConfig,
          }),
        )
        .digest("hex")

      const runtime = await getOrCreateCodexAppServerRuntime({
        authConfig: effectiveAuthConfig,
      })
      const accountState = getCodexAppServerAccountState(runtime.account)
      if (accountState === "not_logged_in") {
        throw new Error("Codex authentication required. Run Codex login or add an API key.")
      }

      safeEmit({
        type: "session-init",
        runtime: "app-server",
        tools: sessionMcpServers.map((server) => server.name),
        mcpServers: sessionMcpServers.map((server) => ({
          name: server.name,
          status: "connected",
        })),
        plugins: [{ name: LANI_PLUGIN_NAME, path: getLaniPluginPath() }],
        skills: laniSkills.enabledSkillNames,
        agents: codexAgents.registeredNames,
        models: runtime.models,
        account: runtime.account,
      })

      const sandbox = getCodexSandboxForMode(input.mode || "agent")
      const existingThread = appServerThreads.get(input.subChatId)
      const canReuseThread =
        existingThread &&
        existingThread.cwd === input.cwd &&
        existingThread.authFingerprint === getAuthFingerprint(effectiveAuthConfig) &&
        existingThread.threadConfigFingerprint === threadConfigFingerprint &&
        (!input.sessionId || input.sessionId === existingThread.threadId)

      let promptForModel =
        parsedMentions.cleanedPrompt ||
        (parsedMentions.agentMentions.length > 0 ||
        parsedMentions.skillMentions.length > 0
          ? ""
          : input.prompt)
      const agentMentionInstruction = buildCodexAgentMentionInstruction({
        mentionedAgentNames: codexAgents.mentionedAgentNames,
        missingMentionedAgentNames: codexAgents.missingMentionedAgentNames,
      })
      if (agentMentionInstruction) {
        promptForModel = `${agentMentionInstruction}\n\n${
          promptForModel || "Run the requested Lani agent delegation."
        }`
      }
      if (!canReuseThread && existingMessages.length > 0) {
        const localHistoryContext = buildLocalHistoryContext(
          existingMessages,
          input.prompt,
        )
        if (localHistoryContext) {
          promptForModel = `${localHistoryContext}${promptForModel}`
        }
      }

      // Active focus — prepended per-turn as ambient context so the
      // agent knows what file the user has open right now. Lives on the
      // user prompt (not in thread config) so switching scenes does not
      // invalidate the thread fingerprint.
      const activeFocusBlock = buildActiveFocusBlock(input.activeFocus ?? null)
      if (activeFocusBlock) {
        promptForModel = `${activeFocusBlock}\n\n${promptForModel}`
      }

      if (canReuseThread) {
        threadId = existingThread.threadId
        sessionId = existingThread.sessionId
      } else {
        const threadResponse: any = await runtime.client.request(
          "thread/start",
          {
            model: modelSelection.model,
            cwd: input.cwd,
            approvalPolicy: "never",
            sandbox: sandbox.threadSandbox,
            config: appServerConfig,
            serviceName: "lani",
            developerInstructions:
              input.mode === "plan"
                ? `${laniHarnessBlock}\n\nStay in planning mode. Do not edit files or run mutating commands.`
                : laniHarnessBlock,
            ephemeral: false,
            sessionStartSource: "startup",
          },
          180_000,
        )
        threadId = threadResponse?.thread?.id
        sessionId = threadResponse?.thread?.sessionId || null
        if (!threadId) {
          throw new Error("Codex app-server did not return a thread id.")
        }
        appServerThreads.set(input.subChatId, {
          threadId,
          sessionId,
          cwd: input.cwd,
          authFingerprint: getAuthFingerprint(effectiveAuthConfig),
          threadConfigFingerprint,
        })
      }

      const activeTurn = activeAppServerTurns.get(input.subChatId)
      if (activeTurn && activeTurn.runId === input.runId) {
        activeTurn.threadId = threadId
        activeTurn.flushPartial = () => flushPartial()
      }

      accumulator = new CodexAppServerMessageAccumulator(safeEmit)
      startedAt = Date.now()
      let resolveTurnDone: (() => void) | null = null
      const turnDone = new Promise<void>((resolve) => {
        resolveTurnDone = resolve
      })

      unsubscribeNotifications = runtime.client.onNotification((notification) => {
        const params = notification.params as any
        const notificationThreadId =
          typeof params?.threadId === "string" ? params.threadId : undefined
        const notificationTurnId =
          typeof params?.turnId === "string" ? params.turnId : undefined

        if (notificationThreadId && notificationThreadId !== threadId) return
        if (turnId && notificationTurnId && notificationTurnId !== turnId) return

        if (notification.method === "thread/tokenUsage/updated") {
          usageMetadata = mapAppServerUsage(params?.tokenUsage)
          return
        }

        if (notification.method === "turn/started") {
          turnId = params?.turn?.id || turnId
          const currentTurn = activeAppServerTurns.get(input.subChatId)
          if (currentTurn && currentTurn.runId === input.runId) {
            currentTurn.turnId = turnId || undefined
            currentTurn.interrupt = async () => {
              if (!threadId || !turnId) return
              await runtime.client.request("turn/interrupt", { threadId, turnId }, 30_000)
            }
          }
        }

        accumulator?.handleNotification(notification)

        if (notification.method === "turn/completed") {
          finished = true
          resolveTurnDone?.()
        }
      })

      const userInput: any[] = [
        ...laniSkills.mentionedInputs,
        {
          type: "text",
          text: promptForModel,
          text_elements: [],
        },
      ]

      for (const image of input.images || []) {
        if (!image?.base64Data || !image?.mediaType) continue
        userInput.push({
          type: "image",
          url: `data:${image.mediaType};base64,${image.base64Data}`,
        })
      }

      const turnResponse: any = await runtime.client.request(
        "turn/start",
        {
          threadId,
          input: userInput,
          cwd: input.cwd,
          approvalPolicy: "never",
          sandboxPolicy: sandbox.turnSandboxPolicy,
          model: modelSelection.model,
          ...(modelSelection.effort ? { effort: modelSelection.effort } : {}),
        },
        120_000,
      )
      turnId = turnResponse?.turn?.id || turnId

      const currentTurn = activeAppServerTurns.get(input.subChatId)
      if (currentTurn && currentTurn.runId === input.runId) {
        currentTurn.turnId = turnId || undefined
        currentTurn.interrupt = async () => {
          if (!threadId || !turnId) return
          await runtime.client.request("turn/interrupt", { threadId, turnId }, 30_000)
        }
      }

      abortController.signal.addEventListener("abort", () => {
        const active = activeAppServerTurns.get(input.subChatId)
        if (!active || active.runId !== input.runId) return
        active.cancelRequested = true
        void active.interrupt?.().catch((error) => {
          console.warn("[codex] Failed to interrupt app-server turn:", error)
        })
      })

      if (!finished) {
        await Promise.race([
          turnDone,
          new Promise<void>((resolve) => {
            abortController.signal.addEventListener("abort", () => resolve(), {
              once: true,
            })
          }),
        ])
      }

      accumulator.closeOpenParts()
      const resultSubtype = abortController.signal.aborted
        ? "cancelled"
        : "success"
      const messageMetadata = accumulator.finishMetadata({
        metadataModel,
        threadId,
        sessionId,
        turnId,
        startedAt,
        resultSubtype,
        rollbackCheckpointId,
        threadConfigFingerprint,
        usageMetadata,
      })
      const assistantMessage = accumulator.toAssistantMessage(messageMetadata)
      if (assistantMessage) {
        const didPersist = persistSubChatMessages?.([
          ...messagesForStream,
          assistantMessage,
        ]) || false
        if (didPersist && rollbackCheckpointId && input.cwd) {
          await createRollbackStash(input.cwd, rollbackCheckpointId)
        }
      } else {
        persistSubChatMessages?.(messagesForStream)
      }

      safeEmit({
        type: "message-metadata",
        messageMetadata,
      })
      safeEmit({ type: "finish" })
      safeComplete()
    } catch (error) {
      const normalized = extractCodexError(error)
      console.error("[codex] app-server chat stream error:", error)
      if (isCodexAuthError(normalized)) {
        safeEmit({ type: "auth-error", errorText: normalized.message })
      } else {
        safeEmit({ type: "error", errorText: normalized.message })
      }
      if (accumulator && threadId) {
        await flushPartial("error").catch((persistError) => {
          console.error("[codex] Failed to persist app-server error partial:", persistError)
        })
      }
      safeEmit({ type: "finish" })
      safeComplete()
    } finally {
      unsubscribeNotifications?.()
      const activeTurn = activeAppServerTurns.get(input.subChatId)
      if (activeTurn && activeTurn.runId === input.runId) {
        activeAppServerTurns.delete(input.subChatId)
      }
    }
  })()

  return () => {
    isActive = false
    abortController.abort()
    const activeTurn = activeAppServerTurns.get(input.subChatId)
    if (activeTurn && activeTurn.runId === input.runId) {
      activeTurn.cancelRequested = true
      void activeTurn.interrupt?.().catch(() => {
        // No-op.
      })
      void activeTurn.flushPartial?.().catch(() => {
        // No-op.
      })
    }
  }
}

export const codexRouter = router({
  getStoredApiKey: publicProcedure.query(() => {
    const apiKey = loadStoredCodexApiKey()
    return {
      apiKey: apiKey || "",
      hasKey: Boolean(apiKey),
      encryptionAvailable: isCodexApiKeyEncryptionAvailable(),
    }
  }),

  setStoredApiKey: publicProcedure
    .input(
      z.object({
        apiKey: z.string(),
      }),
    )
    .mutation(({ input }) => {
      const normalized = input.apiKey.trim()
      if (!normalized) {
        clearStoredCodexApiKey()
        return {
          success: true,
          hasKey: false,
          encryptionAvailable: isCodexApiKeyEncryptionAvailable(),
        }
      }

      saveStoredCodexApiKey(normalized)
      return {
        success: true,
        hasKey: hasStoredCodexApiKey(),
        encryptionAvailable: isCodexApiKeyEncryptionAvailable(),
      }
    }),

  getIntegration: publicProcedure.query(async () => {
    if (getCodexRuntimeId() === "app-server") {
      const storedApiKey = loadStoredCodexApiKey()
      const runtime = await getOrCreateCodexAppServerRuntime({
        authConfig: storedApiKey ? { apiKey: storedApiKey } : undefined,
      })
      const state = getCodexAppServerAccountState(runtime.account)
      return {
        state,
        isConnected:
          state === "connected_chatgpt" || state === "connected_api_key",
        rawOutput: JSON.stringify(runtime.account || {}),
        exitCode: 0,
        runtime: "app-server" as const,
      }
    }

    const result = await runCodexCli(["login", "status"])
    const combinedOutput = [result.stdout, result.stderr]
      .filter((chunk) => chunk.trim().length > 0)
      .join("\n")
      .trim()

    const state = normalizeCodexIntegrationState(combinedOutput)

    return {
      state,
      isConnected:
        state === "connected_chatgpt" || state === "connected_api_key",
      rawOutput: combinedOutput,
      exitCode: result.exitCode,
    }
  }),

  logout: publicProcedure.mutation(async () => {
    const logoutResult = await runCodexCli(["logout"])
    const statusResult = await runCodexCli(["login", "status"])

    const statusOutput = [statusResult.stdout, statusResult.stderr]
      .filter((chunk) => chunk.trim().length > 0)
      .join("\n")
      .trim()

    const state = normalizeCodexIntegrationState(statusOutput)
    const isConnected =
      state === "connected_chatgpt" || state === "connected_api_key"

    if (isConnected) {
      throw new Error("Failed to log out from Codex. Please try again.")
    }

    const logoutOutput = [logoutResult.stdout, logoutResult.stderr]
      .filter((chunk) => chunk.trim().length > 0)
      .join("\n")
      .trim()

    return {
      success: true,
      state,
      isConnected: false,
      logoutExitCode: logoutResult.exitCode,
      logoutOutput,
      statusOutput,
    }
  }),

  startLogin: publicProcedure.mutation(() => {
    const existingSession = getActiveLoginSession()
    if (existingSession) {
      return toLoginSessionResponse(existingSession)
    }

    const codexCliPath = resolveBundledCodexCliPath()
    const sessionId = randomUUID()

    const child = spawn(codexCliPath, ["login"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: buildCodexBaseEnv(),
      windowsHide: true,
    })

    const session: CodexLoginSession = {
      id: sessionId,
      process: child,
      state: "running",
      output: "",
      url: null,
      error: null,
      exitCode: null,
    }

    const handleChunk = (chunk: Buffer | string) => {
      appendLoginOutput(session, chunk.toString("utf8"))
    }

    child.stdout.on("data", handleChunk)
    child.stderr.on("data", handleChunk)

    child.once("error", (error) => {
      session.state = "error"
      session.error = error.message
      session.exitCode = null
      session.process = null
    })

    child.once("close", (exitCode) => {
      session.exitCode = exitCode
      session.process = null

      if (session.state === "cancelled") {
        return
      }

      if (exitCode === 0) {
        session.state = "success"
        session.error = null
        return
      }

      session.state = "error"
      session.error =
        session.output.trim() ||
        `Codex login exited with code ${exitCode ?? "unknown"}`
    })

    loginSessions.set(sessionId, session)
    return toLoginSessionResponse(session)
  }),

  getLoginSession: publicProcedure
    .input(
      z.object({
        sessionId: z.string(),
      }),
    )
    .query(({ input }) => {
      const session = loginSessions.get(input.sessionId)
      if (!session) {
        throw new Error("Codex login session not found")
      }

      return toLoginSessionResponse(session)
    }),

  cancelLogin: publicProcedure
    .input(
      z.object({
        sessionId: z.string(),
      }),
    )
    .mutation(({ input }) => {
      const session = loginSessions.get(input.sessionId)
      if (!session) {
        return { success: true, found: false }
      }

      session.state = "cancelled"
      session.error = null
      if (session.process && !session.process.killed) {
        session.process.kill("SIGTERM")
      }

      return { success: true, found: true, session: toLoginSessionResponse(session) }
    }),

  getAllMcpConfig: publicProcedure.query(async () => {
    try {
      return await getAllCodexMcpConfigHandler()
    } catch (error) {
      console.error("[codex.getAllMcpConfig] Error:", error)
      return {
        groups: [],
        error: extractCodexError(error).message,
      }
    }
  }),

  refreshMcpConfig: publicProcedure.mutation(() => {
    clearCodexMcpCache()
    return { success: true }
  }),

  addMcpServer: publicProcedure
    .input(
      z.object({
        name: z
          .string()
          .min(1)
          .regex(
            /^[a-zA-Z0-9_-]+$/,
            "Name must contain only letters, numbers, underscores, and hyphens",
          ),
        scope: z.enum(["global", "project"]),
        transport: z.enum(["stdio", "http"]),
        command: z.string().optional(),
        args: z.array(z.string()).optional(),
        url: z.string().url().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      if (input.scope !== "global") {
        throw new Error("Codex MCP currently supports global scope only.")
      }

      const args = ["mcp", "add", input.name.trim()]
      if (input.transport === "http") {
        const url = input.url?.trim()
        if (!url) {
          throw new Error("URL is required for HTTP servers.")
        }
        args.push("--url", url)
      } else {
        const command = input.command?.trim()
        if (!command) {
          throw new Error("Command is required for stdio servers.")
        }

        args.push("--", command, ...(input.args || []))
      }

      await runCodexCliChecked(args)
      clearCodexMcpCache()
      return { success: true }
    }),

  removeMcpServer: publicProcedure
    .input(
      z.object({
        name: z.string().min(1),
        scope: z.enum(["global", "project"]).default("global"),
      }),
    )
    .mutation(async ({ input }) => {
      if (input.scope !== "global") {
        throw new Error("Codex MCP currently supports global scope only.")
      }

      await runCodexCliChecked(["mcp", "remove", input.name.trim()])
      clearCodexMcpCache()
      return { success: true }
    }),

  startMcpOAuth: publicProcedure
    .input(
      z.object({
        serverName: z.string().min(1),
        projectPath: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        const projectPath = input.projectPath?.trim()
        await runCodexCliChecked(["mcp", "login", input.serverName.trim()], {
          cwd: projectPath && projectPath.length > 0 ? projectPath : undefined,
        })
        clearCodexMcpCache()
        return { success: true as const }
      } catch (error) {
        return {
          success: false as const,
          error: extractCodexError(error).message,
        }
      }
    }),

  logoutMcpServer: publicProcedure
    .input(
      z.object({
        serverName: z.string().min(1),
        projectPath: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        const projectPath = input.projectPath?.trim()
        await runCodexCliChecked(["mcp", "logout", input.serverName.trim()], {
          cwd: projectPath && projectPath.length > 0 ? projectPath : undefined,
        })
        clearCodexMcpCache()
        return { success: true as const }
      } catch (error) {
        return {
          success: false as const,
          error: extractCodexError(error).message,
        }
      }
    }),

  chat: publicProcedure
    .input(
      z.object({
        subChatId: z.string(),
        chatId: z.string(),
        runId: z.string(),
        prompt: z.string(),
        model: z.string().optional(),
        cwd: z.string(),
        projectPath: z.string().optional(),
        mode: z.enum(["plan", "agent"]).default("agent"),
        sessionId: z.string().optional(),
        forceNewSession: z.boolean().optional(),
        historyEnabled: z.boolean().optional(),
        images: z.array(imageAttachmentSchema).optional(),
        authConfig: z
          .object({
            apiKey: z.string().min(1),
          })
          .optional(),
        // Ambient context describing what the user has open in the app
        // *right now*. Mirrors the claude.chat input — see harness-prompt.ts.
        activeFocus: z
          .object({
            path: z.string(),
            kind: z.string(),
            label: z.string().nullable().optional(),
            mode: z.string().nullable().optional(),
            submode: z.string().nullable().optional(),
            sceneId: z.string().nullable().optional(),
          })
          .nullable()
          .optional(),
      }),
    )
    .subscription(({ input }) => {
      return observable<any>((emit) => {
        if (getCodexRuntimeId() === "app-server") {
          return createCodexAppServerSubscription(input, emit)
        }

        const existingStream = activeStreams.get(input.subChatId)
        if (existingStream) {
          existingStream.cancelRequested = true
          existingStream.controller.abort()
          // Ensure old run cannot continue emitting after supersede.
          cleanupProvider(input.subChatId)
        }

        const abortController = new AbortController()
        activeStreams.set(input.subChatId, {
          runId: input.runId,
          controller: abortController,
          cancelRequested: false,
        })

        let isActive = true

        const safeEmit = (chunk: any) => {
          if (!isActive) return
          try {
            emit.next(chunk)
          } catch {
            isActive = false
          }
        }

        const safeComplete = () => {
          if (!isActive) return
          isActive = false
          try {
            emit.complete()
          } catch {
            // Ignore double completion
          }
        }

        ;(async () => {
          try {
            const db = getDatabase()

            const existingSubChat = db
              .select()
              .from(subChats)
              .where(eq(subChats.id, input.subChatId))
              .get()

            if (!existingSubChat) {
              throw new Error("Sub-chat not found")
            }

            const existingMessages = parseStoredMessages(existingSubChat.messages)
            const requestedModelId =
              extractCodexModelId(input.model) || DEFAULT_CODEX_MODEL
            const storedApiKey = loadStoredCodexApiKey()
            const effectiveAuthConfig =
              input.authConfig || (storedApiKey ? { apiKey: storedApiKey } : undefined)
            const selectedModelId = preprocessCodexModelName({
              modelId: requestedModelId,
              authConfig: effectiveAuthConfig,
            })
            const metadataModel = selectedModelId
            const historyEnabled = input.historyEnabled === true
            const rollbackCheckpointId = historyEnabled ? randomUUID() : undefined

            const lastMessage = existingMessages[existingMessages.length - 1]
            const isDuplicatePrompt =
              lastMessage?.role === "user" &&
              extractPromptFromStoredMessage(lastMessage) === input.prompt

            let messagesForStream = existingMessages
            const isAuthoritativeRun = () => {
              const currentStream = activeStreams.get(input.subChatId)
              return !currentStream || currentStream.runId === input.runId
            }

            const persistSubChatMessages = (messages: any[]) => {
              if (!isAuthoritativeRun()) {
                return false
              }

              db.update(subChats)
                .set({
                  messages: JSON.stringify(messages),
                  updatedAt: new Date(),
                })
                .where(eq(subChats.id, input.subChatId))
                .run()
              return true
            }

            const cleanAssistantMessageForPersistence = (message: any) => {
              if (!message || message.role !== "assistant") return message
              if (!Array.isArray(message.parts)) return message

              const cleanedParts = message.parts.filter(
                (part: any) => part?.state !== "input-streaming",
              )

              if (cleanedParts.length === 0) {
                return null
              }

              const cleanedMessage = {
                ...message,
                parts: cleanedParts,
              }

              return normalizeCodexAssistantMessage(cleanedMessage, {
                normalizeState: true,
              })
            }

            if (!isDuplicatePrompt) {
              const userMessage = {
                id: crypto.randomUUID(),
                role: "user",
                parts: buildUserParts(input.prompt, input.images),
                metadata: { model: metadataModel },
              }

              messagesForStream = [...existingMessages, userMessage]

              db.update(subChats)
                .set({
                  messages: JSON.stringify(messagesForStream),
                  updatedAt: new Date(),
                })
                .where(eq(subChats.id, input.subChatId))
                .run()
            }

            if (input.forceNewSession) {
              cleanupProvider(input.subChatId)
            }

            const parsedMentions = parseMentions(input.prompt)
            const codexAgents = await buildCodexAgentBridge({
              cwd: input.cwd,
              mentionedAgentNames: parsedMentions.agentMentions,
            })

            let mcpSnapshot: CodexMcpSnapshot = {
              mcpServersForSession: [],
              groups: [],
              fingerprint: getCodexMcpFingerprint([]),
              fetchedAt: Date.now(),
              toolsResolved: false,
            }
            try {
              const resolvedProjectPathFromCwd = resolveProjectPathFromWorktree(
                input.cwd,
              )
              const mcpLookupPath =
                input.projectPath || resolvedProjectPathFromCwd || input.cwd
              mcpSnapshot = await resolveCodexMcpSnapshot({
                lookupPath: mcpLookupPath,
              })
            } catch (mcpError) {
              console.error("[codex] Failed to resolve MCP servers:", mcpError)
            }

            const resolvedNames = new Set(
              mcpSnapshot.mcpServersForSession.map((server) => server.name),
            )
            const builtinCodexServers = getBuiltinCodexMcpServers({
              worktreeId: input.chatId,
              cwd: input.cwd,
              resolvedNames,
            })
            const sessionMcpServers = [
              ...builtinCodexServers,
              ...mcpSnapshot.mcpServersForSession,
            ]
            const existingSessionIdForStream = input.forceNewSession
              ? undefined
              : input.sessionId ?? getLastSessionId(existingMessages)
            const codexSessionFingerprint = createHash("sha256")
              .update(
                JSON.stringify({
                  mcp: getCodexMcpFingerprint(sessionMcpServers),
                  agents: codexAgents.fingerprint,
                }),
              )
              .digest("hex")

            const provider = getOrCreateProvider({
              subChatId: input.subChatId,
              cwd: input.cwd,
              mcpServers: sessionMcpServers,
              mcpFingerprint: codexSessionFingerprint,
              configArgs: codexAgents.acpConfigArgs,
              existingSessionId: existingSessionIdForStream,
              authConfig: effectiveAuthConfig,
            })

            const startedAt = Date.now()
            let latestSessionId =
              provider.getSessionId() ||
              existingSessionIdForStream
            let usagePromise: Promise<CodexUsageMetadata | null> | null = null

            const promptWithoutAgentMentions =
              parsedMentions.agentMentions.length > 0
                ? input.prompt.replace(/@\[agent:[^\]]+\]/g, "").trim()
                : input.prompt
            let promptForModel = promptWithoutAgentMentions
            const agentMentionInstruction = buildCodexAgentMentionInstruction({
              mentionedAgentNames: codexAgents.mentionedAgentNames,
              missingMentionedAgentNames: codexAgents.missingMentionedAgentNames,
            })
            if (agentMentionInstruction) {
              promptForModel = `${agentMentionInstruction}\n\n${
                promptForModel || "Run the requested Lani agent delegation."
              }`
            }
            if (!latestSessionId && existingMessages.length > 0) {
              const localHistoryContext = buildLocalHistoryContext(
                existingMessages,
                input.prompt,
              )
              if (localHistoryContext) {
                promptForModel = `${localHistoryContext}${promptForModel}`
              }
            }

            const resolveUsageOnce = (): Promise<CodexUsageMetadata | null> => {
              if (usagePromise) return usagePromise

              const sessionId = latestSessionId || provider.getSessionId()
              if (!sessionId) {
                return Promise.resolve(null)
              }

              usagePromise = pollUsage(sessionId, {
                notBeforeTimestampMs: startedAt,
              }).catch(() => null)
              return usagePromise
            }

            const laniHarnessBlock = buildLaniHarnessBlock()
            const activeFocusBlock = buildActiveFocusBlock(
              input.activeFocus ?? null,
            )
            const systemWithFocus = activeFocusBlock
              ? `${laniHarnessBlock}\n\n${activeFocusBlock}`
              : laniHarnessBlock

            const result = streamText({
              model: provider.languageModel(selectedModelId),
              system: systemWithFocus,
              messages: [
                {
                  role: "user",
                  content: buildModelMessageContent(promptForModel, input.images),
                },
              ],
              tools: provider.tools,
              abortSignal: abortController.signal,
            })

            const uiStream = result.toUIMessageStream({
              originalMessages: messagesForStream,
              generateMessageId: () => crypto.randomUUID(),
              messageMetadata: ({ part }) => {
                const sessionId = provider.getSessionId() || undefined
                if (sessionId) {
                  latestSessionId = sessionId
                }

                if (part.type === "finish") {
                  return {
                    model: metadataModel,
                    sessionId,
                    durationMs: Date.now() - startedAt,
                    resultSubtype: part.finishReason === "error" ? "error" : "success",
                    ...(rollbackCheckpointId ? { rollbackCheckpointId } : {}),
                  }
                }

                if (sessionId) {
                  return {
                    model: metadataModel,
                    sessionId,
                  }
                }

                return { model: metadataModel }
              },
              onFinish: async ({ responseMessage, isContinuation }) => {
                try {
                  const usageMetadata = await resolveUsageOnce()
                  const responseMetadata = {
                    ...((responseMessage as any)?.metadata || {}),
                    ...(usageMetadata || {}),
                    ...(rollbackCheckpointId ? { rollbackCheckpointId } : {}),
                  }
                  const responseWithUsage = {
                    ...responseMessage,
                    metadata: responseMetadata,
                  }
                  const cleanedResponseMessage =
                    cleanAssistantMessageForPersistence(responseWithUsage)

                  if (!cleanedResponseMessage) {
                    persistSubChatMessages(messagesForStream)
                    return
                  }

                  const messagesToPersist = [
                    ...(isContinuation
                      ? messagesForStream.slice(0, -1)
                      : messagesForStream),
                    cleanedResponseMessage,
                  ]

                  const didPersist = persistSubChatMessages(messagesToPersist)
                  if (didPersist && rollbackCheckpointId && input.cwd) {
                    await createRollbackStash(input.cwd, rollbackCheckpointId)
                  }
                } catch (error) {
                  console.error("[codex] Failed to persist messages:", error)
                }
              },
              onError: (error) => extractCodexError(error).message,
            })

            const reader = uiStream.getReader()
            let pendingFinishChunk: any | null = null
            while (true) {
              const { done, value } = await reader.read()
              if (done) break

              if (value?.type === "error") {
                const normalized = extractCodexError(value)

                if (isCodexAuthError(normalized)) {
                  safeEmit({ ...value, type: "auth-error", errorText: normalized.message })
                } else {
                  safeEmit({ ...value, errorText: normalized.message })
                }
                continue
              }

              if (value?.type === "finish") {
                pendingFinishChunk = value
                continue
              }

              safeEmit(value)
            }

            if (pendingFinishChunk) {
              const usageMetadata = await resolveUsageOnce()
              if (usageMetadata) {
                safeEmit({
                  type: "message-metadata",
                  messageMetadata: usageMetadata,
                })
              }
              safeEmit(pendingFinishChunk)
            } else {
              safeEmit({ type: "finish" })
            }

            safeComplete()
          } catch (error) {
            const normalized = extractCodexError(error)

            console.error("[codex] chat stream error:", error)
            if (isCodexAuthError(normalized)) {
              safeEmit({ type: "auth-error", errorText: normalized.message })
            } else {
              safeEmit({ type: "error", errorText: normalized.message })
            }
            safeEmit({ type: "finish" })
            safeComplete()
          } finally {
            const activeStream = activeStreams.get(input.subChatId)
            if (activeStream?.runId === input.runId) {
              const shouldCleanupProvider =
                abortController.signal.aborted || activeStream.cancelRequested
              if (shouldCleanupProvider) {
                cleanupProvider(input.subChatId)
              }
              activeStreams.delete(input.subChatId)
            }
          }
        })()

        return () => {
          isActive = false
          abortController.abort()

          const activeStream = activeStreams.get(input.subChatId)
          if (activeStream?.runId === input.runId) {
            activeStream.cancelRequested = true
          }
        }
      })
    }),

  cancel: publicProcedure
    .input(
      z.object({
        subChatId: z.string(),
        runId: z.string(),
      }),
    )
    .mutation(({ input }) => {
      const activeAppServerTurn = activeAppServerTurns.get(input.subChatId)
      if (activeAppServerTurn) {
        if (activeAppServerTurn.runId !== input.runId) {
          return { cancelled: false, ignoredStale: true }
        }
        activeAppServerTurn.cancelRequested = true
        activeAppServerTurn.controller.abort()
        void activeAppServerTurn.interrupt?.().catch(() => {
          // No-op.
        })
        void activeAppServerTurn.flushPartial?.().catch(() => {
          // No-op.
        })
        return { cancelled: true, ignoredStale: false }
      }

      const activeStream = activeStreams.get(input.subChatId)
      if (!activeStream) {
        return { cancelled: false, ignoredStale: false }
      }

      if (activeStream.runId !== input.runId) {
        return { cancelled: false, ignoredStale: true }
      }

      activeStream.cancelRequested = true
      activeStream.controller.abort()

      return { cancelled: true, ignoredStale: false }
    }),

  cleanup: publicProcedure
    .input(z.object({ subChatId: z.string() }))
    .mutation(({ input }) => {
      cleanupProvider(input.subChatId)
      appServerThreads.delete(input.subChatId)

      const activeStream = activeStreams.get(input.subChatId)
      if (activeStream) {
        activeStream.controller.abort()
        activeStreams.delete(input.subChatId)
      }

      const activeAppServerTurn = activeAppServerTurns.get(input.subChatId)
      if (activeAppServerTurn) {
        activeAppServerTurn.controller.abort()
        void activeAppServerTurn.interrupt?.().catch(() => {
          // No-op.
        })
        void activeAppServerTurn.flushPartial?.().catch(() => {
          // No-op.
        })
        activeAppServerTurns.delete(input.subChatId)
      }

      return { success: true }
    }),
})
