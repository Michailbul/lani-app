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
 * Drag image/video files from Finder onto a folder to copy them into
 * the project. Duplicate names get suffixed by the main process rather
 * than overwritten.
 *
 * The tree is generic by design. It doesn't know about Brief/World/
 * Characters/Locations as concepts — it just renders the filesystem,
 * and the EntityEditor handles per-kind chrome via path heuristic.
 * That keeps the tree honest: the user (and the agent) sees the
 * same thing the file system sees.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import {
  AtSign,
  Check,
  ChevronDown,
  ChevronRight,
  Clapperboard,
  Copy,
  File,
  FilePlus,
  FileText,
  Film,
  Folder,
  FolderOpen,
  FolderPlus,
  Image as ImageIcon,
  ListChecks,
  PencilLine,
  Trash2,
  Upload,
  Video,
  X,
} from "lucide-react"
import {
  pendingMentionAtom,
  selectedAgentChatIdAtom,
  selectedProjectAtom,
} from "../agents/atoms"
import { trpc } from "../../lib/trpc"
import { cn } from "../../lib/utils"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "../../components/ui/context-menu"
import { activeEntityAtom, shotlistSubmodeAtom, viewModeAtom } from "./atoms"
import {
  activeEntityFromPath,
  CANVAS_DROP_MIME,
  isImagePath,
  isQueuePath,
  isShotlistPath,
  isVideoPath,
  labelFromFilename,
} from "./entity-kind"
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

/** Cursor-style status letters per path. Read from `paths.changedFiles`
 *  and threaded through the tree via context so every FileRow / FolderRow
 *  can render a badge without prop-drilling. */
type FileStatus =
  | "modified"
  | "added"
  | "untracked"
  | "deleted"
  | "renamed"
  | "clean"
const ChangedFilesContext = createContext<Map<string, FileStatus>>(new Map())

/**
 * Multi-select state for the file tree. Lets the user build up a set of
 * paths (via cmd/ctrl-click or the per-row checkbox) and act on them as
 * a group — currently only bulk delete, but the same selection set is
 * the natural seat for any future batch op (move, archive, export).
 *
 * `active` is just `selected.size > 0` — exposed as a flag so each row
 * can show its checkbox permanently while a selection is in flight,
 * not just on hover.
 */
interface FileSelectionState {
  selected: ReadonlySet<string>
  active: boolean
  isSelected: (path: string) => boolean
  toggle: (path: string) => void
  clear: () => void
}
const FileSelectionContext = createContext<FileSelectionState | null>(null)
function useFileSelection(): FileSelectionState {
  const ctx = useContext(FileSelectionContext)
  if (!ctx) {
    throw new Error("FileSelectionContext is missing — wrap in the provider.")
  }
  return ctx
}

function hasDroppedFiles(event: React.DragEvent): boolean {
  return Array.from(event.dataTransfer.types).includes("Files")
}

function pathForDroppedFile(file: File): string | null {
  const pathFromElectron = window.webUtils?.getPathForFile(file)
  if (pathFromElectron) return pathFromElectron

  // Older Electron builds exposed `path` directly on File. Keep this
  // fallback for dev shells, but prefer the preload bridge above.
  const legacyPath = (file as File & { path?: string }).path
  return legacyPath || null
}

function droppedMediaPaths(event: React.DragEvent): string[] {
  return Array.from(event.dataTransfer.files)
    .map(pathForDroppedFile)
    .filter((path): path is string => !!path)
    .filter((path) => isImagePath(path) || isVideoPath(path))
}

export function ProjectFileTree({
  trafficLightInset = false,
}: { trafficLightInset?: boolean } = {}) {
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

  // Pending-changes overlay — only meaningful inside a chat (worktrees
  // have a HEAD to diff against). Polled at the same cadence as the
  // tree so a fresh agent edit shows its status badge promptly.
  const changedFilesQuery = trpc.paths.changedFiles.useQuery(
    { chatId: chatId ?? "" },
    {
      enabled: !!chatId,
      refetchInterval: 3000,
      refetchOnWindowFocus: true,
    },
  )
  const changedFilesMap = useMemo(() => {
    const map = new Map<string, FileStatus>()
    for (const entry of changedFilesQuery.data ?? []) {
      map.set(entry.relPath, entry.status as FileStatus)
    }
    return map
  }, [changedFilesQuery.data])

  // Multi-select state — scoped per tree mount. Switching project/chat
  // remounts this component (the `key` is the entity-root key upstream),
  // which is the simplest way to guarantee selection resets.
  const [selectedPaths, setSelectedPaths] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  )
  const fileSelection = useMemo<FileSelectionState>(
    () => ({
      selected: selectedPaths,
      active: selectedPaths.size > 0,
      isSelected: (path) => selectedPaths.has(path),
      toggle: (path) =>
        setSelectedPaths((prev) => {
          const next = new Set(prev)
          if (next.has(path)) next.delete(path)
          else next.add(path)
          return next
        }),
      clear: () => setSelectedPaths(new Set<string>()),
    }),
    [selectedPaths],
  )

  // Escape clears the selection from anywhere — same affordance the
  // user expects from any multi-select surface.
  useEffect(() => {
    if (!fileSelection.active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") fileSelection.clear()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [fileSelection])

  const [, setActive] = useAtom(activeEntityAtom)
  const setViewMode = useSetAtom(viewModeAtom)
  const setSubmode = useSetAtom(shotlistSubmodeAtom)
  const importShotlist = trpc.shotlists.pickAndImportHtml.useMutation({
    onSuccess: (result) => {
      if (!result) return
      setActive(activeEntityFromPath(result.relPath, "Shotlist"))
      setViewMode("shotlist")
      setSubmode("shotlist")
      void tree.refetch()
      toast.success("Imported shotlist HTML", {
        description: result.relPath,
      })
    },
    onError: (err) => {
      toast.error(err.message || "Couldn't import shotlist")
    },
  })

  if (!entityRoot) {
    return (
      <RailMessage
        insetTop={trafficLightInset}
        kicker="No project"
        body="Pick a project from the recents to see its files."
      />
    )
  }
  if (tree.isPending) {
    return (
      <RailMessage insetTop={trafficLightInset} kicker="Loading" body={null} />
    )
  }

  // tRPC error — most commonly because the main-process restart hasn't
  // happened after a backend change. Surface the actual error so the
  // user isn't left guessing.
  if (tree.isError) {
    return (
      <RailMessage
        insetTop={trafficLightInset}
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
    return (
      <RailMessage insetTop={trafficLightInset} kicker="No files" body={body} />
    )
  }

  // Tree exists but has zero files (excluding noise). Render the
  // create affordances anyway so the user can start from blank.
  const isEmpty = (tree.data.children ?? []).length === 0

  const refetchAll = () => {
    void tree.refetch()
    void changedFilesQuery.refetch()
  }

  return (
    <ChangedFilesContext.Provider value={changedFilesMap}>
    <FileSelectionContext.Provider value={fileSelection}>
    <div className="px-1">
      <RootRow
        tree={tree.data}
        entityRoot={entityRoot}
        onChanged={tree.refetch}
        onImportShotlist={() => importShotlist.mutate(entityRoot)}
        importingShotlist={importShotlist.isPending}
        trafficLightInset={trafficLightInset}
      />
      <SelectionActionBar entityRoot={entityRoot} onChanged={refetchAll} />
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
    </FileSelectionContext.Provider>
    </ChangedFilesContext.Provider>
  )
}

/**
 * Bulk-action strip — visible only when at least one row is in the
 * multi-select set. Sits just below the "Files" header so the count
 * and the actions are always in the same spot.
 */
function SelectionActionBar({
  entityRoot,
  onChanged,
}: {
  entityRoot: EntityRoot
  onChanged: () => void
}) {
  const selection = useFileSelection()
  const [active, setActive] = useAtom(activeEntityAtom)
  const deleteMany = trpc.entities.deleteMany.useMutation({
    onSuccess: (result, vars) => {
      // If the active entity was deleted, clear it so the editor doesn't
      // point at a vanished file.
      if (active && vars.paths.includes(active.path)) setActive(null)
      selection.clear()
      onChanged()
      const n = result.deleted.length
      if (n > 0) {
        toast.success(n === 1 ? "Deleted 1 item" : `Deleted ${n} items`)
      }
      if (result.errors.length > 0) {
        toast.error(
          result.errors.length === 1
            ? `Couldn't delete 1 item: ${result.errors[0]?.error ?? ""}`
            : `Couldn't delete ${result.errors.length} items`,
        )
      }
    },
    onError: (err) => {
      toast.error(err.message || "Couldn't delete the selection")
    },
  })

  if (!selection.active) return null

  const count = selection.selected.size
  const handleDelete = () => {
    const ok = window.confirm(
      `Delete ${count} ${count === 1 ? "item" : "items"}? Folders are removed with everything inside. This can't be undone.`,
    )
    if (!ok) return
    deleteMany.mutate({
      ...entityRoot,
      paths: Array.from(selection.selected),
    })
  }

  return (
    <div className="mx-2 mb-1 flex items-center gap-2 rounded-md border border-border/50 bg-foreground/[0.04] px-2 py-1">
      <span
        className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground"
      >
        {count} selected
      </span>
      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          onClick={selection.clear}
          title="Clear selection (Esc)"
          className="press inline-flex h-6 items-center gap-1 rounded px-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70 transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
        >
          <X className="h-3 w-3" />
          Clear
        </button>
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleteMany.isPending}
          title={`Delete ${count} selected ${count === 1 ? "item" : "items"}`}
          className="press inline-flex h-6 items-center gap-1 rounded bg-rose-500/15 px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-rose-500 transition-colors hover:bg-rose-500/25 disabled:cursor-not-allowed disabled:opacity-50 dark:text-rose-400"
        >
          <Trash2 className="h-3 w-3" />
          Delete
        </button>
      </div>
    </div>
  )
}

/**
 * Small per-row checkbox. Hidden until the row is hovered or the
 * selection is already non-empty (so the user can add to it).
 * Stop-propagates its click so it never accidentally opens a file.
 */
function RowSelectCheckbox({ path }: { path: string }) {
  const selection = useFileSelection()
  const checked = selection.isSelected(path)
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={(e) => {
        e.stopPropagation()
        e.preventDefault()
        selection.toggle(path)
      }}
      title={checked ? "Deselect" : "Add to selection"}
      className={cn(
        "press shrink-0 inline-flex h-3.5 w-3.5 items-center justify-center rounded-[3px] border transition-colors",
        checked
          ? "border-primary bg-primary text-primary-foreground"
          : "border-foreground/30 bg-transparent text-transparent hover:border-foreground/60",
        // Visible on hover, always when something is already selected,
        // and always when this row itself is selected.
        !checked && !selection.active && "opacity-0 group-hover/row:opacity-100",
      )}
    >
      {checked && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
    </button>
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
  insetTop = false,
}: {
  kicker: string
  body: string | null
  action?: { label: string; onClick: () => void }
  insetTop?: boolean
}) {
  return (
    <div className={cn("px-4 py-5 space-y-2", insetTop && "pt-12")}>
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
  onImportShotlist,
  importingShotlist,
  trafficLightInset,
}: {
  tree: TreeNode
  entityRoot: EntityRoot
  onChanged: () => void
  onImportShotlist: () => void
  importingShotlist: boolean
  trafficLightInset: boolean
}) {
  const [creating, setCreating] = useState<null | "file" | "folder">(null)
  const mediaDrop = useMediaDropImport({
    entityRoot,
    targetDir: "",
    onChanged,
  })
  void tree

  return (
    <>
      <div
        {...mediaDrop.dropHandlers}
        className={cn(
          "group/root flex h-10 items-center justify-between",
          mediaDrop.isDragOver &&
            "rounded-md bg-primary/10 ring-1 ring-primary/30",
          // When the rail is the window's left-most panel, shift the
          // header right so "Files" clears the native traffic lights.
          trafficLightInset ? "pl-[74px] pr-2" : "px-2",
        )}
      >
        <span
          className="text-[10px] uppercase leading-none tracking-[0.22em] text-muted-foreground/70"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          Files
        </span>
        <RootActions
          onNewFile={() => setCreating("file")}
          onNewFolder={() => setCreating("folder")}
          onImportShotlist={onImportShotlist}
          importingShotlist={importingShotlist}
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
  onImportShotlist,
  importingShotlist,
}: {
  onNewFile: () => void
  onNewFolder: () => void
  onImportShotlist: () => void
  importingShotlist: boolean
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
      <ActionIcon
        onClick={onImportShotlist}
        title={importingShotlist ? "Importing shotlist..." : "Import shotlist HTML"}
        icon={<Upload className="h-3 w-3" />}
      />
    </div>
  )
}

function useMediaDropImport({
  entityRoot,
  targetDir,
  onChanged,
  onAcceptDrag,
}: {
  entityRoot: EntityRoot
  targetDir: string
  onChanged: () => void
  onAcceptDrag?: () => void
}) {
  const [isDragOver, setIsDragOver] = useState(false)
  const dragDepthRef = useRef(0)
  const setActive = useSetAtom(activeEntityAtom)
  const setViewMode = useSetAtom(viewModeAtom)
  const importMediaFiles = trpc.entities.importMediaFiles.useMutation()

  const resetDragState = useCallback(() => {
    dragDepthRef.current = 0
    setIsDragOver(false)
  }, [])

  const markDragAccepted = useCallback(
    (event: React.DragEvent) => {
      if (!hasDroppedFiles(event) || importMediaFiles.isPending) return false
      event.preventDefault()
      event.stopPropagation()
      event.dataTransfer.dropEffect = "copy"
      setIsDragOver(true)
      onAcceptDrag?.()
      return true
    },
    [importMediaFiles.isPending, onAcceptDrag],
  )

  const onDragEnter = useCallback(
    (event: React.DragEvent) => {
      if (!markDragAccepted(event)) return
      dragDepthRef.current += 1
    },
    [markDragAccepted],
  )

  const onDragOver = useCallback(
    (event: React.DragEvent) => {
      markDragAccepted(event)
    },
    [markDragAccepted],
  )

  const onDragLeave = useCallback((event: React.DragEvent) => {
    if (!hasDroppedFiles(event)) return
    event.preventDefault()
    event.stopPropagation()
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) {
      setIsDragOver(false)
    }
  }, [])

  const onDrop = useCallback(
    async (event: React.DragEvent) => {
      if (!hasDroppedFiles(event)) return
      event.preventDefault()
      event.stopPropagation()
      resetDragState()

      const allFiles = Array.from(event.dataTransfer.files)
      const files = droppedMediaPaths(event)
      if (files.length === 0) {
        toast.message("Drop image or video files", {
          description:
            allFiles.length > 0
              ? "Backlot only imports media into the file tree."
              : "No local files were found in that drop.",
        })
        return
      }

      try {
        const result = await importMediaFiles.mutateAsync({
          ...entityRoot,
          targetDir,
          files,
        })
        onChanged()

        const lastImported = result.imported.at(-1)
        if (lastImported) {
          const nextActive = activeEntityFromPath(
            lastImported.path,
            labelFromFilename(lastImported.name),
          )
          setActive(nextActive)
          setViewMode("screenwriting")
        }

        if (result.imported.length > 0) {
          toast.success(
            result.imported.length === 1
              ? `Imported ${result.imported[0]?.name ?? "media"}`
              : `Imported ${result.imported.length} media files`,
            {
              description: targetDir || "Project root",
            },
          )
        }

        if (result.rejected.length > 0) {
          toast.message(
            result.rejected.length === 1
              ? "Skipped 1 file"
              : `Skipped ${result.rejected.length} files`,
            { description: "Only image and video files can be imported." },
          )
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Couldn't import media")
      }
    },
    [
      entityRoot,
      importMediaFiles,
      onChanged,
      resetDragState,
      setActive,
      setViewMode,
      targetDir,
    ],
  )

  return {
    isDragOver,
    dropHandlers: {
      onDragEnter,
      onDragOver,
      onDragLeave,
      onDrop,
    },
  }
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
            <FileRow
              node={child}
              depth={depth}
              entityRoot={entityRoot}
              onChanged={onChanged}
            />
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
  const [renaming, setRenaming] = useState(false)
  const Icon = open ? FolderOpen : Folder
  const Chevron = open ? ChevronDown : ChevronRight
  const selection = useFileSelection()
  const isSelected = selection.isSelected(node.path)
  const mediaDrop = useMediaDropImport({
    entityRoot,
    targetDir: node.path,
    onChanged,
    onAcceptDrag: () => setOpen(true),
  })

  // The root row (depth 0) is the project itself — renaming it would
  // mean renaming the worktree / project folder, which is out of scope
  // for the file tree. Suppress the affordance for that one row.
  const canRename = depth > 0

  const startCreate = (kind: "file" | "folder") => {
    setOpen(true)
    setCreating(kind)
  }

  return (
    <div>
      {renaming ? (
        <RenameInline
          node={node}
          entityRoot={entityRoot}
          depth={depth}
          onClose={() => setRenaming(false)}
          onRenamed={onChanged}
        />
      ) : (
      <RowContextMenu
        node={node}
        entityRoot={entityRoot}
        onChanged={onChanged}
        onRename={canRename ? () => setRenaming(true) : undefined}
      >
        <div
          {...mediaDrop.dropHandlers}
          className={cn(
            "group/row relative w-full flex items-center pr-1 py-[3px] rounded-md",
            "hover:bg-secondary/45 transition-colors",
            isSelected && "bg-primary/10 ring-1 ring-primary/30",
            mediaDrop.isDragOver &&
              "bg-primary/10 ring-1 ring-primary/30 hover:bg-primary/10",
          )}
        >
          <button
            type="button"
            onClick={(e) => {
              // Cmd/Ctrl-click toggles selection instead of expanding —
              // the standard multi-select shortcut.
              if (e.metaKey || e.ctrlKey) {
                e.preventDefault()
                selection.toggle(node.path)
                return
              }
              setOpen((o) => !o)
            }}
            className="flex items-center gap-1 flex-1 min-w-0 text-left"
            style={{ paddingLeft: indentFor(depth) }}
          >
            <Chevron className="h-3 w-3 text-muted-foreground/55 shrink-0" />
            <Icon className="h-3.5 w-3.5 text-primary/70 shrink-0" />
            <RowSelectCheckbox path={node.path} />
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
      </RowContextMenu>
      )}

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

function FileRow({
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
  const [active, setActive] = useAtom(activeEntityAtom)
  const [viewMode, setViewMode] = useAtom(viewModeAtom)
  const setSubmode = useSetAtom(shotlistSubmodeAtom)
  const [renaming, setRenaming] = useState(false)
  const isActive = active?.path === node.path
  const label = labelFromFilename(node.name)
  const Icon = iconForFile(node.name, node.path)
  const changedFiles = useContext(ChangedFilesContext)
  const fileStatus = changedFiles.get(node.path)
  const selection = useFileSelection()
  const isSelected = selection.isSelected(node.path)
  // Image files can be dragged onto Canvas mode, which reads the
  // project-relative path off the drag payload and imports it as a node.
  const isDraggableImage = isImagePath(node.path)

  if (renaming) {
    return (
      <RenameInline
        node={node}
        entityRoot={entityRoot}
        depth={depth}
        onClose={() => setRenaming(false)}
        onRenamed={onChanged}
      />
    )
  }

  const handleOpen = () => {
    const nextActive = activeEntityFromPath(node.path, label)
    setActive(nextActive)
    // Shotlist and Multishot are two submodes of the one Shotlist mode.
    if (nextActive.kind === "shotlist") {
      setViewMode("shotlist")
      setSubmode("shotlist")
    } else if (nextActive.kind === "multishot") {
      setViewMode("shotlist")
      setSubmode("multishot")
    } else if (nextActive.kind === "queue") {
      setViewMode("queue")
    } else if (viewMode === "shotlist") {
      // Opening any other file (a screenplay, brief, character note…)
      // while parked in the Shotlist mode would leave the writer staring
      // at that surface instead of the file they just clicked. Drop back
      // to screenwriting so the file opens in preview. Other modes are
      // left untouched.
      setViewMode("screenwriting")
    }
  }

  // Selection visual: neutral grey fill on the row, slightly heavier
  // text. No left accent bar, no Coral tint — same restrained idiom
  // as the main nav (and the settings tab list). Hover and active
  // share the foreground/5 fill so movement between rows feels like
  // a single drift of weight, not a colour switch.
  return (
    <RowContextMenu
      node={node}
      entityRoot={entityRoot}
      onChanged={onChanged}
      onRename={() => setRenaming(true)}
    >
      <button
        type="button"
        onClick={(e) => {
          // Cmd/Ctrl-click toggles selection instead of opening — the
          // standard multi-select shortcut. Plain click opens, leaving
          // existing single-file muscle memory intact.
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault()
            selection.toggle(node.path)
            return
          }
          handleOpen()
        }}
        draggable={isDraggableImage}
        onDragStart={
          isDraggableImage
            ? (event) => {
                event.dataTransfer.setData(CANVAS_DROP_MIME, node.path)
                event.dataTransfer.effectAllowed = "copy"
              }
            : undefined
        }
        className={cn(
          "group/row relative w-full flex items-center gap-1.5 pr-2 py-[3px] rounded-md",
          "transition-colors",
          isSelected
            ? "bg-primary/10 ring-1 ring-primary/30"
            : isActive
              ? "bg-foreground/[0.06] text-foreground dark:bg-foreground/[0.08]"
              : "text-foreground/80 hover:bg-foreground/[0.04] dark:hover:bg-foreground/[0.05]",
        )}
        style={{ paddingLeft: indentFor(depth) + 16 }}
        title={node.path}
      >
        <Icon
          className={cn(
            "h-3.5 w-3.5 shrink-0",
            isActive ? "text-foreground/90" : "text-muted-foreground/65",
          )}
        />
        <RowSelectCheckbox path={node.path} />
        <span
          className={cn(
            "truncate text-[12.5px] text-left flex-1 min-w-0",
            isActive && "font-medium",
            // Cursor-style emphasis on changed files: shift the row text
            // to a Coral-tinted weight so the eye finds them without
            // hunting the gutter. Not bold (avoids visual chunking).
            fileStatus &&
              fileStatus !== "clean" &&
              "text-primary/90 dark:text-primary",
          )}
          style={{ fontFamily: "var(--font-body)" }}
        >
          {node.name}
        </span>
        {fileStatus && fileStatus !== "clean" && (
          <FileStatusBadge status={fileStatus} />
        )}
      </button>
    </RowContextMenu>
  )
}

/** Cursor-style single-letter status indicator: M (modified) / A (added) /
 *  U (untracked) / D (deleted) / R (renamed). Coral on a faint pill,
 *  uppercase mono. */
function FileStatusBadge({ status }: { status: FileStatus }) {
  const letter =
    status === "modified"
      ? "M"
      : status === "added"
        ? "A"
        : status === "untracked"
          ? "U"
          : status === "deleted"
            ? "D"
            : status === "renamed"
              ? "R"
              : ""
  if (!letter) return null
  const tone =
    status === "deleted"
      ? "text-rose-600 dark:text-rose-400"
      : "text-primary"
  return (
    <span
      className={cn(
        "shrink-0 inline-flex items-center justify-center w-4 text-[10px] font-mono font-semibold tabular-nums",
        tone,
      )}
      title={status}
    >
      {letter}
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Right-click affordances — one menu shape for both files and folders.
//
// • Add to context — pushes a FileMentionOption into the renderer-wide
//   pendingMentionAtom; active-chat picks it up, calls the editor's
//   insertMention(), and the file lands as a chip in the agent input.
//   Same path the @-trigger picker uses, just driven from the tree.
// • Delete — calls entities.delete (recursive for folders). Native
//   confirm so the destruction is unmistakable; this is a hard rm.
// ─────────────────────────────────────────────────────────────────────
function RowContextMenu({
  node,
  entityRoot,
  onChanged,
  onRename,
  children,
}: {
  node: TreeNode
  entityRoot: EntityRoot
  onChanged: () => void
  onRename?: () => void
  children: React.ReactNode
}) {
  const [active, setActive] = useAtom(activeEntityAtom)
  const setPendingMention = useSetAtom(pendingMentionAtom)
  const selectedProject = useAtomValue(selectedProjectAtom)
  const activeChatId = useAtomValue(selectedAgentChatIdAtom)
  const utils = trpc.useUtils()
  const selection = useFileSelection()
  const isSelected = selection.isSelected(node.path)
  const deleteEntity = trpc.entities.delete.useMutation({
    onSuccess: () => {
      // If the deleted entity was open in the editor, clear it so we
      // don't leave a stale buffer pointing at a non-existent path.
      if (active?.path === node.path) setActive(null)
      onChanged()
      toast.success(
        node.kind === "folder"
          ? `Deleted folder "${node.name}"`
          : `Deleted "${node.name}"`,
      )
    },
    onError: (err) => {
      toast.error(err.message || `Couldn't delete "${node.name}"`)
    },
  })

  const repository =
    selectedProject?.id ?? entityRoot.projectId ?? entityRoot.chatId ?? "backlot"

  const handleAddToContext = () => {
    if (!activeChatId) {
      toast.message("Open a chat first", {
        description: "There's no active assistant thread to add this to.",
      })
      return
    }
    const kindPrefix = node.kind === "folder" ? "folder" : "file"
    setPendingMention({
      id: `${kindPrefix}:${repository}:${node.path}`,
      label: node.name,
      path: node.path,
      repository,
      truncatedPath: node.path.includes("/")
        ? node.path.split("/").slice(0, -1).join("/")
        : "/",
      type: node.kind === "folder" ? "folder" : "file",
    })
  }

  const handleCopyPath = async () => {
    let pathToCopy = node.path
    try {
      const resolved = await utils.entities.resolvePath.fetch({
        ...entityRoot,
        entityPath: node.path,
      })
      if (resolved.absPath) pathToCopy = resolved.absPath
    } catch {
      // Resolution failed — fall back to the project-relative path.
    }
    try {
      await navigator.clipboard.writeText(pathToCopy)
      toast.success("Copied path", { description: pathToCopy })
    } catch {
      toast.error("Couldn't copy path to the clipboard")
    }
  }

  const handleDelete = () => {
    const what = node.kind === "folder" ? "folder" : "file"
    const ok = window.confirm(
      `Delete ${what} "${node.name}"?\n${
        node.kind === "folder"
          ? "All files inside will be removed. "
          : ""
      }This can't be undone.`,
    )
    if (!ok) return
    deleteEntity.mutate({ ...entityRoot, path: node.path })
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <ContextMenuItem
          onClick={handleAddToContext}
          disabled={!activeChatId}
        >
          <AtSign className="h-4 w-4 mr-2 text-muted-foreground" />
          <div className="flex flex-col">
            <span>Add to context</span>
            <span className="text-[11px] text-muted-foreground">
              {activeChatId
                ? "Insert as @-mention in the chat"
                : "Open a chat first"}
            </span>
          </div>
        </ContextMenuItem>
        <ContextMenuItem onClick={handleCopyPath}>
          <Copy className="h-4 w-4 mr-2 text-muted-foreground" />
          Copy path
        </ContextMenuItem>
        <ContextMenuItem onClick={() => selection.toggle(node.path)}>
          {isSelected ? (
            <X className="h-4 w-4 mr-2 text-muted-foreground" />
          ) : (
            <Check className="h-4 w-4 mr-2 text-muted-foreground" />
          )}
          {isSelected ? "Remove from selection" : "Add to selection"}
        </ContextMenuItem>
        {onRename && (
          <ContextMenuItem onClick={() => onRename()}>
            <PencilLine className="h-4 w-4 mr-2 text-muted-foreground" />
            Rename {node.kind === "folder" ? "folder" : "file"}
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem
          onClick={handleDelete}
          className="text-rose-600 dark:text-rose-400 focus:text-rose-600 dark:focus:text-rose-400"
        >
          <Trash2 className="h-4 w-4 mr-2" />
          Delete {node.kind === "folder" ? "folder" : "file"}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
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
  const setViewMode = useSetAtom(viewModeAtom)
  const setSubmode = useSetAtom(shotlistSubmodeAtom)
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
        const nextActive = activeEntityFromPath(path, labelFromFilename(trimmed))
        setActive(nextActive)
        if (nextActive.kind === "shotlist") {
          setViewMode("shotlist")
          setSubmode("shotlist")
        } else if (nextActive.kind === "multishot") {
          setViewMode("shotlist")
          setSubmode("multishot")
        } else if (nextActive.kind === "queue") {
          setViewMode("queue")
        }
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
// Rename flow — swaps the row for an inline input pre-filled with the
// current name. Same Cursor-style mechanics as CreateInline:
//
//   • basename is selected (extension preserved) so the writer types and
//     replaces; folders get the whole name selected,
//   • Enter commits, Esc cancels, blur with a non-empty value commits,
//   • on success the tree refetches and — if the renamed node was the
//     active entity — activeEntityAtom is rebound to the new path so the
//     editor doesn't keep a stale buffer. Folder renames also remap any
//     descendant active path that lived under the old prefix.
// ─────────────────────────────────────────────────────────────────────

function RenameInline({
  node,
  entityRoot,
  depth,
  onClose,
  onRenamed,
}: {
  node: TreeNode
  entityRoot: EntityRoot
  depth: number
  onClose: () => void
  onRenamed: () => void
}) {
  const [value, setValue] = useState(node.name)
  const inputRef = useRef<HTMLInputElement>(null)
  const submittedRef = useRef(false)
  const [active, setActive] = useAtom(activeEntityAtom)
  const renameMutation = trpc.entities.rename.useMutation()

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.focus()
    if (node.kind === "file") {
      const lastDot = node.name.lastIndexOf(".")
      const end = lastDot > 0 ? lastDot : node.name.length
      el.setSelectionRange(0, end)
    } else {
      el.select()
    }
    // Mount-only selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const submit = async () => {
    const trimmed = value.trim()
    if (!trimmed || trimmed === node.name) {
      onClose()
      return
    }
    // Refuse path separators in the new name — this is a rename, not a
    // move. We could support moves later, but the inline affordance is
    // for a same-folder rename only and a "/" would silently relocate
    // the file in a way the writer didn't ask for.
    if (trimmed.includes("/") || trimmed.includes("\\")) {
      toast.error("Names can't contain slashes — use Move to relocate.")
      return
    }
    const parent = node.path.includes("/")
      ? node.path.slice(0, node.path.lastIndexOf("/"))
      : ""
    const toPath = parent ? `${parent}/${trimmed}` : trimmed
    submittedRef.current = true
    try {
      const result = await renameMutation.mutateAsync({
        ...entityRoot,
        fromPath: node.path,
        toPath,
      })
      const finalPath = result.toPath
      // Rebind the active entity if the renamed item (or one of its
      // descendants for a folder rename) was open in the editor.
      if (active) {
        if (active.path === node.path) {
          setActive(
            activeEntityFromPath(finalPath, labelFromFilename(trimmed)),
          )
        } else if (
          node.kind === "folder" &&
          active.path.startsWith(`${node.path}/`)
        ) {
          const remapped = `${finalPath}/${active.path.slice(node.path.length + 1)}`
          const lastSeg = remapped.split("/").pop() ?? remapped
          setActive(
            activeEntityFromPath(remapped, labelFromFilename(lastSeg)),
          )
        }
      }
      onRenamed()
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't rename.")
      submittedRef.current = false
    }
  }

  const indent = indentFor(depth) + (node.kind === "file" ? 16 : 0)

  return (
    <div
      className="flex items-center gap-1.5 py-[3px]"
      style={{ paddingLeft: indent }}
    >
      {node.kind === "file" ? (
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
          if (value.trim() && value.trim() !== node.name) submit()
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
  if (isShotlistPath(path)) {
    return Clapperboard
  }
  if (isQueuePath(path)) {
    return ListChecks
  }
  if (isImagePath(path)) return ImageIcon
  if (isVideoPath(path)) return Video
  if (lower.endsWith(".md")) return FileText
  // Acts/scenes/shots/characters/locations all use .md, already handled above.
  return File
}
