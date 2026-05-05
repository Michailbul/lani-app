/**
 * AuthManager — Backlot's auth surface.
 *
 * Backlot does not have its own user account system. "Signed in" means
 * "we have a valid Claude OAuth credential" — read directly from the
 * macOS Keychain, Windows Credential Manager, Linux Secret Service, or
 * the ~/.claude/.credentials.json fallback. The credential is created
 * by running `claude /login` (or `claude setup-token`) — official
 * Anthropic CLI commands shipped with the bundled Claude binary.
 *
 * The upstream 1code AuthManager brokered auth through a 21st.dev
 * backend (exchangeCode / refresh against /api/auth/desktop/*). All of
 * that is gone — Backlot talks to Anthropic directly. The public method
 * surface is preserved so existing routers (chats, voice, claude-code)
 * keep compiling; calls that previously hit 21st.dev now return null
 * tokens and the routers' fallback paths handle that gracefully.
 */

import { BrowserWindow, shell } from "electron"
import {
  getExistingClaudeCredentials,
  refreshClaudeToken,
  isTokenExpired,
} from "./lib/claude-token"
import { AuthData, AuthUser } from "./auth-store"

const BACKLOT_PSEUDO_USER: AuthUser = {
  id: "claude-local",
  email: "you@claude.local",
  name: "Claude",
  imageUrl: null,
  username: "claude",
}

export class AuthManager {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private isDev: boolean
  private onTokenRefresh?: (authData: AuthData) => void

  constructor(isDev: boolean = false) {
    this.isDev = isDev
  }

  /**
   * Set callback for token-refresh events. The caller (main process) uses
   * this to update cookies. With Anthropic-direct auth, refresh happens
   * lazily inside getValidToken() — there is no schedule.
   */
  setOnTokenRefresh(callback: (authData: AuthData) => void): void {
    this.onTokenRefresh = callback
  }

  /**
   * Deprecated. Was 21st.dev's deep-link auth-code exchange. The deep-link
   * handler in main/index.ts still calls this on `backlot://auth-callback`
   * URLs; we keep the signature so it does not throw, but the flow is
   * obsolete with Anthropic-direct auth.
   */
  async exchangeCode(_code: string): Promise<AuthData> {
    throw new Error(
      "Backlot uses direct Anthropic auth — no auth-code exchange. Run `claude /login` and the credentials will be detected automatically.",
    )
  }

  /**
   * Return a valid Claude OAuth access token, refreshing if it is close
   * to expiry. Returns null if no credentials are stored yet.
   */
  async getValidToken(): Promise<string | null> {
    const creds = getExistingClaudeCredentials()
    if (!creds) return null

    if (creds.refreshToken && isTokenExpired(creds.expiresAt)) {
      try {
        const refreshed = await refreshClaudeToken(creds.refreshToken)
        // Note: we do NOT persist the refreshed token back to the keychain
        // here — `claude` itself owns that file. Consumers get a fresh
        // token for this call; next call refreshes again if needed. The
        // refresh endpoint is cheap and idempotent.
        if (this.onTokenRefresh) {
          this.onTokenRefresh({
            token: refreshed.accessToken,
            refreshToken: refreshed.refreshToken,
            expiresAt: new Date(refreshed.expiresAt ?? Date.now() + 3600_000).toISOString(),
            user: BACKLOT_PSEUDO_USER,
          })
        }
        return refreshed.accessToken
      } catch (err) {
        console.error("[AuthManager] Refresh failed:", err)
        // Fall through and return the (likely-expired) accessToken — the
        // Claude SDK will surface a 401 if it really cannot use it.
        return creds.accessToken
      }
    }

    return creds.accessToken
  }

  /**
   * Refresh the current session. With Anthropic-direct auth this is a
   * lightweight wrapper around getValidToken().
   */
  async refresh(): Promise<boolean> {
    const token = await this.getValidToken()
    return token !== null
  }

  isAuthenticated(): boolean {
    const creds = getExistingClaudeCredentials()
    return creds !== null && !!creds.accessToken
  }

  getUser(): AuthUser | null {
    return this.isAuthenticated() ? BACKLOT_PSEUDO_USER : null
  }

  getAuth(): AuthData | null {
    const creds = getExistingClaudeCredentials()
    if (!creds) return null
    return {
      token: creds.accessToken,
      refreshToken: creds.refreshToken ?? "",
      expiresAt: new Date(creds.expiresAt ?? Date.now() + 3600_000).toISOString(),
      user: BACKLOT_PSEUDO_USER,
    }
  }

  /**
   * "Logout" cannot remove credentials Backlot does not own — `claude` writes
   * those to the OS keychain. Surface a clear message instead. The renderer
   * can decide how to present it (e.g. a dialog telling the user to run
   * `claude logout`).
   */
  logout(): void {
    console.log(
      "[AuthManager] Logout requested. Credentials live in the OS keychain — run `claude logout` in a terminal to remove them.",
    )
  }

  /**
   * Trigger the Anthropic sign-in flow. Backlot does not run a local OAuth
   * server — it delegates to the bundled `claude` binary's own /login,
   * which handles the full PKCE + browser redirect flow on its own.
   *
   * Strategy:
   *  1. If credentials already exist, fire onAuthSuccess immediately.
   *  2. Otherwise open https://claude.ai/login in the user's browser and
   *     instruct the user to also run `claude /login` in a terminal. The
   *     login page polls for credentials on a short interval and reloads
   *     to the main UI as soon as they appear.
   *
   * This is intentionally low-tech for v1. The polished v1.5 path spawns
   * `claude /login` in an embedded node-pty terminal inside Backlot.
   */
  async startAuthFlow(_mainWindow: BrowserWindow | null): Promise<void> {
    // Already signed in — nothing to do, the renderer will detect this on
    // its next poll and switch windows.
    if (this.isAuthenticated()) {
      console.log("[AuthManager] startAuthFlow called but already authenticated.")
      return
    }

    // Open Anthropic's sign-in landing page so the user can confirm their
    // Claude subscription is active.
    await shell.openExternal("https://claude.ai/login")
  }

  /**
   * Update user profile. With Anthropic-direct auth the user object is
   * synthetic — there is no remote profile to update. No-op for compat.
   */
  async updateUser(_updates: { name?: string }): Promise<AuthUser | null> {
    return this.getUser()
  }

  /**
   * Fetch user's subscription plan. Was a 21st.dev call for analytics
   * enrichment; not available without their backend. Returns null.
   */
  async fetchUserPlan(): Promise<{ email: string; plan: string; status: string | null } | null> {
    return null
  }
}

let authManagerInstance: AuthManager | null = null

export function initAuthManager(isDev: boolean = false): AuthManager {
  if (!authManagerInstance) {
    authManagerInstance = new AuthManager(isDev)
  }
  return authManagerInstance
}

export function getAuthManager(): AuthManager | null {
  return authManagerInstance
}
