/**
 * Skill Workbench focus bus — lets an agent (running inside the Claude
 * Agent SDK as the in-process `open_skill_workbench` MCP tool) ask the
 * renderer to switch into Skill Workbench mode and open a specific
 * skill file.
 *
 * Flow:
 *   1. The user tells the agent "let's adapt the X skill".
 *   2. The agent calls `open_skill_workbench`, which calls
 *      `requestSkillWorkbenchFocus()` here.
 *   3. The renderer's `skillWorkbench.focusEvents` subscription receives
 *      the request and flips the workbench into view on the file.
 *
 * Unlike skill proposals this is fire-and-forget — the tool does not
 * wait for a user verdict, it just moves the app's focus. Requests are
 * live-only; nothing is replayed to a fresh subscriber, so relaunching
 * the app never re-hijacks the view mode.
 */

import { EventEmitter } from "node:events"

export interface SkillWorkbenchFocusRequest {
  /** Monotonic id so the renderer can ignore a replayed request. */
  id: number
  /** Skill slug — the directory name under ~/.claude/skills. */
  skillName: string
  /** Absolute path of the skill's directory. */
  skillDir: string
  /** File to open, relative to `skillDir`. Defaults to "SKILL.md". */
  relPath: string
}

const emitter = new EventEmitter()
emitter.setMaxListeners(50)

let counter = 0

/** Ask the renderer to focus the Skill Workbench on a file. */
export function requestSkillWorkbenchFocus(input: {
  skillName: string
  skillDir: string
  relPath?: string
}): SkillWorkbenchFocusRequest {
  const request: SkillWorkbenchFocusRequest = {
    id: ++counter,
    skillName: input.skillName,
    skillDir: input.skillDir,
    relPath: input.relPath?.trim() || "SKILL.md",
  }
  emitter.emit("focus", request)
  return request
}

/** Subscribe to focus requests. Returns an unsubscribe function. */
export function subscribeSkillWorkbenchFocus(
  cb: (request: SkillWorkbenchFocusRequest) => void,
): () => void {
  emitter.on("focus", cb)
  return () => emitter.off("focus", cb)
}
