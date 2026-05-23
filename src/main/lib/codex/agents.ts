import { createHash } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { discoverInstalledPlugins, getPluginComponentPaths } from "../plugins"
import { resolveBuiltinAgents } from "../claude/builtin-agents"
import { getEnabledPlugins } from "../trpc/routers/claude-settings"
import {
  scanAgentsDirectory,
  type AgentModel,
  type FileAgent,
  type ParsedAgent,
} from "../trpc/routers/agent-utils"

const BACKLOT_CODEX_AGENTS_DIR = join(homedir(), ".backlot", "codex-agents")
const USER_CLAUDE_AGENTS_DIR = join(homedir(), ".claude", "agents")

const READ_ONLY_CLAUDE_TOOLS = new Set([
  "read",
  "glob",
  "grep",
  "ls",
])

export type CodexAgentBridge = {
  registeredNames: string[]
  mentionedAgentNames: string[]
  missingMentionedAgentNames: string[]
  appServerConfig: Record<string, unknown>
  acpConfigArgs: string[]
  fingerprint: string
}

type CodexAgentDefinition = {
  name: string
  description: string
  developerInstructions: string
  tools?: string[]
  disallowedTools?: string[]
  model?: AgentModel
  configFile: string
  sandboxMode?: "read-only"
}

function normalizeAgentName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function tomlString(value: string): string {
  return JSON.stringify(value)
}

function hasOnlyReadOnlyTools(tools: string[] | undefined): boolean {
  if (!tools || tools.length === 0) return false
  return tools.every((tool) => READ_ONLY_CLAUDE_TOOLS.has(tool.trim().toLowerCase()))
}

function withToolPolicy(agent: ParsedAgent): string {
  const policy: string[] = []
  if (agent.tools && agent.tools.length > 0) {
    policy.push(`Allowed tool policy from Backlot settings: ${agent.tools.join(", ")}.`)
  }
  if (agent.disallowedTools && agent.disallowedTools.length > 0) {
    policy.push(
      `Disallowed tool policy from Backlot settings: ${agent.disallowedTools.join(", ")}.`,
    )
  }
  if (policy.length === 0) return agent.prompt
  return `${agent.prompt}\n\n${policy.join("\n")}`
}

function toCodexAgentDefinition(agent: ParsedAgent): CodexAgentDefinition | null {
  const name = normalizeAgentName(agent.name)
  if (!name || !agent.description || !agent.prompt) return null
  return {
    name,
    description: agent.description,
    developerInstructions: withToolPolicy(agent),
    tools: agent.tools,
    disallowedTools: agent.disallowedTools,
    model: agent.model,
    configFile: join(BACKLOT_CODEX_AGENTS_DIR, `${name}.toml`),
    ...(hasOnlyReadOnlyTools(agent.tools) ? { sandboxMode: "read-only" as const } : {}),
  }
}

async function listPluginAgents(): Promise<FileAgent[]> {
  const [enabledPluginSources, installedPlugins] = await Promise.all([
    getEnabledPlugins(),
    discoverInstalledPlugins(),
  ])
  const enabledPlugins = installedPlugins.filter((plugin) =>
    enabledPluginSources.includes(plugin.source),
  )
  const pluginAgents = await Promise.all(
    enabledPlugins.map(async (plugin) => {
      const paths = getPluginComponentPaths(plugin)
      try {
        const agents = await scanAgentsDirectory(paths.agents, "plugin")
        return agents.map((agent) => ({ ...agent, pluginName: plugin.source }))
      } catch {
        return []
      }
    }),
  )
  return pluginAgents.flat()
}

async function listBacklotAgentDefinitions(cwd?: string): Promise<CodexAgentDefinition[]> {
  const projectAgentsPromise = cwd
    ? scanAgentsDirectory(join(cwd, ".claude", "agents"), "project", cwd)
    : Promise.resolve<FileAgent[]>([])

  const [projectAgents, userAgents, pluginAgents, builtinAgents] = await Promise.all([
    projectAgentsPromise,
    scanAgentsDirectory(USER_CLAUDE_AGENTS_DIR, "user"),
    listPluginAgents(),
    resolveBuiltinAgents(),
  ])

  const definitions = new Map<string, CodexAgentDefinition>()
  const add = (agent: ParsedAgent) => {
    const definition = toCodexAgentDefinition(agent)
    if (!definition || definitions.has(definition.name)) return
    definitions.set(definition.name, definition)
  }

  for (const agent of projectAgents) add(agent)
  for (const agent of userAgents) add(agent)
  for (const agent of pluginAgents) add(agent)
  for (const [name, agent] of Object.entries(builtinAgents)) {
    add({ name, ...agent })
  }

  return [...definitions.values()].sort((a, b) => a.name.localeCompare(b.name))
}

async function writeCodexAgentFile(agent: CodexAgentDefinition): Promise<void> {
  await mkdir(BACKLOT_CODEX_AGENTS_DIR, { recursive: true })
  const body = [
    `name = ${tomlString(agent.name)}`,
    `description = ${tomlString(agent.description)}`,
    ...(agent.sandboxMode ? [`sandbox_mode = ${tomlString(agent.sandboxMode)}`] : []),
    `developer_instructions = ${tomlString(agent.developerInstructions)}`,
    "",
  ].join("\n")
  await writeFile(agent.configFile, body, "utf-8")
}

function toAcpConfigArgs(agents: CodexAgentDefinition[]): string[] {
  const args: string[] = []

  for (const agent of agents) {
    args.push(
      "-c",
      `agents.${agent.name}.description=${tomlString(agent.description)}`,
      "-c",
      `agents.${agent.name}.config_file=${tomlString(agent.configFile)}`,
    )
  }

  return args
}

function toAppServerConfig(agents: CodexAgentDefinition[]): Record<string, unknown> {
  const config: Record<string, unknown> = {}

  for (const agent of agents) {
    config[agent.name] = {
      description: agent.description,
      config_file: agent.configFile,
    }
  }

  return config
}

export async function buildCodexAgentBridge(params: {
  cwd?: string
  mentionedAgentNames?: string[]
}): Promise<CodexAgentBridge> {
  const agents = await listBacklotAgentDefinitions(params.cwd)
  await Promise.all(agents.map(writeCodexAgentFile))

  const registeredNames = agents.map((agent) => agent.name)
  const registered = new Set(registeredNames)
  const mentionedAgentNames = [
    ...new Set((params.mentionedAgentNames || []).map(normalizeAgentName).filter(Boolean)),
  ]
  const availableMentionedAgentNames = mentionedAgentNames.filter((name) =>
    registered.has(name),
  )
  const missingMentionedAgentNames = mentionedAgentNames.filter(
    (name) => !registered.has(name),
  )
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        agents: agents.map((agent) => ({
          name: agent.name,
          description: agent.description,
          instructions: agent.developerInstructions,
          configFile: agent.configFile,
          sandboxMode: agent.sandboxMode || null,
        })),
        mentioned: mentionedAgentNames,
      }),
    )
    .digest("hex")

  return {
    registeredNames,
    mentionedAgentNames: availableMentionedAgentNames,
    missingMentionedAgentNames,
    appServerConfig: toAppServerConfig(agents),
    acpConfigArgs: toAcpConfigArgs(agents),
    fingerprint,
  }
}

export function buildCodexAgentMentionInstruction(input: {
  mentionedAgentNames: string[]
  missingMentionedAgentNames?: string[]
}): string {
  const mentioned = [...new Set(input.mentionedAgentNames)].filter(Boolean)
  const missing = [...new Set(input.missingMentionedAgentNames || [])].filter(Boolean)
  if (mentioned.length === 0 && missing.length === 0) return ""

  const lines = [
    "[BACKLOT AGENT MENTIONS]",
    "The user selected Backlot @agent mention(s) in a Codex chat.",
  ]

  if (mentioned.length > 0) {
    lines.push(
      `Spawn Codex subagent(s) with exactly these agent names: ${mentioned.join(", ")}.`,
      "Wait for the subagent result, then integrate or summarize it for the user in this parent thread.",
    )
  }

  if (missing.length > 0) {
    lines.push(
      `These mentioned agents are not registered for this Codex turn: ${missing.join(", ")}.`,
      "Tell the user which agent names were unavailable instead of substituting a different agent.",
    )
  }

  lines.push("[/BACKLOT AGENT MENTIONS]")
  return lines.join("\n")
}
