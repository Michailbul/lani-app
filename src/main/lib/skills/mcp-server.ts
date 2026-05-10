/**
 * In-process MCP server exposing skill-editing tools to the Claude
 * Agent SDK. Runs inside Backlot's main process; no external binary.
 *
 * Currently exposes one tool: `propose_skill_change` — the agent
 * proposes a new SKILL.md body, the renderer shows a diff modal, and
 * the user clicks Apply (write to disk) or Dismiss (no-op). The tool
 * call awaits the user's verdict and returns a textual result the
 * agent can read.
 *
 * The tool deliberately does NOT write the file directly — the user
 * is in the loop. Apply happens on the main side after the renderer
 * confirms, so the file write is auditable and tied to a UI action.
 *
 * To add more skill-related tools later (rename, delete, create new
 * skill), add them to the same server so the agent sees one coherent
 * "skills" toolset.
 */

import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import matter from "gray-matter"
import { z } from "zod"
import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
} from "@anthropic-ai/claude-agent-sdk"
import { createProposal } from "./proposals"

/** Server name as it appears in MCP config. Keep stable — referenced
 *  by the renderer when displaying tool calls. */
export const SKILLS_MCP_SERVER_NAME = "backlot-skills"

/** Tool name as the agent invokes it. Stable. */
export const PROPOSE_SKILL_CHANGE_TOOL = "propose_skill_change"

/**
 * Resolve a skill path the agent may have given us. Accepts:
 *   - absolute path (`/Users/.../SKILL.md`)
 *   - tilde-prefixed (`~/.claude/skills/foo/SKILL.md`)
 *   - directory path (`~/.claude/skills/foo`) — auto-appends SKILL.md
 *
 * Returns an absolute path. We do not resolve relative paths because
 * the agent's cwd is the project worktree, and skills can live
 * outside it. If the path doesn't end in SKILL.md and points to a
 * directory, we append SKILL.md.
 */
async function resolveSkillFilePath(input: string): Promise<string> {
  let p = input.trim()
  if (p.startsWith("~")) {
    p = path.join(os.homedir(), p.slice(1))
  }
  if (!path.isAbsolute(p)) {
    throw new Error(
      `skill_path must be absolute (or tilde-prefixed). Got: ${input}`,
    )
  }
  // If the path is a directory, append SKILL.md.
  try {
    const stat = await fs.stat(p)
    if (stat.isDirectory()) {
      p = path.join(p, "SKILL.md")
    }
  } catch {
    // Path doesn't exist yet — assume the caller means a new SKILL.md
    // file at that location (creating skills isn't supported in this
    // first cut, so this will fall through to the readFile error).
  }
  return p
}

/** Try to extract a friendly skill name from frontmatter; fall back
 *  to the parent directory name. */
function extractSkillName(skillPath: string, content: string): string {
  try {
    const parsed = matter(content)
    if (typeof parsed.data?.name === "string" && parsed.data.name.trim()) {
      return parsed.data.name.trim()
    }
  } catch {
    /* ignore */
  }
  return path.basename(path.dirname(skillPath))
}

/** Determine source bucket for UI grouping. We mirror the same
 *  classification used by the skills router (~/.claude/skills →
 *  "user", project-relative .claude/skills → "project", everything
 *  else → "plugin"). */
function classifySkillSource(
  skillPath: string,
  cwd: string | null,
): "user" | "project" | "plugin" {
  const userSkillsRoot = path.join(os.homedir(), ".claude", "skills")
  if (skillPath.startsWith(userSkillsRoot + path.sep)) return "user"
  if (cwd) {
    const projectSkillsRoot = path.join(cwd, ".claude", "skills")
    if (skillPath.startsWith(projectSkillsRoot + path.sep)) return "project"
  }
  return "plugin"
}

/**
 * Build the in-process MCP server. Call this once per Claude session
 * (the `cwd` is captured here so the tool can correctly classify
 * project-vs-user skills for the active workspace).
 */
export function buildSkillsMcpServer(opts: {
  cwd?: string | null
}): McpSdkServerConfigWithInstance {
  const cwd = opts.cwd ?? null

  return createSdkMcpServer({
    name: SKILLS_MCP_SERVER_NAME,
    version: "0.1.0",
    tools: [
      tool(
        PROPOSE_SKILL_CHANGE_TOOL,
        // Description is what the agent sees when deciding whether
        // to call this tool. Be specific about WHEN to use it so
        // Claude doesn't reach for plain Edit/Write on SKILL.md
        // files.
        [
          "Propose a change to a SKILL.md file (a Claude Agent SDK skill",
          "definition). The user will see a diff in a modal and",
          "explicitly Apply or Dismiss the change before it touches",
          "disk. ALWAYS use this tool — never Edit/Write — when the",
          "user asks you to update, refine, or rewrite an existing",
          "skill, including frontmatter or body.",
          "",
          "Inputs:",
          "  • skill_path: absolute path (or ~-prefixed) to the SKILL.md.",
          "    A directory path is accepted and SKILL.md is appended.",
          "  • new_content: full proposed file content (frontmatter + body).",
          "    Send the entire file, not a patch.",
          "  • summary: one-line description (≤120 chars) of what",
          "    changes and why. Shown to the user above the diff.",
          "",
          "Returns: a result describing whether the user applied or",
          "dismissed the change. On apply, the file has been written.",
        ].join("\n"),
        {
          skill_path: z
            .string()
            .min(1)
            .describe("Absolute or ~-prefixed path to SKILL.md (or its directory)."),
          new_content: z
            .string()
            .min(1)
            .describe("Full proposed file content, including frontmatter."),
          summary: z
            .string()
            .min(1)
            .max(160)
            .describe("One-line summary of the change shown above the diff."),
        },
        async (args) => {
          let absPath: string
          try {
            absPath = await resolveSkillFilePath(args.skill_path)
          } catch (e) {
            return {
              content: [
                {
                  type: "text",
                  text: `Failed to resolve skill_path: ${(e as Error).message}`,
                },
              ],
              isError: true,
            }
          }

          let oldContent: string
          try {
            oldContent = await fs.readFile(absPath, "utf-8")
          } catch (e) {
            return {
              content: [
                {
                  type: "text",
                  text: `Failed to read existing skill file at ${absPath}: ${(e as Error).message}`,
                },
              ],
              isError: true,
            }
          }

          // Sanity check — if proposed content is identical, skip
          // surfacing a useless modal.
          if (args.new_content === oldContent) {
            return {
              content: [
                {
                  type: "text",
                  text: "No-op: proposed content is identical to current SKILL.md content. Nothing to apply.",
                },
              ],
            }
          }

          const skillName = extractSkillName(absPath, oldContent)
          const source = classifySkillSource(absPath, cwd)

          const verdict = await createProposal({
            skillName,
            skillPath: absPath,
            source,
            oldContent,
            newContent: args.new_content,
            summary: args.summary.trim(),
          })

          if (verdict.action === "dismiss") {
            return {
              content: [
                {
                  type: "text",
                  text: `User dismissed the proposed change to ${skillName} (${absPath}). The file was NOT modified.`,
                },
              ],
            }
          }

          // Apply: write the new content. We do the actual write
          // here on the main side so it's tied to the resolved
          // verdict and can fail with a clear message back to the
          // agent if disk is unwritable.
          try {
            await fs.writeFile(absPath, args.new_content, "utf-8")
          } catch (e) {
            return {
              content: [
                {
                  type: "text",
                  text: `User applied the change but the file write failed: ${(e as Error).message}`,
                },
              ],
              isError: true,
            }
          }

          return {
            content: [
              {
                type: "text",
                text: `User applied the proposed change to ${skillName}. ${absPath} updated on disk.`,
              },
            ],
          }
        },
      ),
    ],
  })
}
