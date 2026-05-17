/**
 * Offline-mode utilities.
 *
 * Backlot is online-only — the upstream internet check used the
 * Ollama detector module that has been stripped. Returning null means
 * "no warning" — git/gh commands run as normal and surface their own
 * network errors if connectivity is missing.
 */

export async function warnIfOfflineGitOperation(_command: string): Promise<string | null> {
  return null
}
