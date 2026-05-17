"use client"

/**
 * SkillWorkbenchFocusHost — renderer bridge for the agent's
 * `open_skill_workbench` MCP tool.
 *
 * Mounted once at the layout root. It holds a tRPC subscription on
 * `skillWorkbench.focusEvents`; when the agent asks to open a skill
 * (the user said "let's adapt the X skill"), this flips the workspace
 * into Skill Workbench mode and opens the skill file as a tab.
 *
 * Each focus request carries a monotonic id. The subscription replays
 * the last request on connect, so `lastApplied` guards against
 * re-applying a focus the user has since navigated away from.
 */

import { useEffect, useRef } from "react"
import { useAtomValue, useSetAtom } from "jotai"
import { trpc } from "../../lib/trpc"
import {
  skillWorkbenchActiveAtom,
  skillWorkbenchTabsAtom,
  viewModeAtom,
  type SkillWorkbenchTab,
} from "./atoms"

export function SkillWorkbenchFocusHost() {
  const setViewMode = useSetAtom(viewModeAtom)
  const setTabs = useSetAtom(skillWorkbenchTabsAtom)
  const setActive = useSetAtom(skillWorkbenchActiveAtom)

  // Read current tabs through a ref so the subscription callback never
  // closes over a stale snapshot.
  const tabs = useAtomValue(skillWorkbenchTabsAtom)
  const tabsRef = useRef<SkillWorkbenchTab[]>(tabs)
  useEffect(() => {
    tabsRef.current = tabs
  }, [tabs])

  const lastApplied = useRef(0)

  trpc.skillWorkbench.focusEvents.useSubscription(undefined, {
    onData(request) {
      if (request.id <= lastApplied.current) return
      lastApplied.current = request.id

      setViewMode("skill")

      const id = `${request.skillName}::${request.relPath}`
      const existing = tabsRef.current.find((t) => t.id === id)
      if (existing) {
        setActive((a) => ({ ...a, [existing.pane]: id }))
        return
      }
      const tab: SkillWorkbenchTab = {
        id,
        skillName: request.skillName,
        skillDir: request.skillDir,
        relPath: request.relPath,
        pane: "left",
      }
      setTabs((current) =>
        current.some((t) => t.id === id) ? current : [...current, tab],
      )
      setActive((a) => ({ ...a, left: id }))
    },
    onError(err) {
      console.error("[skill-workbench] focusEvents subscription error:", err)
    },
  })

  return null
}
