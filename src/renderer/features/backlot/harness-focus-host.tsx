import { useEffect, useRef } from "react"
import { useSetAtom } from "jotai"
import { toast } from "sonner"
import {
  harnessEditorDraftRequestAtom,
  harnessEditorModalOpenAtom,
} from "../../lib/atoms"
import { trpc } from "../../lib/trpc"

/**
 * Polls for harness focus-requests (written by the `harness_open_editor`
 * MCP tool) and pops the in-pane Harness editor modal. Stays mounted
 * for the life of the app — never navigates away from what the writer
 * is doing.
 */
export function HarnessFocusHost() {
  const setHarnessDraftRequest = useSetAtom(harnessEditorDraftRequestAtom)
  const setHarnessModalOpen = useSetAtom(harnessEditorModalOpenAtom)
  const lastRequestIdRef = useRef<string | null>(null)

  const focusRequest = trpc.harness.consumeFocusRequest.useQuery(undefined, {
    refetchInterval: 750,
    refetchOnWindowFocus: true,
  })

  useEffect(() => {
    const request = focusRequest.data
    if (!request || request.id === lastRequestIdRef.current) return

    lastRequestIdRef.current = request.id
    setHarnessDraftRequest(request)
    setHarnessModalOpen(true)

    toast.message("Harness update requested", {
      description: request.proposedContent
        ? "Review the proposed draft before saving."
        : "Review the harness before saving changes.",
    })
  }, [focusRequest.data, setHarnessDraftRequest, setHarnessModalOpen])

  return null
}
