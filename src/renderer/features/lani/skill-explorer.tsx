"use client"

/**
 * SkillExplorer — the left-rail navigator for Skill Workbench mode.
 *
 * Replaces the project file tree while the workbench is in view. It
 * lists the curated skills Lani surfaces in Settings, grouped by
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
  Plus,
} from "lucide-react"
import { toast } from "sonner"
import { trpc } from "../../lib/trpc"
import { cn } from "../../lib/utils"
import { skillWorkbenchTabsAtom } from "./atoms"
import { useOpenSkillFile } from "./skill-workbench-view"

interface SkillTreeNode {
  kind: "file" | "folder"
  name: string
  relPath: string
  status?: "clean" | "modified" | "untracked" | "deleted" | "added"
  changedDescendantCount?: number
  children?: SkillTreeNode[]
}

export function SkillExplorer() {
  const list = trpc.skillWorkbench.list.useQuery(undefined, {
    refetchInterval: 2000,
  })
  const utils = trpc.useUtils()
  const openFile = useOpenSkillFile()
  const [creating, setCreating] = useState(false)

  const create = trpc.skillWorkbench.create.useMutation({
    onSuccess: ({ slug, dir }) => {
      void utils.skillWorkbench.list.invalidate()
      void utils.skills.library.invalidate()
      setCreating(false)
      openFile({ skillName: slug, skillDir: dir, relPath: "SKILL.md" })
      toast.success(`Created skill "${slug}"`)
    },
    onError: (e) => toast.error(e.message || "Couldn't create the skill"),
  })

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

  const skills = list.data ?? []

  return (
    <div className="px-1.5 py-2">
      <div className="flex items-center justify-between px-2 py-1">
        <span
          className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground/70"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          Skills
        </span>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] tabular-nums text-muted-foreground/50 font-mono">
            {skills.length}
          </span>
          <button
            type="button"
            onClick={() => setCreating(true)}
            title="New skill"
            aria-label="New skill"
            className={cn(
              "h-4 w-4 flex items-center justify-center rounded",
              "text-muted-foreground/55 hover:text-foreground",
              "hover:bg-foreground/[0.06] transition-colors",
            )}
          >
            <Plus className="h-3 w-3" />
          </button>
        </div>
      </div>
      {creating && (
        <NewSkillRow
          busy={create.isPending}
          onSubmit={(name) => create.mutate({ name })}
          onCancel={() => setCreating(false)}
        />
      )}
      {skills.length === 0 && !creating ? (
        <ExplorerMessage
          kicker="Empty"
          body="No skills in ~/.lani/skills yet — use + above to create one, or add some from Settings."
        />
      ) : (
        <ul>
          {skills.map((skill) => (
            <li key={skill.name}>
              <SkillFolderRow skill={skill} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * Inline create row — type a skill name, Enter scaffolds the folder +
 * SKILL.md, Escape (or empty blur) cancels.
 */
function NewSkillRow({
  busy,
  onSubmit,
  onCancel,
}: {
  busy: boolean
  onSubmit: (name: string) => void
  onCancel: () => void
}) {
  const [name, setName] = useState("")
  const submit = () => {
    if (busy) return
    if (!name.trim()) {
      onCancel()
      return
    }
    onSubmit(name)
  }
  return (
    <div className="flex items-center gap-1.5 pl-2 pr-2 py-[3px]">
      <span className="w-3 shrink-0" />
      <Folder className="h-3.5 w-3.5 shrink-0 text-primary/70" />
      <input
        autoFocus
        value={name}
        disabled={busy}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            submit()
          } else if (e.key === "Escape") {
            e.preventDefault()
            onCancel()
          }
        }}
        onBlur={() => {
          if (!name.trim()) onCancel()
        }}
        placeholder="new-skill-name"
        spellCheck={false}
        className={cn(
          "flex-1 min-w-0 bg-transparent outline-none text-[12.5px]",
          "text-foreground/90 placeholder:text-muted-foreground/45",
          busy && "opacity-55",
        )}
        style={{ fontFamily: "var(--font-body)" }}
      />
    </div>
  )
}

function SkillFolderRow({
  skill,
}: {
  skill: {
    name: string
    dir: string
    installed: boolean
    description: string
    changedDescendantCount?: number
  }
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
        {skill.changedDescendantCount ? (
          <span
            className="ml-auto rounded-sm bg-primary/12 px-1 py-px text-[9px] font-mono text-primary"
            title={`${skill.changedDescendantCount} changed file${
              skill.changedDescendantCount === 1 ? "" : "s"
            }`}
          >
            {skill.changedDescendantCount}
          </span>
        ) : null}
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
  const tree = trpc.skillWorkbench.tree.useQuery(
    { skillDir: skill.dir },
    { refetchInterval: 2000 },
  )

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
        {node.changedDescendantCount ? (
          <span
            className="ml-auto rounded-sm bg-primary/10 px-1 py-px text-[9px] font-mono text-primary/85"
            title={`${node.changedDescendantCount} changed file${
              node.changedDescendantCount === 1 ? "" : "s"
            }`}
          >
            {node.changedDescendantCount}
          </span>
        ) : null}
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
  const status = node.status && node.status !== "clean" ? node.status : null

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
      {status ? <FileStatusBadge status={status} /> : null}
    </button>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

function indentFor(depth: number): number {
  return 12 + depth * 12
}

function FileStatusBadge({
  status,
}: {
  status: "modified" | "untracked" | "deleted" | "added"
}) {
  const label =
    status === "untracked"
      ? "U"
      : status === "deleted"
        ? "D"
        : status === "added"
          ? "A"
          : "M"
  return (
    <span
      className={cn(
        "shrink-0 rounded-sm px-1 py-px text-[9px] font-mono",
        status === "deleted"
          ? "bg-rose-500/10 text-rose-500"
          : status === "untracked" || status === "added"
            ? "bg-primary/12 text-primary"
            : "bg-amber-500/10 text-amber-600 dark:text-amber-400",
      )}
      title={
        status === "untracked"
          ? "Untracked"
          : status === "deleted"
            ? "Deleted"
            : status === "added"
              ? "Added"
              : "Modified"
      }
    >
      {label}
    </span>
  )
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
