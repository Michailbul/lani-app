"use client"

/**
 * SkillExplorer — the left-rail navigator for Skill Workbench mode.
 *
 * Replaces the project file tree while the workbench is in view. It
 * lists the curated skills Backlot surfaces in Settings, grouped by
 * category. A skill is a folder — expanding it walks the real
 * directory (`~/.claude/skills/<name>/`) so reference docs and scripts
 * shipped alongside `SKILL.md` are all reachable.
 *
 * Clicking a file opens it as a workbench tab.
 */

import { useState } from "react"
import { useAtomValue } from "jotai"
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  File,
  FileText,
  Folder,
  FolderOpen,
  Package,
} from "lucide-react"
import { trpc } from "../../lib/trpc"
import { cn } from "../../lib/utils"
import { skillWorkbenchTabsAtom } from "./atoms"
import { useOpenSkillFile } from "./skill-workbench-view"

interface SkillTreeNode {
  kind: "file" | "folder"
  name: string
  relPath: string
  children?: SkillTreeNode[]
}

export function SkillExplorer() {
  const list = trpc.skillWorkbench.list.useQuery()

  if (list.isPending) {
    return <ExplorerMessage kicker="Loading" body={null} />
  }
  if (list.isError) {
    return (
      <ExplorerMessage
        kicker="Couldn't load skills"
        body={list.error.message}
      />
    )
  }

  const categories = list.data ?? []

  return (
    <div className="px-1.5 py-2">
      <div className="flex items-center justify-between px-2 py-1">
        <span
          className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground/70"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          Skills
        </span>
      </div>
      {categories.map((category) => (
        <section key={category.label} className="mb-2">
          <div className="px-2 pt-1.5 pb-0.5">
            <span
              className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground/55"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              {category.label}
            </span>
          </div>
          <ul>
            {category.skills.map((skill) => (
              <li key={skill.name}>
                <SkillFolderRow skill={skill} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

function SkillFolderRow({
  skill,
}: {
  skill: { name: string; dir: string; installed: boolean; description: string }
}) {
  const [open, setOpen] = useState(false)

  if (!skill.installed) {
    return (
      <div
        className="flex items-center gap-1.5 pl-2 pr-2 py-[3px] opacity-55"
        title={`Not installed at ${skill.dir}`}
      >
        <span className="w-3 shrink-0" />
        <Package className="h-3.5 w-3.5 shrink-0 text-muted-foreground/45" />
        <span
          className="truncate text-[12.5px] text-muted-foreground/70"
          style={{ fontFamily: "var(--font-body)" }}
        >
          {skill.name}
        </span>
        <AlertCircle className="h-3 w-3 shrink-0 text-amber-500/80" />
      </div>
    )
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "group w-full flex items-center gap-1.5 pl-2 pr-2 py-[3px] rounded-md",
          "hover:bg-secondary/45 transition-colors",
        )}
        title={skill.description || skill.name}
      >
        {open ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground/55" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/55" />
        )}
        {open ? (
          <FolderOpen className="h-3.5 w-3.5 shrink-0 text-primary/70" />
        ) : (
          <Folder className="h-3.5 w-3.5 shrink-0 text-primary/70" />
        )}
        <span
          className="truncate text-[12.5px] text-foreground/90"
          style={{ fontFamily: "var(--font-body)", fontWeight: 500 }}
        >
          {skill.name}
        </span>
      </button>
      {open && <SkillFolderContents skill={skill} />}
    </div>
  )
}

function SkillFolderContents({
  skill,
}: {
  skill: { name: string; dir: string }
}) {
  const tree = trpc.skillWorkbench.tree.useQuery({ skillDir: skill.dir })

  if (tree.isPending) {
    return <LeafMessage depth={1} text="Loading…" />
  }
  if (tree.isError) {
    return <LeafMessage depth={1} text={tree.error.message} tone="error" />
  }
  const nodes = tree.data ?? []
  if (nodes.length === 0) {
    return <LeafMessage depth={1} text="Empty skill folder" />
  }
  return (
    <SkillTreeLevel
      nodes={nodes}
      depth={1}
      skillName={skill.name}
      skillDir={skill.dir}
    />
  )
}

function SkillTreeLevel({
  nodes,
  depth,
  skillName,
  skillDir,
}: {
  nodes: SkillTreeNode[]
  depth: number
  skillName: string
  skillDir: string
}) {
  return (
    <ul>
      {nodes.map((node) => (
        <li key={node.relPath}>
          {node.kind === "folder" ? (
            <SkillSubFolder
              node={node}
              depth={depth}
              skillName={skillName}
              skillDir={skillDir}
            />
          ) : (
            <SkillFileRow
              node={node}
              depth={depth}
              skillName={skillName}
              skillDir={skillDir}
            />
          )}
        </li>
      ))}
    </ul>
  )
}

function SkillSubFolder({
  node,
  depth,
  skillName,
  skillDir,
}: {
  node: SkillTreeNode
  depth: number
  skillName: string
  skillDir: string
}) {
  const [open, setOpen] = useState(true)
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-1 py-[3px] rounded-md hover:bg-secondary/45 transition-colors"
        style={{ paddingLeft: indentFor(depth) }}
      >
        {open ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground/55" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/55" />
        )}
        {open ? (
          <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
        ) : (
          <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
        )}
        <span
          className="truncate text-[12px] text-foreground/80"
          style={{ fontFamily: "var(--font-body)" }}
        >
          {node.name}
        </span>
      </button>
      {open && node.children && (
        <SkillTreeLevel
          nodes={node.children}
          depth={depth + 1}
          skillName={skillName}
          skillDir={skillDir}
        />
      )}
    </div>
  )
}

function SkillFileRow({
  node,
  depth,
  skillName,
  skillDir,
}: {
  node: SkillTreeNode
  depth: number
  skillName: string
  skillDir: string
}) {
  const openFile = useOpenSkillFile()
  const tabs = useAtomValue(skillWorkbenchTabsAtom)
  const tabId = `${skillName}::${node.relPath}`
  const isOpen = tabs.some((t) => t.id === tabId)
  const Icon = node.name.toLowerCase().endsWith(".md") ? FileText : File

  return (
    <button
      type="button"
      onClick={() => openFile({ skillName, skillDir, relPath: node.relPath })}
      className={cn(
        "w-full flex items-center gap-1.5 pr-2 py-[3px] rounded-md transition-colors",
        isOpen
          ? "bg-foreground/[0.06] text-foreground dark:bg-foreground/[0.08]"
          : "text-foreground/80 hover:bg-foreground/[0.04]",
      )}
      style={{ paddingLeft: indentFor(depth) + 16 }}
      title={node.relPath}
    >
      <Icon
        className={cn(
          "h-3.5 w-3.5 shrink-0",
          isOpen ? "text-foreground/85" : "text-muted-foreground/60",
        )}
      />
      <span
        className={cn(
          "truncate text-[12px] text-left flex-1 min-w-0",
          isOpen && "font-medium",
        )}
        style={{ fontFamily: "var(--font-body)" }}
      >
        {node.name}
      </span>
    </button>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

function indentFor(depth: number): number {
  return 12 + depth * 12
}

function ExplorerMessage({
  kicker,
  body,
}: {
  kicker: string
  body: string | null
}) {
  return (
    <div className="px-4 py-5 space-y-2">
      <span
        className="block text-[10px] uppercase tracking-[0.22em] text-muted-foreground/65"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {kicker}
      </span>
      {body && (
        <p
          className="text-[11.5px] leading-[1.55] text-muted-foreground/80"
          style={{ fontFamily: "var(--font-body)" }}
        >
          {body}
        </p>
      )}
    </div>
  )
}

function LeafMessage({
  depth,
  text,
  tone,
}: {
  depth: number
  text: string
  tone?: "error"
}) {
  return (
    <div
      className={cn(
        "py-1 text-[11px] italic",
        tone === "error" ? "text-rose-500/80" : "text-muted-foreground/55",
      )}
      style={{ paddingLeft: indentFor(depth) + 16 }}
    >
      {text}
    </div>
  )
}
