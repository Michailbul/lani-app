import { EventEmitter } from "node:events"
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { createInterface } from "node:readline"

type JsonRpcId = number | string

type PendingRequest = {
  method: string
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

export type CodexAppServerIncomingNotification = {
  method: string
  params?: unknown
}

export type CodexAppServerIncomingRequest = {
  id: JsonRpcId
  method: string
  params?: unknown
}

export type CodexAppServerRequestHandler = (
  request: CodexAppServerIncomingRequest,
) => Promise<unknown> | unknown

type CodexAppServerClientOptions = {
  command: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  requestTimeoutMs?: number
  onRequest?: CodexAppServerRequestHandler
  onNotification?: (notification: CodexAppServerIncomingNotification) => void
}

const DEFAULT_REQUEST_TIMEOUT_MS = 120_000

function stringifyError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

function parseJsonRpcLine(line: string): unknown | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed)
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

export class CodexAppServerClient {
  private readonly child: ChildProcessWithoutNullStreams
  private readonly events = new EventEmitter()
  private readonly pending = new Map<string, PendingRequest>()
  private readonly requestTimeoutMs: number
  private readonly onRequest?: CodexAppServerRequestHandler
  private nextRequestId = 1
  private closed = false
  private stderr = ""

  constructor(options: CodexAppServerClientOptions) {
    this.requestTimeoutMs =
      options.requestTimeoutMs || DEFAULT_REQUEST_TIMEOUT_MS
    this.onRequest = options.onRequest
    this.child = spawn(options.command, options.args || ["app-server"], {
      cwd: options.cwd,
      env: options.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    })

    if (options.onNotification) {
      this.onNotification(options.onNotification)
    }

    const reader = createInterface({
      input: this.child.stdout,
      crlfDelay: Infinity,
    })

    reader.on("line", (line) => {
      const message = parseJsonRpcLine(line)
      if (message !== null) {
        this.routeIncoming(message)
      }
    })

    this.child.stderr.on("data", (chunk) => {
      this.stderr += chunk.toString("utf8")
      if (this.stderr.length > 16_000) {
        this.stderr = this.stderr.slice(-16_000)
      }
    })

    this.child.once("error", (error) => {
      this.failAllPending(error)
    })

    this.child.once("close", (code, signal) => {
      this.closed = true
      const detail = this.stderr.trim()
      const suffix = detail ? `: ${detail}` : ""
      this.failAllPending(
        new Error(
          `Codex app-server exited with code ${code ?? "unknown"} signal ${
            signal ?? "none"
          }${suffix}`,
        ),
      )
      this.events.emit("close", { code, signal, stderr: this.stderr })
    })
  }

  get pid(): number | undefined {
    return this.child.pid
  }

  getStderr(): string {
    return this.stderr
  }

  onNotification(
    handler: (notification: CodexAppServerIncomingNotification) => void,
  ): () => void {
    this.events.on("notification", handler)
    return () => this.events.off("notification", handler)
  }

  onClose(
    handler: (event: {
      code: number | null
      signal: NodeJS.Signals | null
      stderr: string
    }) => void,
  ): () => void {
    this.events.on("close", handler)
    return () => this.events.off("close", handler)
  }

  async request<T = unknown>(
    method: string,
    params?: unknown,
    timeoutMs = this.requestTimeoutMs,
  ): Promise<T> {
    if (this.closed) {
      throw new Error("Codex app-server is not running")
    }

    const id = this.nextRequestId++
    const key = String(id)
    const payload: Record<string, unknown> = { id, method }
    if (params !== undefined) {
      payload.params = params
    }

    const promise = new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(key)
        reject(new Error(`Codex app-server request timed out: ${method}`))
      }, timeoutMs)

      this.pending.set(key, {
        method,
        timeout,
        resolve: (value) => resolve(value as T),
        reject,
      })
    })

    this.write(payload)
    return promise
  }

  notify(method: string, params?: unknown): void {
    const payload: Record<string, unknown> = { method }
    if (params !== undefined) {
      payload.params = params
    }
    this.write(payload)
  }

  respond(id: JsonRpcId, result: unknown): void {
    this.write({ id, result })
  }

  respondError(id: JsonRpcId, message: string): void {
    this.write({
      id,
      error: {
        code: -32603,
        message,
      },
    })
  }

  dispose(): void {
    if (this.closed) return
    this.closed = true
    this.failAllPending(new Error("Codex app-server was disposed"))
    this.child.kill("SIGTERM")
    setTimeout(() => {
      if (!this.child.killed) {
        this.child.kill("SIGKILL")
      }
    }, 2_000).unref()
  }

  private write(payload: Record<string, unknown>): void {
    if (this.closed) {
      throw new Error("Codex app-server is not running")
    }
    this.child.stdin.write(`${JSON.stringify(payload)}\n`)
  }

  private routeIncoming(message: unknown): void {
    if (!isRecord(message)) return

    if ("id" in message && typeof message.method === "string") {
      void this.handleServerRequest({
        id: message.id as JsonRpcId,
        method: message.method,
        params: message.params,
      })
      return
    }

    if ("id" in message) {
      this.handleResponse(message)
      return
    }

    if (typeof message.method === "string") {
      this.events.emit("notification", {
        method: message.method,
        params: message.params,
      } satisfies CodexAppServerIncomingNotification)
    }
  }

  private handleResponse(message: Record<string, unknown>): void {
    const key = String(message.id)
    const pending = this.pending.get(key)
    if (!pending) return

    this.pending.delete(key)
    clearTimeout(pending.timeout)

    if (message.error !== undefined) {
      const errorMessage = isRecord(message.error)
        ? stringifyError(message.error.message || message.error)
        : stringifyError(message.error)
      pending.reject(new Error(errorMessage || `Codex request failed: ${pending.method}`))
      return
    }

    pending.resolve(message.result)
  }

  private async handleServerRequest(
    request: CodexAppServerIncomingRequest,
  ): Promise<void> {
    if (!this.onRequest) {
      this.respondError(request.id, `Unhandled server request: ${request.method}`)
      return
    }

    try {
      const result = await this.onRequest(request)
      this.respond(request.id, result)
    } catch (error) {
      this.respondError(request.id, stringifyError(error))
    }
  }

  private failAllPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout)
      pending.reject(error)
    }
    this.pending.clear()
  }
}
