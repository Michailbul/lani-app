"use client"

/**
 * QueueSurface — Lani's "Queue" workflow mode.
 *
 * A project-wide submission tracker. Prompts drafted in the Multishot
 * or Shotlist surfaces are pushed here; an external agent reads the
 * backing `queue.lani.json`, submits each prompt to a video model
 * (Runway), and writes the result back — flipping `status` and bumping
 * `submissionCount`.
 *
 * Rows are a working list, not a read-only ledger: the prompt (EN and
 * ZH) is editable in place, rows drag to reorder by priority, reference
 * images add (drop) and remove, and the result clip links by dropping
 * the video onto the row. A row can be liked, noted, and archived.
 * Every one of those is a field in `queue.lani.json`, which the
 * `queue` router checkpoints into git — a real, time-travelable
 * history. A Raw toggle shows the underlying JSON file.
 */

import {
  type CSSProperties,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { useAtomValue } from "jotai"
import {
  Archive,
  ArchiveRestore,
  Braces,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Copy,
  GripVertical,
  ImageOff,
  Inbox,
  Loader2,
  Maximize2,
  MessageSquare,
  MoreHorizontal,
  Play,
  Plus,
  Star,
  Trash2,
  Video,
  X,
} from "lucide-react"
import { toast } from "sonner"
import type { QueueItem, SubmissionQueue } from "../../../shared/queue-types"
import { selectedAgentChatIdAtom, selectedProjectAtom } from "../agents/atoms"
import { trpc } from "../../lib/trpc"
import { cn } from "../../lib/utils"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu"
import { isImagePath, isVideoPath } from "./entity-kind"

const LIVE_POLL_MS = 1500
const AUTOSAVE_MS = 600

/** dataTransfer MIME for an in-app row drag — carries the dragged id. */
const REORDER_MIME = "application/x-lani-queue-reorder"

/**
 * Two CSS-grid templates the queue table swaps between as the surrounding
 * pane resizes (the assistant rail eats real estate when it expands).
 *
 * Columns: # | Source | Script | Refs | Prompt | Status | Actions
 *
 * At "narrow", the Script column collapses entirely — it's auxiliary
 * context, never an interaction target, so it's the right thing to drop
 * first. Everything else stays addressable.
 */
const COL_TEMPLATE_WIDE =
  "44px 168px 148px 132px minmax(240px,1fr) 188px 72px"
const COL_TEMPLATE_NARROW =
  "40px 148px 0px 120px minmax(220px,1fr) 184px 68px"

/** Below this container width, the Script column hides. */
const NARROW_BREAKPOINT = 940

type QueueLayout = "wide" | "narrow"

/**
 * Track a container's contentRect width with a ResizeObserver — used to
 * swap the table layout when the parent shrinks/grows.
 */
function useObservedWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(el.getBoundingClientRect().width)
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) setWidth(entry.contentRect.width)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return width
}

type QueueFilter = "all" | "pending" | "submitted" | "archived"
type PromptLang = "en" | "zh"

type EntityRoot =
  | { chatId: string; projectId?: undefined }
  | { chatId?: undefined; projectId: string }

/** Stream a project file to the renderer over the lani-asset:// scheme. */
function assetUrl(absPath: string): string {
  return `lani-asset://asset/?p=${encodeURIComponent(absPath)}`
}

/**
 * Liquid-glass refraction — the same SVG displacement filter the mode
 * dock and the asset lightbox use, layered over a frosted blur.
 */
const liquidGlassStyle: CSSProperties = {
  backdropFilter: "url(#bl-glass-displace) blur(8px) saturate(160%)",
  WebkitBackdropFilter: "url(#bl-glass-displace) blur(8px) saturate(160%)",
}

/** A clicked thumbnail / result clip blown up full-window. */
interface PreviewMedia {
  url: string
  name: string
  kind: "image" | "video"
}

/** Resolve the absolute path of a file dragged in from Finder. */
function pathForDroppedFile(file: File): string | null {
  const fromElectron = window.webUtils?.getPathForFile(file)
  if (fromElectron) return fromElectron
  const legacy = (file as File & { path?: string }).path
  return legacy || null
}

/** True when a drag event is carrying OS files (vs. an in-app drag). */
function hasDroppedFiles(types: readonly string[]): boolean {
  return types.includes("Files")
}

/** Split dropped files into image and video absolute paths. */
function classifyDropped(files: File[]): {
  images: string[]
  videos: string[]
} {
  const images: string[] = []
  const videos: string[] = []
  for (const file of files) {
    const path = pathForDroppedFile(file)
    if (!path) continue
    if (isVideoPath(path)) videos.push(path)
    else if (isImagePath(path)) images.push(path)
  }
  return { images, videos }
}

// ──────────────────────────────────────────────────────────────────────────

export function QueueSurface() {
  const chatId = useAtomValue(selectedAgentChatIdAtom)
  const selectedProject = useAtomValue(selectedProjectAtom)
  const entityRoot: EntityRoot | null = chatId
    ? { chatId }
    : selectedProject?.id
      ? { projectId: selectedProject.id }
      : null
  const entityRootKey = chatId
    ? `chat:${chatId}`
    : selectedProject?.id
      ? `project:${selectedProject.id}`
      : null

  if (!entityRoot || !entityRootKey) {
    return (
      <QueueEmpty
        title="No project"
        message="Pick a project to track its submission queue."
      />
    )
  }
  return <QueueWorkspace key={entityRootKey} entityRoot={entityRoot} />
}

const EMPTY_QUEUE: SubmissionQueue = {
  schemaVersion: 1,
  items: [],
  updatedAt: "",
}

function QueueWorkspace({ entityRoot }: { entityRoot: EntityRoot }) {
  const read = trpc.queue.read.useQuery(entityRoot, {
    refetchOnWindowFocus: true,
    refetchInterval: LIVE_POLL_MS,
  })
  const readArchive = trpc.queue.readArchive.useQuery(entityRoot, {
    refetchOnWindowFocus: true,
    refetchInterval: LIVE_POLL_MS,
  })
  const refetchBoth = () => {
    void read.refetch()
    void readArchive.refetch()
  }

  const write = trpc.queue.write.useMutation({
    onError: (err) => toast.error(err.message || "Couldn't save the queue"),
  })
  const writeArchive = trpc.queue.writeArchive.useMutation({
    onError: (err) => toast.error(err.message || "Couldn't save the archive"),
  })
  const archiveMut = trpc.queue.archiveItem.useMutation({
    onError: (err) => toast.error(err.message || "Couldn't archive the item"),
    onSuccess: () => {
      refetchBoth()
      toast.success("Moved to the archive")
    },
  })
  const restoreMut = trpc.queue.restoreItem.useMutation({
    onError: (err) => toast.error(err.message || "Couldn't restore the item"),
    onSuccess: () => {
      refetchBoth()
      toast.success("Restored to the queue")
    },
  })
  const removeItem = trpc.queue.removeItem.useMutation({
    onError: (err) => toast.error(err.message || "Couldn't remove the item"),
  })
  const linkVideo = trpc.queue.linkResultVideo.useMutation({
    onError: (err) => toast.error(err.message || "Couldn't link the video"),
    onSuccess: () => {
      refetchBoth()
      toast.success("Result video linked")
    },
  })
  const clearVideo = trpc.queue.clearResultVideo.useMutation({
    onError: (err) => toast.error(err.message || "Couldn't unlink the video"),
    onSuccess: refetchBoth,
  })
  const addRefs = trpc.queue.addReferenceImages.useMutation({
    onError: (err) => toast.error(err.message || "Couldn't add references"),
    onSuccess: (r) => {
      refetchBoth()
      if (r.added.length > 0) {
        toast.success(
          r.added.length === 1
            ? "Reference image added"
            : `${r.added.length} reference images added`,
        )
      }
    },
  })
  const removeRef = trpc.queue.removeReferenceImage.useMutation({
    onError: (err) => toast.error(err.message || "Couldn't remove reference"),
    onSettled: refetchBoth,
  })
  const addManual = trpc.queue.addManualItem.useMutation({
    onError: (err) => toast.error(err.message || "Couldn't add a new item"),
    onSuccess: () => {
      refetchBoth()
      toast.success("New queue row added")
    },
  })

  const [doc, setDoc] = useState<SubmissionQueue | null>(null)
  const [archiveDoc, setArchiveDoc] = useState<SubmissionQueue | null>(null)
  const [filter, setFilter] = useState<QueueFilter>("all")
  const [raw, setRaw] = useState(false)
  const [preview, setPreview] = useState<PreviewMedia | null>(null)
  const [reorderId, setReorderId] = useState<string | null>(null)
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set())
  const surfaceRef = useRef<HTMLDivElement>(null)
  const surfaceWidth = useObservedWidth(surfaceRef)
  const layout: QueueLayout =
    surfaceWidth > 0 && surfaceWidth < NARROW_BREAKPOINT ? "narrow" : "wide"
  const template =
    layout === "narrow" ? COL_TEMPLATE_NARROW : COL_TEMPLATE_WIDE
  const localEditAtRef = useRef(0)
  const writeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const toggleCollapsed = useCallback((id: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  useEffect(() => {
    return () => {
      if (writeTimer.current) clearTimeout(writeTimer.current)
    }
  }, [])

  // Pull server content into local state when the user is idle — a
  // poll round-trip mid-edit must not clobber a just-typed row.
  useEffect(() => {
    const incoming = read.data?.queue ?? null
    if (read.data && !incoming && doc === null) {
      setDoc({ ...EMPTY_QUEUE })
      return
    }
    if (!incoming) return
    if (Date.now() - localEditAtRef.current < 1200) return
    setDoc(incoming)
  }, [read.data, doc])

  useEffect(() => {
    const incoming = readArchive.data?.queue ?? null
    if (!incoming) return
    if (Date.now() - localEditAtRef.current < 1200) return
    setArchiveDoc(incoming)
  }, [readArchive.data])

  /** A discrete edit — persisted at once, to the active or archive file. */
  const commitNow = (next: SubmissionQueue, archived: boolean) => {
    localEditAtRef.current = Date.now()
    if (writeTimer.current) clearTimeout(writeTimer.current)
    if (archived) {
      setArchiveDoc(next)
      writeArchive.mutate({ ...entityRoot, queue: next })
    } else {
      setDoc(next)
      write.mutate({ ...entityRoot, queue: next })
    }
  }

  /** A typed edit — reflected immediately, persisted after a pause. */
  const commitDebounced = (next: SubmissionQueue, archived: boolean) => {
    localEditAtRef.current = Date.now()
    if (archived) setArchiveDoc(next)
    else setDoc(next)
    if (writeTimer.current) clearTimeout(writeTimer.current)
    writeTimer.current = setTimeout(() => {
      if (archived) writeArchive.mutate({ ...entityRoot, queue: next })
      else write.mutate({ ...entityRoot, queue: next })
    }, AUTOSAVE_MS)
  }

  const itemPatch = (
    src: SubmissionQueue,
    id: string,
    patch: Partial<QueueItem>,
  ): SubmissionQueue => {
    const now = new Date().toISOString()
    return {
      ...src,
      items: src.items.map((it) =>
        it.id === id ? { ...it, ...patch, updatedAt: now } : it,
      ),
      updatedAt: now,
    }
  }

  const patchItem = (item: QueueItem, patch: Partial<QueueItem>) => {
    const archived = !!item.archivedAt
    const src = archived ? archiveDoc : doc
    if (!src) return
    commitNow(itemPatch(src, item.id, patch), archived)
  }

  const editText = (item: QueueItem, lang: PromptLang, text: string) => {
    const archived = !!item.archivedAt
    const src = archived ? archiveDoc : doc
    if (!src) return
    commitDebounced(
      itemPatch(src, item.id, lang === "zh" ? { zh: text } : { prompt: text }),
      archived,
    )
  }

  const toggleStatus = (item: QueueItem) =>
    patchItem(item, {
      status: item.status === "submitted" ? "pending" : "submitted",
    })

  const toggleLike = (item: QueueItem) =>
    patchItem(item, { liked: !item.liked })

  const setComment = (item: QueueItem, comment: string) =>
    patchItem(item, { comment })

  const setRunwayName = (item: QueueItem, runwayName: string) =>
    patchItem(item, { runwayName: runwayName || undefined })

  const setRunwayUrl = (item: QueueItem, runwayUrl: string) =>
    patchItem(item, { runwayUrl: runwayUrl || undefined })

  const setRepeatCount = (item: QueueItem, repeatCount: number) =>
    patchItem(item, { repeatCount })

  const setCustomInstructions = (item: QueueItem, text: string) =>
    patchItem(item, { customInstructions: text.trim() ? text : undefined })

  /** Archive ⇄ restore — moves the item between the two files. */
  const toggleArchive = (item: QueueItem) => {
    localEditAtRef.current = Date.now()
    if (item.archivedAt) {
      // Restore: optimistically move archive → active.
      if (archiveDoc && doc) {
        const restored = { ...item }
        delete restored.archivedAt
        setArchiveDoc({
          ...archiveDoc,
          items: archiveDoc.items.filter((i) => i.id !== item.id),
        })
        setDoc({ ...doc, items: [...doc.items, restored] })
      }
      restoreMut.mutate({ ...entityRoot, itemId: item.id })
    } else {
      // Archive: optimistically move active → archive.
      if (doc && archiveDoc) {
        setDoc({
          ...doc,
          items: doc.items.filter((i) => i.id !== item.id),
        })
        setArchiveDoc({
          ...archiveDoc,
          items: [
            ...archiveDoc.items,
            { ...item, archivedAt: new Date().toISOString() },
          ],
        })
      }
      archiveMut.mutate({ ...entityRoot, itemId: item.id })
    }
  }

  const deleteItem = (item: QueueItem) => {
    const archived = !!item.archivedAt
    localEditAtRef.current = Date.now()
    if (archived && archiveDoc) {
      setArchiveDoc({
        ...archiveDoc,
        items: archiveDoc.items.filter((i) => i.id !== item.id),
      })
    } else if (doc) {
      setDoc({ ...doc, items: doc.items.filter((i) => i.id !== item.id) })
    }
    removeItem.mutate(
      { ...entityRoot, itemId: item.id, archived },
      { onSettled: refetchBoth },
    )
  }

  /** Move `draggedId` to just before `targetId` — priority reorder. */
  const reorder = (draggedId: string, targetId: string) => {
    if (draggedId === targetId) return
    const inActive = !!doc?.items.some((i) => i.id === draggedId)
    const src = inActive ? doc : archiveDoc
    if (!src) return
    const items = [...src.items]
    const from = items.findIndex((i) => i.id === draggedId)
    if (from < 0) return
    const [moved] = items.splice(from, 1)
    const to = items.findIndex((i) => i.id === targetId)
    if (to < 0) return
    items.splice(to, 0, moved!)
    commitNow(
      { ...src, items, updatedAt: new Date().toISOString() },
      !inActive,
    )
  }

  if (read.isPending && !doc) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading queue
      </div>
    )
  }

  if (read.isError && !doc) {
    return (
      <QueueEmpty
        title="Couldn't load the queue"
        message={
          read.error?.message ||
          "The queue could not be read. If the app was running during an update, restart it and try again."
        }
      />
    )
  }

  const activeItems = doc?.items ?? []
  const archivedItems = archiveDoc?.items ?? []
  const pendingCount = activeItems.filter((i) => i.status === "pending").length
  const submittedCount = activeItems.length - pendingCount

  const visible =
    filter === "archived"
      ? archivedItems
      : filter === "all"
        ? activeItems
        : activeItems.filter((i) => i.status === filter)

  const linkingItemId = linkVideo.isPending
    ? linkVideo.variables?.itemId ?? null
    : null
  const addingRefsItemId = addRefs.isPending
    ? addRefs.variables?.itemId ?? null
    : null
  const saving =
    write.isPending || writeArchive.isPending || archiveMut.isPending

  const empty = activeItems.length === 0 && archivedItems.length === 0

  // All visible rows currently folded? Drives the toolbar fold-all button's
  // pressed state and label, and what its single click does.
  const allFolded =
    visible.length > 0 && visible.every((it) => collapsedIds.has(it.id))
  const toggleFoldAll = () => {
    if (allFolded) {
      // Unfold only the currently-visible set; rows hidden by the filter
      // keep their own state.
      setCollapsedIds((prev) => {
        const next = new Set(prev)
        for (const it of visible) next.delete(it.id)
        return next
      })
    } else {
      setCollapsedIds((prev) => {
        const next = new Set(prev)
        for (const it of visible) next.add(it.id)
        return next
      })
    }
  }

  return (
    <div
      ref={surfaceRef}
      className="flex h-full flex-col overflow-hidden bg-background"
    >
      {/* ── Masthead ──────────────────────────────────────────────────── */}
      <header className="no-drag flex h-11 shrink-0 items-center gap-3 border-b border-border/70 px-4">
        <div className="flex shrink-0 items-center gap-2">
          <span className="h-3.5 w-[3px] rounded-full bg-primary" />
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            Queue
          </span>
        </div>
        {!raw && (
          <FilterSwitch
            value={filter}
            onChange={setFilter}
            counts={{
              all: activeItems.length,
              pending: pendingCount,
              submitted: submittedCount,
              archived: archivedItems.length,
            }}
          />
        )}
        <div className="ml-auto flex shrink-0 items-center gap-2.5">
          {saving && (
            <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Saving
            </span>
          )}
          {!raw && (
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] tabular-nums text-muted-foreground/70">
              {submittedCount}/{activeItems.length} submitted
            </span>
          )}
          {!raw && visible.length > 0 && (
            <button
              type="button"
              onClick={toggleFoldAll}
              aria-pressed={allFolded}
              title={
                allFolded
                  ? "Unfold every visible row"
                  : "Fold every visible row to one line"
              }
              className={cn(
                "press flex h-7 items-center gap-1.5 rounded-lg px-2",
                "font-mono text-[10px] font-semibold uppercase tracking-[0.1em] transition-colors",
                allFolded
                  ? "bg-foreground/[0.08] text-foreground"
                  : "text-muted-foreground/65 hover:bg-foreground/[0.06] hover:text-foreground",
              )}
            >
              {allFolded ? (
                <ChevronsUpDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronsDownUp className="h-3.5 w-3.5" />
              )}
              {allFolded ? "Unfold" : "Fold"}
            </button>
          )}
          {!raw && (
            <button
              type="button"
              onClick={() => {
                if (filter === "archived") setFilter("all")
                addManual.mutate({ ...entityRoot })
              }}
              disabled={addManual.isPending}
              title="Add a blank queue row you can fill in by hand"
              className={cn(
                "press flex h-7 items-center gap-1.5 rounded-lg px-2",
                "font-mono text-[10px] font-semibold uppercase tracking-[0.1em] transition-colors",
                "text-muted-foreground/65 hover:bg-foreground/[0.06] hover:text-foreground",
                "disabled:cursor-not-allowed disabled:opacity-50",
              )}
            >
              {addManual.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
              New
            </button>
          )}
          <button
            type="button"
            onClick={() => setRaw((v) => !v)}
            aria-pressed={raw}
            title={
              raw
                ? "Back to the queue"
                : filter === "archived"
                  ? "Show the raw queue-archive.lani.json"
                  : "Show the raw queue.lani.json"
            }
            className={cn(
              "press flex h-7 items-center gap-1.5 rounded-lg px-2",
              "font-mono text-[10px] font-semibold uppercase tracking-[0.1em] transition-colors",
              raw
                ? "bg-foreground/[0.08] text-foreground"
                : "text-muted-foreground/65 hover:bg-foreground/[0.06] hover:text-foreground",
            )}
          >
            <Braces className="h-3.5 w-3.5" />
            Raw
          </button>
        </div>
      </header>

      {/* ── Body ──────────────────────────────────────────────────────── */}
      {raw ? (
        <RawQueueView
          doc={filter === "archived" ? archiveDoc : doc}
          filename={
            filter === "archived"
              ? "queue-archive.lani.json"
              : "queue.lani.json"
          }
        />
      ) : empty ? (
        <QueueEmpty
          title="The queue is empty"
          message="Open Multishot or Shotlist mode and use “Add to queue” on a prompt — or hit “+ New” above to add a blank row by hand."
        />
      ) : visible.length === 0 ? (
        <QueueEmpty
          title={
            filter === "archived" ? "Nothing archived" : `Nothing ${filter}`
          }
          message={
            filter === "archived"
              ? "Archive a submission from its ⋯ menu — it moves to queue-archive.lani.json, kept as history you can always restore."
              : "Switch the filter to see the rest of the queue."
          }
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* ── Sticky column header ──────────────────────────────── */}
          <div
            style={{ gridTemplateColumns: template }}
            className="sticky top-0 z-10 grid border-b border-border/60 bg-background/95 backdrop-blur"
          >
            {(
              [
                ["#", "px-2"],
                ["Source", "px-3"],
                ["Script", "px-3"],
                ["Refs", "px-3"],
                ["Prompt", "px-3"],
                [filter === "archived" ? "Archived" : "Status", "px-3"],
                ["", "px-2"],
              ] as [string, string][]
            ).map(([label, pad], i) => {
              // Skip the Script header entirely when its column is collapsed
              // — otherwise its padding still claims a slot and the next
              // header label drifts off the column it belongs to.
              if (i === 2 && layout === "narrow") {
                return <span key={i} aria-hidden />
              }
              return (
                <span
                  key={i}
                  className={`${pad} py-2 font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground/40`}
                >
                  {label}
                </span>
              )
            })}
          </div>

          {/* ── Rows ─────────────────────────────────────────────── */}
          {visible.map((item, i) => (
            <QueueTableRow
              key={item.id}
              item={item}
              index={i}
              entityRoot={entityRoot}
              layout={layout}
              template={template}
              collapsed={collapsedIds.has(item.id)}
              onToggleCollapsed={() => toggleCollapsed(item.id)}
              removing={
                removeItem.isPending &&
                removeItem.variables?.itemId === item.id
              }
              linkingVideo={linkingItemId === item.id}
              addingRefs={addingRefsItemId === item.id}
              isReorderSource={reorderId === item.id}
              onReorderStart={() => setReorderId(item.id)}
              onReorderEnd={() => setReorderId(null)}
              onReorder={reorder}
              onEditText={(lang, text) => editText(item, lang, text)}
              onToggleStatus={() => toggleStatus(item)}
              onToggleLike={() => toggleLike(item)}
              onToggleArchive={() => toggleArchive(item)}
              onSetComment={(text) => setComment(item, text)}
              onSetRunwayName={(name) => setRunwayName(item, name)}
              onSetRunwayUrl={(url) => setRunwayUrl(item, url)}
              onSetCustomInstructions={(text) =>
                setCustomInstructions(item, text)
              }
              onSetRepeatCount={(count) => setRepeatCount(item, count)}
              onDelete={() => deleteItem(item)}
              onPreview={setPreview}
              onLinkVideo={(sourcePath) =>
                linkVideo.mutate({
                  ...entityRoot,
                  itemId: item.id,
                  sourcePath,
                  archived: !!item.archivedAt,
                })
              }
              onClearVideo={() =>
                clearVideo.mutate({
                  ...entityRoot,
                  itemId: item.id,
                  archived: !!item.archivedAt,
                })
              }
              onAddRefs={(sourcePaths) =>
                addRefs.mutate({
                  ...entityRoot,
                  itemId: item.id,
                  sourcePaths,
                  archived: !!item.archivedAt,
                })
              }
              onRemoveRef={(path) =>
                removeRef.mutate({
                  ...entityRoot,
                  itemId: item.id,
                  path,
                  archived: !!item.archivedAt,
                })
              }
            />
          ))}
          {/* bottom breathing room */}
          <div className="h-24" />
        </div>
      )}

      <QueueLightbox media={preview} onClose={() => setPreview(null)} />
    </div>
  )
}

// ── Raw view — the underlying queue.lani.json ──────────────────────────

function RawQueueView({
  doc,
  filename,
}: {
  doc: SubmissionQueue | null
  filename: string
}) {
  const json = useMemo(
    () => (doc ? JSON.stringify(doc, null, 2) : "{}"),
    [doc],
  )
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  const copy = () => {
    navigator.clipboard.writeText(json)
    setCopied(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), 1600)
    toast.success(`${filename} copied`)
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col px-6 pb-28 pt-3">
      <div className="flex shrink-0 items-center justify-between pb-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground/55">
          {filename}
        </span>
        <button
          type="button"
          onClick={copy}
          title="Copy the JSON"
          className="press inline-flex h-7 items-center gap-1.5 rounded-lg bg-foreground/[0.06] px-2.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-foreground/[0.1] hover:text-foreground"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-border/70 bg-foreground/[0.02] p-4 font-mono text-[12px] leading-[1.7] text-foreground">
        {json}
      </pre>
    </div>
  )
}

// ── Lightbox — a clicked thumbnail or clip blown up full-window ───────────

function QueueLightbox({
  media,
  onClose,
}: {
  media: PreviewMedia | null
  onClose: () => void
}) {
  useEffect(() => {
    if (!media) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [media, onClose])

  if (!media) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${media.name} preview`}
      onClick={onClose}
      className="fixed inset-0 z-[120] flex items-center justify-center bg-[hsl(0_0%_3%/0.92)] p-12 backdrop-blur-2xl"
    >
      <button
        type="button"
        aria-label="Close preview"
        onClick={onClose}
        style={liquidGlassStyle}
        className="bl-liquid-glass absolute right-5 top-5 grid h-9 w-9 cursor-pointer place-items-center rounded-full text-foreground/80 transition-colors duration-150 hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex flex-col items-center gap-3"
      >
        {media.kind === "video" ? (
          <video
            src={media.url}
            controls
            autoPlay
            playsInline
            className="block max-h-[calc(100vh-9rem)] max-w-[calc(100vw-6rem)] rounded-2xl ring-1 ring-white/10"
          />
        ) : (
          <img
            src={media.url}
            alt={media.name}
            className="block max-h-[calc(100vh-9rem)] max-w-[calc(100vw-6rem)] rounded-2xl object-contain ring-1 ring-white/10"
          />
        )}
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-foreground/45">
          {media.name}
        </span>
      </div>
    </div>
  )
}

// ── Table row — one tracked prompt laid out across the 7 columns ──────────

type QueueRowProps = {
  item: QueueItem
  index: number
  entityRoot: EntityRoot
  layout: QueueLayout
  template: string
  collapsed: boolean
  onToggleCollapsed: () => void
  removing: boolean
  linkingVideo: boolean
  addingRefs: boolean
  isReorderSource: boolean
  onReorderStart: () => void
  onReorderEnd: () => void
  onReorder: (draggedId: string, targetId: string) => void
  onEditText: (lang: PromptLang, text: string) => void
  onToggleStatus: () => void
  onToggleLike: () => void
  onToggleArchive: () => void
  onSetComment: (text: string) => void
  onSetRunwayName: (name: string) => void
  onSetRunwayUrl: (url: string) => void
  onSetCustomInstructions: (text: string) => void
  onSetRepeatCount: (count: number) => void
  onDelete: () => void
  onPreview: (media: PreviewMedia) => void
  onLinkVideo: (sourcePath: string) => void
  onClearVideo: () => void
  onAddRefs: (sourcePaths: string[]) => void
  onRemoveRef: (path: string) => void
}


function QueueTableRow({
  item,
  index,
  entityRoot,
  layout,
  template,
  collapsed,
  onToggleCollapsed,
  removing,
  linkingVideo,
  addingRefs,
  isReorderSource,
  onReorderStart,
  onReorderEnd,
  onReorder,
  onEditText,
  onToggleStatus,
  onToggleLike,
  onToggleArchive,
  onSetComment,
  onSetRunwayName,
  onSetRunwayUrl,
  onSetCustomInstructions,
  onSetRepeatCount,
  onDelete,
  onPreview,
  onLinkVideo,
  onClearVideo,
  onAddRefs,
  onRemoveRef,
}: QueueRowProps) {
  const [lang, setLang] = useState<PromptLang>("en")
  const [copied, setCopied] = useState(false)
  const [editingNote, setEditingNote] = useState(false)
  const [fileDragOver, setFileDragOver] = useState(false)
  const [reorderOver, setReorderOver] = useState(false)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rowRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current)
    }
  }, [])

  const isZh = lang === "zh"
  const body = isZh ? item.zh ?? "" : item.prompt
  const submitted = item.status === "submitted"
  const archived = !!item.archivedAt
  const hasComment = !!(item.comment && item.comment.trim())

  const sceneName =
    item.source.sceneName || item.source.label || ""
  const partLabel = item.source.partLabel || ""


  const copyPrompt = () => {
    if (!body.trim()) return
    navigator.clipboard.writeText(body)
    setCopied(true)
    if (copyTimer.current) clearTimeout(copyTimer.current)
    copyTimer.current = setTimeout(() => setCopied(false), 1600)
    toast.success(isZh ? "ZH prompt copied" : "Prompt copied")
  }

  const handleDragOver = (e: React.DragEvent) => {
    const types = Array.from(e.dataTransfer.types)
    if (types.includes(REORDER_MIME)) {
      e.preventDefault()
      e.dataTransfer.dropEffect = "move"
      if (!isReorderSource) setReorderOver(true)
      return
    }
    if (hasDroppedFiles(types)) {
      e.preventDefault()
      setFileDragOver(true)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    const draggedId = e.dataTransfer.getData(REORDER_MIME)
    if (draggedId) {
      e.preventDefault()
      setReorderOver(false)
      onReorder(draggedId, item.id)
      return
    }
    if (!hasDroppedFiles(Array.from(e.dataTransfer.types))) return
    e.preventDefault()
    setFileDragOver(false)
    const { images, videos } = classifyDropped(Array.from(e.dataTransfer.files))
    if (images.length > 0) onAddRefs(images)
    if (videos.length > 0) onLinkVideo(videos[videos.length - 1]!)
    if (images.length === 0 && videos.length === 0) {
      toast.error("Drop image files (refs) or a video file (result).")
    }
  }

  return (
    <div
      ref={rowRef}
      onDragOver={handleDragOver}
      onDragLeave={() => {
        setFileDragOver(false)
        setReorderOver(false)
      }}
      onDrop={handleDrop}
      style={{ gridTemplateColumns: template }}
      className={cn(
        "group relative grid items-start border-b border-border/50 transition-colors",
        "hover:bg-foreground/[0.018]",
        collapsed && "bg-foreground/[0.012]",
        archived && "opacity-70",
        isReorderSource && "opacity-40",
        removing && "pointer-events-none opacity-40",
      )}
    >
      {/* Reorder line */}
      {reorderOver && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 -top-px z-10 h-0.5 bg-primary"
        />
      )}

      {/* Drop overlay */}
      {fileDragOver && (
        <div className="pointer-events-none absolute inset-1 z-10 flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-primary/70 bg-primary/[0.07]">
          <Video className="h-4 w-4 text-primary" />
          <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-primary">
            Drop images · video
          </span>
        </div>
      )}

      {/* ── Col 1: # ── drag handle, index, status dot ─────────── */}
      <div className="flex flex-col items-center gap-1.5 px-2 py-3">
        <span
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(REORDER_MIME, item.id)
            e.dataTransfer.effectAllowed = "move"
            if (rowRef.current)
              e.dataTransfer.setDragImage(rowRef.current, 24, 24)
            onReorderStart()
          }}
          onDragEnd={onReorderEnd}
          title="Drag to reprioritise"
          className={cn(
            "flex h-5 w-5 cursor-grab items-center justify-center rounded text-muted-foreground/30",
            "opacity-0 transition-all active:cursor-grabbing",
            "hover:bg-foreground/[0.06] hover:text-foreground group-hover:opacity-100",
          )}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </span>
        <span className="font-mono text-[11px] tabular-nums text-muted-foreground/50">
          {String(index + 1).padStart(2, "0")}
        </span>
        <span
          title={archived ? "Archived" : submitted ? "Submitted" : "Pending"}
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            archived
              ? "bg-muted-foreground/25 ring-1 ring-muted-foreground/40"
              : submitted
                ? "bg-emerald-500"
                : "bg-muted-foreground/30",
          )}
        />
        {item.liked && (
          <Star className="h-3 w-3 fill-primary text-primary" />
        )}
      </div>

      {/* ── Col 2: Source ── scene, part ───────────────────────── */}
      <div className="min-w-0 px-3 py-3">
        {sceneName && (
          <p
            title={sceneName}
            className="truncate text-[12px] font-medium leading-snug text-foreground/80"
          >
            {sceneName}
          </p>
        )}
        {partLabel && (
          <p className="mt-0.5 font-mono text-[10px] text-muted-foreground/55">
            {partLabel}
          </p>
        )}
        {!sceneName && !partLabel && (
          <p
            title={item.source.label}
            className="truncate text-[12px] text-muted-foreground/60"
          >
            {item.source.label}
          </p>
        )}
      </div>

      {/* ── Col 3: Script ── screenplay excerpt (hidden at narrow widths) ── */}
      {layout === "narrow" ? (
        <span aria-hidden />
      ) : (
        <div className="min-w-0 px-3 py-3">
          {item.scriptExcerpt && !collapsed ? (
            <p
              title={item.scriptExcerpt}
              className="line-clamp-5 break-words text-[11.5px] italic leading-[1.55] text-muted-foreground/65"
            >
              {item.scriptExcerpt}
            </p>
          ) : item.scriptExcerpt && collapsed ? (
            <p
              title={item.scriptExcerpt}
              className="line-clamp-1 break-words text-[11.5px] italic text-muted-foreground/55"
            >
              {item.scriptExcerpt}
            </p>
          ) : (
            <span className="text-[12px] text-muted-foreground/25">—</span>
          )}
        </div>
      )}

      {/* ── Col 4: Refs ── thumbnails + result-video thumb ─────────── */}
      <div className="flex min-w-0 flex-wrap content-start gap-1.5 px-3 py-3">
        {collapsed ? (
          <>
            {item.referenceImages[0] && (
              <QueueThumb
                key={item.referenceImages[0]}
                entityRoot={entityRoot}
                path={item.referenceImages[0]}
                size="sm"
                onPreview={onPreview}
                onRemove={() => onRemoveRef(item.referenceImages[0]!)}
              />
            )}
            {item.referenceImages.length > 1 && (
              <span
                title={`${item.referenceImages.length} reference images`}
                className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-foreground/[0.06] font-mono text-[10px] font-semibold tabular-nums text-muted-foreground/70 ring-1 ring-border/70"
              >
                +{item.referenceImages.length - 1}
              </span>
            )}
            {(item.resultVideo || linkingVideo) && (
              <QueueResultVideoThumb
                entityRoot={entityRoot}
                path={item.resultVideo}
                loading={linkingVideo}
                onPreview={onPreview}
                onClear={onClearVideo}
              />
            )}
          </>
        ) : (
          <>
            {item.referenceImages.map((path) => (
              <QueueThumb
                key={path}
                entityRoot={entityRoot}
                path={path}
                size="sm"
                onPreview={onPreview}
                onRemove={() => onRemoveRef(path)}
              />
            ))}
            {addingRefs && (
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-foreground/[0.04] ring-1 ring-border/70">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground/50" />
              </div>
            )}
            {(item.resultVideo || linkingVideo) && (
              <QueueResultVideoThumb
                entityRoot={entityRoot}
                path={item.resultVideo}
                loading={linkingVideo}
                onPreview={onPreview}
                onClear={onClearVideo}
              />
            )}
          </>
        )}
      </div>

      {/* ── Col 5: Prompt ── version tabs + lang toggle + textarea ─ */}
      <div className="min-w-0 px-3 py-3">
        {collapsed ? (
          // Collapsed: a click-to-expand single-line preview. No tabs,
          // no lang toggle, no notes — pure scan-mode.
          <button
            type="button"
            onClick={onToggleCollapsed}
            title="Unfold this row"
            className={cn(
              "block w-full max-w-[80ch] truncate rounded-md px-1 py-1 text-left",
              "text-[13px] leading-snug text-foreground/85",
              "transition-colors hover:bg-foreground/[0.04]",
              !body.trim() && "italic text-muted-foreground/45",
            )}
          >
            {body.trim() || (isZh ? "Empty ZH prompt" : "Empty prompt")}
          </button>
        ) : (
          <>
            <div className="mb-2 flex items-center gap-2">
              {/* Lang toggle */}
              <div className="flex h-7 items-center gap-0.5 rounded-md border border-foreground/10 bg-foreground/[0.04] p-0.5">
                {(["en", "zh"] as const).map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setLang(opt)}
                    aria-pressed={lang === opt}
                    className={cn(
                      "press inline-flex h-6 min-w-[28px] items-center justify-center rounded px-1.5",
                      "font-mono text-[10px] font-semibold uppercase tracking-[0.06em] transition-colors",
                      lang === opt
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground/60 hover:text-foreground",
                    )}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>

            <GrowTextarea
              value={body}
              onChange={(text) => onEditText(lang, text)}
              spellCheck={!isZh}
              placeholder={isZh ? "ZH prompt…" : "Prompt…"}
            />

            {(editingNote || hasComment) && (
              <NoteBlock
                comment={item.comment ?? ""}
                editing={editingNote}
                onEdit={() => setEditingNote(true)}
                onSave={(text) => {
                  onSetComment(text)
                  setEditingNote(false)
                }}
                onCancel={() => setEditingNote(false)}
              />
            )}
          </>
        )}
      </div>

      {/* ── Col 6: Status ── toggle · runs · repeat · runway url ── */}
      <div className="flex min-w-0 flex-col items-start gap-2 px-3 py-3">
        {/* Status + runs — always visible */}
        <div className="flex w-full items-center gap-2">
          <StatusToggle submitted={submitted} onToggle={onToggleStatus} />
          {item.submissionCount > 0 && (
            <RunsBadge count={item.submissionCount} />
          )}
        </div>

        {archived && (
          <span className="rounded bg-foreground/[0.06] px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/50">
            Archived
          </span>
        )}

        {!collapsed && (
          <>
            {/* Repeat count — always-editable number input */}
            <div className="flex items-center gap-2">
              <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground/45">
                ×
              </span>
              <RepeatCountField
                value={item.repeatCount ?? 1}
                onChange={onSetRepeatCount}
              />
            </div>

            {/* Runway Name */}
            <RunwayTextField
              value={item.runwayName ?? ""}
              placeholder="Runway name…"
              onChange={onSetRunwayName}
            />

            {/* Runway URL — always-visible input + open link */}
            <RunwayUrlField
              value={item.runwayUrl ?? ""}
              onChange={onSetRunwayUrl}
            />

            {/* Custom Instructions — per-submission override directions */}
            <CustomInstructionsField
              value={item.customInstructions ?? ""}
              onChange={onSetCustomInstructions}
            />
          </>
        )}
      </div>

      {/* ── Col 7: Actions ── fold · like · copy · more (2x2) ──── */}
      <div className="grid grid-cols-2 content-start gap-0.5 px-2 py-3">
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-pressed={collapsed}
          title={collapsed ? "Unfold row" : "Fold row to one line"}
          className={cn(
            "press flex h-7 w-7 items-center justify-center rounded-lg transition-colors",
            collapsed
              ? "bg-foreground/[0.08] text-foreground"
              : "text-muted-foreground/45 opacity-0 hover:bg-foreground/[0.06] hover:text-foreground group-hover:opacity-100",
          )}
        >
          {collapsed ? (
            <ChevronRight className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </button>
        <button
          type="button"
          onClick={onToggleLike}
          title={item.liked ? "Liked — click to unlike" : "Like"}
          className={cn(
            "press flex h-7 w-7 items-center justify-center rounded-lg transition-colors",
            item.liked
              ? "text-primary hover:bg-primary/10"
              : "text-muted-foreground/35 opacity-0 transition-opacity hover:bg-foreground/[0.06] hover:text-foreground group-hover:opacity-100",
          )}
        >
          <Star
            className={cn("h-3.5 w-3.5", item.liked && "fill-current")}
          />
        </button>
        <button
          type="button"
          onClick={copyPrompt}
          title={isZh ? "Copy ZH prompt" : "Copy prompt"}
          className="press flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground/35 opacity-0 transition-all hover:bg-foreground/[0.06] hover:text-foreground group-hover:opacity-100"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </button>
        <RowMenu
          archived={archived}
          hasComment={hasComment}
          onEditNote={() => setEditingNote(true)}
          onToggleArchive={onToggleArchive}
          onDelete={onDelete}
        />
      </div>
    </div>
  )
}

// ── Auto-growing prompt textarea — boxless, grows to fit ──────────────────

function GrowTextarea({
  value,
  onChange,
  placeholder,
  spellCheck,
}: {
  value: string
  onChange: (text: string) => void
  placeholder: string
  spellCheck: boolean
}) {
  const ref = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${el.scrollHeight}px`
  }, [value])

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      spellCheck={spellCheck}
      rows={1}
      className={cn(
        "block w-full max-w-[80ch] resize-none overflow-hidden rounded-md bg-transparent",
        "text-[14.5px] leading-[1.75] text-foreground/90 caret-primary outline-none",
        "placeholder:text-muted-foreground/40",
        "transition-colors focus:bg-foreground/[0.02]",
      )}
    />
  )
}

// ── Note — the writer's comment, boxless with a left accent rule ──────────

function NoteBlock({
  comment,
  editing,
  onEdit,
  onSave,
  onCancel,
}: {
  comment: string
  editing: boolean
  onEdit: () => void
  onSave: (text: string) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState(comment)
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (editing) {
      setDraft(comment)
      const el = ref.current
      if (el) {
        el.focus()
        el.setSelectionRange(el.value.length, el.value.length)
      }
    }
  }, [editing, comment])

  if (editing) {
    return (
      <div className="mt-3 flex max-w-[80ch] gap-2.5 border-l-2 border-primary/55 pl-3">
        <textarea
          ref={ref}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault()
              onCancel()
            }
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              onSave(draft.trim())
            }
          }}
          rows={2}
          placeholder="Add a note for this submission…"
          className={cn(
            "min-h-[2.5rem] flex-1 resize-y bg-transparent py-1 text-[13px] leading-relaxed",
            "text-foreground outline-none placeholder:text-muted-foreground/40",
          )}
        />
        <div className="flex shrink-0 flex-col gap-1">
          <button
            type="button"
            onClick={() => onSave(draft.trim())}
            title="Save note (⌘↵)"
            className="press grid h-6 w-6 place-items-center rounded-md bg-primary text-primary-foreground"
          >
            <Check className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onCancel}
            title="Cancel (Esc)"
            className="press grid h-6 w-6 place-items-center rounded-md text-muted-foreground/60 hover:bg-foreground/[0.06] hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={onEdit}
      title="Edit note"
      className={cn(
        "mt-3 flex max-w-[80ch] items-start gap-2 border-l-2 border-primary/45 pl-3 text-left",
        "transition-colors hover:border-primary",
      )}
    >
      <MessageSquare className="mt-[3px] h-3.5 w-3.5 shrink-0 text-primary/70" />
      <span className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-muted-foreground">
        {comment}
      </span>
    </button>
  )
}

// ── Row overflow menu — note · archive · delete ───────────────────────────

function RowMenu({
  archived,
  hasComment,
  onEditNote,
  onToggleArchive,
  onDelete,
}: {
  archived: boolean
  hasComment: boolean
  onEditNote: () => void
  onToggleArchive: () => void
  onDelete: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        title="More"
        className={cn(
          "press flex h-7 w-7 items-center justify-center rounded-lg outline-none",
          "text-muted-foreground/45 transition-colors",
          "hover:bg-foreground/[0.06] hover:text-foreground",
          "data-[state=open]:bg-foreground/[0.06] data-[state=open]:text-foreground",
          "focus-visible:ring-2 focus-visible:ring-ring/40",
        )}
      >
        <MoreHorizontal className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[176px]">
        <DropdownMenuItem onSelect={onEditNote} className="gap-2">
          <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
          {hasComment ? "Edit note" : "Add note"}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onToggleArchive} className="gap-2">
          {archived ? (
            <>
              <ArchiveRestore className="h-3.5 w-3.5 text-muted-foreground" />
              Restore to queue
            </>
          ) : (
            <>
              <Archive className="h-3.5 w-3.5 text-muted-foreground" />
              Archive
            </>
          )}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={onDelete}
          className="gap-2 text-destructive focus:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete permanently
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// ── Status toggle — pending ⇄ submitted ───────────────────────────────────

function StatusToggle({
  submitted,
  onToggle,
}: {
  submitted: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title={
        submitted
          ? "Submitted — click to mark pending"
          : "Pending — click to mark submitted"
      }
      className={cn(
        "press inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5",
        "font-mono text-[10px] font-semibold uppercase tracking-[0.1em] transition-colors",
        submitted
          ? "bg-emerald-500/12 text-emerald-600 ring-1 ring-inset ring-emerald-500/30 hover:bg-emerald-500/20 dark:text-emerald-400"
          : "text-muted-foreground/70 ring-1 ring-inset ring-border hover:text-foreground hover:ring-foreground/30",
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          submitted ? "bg-emerald-500" : "bg-muted-foreground/40",
        )}
      />
      {submitted ? "Submitted" : "Pending"}
    </button>
  )
}

/** The submission iterator — how many times this prompt has gone out. */
function RunsBadge({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <span
      title={`Submitted ${count} time${count === 1 ? "" : "s"}`}
      className="inline-flex h-7 items-center rounded-lg bg-foreground/[0.06] px-2 font-mono text-[10px] font-semibold tabular-nums text-muted-foreground/80"
    >
      {count}×
    </span>
  )
}

// ── Reference thumbnail — click to expand, hover to remove ────────────────

function QueueThumb({
  entityRoot,
  path,
  size = "md",
  onPreview,
  onRemove,
}: {
  entityRoot: EntityRoot
  path: string
  /** `"sm"` = 40×40 for the table Refs column; `"md"` = 72×72 (default). */
  size?: "sm" | "md"
  onPreview: (media: PreviewMedia) => void
  onRemove: () => void
}) {
  const resolved = trpc.entities.resolvePath.useQuery(
    { ...entityRoot, entityPath: path },
    { staleTime: 60_000 },
  )
  const name = path.split("/").pop() ?? path
  const url = resolved.data?.absPath ? assetUrl(resolved.data.absPath) : null

  const dim = size === "sm" ? "h-10 w-10" : "h-[72px] w-[72px]"
  const iconSz = size === "sm" ? "h-3 w-3" : "h-4 w-4"

  return (
    <div className={cn("group/thumb relative shrink-0", dim)}>
      {url ? (
        <button
          type="button"
          title={`${name} — click to expand`}
          onClick={() => onPreview({ url, name, kind: "image" })}
          className={cn(
            "press relative block h-full w-full cursor-zoom-in overflow-hidden rounded-lg",
            "bg-foreground/[0.04] ring-1 ring-border/70 transition-all duration-150",
            "hover:ring-primary/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
          )}
        >
          <img
            src={url}
            alt={name}
            draggable={false}
            className="h-full w-full object-cover transition-transform duration-200 group-hover/thumb:scale-[1.06]"
          />
          <span
            aria-hidden
            className="absolute inset-0 flex items-center justify-center bg-[hsl(0_0%_3%/0.42)] opacity-0 transition-opacity duration-150 group-hover/thumb:opacity-100"
          >
            <span
              style={liquidGlassStyle}
              className="bl-liquid-glass grid h-6 w-6 place-items-center rounded-full text-foreground/90"
            >
              <Maximize2 className="h-3 w-3" />
            </span>
          </span>
        </button>
      ) : (
        <div
          title={name}
          className="grid h-full w-full place-items-center rounded-lg bg-foreground/[0.04] text-muted-foreground/35 ring-1 ring-border/70"
        >
          <ImageOff className={iconSz} />
        </div>
      )}
      <button
        type="button"
        onClick={onRemove}
        title="Remove reference"
        className={cn(
          "absolute -right-2 -top-2 grid h-5 w-5 place-items-center rounded-full",
          "bg-background text-foreground/70 ring-1 ring-border opacity-0 transition-opacity",
          "hover:bg-destructive hover:text-white group-hover/thumb:opacity-100",
        )}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  )
}

// ── Result video — the linked generated clip ──────────────────────────────

function QueueResultVideo({
  entityRoot,
  path,
  loading,
  onPreview,
  onClear,
}: {
  entityRoot: EntityRoot
  path: string | undefined
  loading: boolean
  onPreview: (media: PreviewMedia) => void
  onClear: () => void
}) {
  const resolved = trpc.entities.resolvePath.useQuery(
    { ...entityRoot, entityPath: path ?? "" },
    { staleTime: 60_000, enabled: !!path },
  )

  if (loading) {
    return (
      <div className="grid h-[112px] w-[200px] place-items-center rounded-lg bg-foreground/[0.04] text-muted-foreground/55 ring-1 ring-border/70">
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    )
  }

  if (!path) return null

  const name = path.split("/").pop() ?? path
  const url = resolved.data?.absPath ? assetUrl(resolved.data.absPath) : null

  if (!url) {
    return (
      <div className="grid h-[112px] w-[200px] place-items-center rounded-lg bg-foreground/[0.04] text-muted-foreground/35 ring-1 ring-border/70">
        <Video className="h-4 w-4" />
      </div>
    )
  }

  return (
    <div className="group/result relative h-[112px] w-[200px] shrink-0">
      <button
        type="button"
        title={`${name} — click to play`}
        onClick={() => onPreview({ url, name, kind: "video" })}
        className={cn(
          "press relative block h-full w-full cursor-zoom-in overflow-hidden rounded-lg",
          "bg-black ring-1 ring-border/70 transition-all duration-150",
          "hover:ring-primary/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
        )}
      >
        {/* `#t=0.1` nudges the element to render a real first frame. */}
        <video
          src={`${url}#t=0.1`}
          muted
          playsInline
          preload="metadata"
          className="h-full w-full object-cover"
        />
        <span
          aria-hidden
          className="absolute inset-0 flex items-center justify-center bg-[hsl(0_0%_3%/0.30)] transition-colors duration-150 group-hover/result:bg-[hsl(0_0%_3%/0.12)]"
        >
          <span
            style={liquidGlassStyle}
            className="bl-liquid-glass grid h-9 w-9 place-items-center rounded-full text-foreground"
          >
            <Play className="h-4 w-4 translate-x-[1px] fill-current" />
          </span>
        </span>
      </button>
      <button
        type="button"
        onClick={onClear}
        title="Unlink result video"
        className={cn(
          "absolute -right-2 -top-2 grid h-5 w-5 place-items-center rounded-full",
          "bg-background text-foreground/70 ring-1 ring-border opacity-0 transition-opacity",
          "hover:bg-destructive hover:text-white group-hover/result:opacity-100",
        )}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  )
}

// ── Repeat-count field — local draft so backspace works ────────────────

function RepeatCountField({
  value,
  onChange,
}: {
  value: number
  onChange: (n: number) => void
}) {
  // Local draft so the user can clear the field and retype. Without this,
  // a fully-controlled input rejects the empty intermediate state and the
  // old value snaps back, leaving the user unable to ever go from "1" to
  // a fresh single digit — only able to append, producing "12", "13" …
  const [draft, setDraft] = useState(String(value))
  const editingRef = useRef(false)

  useEffect(() => {
    if (!editingRef.current) setDraft(String(value))
  }, [value])

  const commit = (raw: string) => {
    const n = parseInt(raw, 10)
    if (Number.isFinite(n) && n >= 1 && n <= 20) {
      if (n !== value) onChange(n)
      setDraft(String(n))
    } else {
      // Restore last good value on invalid/empty blur.
      setDraft(String(value))
    }
  }

  return (
    <input
      type="number"
      min={1}
      max={20}
      value={draft}
      onFocus={() => (editingRef.current = true)}
      onChange={(e) => {
        setDraft(e.target.value)
        const n = parseInt(e.target.value, 10)
        if (Number.isFinite(n) && n >= 1 && n <= 20 && n !== value) {
          onChange(n)
        }
      }}
      onBlur={(e) => {
        editingRef.current = false
        commit(e.target.value)
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.currentTarget.blur()
        } else if (e.key === "Escape") {
          setDraft(String(value))
          e.currentTarget.blur()
        }
      }}
      title="Number of generation runs"
      className={cn(
        "h-6 w-12 rounded-md bg-foreground/[0.06] px-2 text-center",
        "font-mono text-[11px] font-semibold tabular-nums text-foreground/80",
        "outline-none transition-colors",
        "hover:bg-foreground/[0.09] focus:bg-foreground/[0.09] focus:ring-1 focus:ring-primary/50",
        "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
      )}
    />
  )
}

// ── Generic debounced text field — used for Runway Name ──────────────────

function RunwayTextField({
  value,
  placeholder,
  onChange,
}: {
  value: string
  placeholder: string
  onChange: (val: string) => void
}) {
  const [draft, setDraft] = useState(value)
  const editingRef = useRef(false)

  useEffect(() => {
    if (!editingRef.current) setDraft(value)
  }, [value])

  const commit = () => {
    editingRef.current = false
    const trimmed = draft.trim()
    if (trimmed !== value) onChange(trimmed)
  }

  return (
    <input
      type="text"
      value={draft}
      onChange={(e) => {
        editingRef.current = true
        setDraft(e.target.value)
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); commit() }
        if (e.key === "Escape") {
          e.preventDefault()
          editingRef.current = false
          setDraft(value)
          ;(e.target as HTMLInputElement).blur()
        }
      }}
      placeholder={placeholder}
      className={cn(
        "h-6 w-full rounded-md px-2",
        "font-mono text-[10px] outline-none transition-colors",
        "placeholder:text-muted-foreground/30",
        value
          ? "bg-foreground/[0.06] text-foreground/80 ring-1 ring-border/50 focus:ring-primary/50"
          : "bg-foreground/[0.06] text-foreground/70 focus:ring-1 focus:ring-primary/50",
      )}
    />
  )
}

// ── Runway URL field — paste-and-link, inline in the Status column ────────

function RunwayUrlField({
  value,
  onChange,
}: {
  value: string
  onChange: (url: string) => void
}) {
  const [draft, setDraft] = useState(value)
  const savingRef = useRef(false)

  // Sync draft when value changes externally (poll round-trip) but only
  // when the field isn't mid-edit.
  useEffect(() => {
    if (!savingRef.current) setDraft(value)
  }, [value])

  const commit = () => {
    savingRef.current = false
    const trimmed = draft.trim()
    if (trimmed !== value) onChange(trimmed)
  }

  const hasUrl = !!value.trim()

  return (
    <div className="flex w-full items-center gap-1">
      <input
        type="url"
        value={draft}
        onChange={(e) => {
          savingRef.current = true
          setDraft(e.target.value)
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commit() }
          if (e.key === "Escape") {
            e.preventDefault()
            savingRef.current = false
            setDraft(value)
            ;(e.target as HTMLInputElement).blur()
          }
        }}
        placeholder="Runway URL…"
        className={cn(
          "h-6 min-w-0 flex-1 rounded-md px-2",
          "font-mono text-[10px] outline-none transition-colors",
          "placeholder:text-muted-foreground/30",
          hasUrl
            ? "bg-emerald-500/10 text-emerald-400/90 ring-1 ring-emerald-500/25 focus:ring-emerald-500/50"
            : "bg-foreground/[0.06] text-foreground/70 focus:ring-1 focus:ring-primary/50",
        )}
      />
      {hasUrl && (
        <a
          href={value}
          target="_blank"
          rel="noreferrer"
          title="Open in Runway"
          className="press flex h-6 w-6 shrink-0 items-center justify-center rounded text-emerald-500/60 transition-colors hover:bg-emerald-500/10 hover:text-emerald-400"
        >
          <Play className="h-3 w-3 translate-x-px fill-current" />
        </a>
      )}
    </div>
  )
}

// ── Custom Instructions — per-submission override directions ──────────────
//
// Sits directly under the Runway URL because it is part of the
// submission configuration (not the prompt). Auto-growing textarea so
// short notes stay one line and longer overrides expand without a
// separate edit modal.

function CustomInstructionsField({
  value,
  onChange,
}: {
  value: string
  onChange: (text: string) => void
}) {
  const [draft, setDraft] = useState(value)
  const editingRef = useRef(false)
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!editingRef.current) setDraft(value)
  }, [value])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.max(el.scrollHeight, 24)}px`
  }, [draft])

  const commit = () => {
    editingRef.current = false
    if (draft !== value) onChange(draft)
  }

  const hasText = !!value.trim()

  return (
    <textarea
      ref={ref}
      value={draft}
      onChange={(e) => {
        editingRef.current = true
        setDraft(e.target.value)
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault()
          editingRef.current = false
          setDraft(value)
          ;(e.target as HTMLTextAreaElement).blur()
        }
      }}
      rows={1}
      placeholder="Custom instructions… (overrides defaults)"
      title="Overrides any submission instructions for this row, if present"
      className={cn(
        "w-full resize-none rounded-md px-2 py-1",
        "font-mono text-[10px] leading-[1.45] outline-none transition-colors",
        "placeholder:text-muted-foreground/30",
        hasText
          ? "bg-amber-500/10 text-amber-200/90 ring-1 ring-amber-500/25 focus:ring-amber-500/50"
          : "bg-foreground/[0.06] text-foreground/70 focus:ring-1 focus:ring-primary/50",
      )}
    />
  )
}

// ── Compact result-video thumbnail for the table Refs column ─────────────

function QueueResultVideoThumb({
  entityRoot,
  path,
  loading,
  onPreview,
  onClear,
}: {
  entityRoot: EntityRoot
  path: string | undefined
  loading: boolean
  onPreview: (media: PreviewMedia) => void
  onClear: () => void
}) {
  const resolved = trpc.entities.resolvePath.useQuery(
    { ...entityRoot, entityPath: path ?? "" },
    { staleTime: 60_000, enabled: !!path },
  )

  if (loading) {
    return (
      <div className="grid h-10 w-[68px] shrink-0 place-items-center rounded-md bg-foreground/[0.04] ring-1 ring-border/70">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground/50" />
      </div>
    )
  }

  if (!path) return null

  const name = path.split("/").pop() ?? path
  const url = resolved.data?.absPath ? assetUrl(resolved.data.absPath) : null

  if (!url) {
    return (
      <div className="grid h-10 w-[68px] shrink-0 place-items-center rounded-md bg-foreground/[0.04] ring-1 ring-border/70">
        <Video className="h-3.5 w-3.5 text-muted-foreground/35" />
      </div>
    )
  }

  return (
    <div className="group/vthumb relative h-10 w-[68px] shrink-0">
      <button
        type="button"
        title={`${name} — click to play`}
        onClick={() => onPreview({ url, name, kind: "video" })}
        className={cn(
          "press relative block h-full w-full cursor-zoom-in overflow-hidden rounded-md",
          "bg-black ring-1 ring-border/70 transition-all duration-150",
          "hover:ring-primary/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
        )}
      >
        <video
          src={`${url}#t=0.1`}
          muted
          playsInline
          preload="metadata"
          className="h-full w-full object-cover"
        />
        <span
          aria-hidden
          className="absolute inset-0 flex items-center justify-center bg-[hsl(0_0%_3%/0.35)] transition-colors group-hover/vthumb:bg-[hsl(0_0%_3%/0.10)]"
        >
          <Play className="h-3 w-3 translate-x-px fill-white text-white" />
        </span>
      </button>
      <button
        type="button"
        onClick={onClear}
        title="Unlink result video"
        className={cn(
          "absolute -right-2 -top-2 grid h-5 w-5 place-items-center rounded-full",
          "bg-background text-foreground/70 ring-1 ring-border opacity-0 transition-opacity",
          "hover:bg-destructive hover:text-white group-hover/vthumb:opacity-100",
        )}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  )
}

// ── Filter switch ─────────────────────────────────────────────────────────

function FilterSwitch({
  value,
  onChange,
  counts,
}: {
  value: QueueFilter
  onChange: (next: QueueFilter) => void
  counts: Record<QueueFilter, number>
}) {
  const options: { id: QueueFilter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "pending", label: "Pending" },
    { id: "submitted", label: "Submitted" },
    { id: "archived", label: "Archived" },
  ]
  return (
    <div className="flex h-7 shrink-0 items-center gap-0.5 rounded-lg bg-foreground/[0.06] p-0.5">
      {options.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          aria-pressed={value === id}
          className={cn(
            "press inline-flex h-6 items-center gap-1.5 rounded-md px-2",
            "text-[11px] font-medium transition-colors",
            value === id
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground/60 hover:text-foreground",
          )}
        >
          {label}
          <span className="font-mono text-[9px] tabular-nums text-muted-foreground/55">
            {counts[id]}
          </span>
        </button>
      ))}
    </div>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────

function QueueEmpty({
  title,
  message,
}: {
  title: string
  message: string
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-10 pb-20 text-center">
      <Inbox className="mb-3 h-7 w-7 text-muted-foreground/30" />
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted-foreground">
        {message}
      </p>
    </div>
  )
}
