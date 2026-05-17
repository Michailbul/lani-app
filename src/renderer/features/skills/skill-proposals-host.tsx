"use client"

/**
 * SkillProposalsHost — the renderer-side bridge between the in-process
 * MCP `propose_skill_change` tool and the SkillDiffModal.
 *
 * Mounted once at the layout root (next to ClaudeLoginModal). It holds
 * a tRPC subscription on `skills.proposalEvents` and renders the
 * modal whenever a proposal is open. If multiple proposals queue up
 * (rare but possible if the agent fires several tool calls in
 * parallel) we surface them in arrival order.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { trpc } from "../../lib/trpc"
import {
  SkillDiffDrawer,
  type SkillProposalForUi,
} from "./skill-diff-modal"

export function SkillProposalsHost() {
  // Queue of proposals awaiting decision. The head (index 0) is the
  // one currently visible; we don't try to stack modals — the user
  // resolves one at a time.
  const [queue, setQueue] = useState<SkillProposalForUi[]>([])
  const [pending, setPending] = useState<"apply" | "dismiss" | null>(null)

  // Avoid handling the same id twice if the subscription replays a
  // pending event we already showed. Set lives across the lifetime of
  // the host.
  const seenIds = useRef<Set<string>>(new Set())

  const resolveProposal = trpc.skills.resolveProposal.useMutation()

  trpc.skills.proposalEvents.useSubscription(undefined, {
    onData(event) {
      if (event.type === "proposed") {
        if (seenIds.current.has(event.proposal.id)) return
        seenIds.current.add(event.proposal.id)
        setQueue((q) => [...q, event.proposal])
      } else if (event.type === "resolved") {
        // The resolution may have been initiated by a different
        // window (rare — multi-window). Drop it from our queue so
        // we don't keep trying to act on it.
        setQueue((q) => q.filter((p) => p.id !== event.proposalId))
      }
    },
    onError(err) {
      console.error("[skills] proposalEvents subscription error:", err)
    },
  })

  const head = queue[0] ?? null

  // Reset the pending flag whenever the head changes (we just popped
  // a proposal off after resolving it).
  useEffect(() => {
    setPending(null)
  }, [head?.id])

  const handleResolve = useCallback(
    async (action: "apply" | "dismiss", finalContent?: string) => {
      if (!head || pending) return
      setPending(action)
      try {
        const result = await resolveProposal.mutateAsync({
          proposalId: head.id,
          action,
          ...(action === "apply" ? { finalContent } : {}),
        })
        if (!result.success) {
          // The proposal was already resolved (probably by another
          // window). Toast a soft warning and drop it from the queue.
          toast.message("Proposal already resolved", {
            description: "Another window or session handled this change.",
          })
        } else if (action === "apply") {
          toast.success("Skill updated", {
            description: head.skillName,
          })
        }
      } catch (err) {
        console.error("[skills] resolveProposal failed:", err)
        toast.error("Couldn't resolve proposal", {
          description: (err as Error).message,
        })
      } finally {
        // Drop the head regardless — if the call failed the user can
        // retry from the agent's next turn.
        setQueue((q) => q.slice(1))
        setPending(null)
      }
    },
    [head, pending, resolveProposal],
  )

  const handleApply = useCallback(
    (finalContent: string) => handleResolve("apply", finalContent),
    [handleResolve],
  )
  const handleDismiss = useCallback(() => handleResolve("dismiss"), [handleResolve])
  const handleClose = useCallback(() => handleResolve("dismiss"), [handleResolve])

  return (
    <SkillDiffDrawer
      proposal={head}
      pending={pending}
      onApply={handleApply}
      onDismiss={handleDismiss}
      onClose={handleClose}
    />
  )
}
