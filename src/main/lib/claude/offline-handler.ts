/**
 * Offline-mode handler stub.
 *
 * Backlot is online-only — Ollama fallback and offline mode were stripped
 * from the upstream 1code substrate. This stub keeps the existing call
 * sites in claude.ts compiling without invasive surgery; every call
 * resolves to "online, use Claude." Dead `isUsingOllama` branches in
 * claude.ts evaluate to false and are unreachable.
 *
 * If you find yourself extending this, reconsider — the right move is to
 * remove the call sites in claude.ts instead.
 */

export type CustomClaudeConfig = {
  model: string
  token: string
  baseUrl: string
}

export type OfflineCheckResult = {
  config: CustomClaudeConfig | undefined
  isUsingOllama: false
  error?: string
}

export async function checkOfflineFallback(
  customConfig: CustomClaudeConfig | undefined,
  _claudeCodeToken: string | null,
  _selectedOllamaModel?: string | null,
  _offlineModeEnabled: boolean = false,
): Promise<OfflineCheckResult> {
  return {
    config: customConfig,
    isUsingOllama: false,
  }
}
