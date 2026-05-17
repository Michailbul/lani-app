/**
 * Skill proposals — in-memory queue + event bus that bridges an agent
 * (running inside the Claude Agent SDK as an in-process MCP tool) and
 * the renderer's SkillDiffModal.
 *
 * Flow:
 *   1. The agent calls the `propose_skill_change` MCP tool with a
 *      proposed new SKILL.md content.
 *   2. The tool handler invokes `createProposal()` here, which:
 *        a. Stores the proposal in `pendingProposals`
 *        b. Emits a `proposed` event so the renderer can open the modal
 *        c. Returns a Promise that resolves when the user clicks
 *           Apply / Dismiss in the modal.
 *   3. The renderer's `skills.resolveProposal` mutation calls
 *      `resolveProposal()` here, which fulfils the awaiting Promise.
 *   4. The MCP tool then performs the file write (on apply) and
 *      returns a tool result the agent can read.
 *
 * The store is process-global, scoped to the Electron main process. A
 * single user-facing modal is enough — proposals are queued; if a new
 * one arrives while another is open, the renderer surfaces them in
 * arrival order.
 */

import { EventEmitter } from "node:events"
import * as crypto from "node:crypto"

export interface SkillProposalInput {
  /** Display name (parsed from frontmatter or directory). */
  skillName: string
  /** Absolute filesystem path of the SKILL.md being proposed. */
  skillPath: string
  /** Source: "user" | "project" | "plugin". For UI grouping. */
  source: "user" | "project" | "plugin"
  /** Existing on-disk content (read by the tool before proposing). */
  oldContent: string
  /** Proposed replacement content. */
  newContent: string
  /** Short (≤120 char) human summary of the change. */
  summary: string
}

export interface SkillProposal extends SkillProposalInput {
  id: string
  createdAt: number
}

export type ProposalResolution =
  | {
      action: "apply"
      /**
       * The content to write. Present when the user edited the agent's
       * proposal in the diff drawer before applying — that edited buffer
       * is what lands on disk. Absent → write the agent's `newContent`.
       */
      finalContent?: string
    }
  | { action: "dismiss" }

interface PendingEntry {
  proposal: SkillProposal
  resolve: (resolution: ProposalResolution) => void
}

const pending = new Map<string, PendingEntry>()
const emitter = new EventEmitter()
emitter.setMaxListeners(50)

/** Renderer subscribes via tRPC observable; we emit one of these. */
export type ProposalEvent =
  | { type: "proposed"; proposal: SkillProposal }
  | { type: "resolved"; proposalId: string; action: "apply" | "dismiss" }

/**
 * Open a proposal and wait for the user's verdict. Resolves with
 * `{action}` once the renderer calls `resolveProposal(id, ...)`.
 *
 * If the awaiting code is aborted (e.g. session cancelled) the caller
 * should listen for that themselves — we only resolve when the modal
 * is acted on. This is fine because tool-call timeouts in the SDK
 * default to 60s; for long-pending modals override
 * `CLAUDE_CODE_STREAM_CLOSE_TIMEOUT` (already documented by the SDK).
 */
export function createProposal(input: SkillProposalInput): Promise<ProposalResolution> {
  const proposal: SkillProposal = {
    ...input,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
  }

  return new Promise((resolve) => {
    pending.set(proposal.id, { proposal, resolve })
    emitter.emit("event", { type: "proposed", proposal } satisfies ProposalEvent)
  })
}

/**
 * Called by the renderer when the user clicks Apply or Dismiss.
 * Returns true if a proposal was actually awaiting; false if the id
 * was unknown (already resolved or never existed).
 */
export function resolveProposal(
  id: string,
  resolution: ProposalResolution,
): boolean {
  const entry = pending.get(id)
  if (!entry) return false
  pending.delete(id)
  entry.resolve(resolution)
  emitter.emit("event", {
    type: "resolved",
    proposalId: id,
    action: resolution.action,
  } satisfies ProposalEvent)
  return true
}

/** Snapshot of currently-pending proposals, used when a fresh
 *  subscriber connects so it can show anything still open. */
export function listPendingProposals(): SkillProposal[] {
  return Array.from(pending.values()).map((e) => e.proposal)
}

/** Subscribe to proposal events. Returns an unsubscribe function. */
export function subscribeProposalEvents(
  cb: (event: ProposalEvent) => void,
): () => void {
  emitter.on("event", cb)
  return () => emitter.off("event", cb)
}
