/**
 * Parse Backlot editor mentions from prompt text.
 *
 * The renderer currently serializes mentions inline, so providers that need
 * structured inputs should parse them in the main process.
 */
export function parseMentions(prompt: string): {
  cleanedPrompt: string
  agentMentions: string[]
  skillMentions: string[]
  fileMentions: string[]
  folderMentions: string[]
  toolMentions: string[]
} {
  const agentMentions: string[] = []
  const skillMentions: string[] = []
  const fileMentions: string[] = []
  const folderMentions: string[] = []
  const toolMentions: string[] = []

  const mentionRegex = /@\[(file|folder|skill|agent|tool):([^\]]+)\]/g
  let match: RegExpExecArray | null

  while ((match = mentionRegex.exec(prompt)) !== null) {
    const [, type, name] = match
    switch (type) {
      case "agent":
        agentMentions.push(name)
        break
      case "skill":
        skillMentions.push(name)
        break
      case "file":
        fileMentions.push(name)
        break
      case "folder":
        folderMentions.push(name)
        break
      case "tool":
        if (
          /^[a-zA-Z0-9_-]+$/.test(name) ||
          /^mcp__[a-zA-Z0-9_-]+__[a-zA-Z0-9_-]+$/.test(name)
        ) {
          toolMentions.push(name)
        }
        break
    }
  }

  const plainSkillRegex = /(?:^|\s)skill:([a-zA-Z0-9_.:-]+)/g
  while ((match = plainSkillRegex.exec(prompt)) !== null) {
    const name = match[1]?.trim()
    if (name && !skillMentions.includes(name)) {
      skillMentions.push(name)
    }
  }

  let cleanedPrompt = prompt
    .replace(/@\[agent:[^\]]+\]/g, "")
    .replace(/@\[skill:[^\]]+\]/g, "")
    .replace(/@\[tool:[^\]]+\]/g, "")
    .replace(/(^|\s)skill:[a-zA-Z0-9_.:-]+/g, "$1")
    .trim()

  cleanedPrompt = cleanedPrompt
    .replace(/@\[file:local:([^\]]+)\]/g, "$1")
    .replace(/@\[file:external:([^\]]+)\]/g, "$1")
    .replace(/@\[folder:local:([^\]]+)\]/g, "$1")
    .replace(/@\[folder:external:([^\]]+)\]/g, "$1")

  if (toolMentions.length > 0) {
    const toolHints = toolMentions
      .map((tool) => {
        if (tool.startsWith("mcp__")) {
          return `Use the ${tool} tool for this request.`
        }
        return `Use tools from the ${tool} MCP server for this request.`
      })
      .join(" ")
    cleanedPrompt = `${toolHints}\n\n${cleanedPrompt}`
  }

  return {
    cleanedPrompt,
    agentMentions,
    skillMentions,
    fileMentions,
    folderMentions,
    toolMentions,
  }
}
