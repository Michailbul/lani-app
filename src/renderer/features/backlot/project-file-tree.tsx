"use client"

/**
 * ProjectFileTree — Cursor-style recursive file/folder tree.
 *
 * The user sees exactly what's on disk inside the worktree (minus
 * `.git` / `node_modules` / build noise). Click a file → the
 * EntityEditor opens it (matched against the canonical schema by
 * path; falls through to a generic "file" kind otherwise).
 *
 * Per-folder hover affordances on the right edge:
 *   ▢+   New file inside this folder
 *   ◰+   New folder inside this folder
 *
 * Click → an inline input appears as the first child of the folder.
 * Enter creates; Esc cancels. The tree refetches; the new file is
 * auto-selected in the editor.
 *
 * No rename / delete / drag-drop in this pass — explicit follow-ups.
 *
 * The tree is generic by design. It doesn't know about Brief/World/
 * Characters/Locations as concepts — it just renders the filesystem,
 * and the EntityEditor handles per-kind chrome via path heuristic.
 * That keeps the tree honest: the user (and the agent) sees the
 * same thing the file system sees.
 */

import { useEffect, useMemo, useRef, useState } from "react"
import { useAtom, useAtomValue } from "jotai"
import {
  ChevronDown,
  ChevronRight,
  Clapperboard,
  File,
  FilePlus,
  FileText,
  Film,
  Folder,
  FolderOpen,
  FolderPlus,
} from "lucide-react"
import { selectedAgentChatIdAtom, selectedProjectAtom } from "../agents/atoms"
import { trpc } from "../../lib/trpc"
import { cn } from "../../lib/utils"
import { activeEntityAtom } from "./atoms"
import { activeEntityFromPath, labelFromFilename } from "./entity-kind"
import { toast } from "sonner"

interface TreeNode {
  kind: "folder" | "file"
  name: string
  path: string
  children?: TreeNode[]
}

/**
 * The filesystem root the tree is reading from. Backlot's two browse
 * modes share one component:
 *
 *   - `chatId` mode: the chat's worktree (forked, agent + user write
 *     here together).
 *   - `projectId` mode: the canonical project root at
 *     `~/.backlot/projects/<slug>/`. Active when no chat is selected
 *     yet but the user is viewing the project itself.
 *
 * Exactly one is set at a time. The renderer threads `EntityRoot`
 * down the tree so every create/read/write call hits the right root.
 */
type EntityRoot =
  | { chatId: string; projectId?: undefined }
  | { chatId?: undefined; projectId: string }

export function ProjectFileTree() {
  const [chatId] = useAtom(selectedAgentChatIdAtom)
  const selectedProject = useAtomValue(selectedProjectAtom)
  const projectId = selectedProject?.id ?? null

  const entityRoot: EntityRoot | null = chatId
    ? { chatId }
    : projectId
      ? { projectId }
      : null

  const tree = trpc.entities.listTree.useQuery(
    entityRoot ?? {},
    {
      enabled: !!entityRoot,
      refetchInterval: 4000,
      retry: false,
    },
  )

  if (!entityRoot) {
    return (
      <RailMessage
        kicker="No project"
        body="Pick a project from the recents to see its files."
      />
    )
  }
  if (tree.isPending) {
    return <RailMessage kicker="Loading" body={null} />
  }

  // tRPC error — most commonly because the main-process restart hasn't
  // happened after a backend change. Surface the actual error so the
  // user isn't left guessing.
  if (tree.isError) {
    return (
      <RailMessage
        kicker="Couldn't read tree"
        body={tree.error.message}
        action={{ label: "Retry", onClick: () => tree.refetch() }}
      />
    )
  }

  // Root unresolved — chat with no worktree, or projectId not in DB.
  // Tell the user explicitly; silent empty states leave them stuck.
  if (!tree.data) {
    const body = entityRoot.chatId
      ? "This chat has no project folder attached."
      : "This project's folder couldn't be found on disk."
    return <RailMessage kicker="No files" body={body} />
  }

  // Tree exists but has zero files (excluding noise). Render the
  // create affordances anyway so the user can start from blank.
  const isEmpty = (tree.data.children ?? []).length === 0

  return (
    <div className="px-1">
      <RootRow
        tree={tree.data}
        entityRoot={entityRoot}
        onChanged={tree.refetch}
      />
      {isEmpty ? (
        <div className="px-3 py-4">
          <span
            className="block text-[11px] leading-[1.5] text-muted-foreground/70"
            style={{ fontFamily: "var(--font-body)" }}
          >
            This {entityRoot.chatId ? "worktree" : "project"} is empty. Hover
            the <em>Files</em> header above to add a file or folder, or ask
            the agent to scaffold something.
          </span>
        </div>
      ) : (
        <FolderChildren
          node={tree.data}
          depth={0}
          entityRoot={entityRoot}
          onChanged={tree.refetch}
        />
      )}
    </div>
  )
}

/**
 * Inline message used by the rail's empty / loading / error states.
 * Editorial styling: tracked-mono kicker on top, body sentence under.
 */
function RailMessage({
  kicker,
  body,
  action,
}: {
  kicker: string
  body: string | null
  action?: { label: string; onClick: () => void }
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
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className={cn(
            "inline-flex items-center gap-1.5 text-[11px]",
            "text-foreground/85 hover:text-primary",
            "border-b border-primary/60 hover:border-primary",
            "transition-colors duration-150",
          )}
          style={{ fontFamily: "var(--font-body)", fontWeight: 500 }}
        >
          {action.label}
        </button>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Root row — affordance for creating top-level files / folders.
// ─────────────────────────────────────────────────────────────────────

function RootRow({
  tree,
  entityRoot,
  onChanged,
}: {
  tree: TreeNode
  entityRoot: EntityRoot
  onChanged: () => void
}) {
  const [creating, setCreating] = useState<null | "file" | "folder">(null)
  void tree

  return (
    <>
      <div className="group/root flex items-center justify-between px-2 py-1">
        <span
          className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground/70"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          Files
        </span>
        <RootActions
          onNewFile={() => setCreating("file")}
          onNewFolder={() => setCreating("folder")}
        />
      </div>
      {creating && (
        <CreateInline
          parentPath=""
          kind={creating}
          entityRoot={entityRoot}
          onClose={() => setCreating(null)}
          onCreated={onChanged}
          depth={0}
        />
      )}
    </>
  )
}

function RootActions({
  onNewFile,
  onNewFolder,
}: {
  onNewFile: () => void
  onNewFolder: () => void
}) {
  return (
    <div className="flex items-center gap-0.5 opacity-0 group-hover/root:opacity-100 focus-within:opacity-100 transition-opacity duration-150">
      <ActionIcon
        onClick={onNewFile}
        title="New file at root"
        icon={<FilePlus className="h-3 w-3" />}
      />
      <ActionIcon
        onClick={onNewFolder}
        title="New folder at root"
        icon={<FolderPlus className="h-3 w-3" />}
      />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Recursive rendering
// ─────────────────────────────────────────────────────────────────────

function FolderChildren({
  node,
  depth,
  entityRoot,
  onChanged,
}: {
  node: TreeNode
  depth: number
  entityRoot: EntityRoot
  onChanged: () => void
}) {
  const children = node.children ?? []
  return (
    <ul>
      {children.map((child) => (
        <li key={child.path}>
          {child.kind === "folder" ? (
            <FolderRow
              node={child}
              depth={depth}
              entityRoot={entityRoot}
              onChanged={onChanged}
            />
          ) : (
            <FileRow node={child} depth={depth} />
          )}
        </li>
      ))}
    </ul>
  )
}

function FolderRow({
  node,
  depth,
  entityRoot,
  onChanged,
}: {
  node: TreeNode
  depth: number
  entityRoot: EntityRoot
  onChanged: () => void
}) {
  const [open, setOpen] = useState<boolean>(() => depth === 0)
  const [creating, setCreating] = useState<null | "file" | "folder">(null)
  const Icon = open ? FolderOpen : Folder
  const Chevron = open ? ChevronDown : ChevronRight

  const startCreate = (kind: "file" | "folder") => {
    setOpen(true)
    setCreating(kind)
  }

  return (
    <div>
      <div
        className={cn(
          "group/row relative w-full flex items-center pr-1 py-[3px] rounded-md",
          "hover:bg-secondary/45 transition-colors",
        )}
      >
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-1 flex-1 min-w-0 text-left"
          style={{ paddingLeft: indentFor(depth) }}
        >
          <Chevron className="h-3 w-3 text-muted-foreground/55 shrink-0" />
          <Icon className="h-3.5 w-3.5 text-primary/70 shrink-0" />
          <span
            className="truncate text-[12.5px] text-foreground/90"
            style={{ fontFamily: "var(--font-body)", fontWeight: 500 }}
          >
            {node.name}
          </span>
        </button>
        <FolderActions
          onNewFile={() => startCreate("file")}
          onNewFolder={() => startCreate("folder")}
        />
      </div>

      {open && (
        <>
          {creating && (
            <CreateInline
              parentPath={node.path}
              kind={creating}
              entityRoot={entityRoot}
              onClose={() => setCreating(null)}
              onCreated={onChanged}
              depth={depth + 1}
            />
          )}
          <FolderChildren
            node={node}
            depth={depth + 1}
            entityRoot={entityRoot}
            onChanged={onChanged}
          />
        </>
      )}
    </div>
  )
}

function FolderActions({
  onNewFile,
  onNewFolder,
}: {
  onNewFile: () => void
  onNewFolder: () => void
}) {
  return (
    <div className="flex items-center gap-0.5 opacity-0 group-hover/row:opacity-100 focus-within:opacity-100 transition-opacity duration-150">
      <ActionIcon
        onClick={(e) => {
          e.stopPropagation()
          onNewFile()
        }}
        title="New file"
        icon={<FilePlus className="h-3 w-3" />}
      />
      <ActionIcon
        onClick={(e) => {
          e.stopPropagation()
          onNewFolder()
        }}
        title="New folder"
        icon={<FolderPlus className="h-3 w-3" />}
      />
    </div>
  )
}

function FileRow({ node, depth }: { node: TreeNode; depth: number }) {
  const [active, setActive] = useAtom(activeEntityAtom)
  const isActive = active?.path === node.path
  const label = labelFromFilename(node.name)
  const Icon = iconForFile(node.name, node.path)

  return (
    <button
      type="button"
      onClick={() => setActive(activeEntityFromPath(node.path, label))}
      className={cn(
        "relative w-full flex items-center gap-1.5 pr-2 py-[3px] rounded-md",
        "transition-colors",
        isActive
          ? "bg-primary/12 text-foreground"
          : "text-foreground/85 hover:bg-secondary/45",
      )}
      style={{ paddingLeft: indentFor(depth) + 16 }}
      title={node.path}
    >
      {isActive && (
        <span className="absolute left-0 top-1 bottom-1 w-[2px] rounded-r bg-primary" />
      )}
      <Icon
        className={cn(
          "h-3.5 w-3.5 shrink-0",
          isActive ? "text-primary" : "text-muted-foreground/65",
        )}
      />
      <span
        className={cn(
          "truncate text-[12.5px] text-left",
          isActive && "font-medium",
        )}
        style={{ fontFamily: "var(--font-body)" }}
      >
        {node.name}
      </span>
    </button>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Create flow
// ─────────────────────────────────────────────────────────────────────

function CreateInline({
  parentPath,
  kind,
  entityRoot,
  onClose,
  onCreated,
  depth,
}: {
  parentPath: string
  kind: "file" | "folder"
  entityRoot: EntityRoot
  onClose: () => void
  onCreated: () => void
  depth: number
}) {
  const [value, setValue] = useState(kind === "file" ? "untitled.md" : "untitled")
  const inputRef = useRef<HTMLInputElement>(null)
  const submittedRef = useRef(false)
  const [, setActive] = useAtom(activeEntityAtom)
  const createFile = trpc.entities.createFile.useMutation()
  const createFolder = trpc.entities.createFolder.useMutation()

  // Select the basename so the user types-and-replaces (Cursor pattern).
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.focus()
    if (kind === "file") {
      const lastDot = value.lastIndexOf(".")
      const end = lastDot > 0 ? lastDot : value.length
      el.setSelectionRange(0, end)
    } else {
      el.select()
    }
    // We deliberately want this to run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const submit = async () => {
    const trimmed = value.trim()
    if (!trimmed) {
      onClose()
      return
    }
    const path = parentPath ? `${parentPath}/${trimmed}` : trimmed
    submittedRef.current = true
    try {
      if (kind === "file") {
        await createFile.mutateAsync({ ...entityRoot, path })
        // Open the newly-created file in the editor.
        setActive(activeEntityFromPath(path, labelFromFilename(trimmed)))
      } else {
        await createFolder.mutateAsync({ ...entityRoot, path })
      }
      onCreated()
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create.")
      submittedRef.current = false
      // Keep the input open so the user can adjust the name.
    }
  }

  return (
    <div
      className="flex items-center gap-1.5 py-[3px]"
      style={{ paddingLeft: indentFor(depth) + (kind === "file" ? 16 : 0) }}
    >
      {kind === "file" ? (
        <FileText className="h-3.5 w-3.5 text-muted-foreground/55 shrink-0" />
      ) : (
        <Folder className="h-3.5 w-3.5 text-muted-foreground/55 shrink-0" />
      )}
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          if (submittedRef.current) return
          // Empty blur cancels; otherwise commits — Cursor convention.
          if (value.trim()) submit()
          else onClose()
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            submit()
          } else if (e.key === "Escape") {
            e.preventDefault()
            onClose()
          }
        }}
        className={cn(
          "flex-1 min-w-0 px-1.5 py-0.5 rounded text-[12.5px]",
          "bg-background border border-primary/45 outline-none",
          "focus:border-primary focus:ring-1 focus:ring-primary/15",
        )}
        style={{ fontFamily: "var(--font-body)" }}
        spellCheck={false}
        autoComplete="off"
      />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Visual helpers
// ─────────────────────────────────────────────────────────────────────

/**
 * Indent in pixels per nesting level. Tight enough to keep deep trees
 * readable on a 240–320px rail, loose enough that the eye can track
 * level changes without counting chevrons.
 */
function indentFor(depth: number): number {
  return 8 + depth * 12
}

function ActionIcon({
  onClick,
  title,
  icon,
}: {
  onClick: (e: React.MouseEvent) => void
  title: string
  icon: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={cn(
        "h-5 w-5 flex items-center justify-center rounded",
        "text-muted-foreground/45 hover:text-primary hover:bg-primary/10",
        "transition-colors",
      )}
    >
      {icon}
    </button>
  )
}

/**
 * Pick an icon for a file based on filename + path. Recognises the
 * canonical Backlot kinds; everything else gets the generic file icon.
 */
function iconForFile(name: string, path: string): typeof File {
  const lower = name.toLowerCase()
  if (lower === "main-script.fountain" || lower === "screenplay.fountain") {
    return Clapperboard
  }
  if (lower.endsWith(".fountain")) return Film
  if (lower.endsWith(".md")) return FileText
  // Acts/scenes/shots/characters/locations all use .md, already handled above.
  return File
}
