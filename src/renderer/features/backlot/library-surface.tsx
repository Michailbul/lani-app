"use client"

/**
 * LibrarySurface — Backlot's "Library" workflow mode.
 *
 * A per-project bookshelf of reusable workflows, character-sheet
 * templates and saved generation prompts. The writer (or the agent)
 * collects recipes that pay off across scenes — "hero turnaround
 * sheet, then Seedance 2 model spin", "wide-eye close-up for
 * confessional moments", etc. — and parks them here once. From any
 * scene they can hit Copy to paste the whole workflow into chat in
 * one shot, or refer to it by its slug id when chatting with the agent.
 *
 * The surface renders as a Pinterest-style masonry. Items are
 * **cardless** — no surrounding box, no ring; the image is the
 * visual anchor and the text floats directly below it. When an entry
 * carries more than one reference image, the thumbnail slowly
 * cross-fades through them. Hovering pauses the rotation so the
 * writer can fixate on what caught their eye. Clicking anywhere on
 * the entry opens a modal with the prompt templates, full reference
 * carousel, edit / delete actions and a one-click Copy button.
 *
 * Backing storage is `library.backlot.json` at the project root —
 * read/written by the `library` tRPC router, edited in place by the
 * in-app agent. Reference images live under `library-media/<itemId>/`.
 * Every write is settled as a git commit, so the library has the
 * same time-travel guarantees as the rest of the project.
 */

import {
  type CSSProperties,
  type FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import {
  ArrowDown,
  ArrowUp,
  Braces,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Eye,
  Hash,
  ImageOff,
  LibraryBig,
  Loader2,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash2,
  User,
  Wand2,
  Wrench,
  X,
} from "lucide-react"
import { toast } from "sonner"
import {
  buildLibraryClipboard,
  buildMarkdownBody,
  type LibraryItem,
  type LibraryItemKind,
  type LibrarySource,
} from "../../../shared/library-types"
import { selectedAgentChatIdAtom, selectedProjectAtom } from "../agents/atoms"
import { trpc } from "../../lib/trpc"
import { cn } from "../../lib/utils"
import { isImagePath } from "./entity-kind"
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "../../components/ui/dialog"
import { GlassFilter } from "../../components/ui/liquid-glass-filter"
import { ResizableSidebar } from "../../components/ui/resizable-sidebar"
import { MarkdownPreview } from "./markdown-preview"
import { Resizer } from "./resizer"
import {
  libraryHeroHeightAtom,
  libraryPanelWidthAtom,
  workspaceRightInsetAtom,
} from "./atoms"

const LIVE_POLL_MS = 2500

type EntityRoot =
  | { chatId: string; projectId?: undefined }
  | { chatId?: undefined; projectId: string }

type KindFilter = "all" | LibraryItemKind
type SourceFilter = "all" | LibrarySource

/**
 * Composite key for the currently-open entry — id alone isn't unique
 * across tiers (a project entry can shadow a studio entry with the
 * same id even though the gallery hides that case). Keeping both
 * keeps lookups deterministic.
 */
interface OpenKey {
  source: LibrarySource
  id: string
}

interface KindMeta {
  label: string
  short: string
  Icon: typeof Wand2
  /** Tailwind colour class for the kind's text + dot. */
  accent: string
  /** Dot colour (raw hsl) for the small kind marker next to the title. */
  dot: string
  /** Subtle painterly gradient for entries with no cover image. */
  swatch: string
}

const KIND_META: Record<LibraryItemKind, KindMeta> = {
  workflow: {
    label: "Workflow",
    short: "WF",
    Icon: Wand2,
    accent: "text-primary",
    dot: "bg-primary",
    swatch:
      "bg-[radial-gradient(circle_at_22%_18%,hsl(var(--primary)/0.34),transparent_55%),linear-gradient(140deg,hsl(var(--primary)/0.20),hsl(var(--primary)/0.04))]",
  },
  "character-sheet": {
    label: "Character sheet",
    short: "CS",
    Icon: User,
    accent: "text-foreground",
    dot: "bg-foreground/70",
    swatch:
      "bg-[radial-gradient(circle_at_70%_30%,hsl(var(--foreground)/0.18),transparent_60%),linear-gradient(160deg,hsl(var(--foreground)/0.08),hsl(var(--foreground)/0.02))]",
  },
  prompt: {
    label: "Prompt",
    short: "PR",
    Icon: Sparkles,
    accent: "text-amber-500 dark:text-amber-300",
    dot: "bg-amber-500 dark:bg-amber-300",
    swatch:
      "bg-[radial-gradient(circle_at_25%_75%,hsl(45_92%_60%/0.32),transparent_55%),linear-gradient(135deg,hsl(45_92%_60%/0.18),hsl(45_92%_60%/0.03))]",
  },
}

const KIND_ORDER: LibraryItemKind[] = ["workflow", "character-sheet", "prompt"]

/** Stream a project file to the renderer over the backlot-asset:// scheme. */
function assetUrl(absPath: string): string {
  return `backlot-asset://asset/?p=${encodeURIComponent(absPath)}`
}

/** Resolve the absolute path of a file dragged in from Finder. */
function pathForDroppedFile(file: File): string | null {
  const fromElectron = window.webUtils?.getPathForFile(file)
  if (fromElectron) return fromElectron
  const legacy = (file as File & { path?: string }).path
  return legacy || null
}

function classifyDroppedImages(files: File[]): string[] {
  const out: string[] = []
  for (const file of files) {
    const path = pathForDroppedFile(file)
    if (!path) continue
    if (isImagePath(path)) out.push(path)
  }
  return out
}

// ──────────────────────────────────────────────────────────────────────────

export function LibrarySurface() {
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
      <LibraryEmpty
        title="No project"
        message="Pick a project to open its library."
      />
    )
  }
  return <LibraryWorkspace key={entityRootKey} entityRoot={entityRoot} />
}

function LibraryWorkspace({ entityRoot }: { entityRoot: EntityRoot }) {
  const list = trpc.library.list.useQuery(entityRoot, {
    refetchOnWindowFocus: true,
    refetchInterval: LIVE_POLL_MS,
  })

  const utils = trpc.useUtils()
  const refetch = () => {
    void utils.library.list.invalidate(entityRoot)
  }

  const addItem = trpc.library.addEntry.useMutation({
    onError: (err) => toast.error(err.message || "Couldn't add the entry"),
    onSuccess: (r) => {
      refetch()
      toast.success(
        r.source === "studio"
          ? "Saved to studio library"
          : "Saved to project library",
      )
    },
  })
  const updateItem = trpc.library.updateMetadata.useMutation({
    onError: (err) => toast.error(err.message || "Couldn't update the entry"),
    onSuccess: refetch,
  })
  const removeItem = trpc.library.removeEntry.useMutation({
    onError: (err) => toast.error(err.message || "Couldn't remove the entry"),
    onSuccess: () => {
      refetch()
      toast.success("Removed from library")
    },
  })
  const addRefs = trpc.library.addReferenceImages.useMutation({
    onError: (err) => toast.error(err.message || "Couldn't add references"),
    onSuccess: (r) => {
      refetch()
      if (r.added.length > 0) {
        toast.success(
          r.added.length === 1
            ? "Reference image added"
            : `${r.added.length} reference images added`,
        )
      }
    },
  })
  const removeRef = trpc.library.removeReferenceImage.useMutation({
    onError: (err) => toast.error(err.message || "Couldn't remove reference"),
    onSettled: refetch,
  })
  const setCover = trpc.library.setCoverImage.useMutation({
    onError: (err) => toast.error(err.message || "Couldn't set the cover"),
    onSettled: refetch,
  })
  const forkMut = trpc.library.forkIntoProject.useMutation({
    onError: (err) => toast.error(err.message || "Couldn't fork the entry"),
    onSuccess: (r) => {
      refetch()
      toast.success(`Forked into project as #${r.id}`)
    },
  })
  const saveAsStudioMut = trpc.library.saveAsStudioPreset.useMutation({
    onError: (err) =>
      toast.error(err.message || "Couldn't save as studio preset"),
    onSuccess: (r) => {
      refetch()
      toast.success(`Saved to studio library as #${r.id}`)
    },
  })
  const promoteSkillMut = trpc.library.promoteToSkill.useMutation({
    onError: (err) =>
      toast.error(err.message || "Couldn't promote to a skill"),
    onSuccess: (r) => {
      toast.success(`Skill ready at ~/.backlot/skills/${r.skillName}/`)
    },
  })

  const [filter, setFilter] = useState<KindFilter>("all")
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all")
  const [search, setSearch] = useState("")
  const [openKey, setOpenKey] = useState<OpenKey | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [createKind, setCreateKind] =
    useState<LibraryItemKind>("workflow")
  const [createSource, setCreateSource] = useState<LibrarySource>("project")

  // Tell the floating ModeDock how much space the detail panel is
  // occupying on the right, so the dock recentres over the masonry
  // instead of sitting under the open panel. Cleared on close /
  // unmount so leaving the surface restores the full-width dock.
  const panelWidth = useAtomValue(libraryPanelWidthAtom)
  const setWorkspaceRightInset = useSetAtom(workspaceRightInsetAtom)
  useEffect(() => {
    setWorkspaceRightInset(openKey ? panelWidth : 0)
    return () => setWorkspaceRightInset(0)
  }, [openKey, panelWidth, setWorkspaceRightInset])

  const items = list.data?.items ?? []

  const counts = useMemo(() => {
    const c: Record<KindFilter, number> = {
      all: items.length,
      workflow: 0,
      "character-sheet": 0,
      prompt: 0,
    }
    for (const it of items) c[it.kind] += 1
    return c
  }, [items])

  const sourceCounts = useMemo(() => {
    const c: Record<SourceFilter, number> = {
      all: items.length,
      studio: 0,
      project: 0,
    }
    for (const it of items) c[it.source] += 1
    return c
  }, [items])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter((it) => {
      if (filter !== "all" && it.kind !== filter) return false
      if (sourceFilter !== "all" && it.source !== sourceFilter) return false
      if (!q) return true
      const hay = [
        it.title,
        it.subtitle ?? "",
        it.id,
        it.tags.join(" "),
      ]
        .join(" ")
        .toLowerCase()
      return hay.includes(q)
    })
  }, [items, filter, sourceFilter, search])

  const openItem = openKey
    ? items.find(
        (it) => it.id === openKey.id && it.source === openKey.source,
      ) ?? null
    : null

  if (list.isPending && items.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading library
      </div>
    )
  }

  if (list.isError && items.length === 0) {
    return (
      <LibraryEmpty
        title="Couldn't load the library"
        message={
          list.error?.message ||
          "The library couldn't be scanned. Restart Backlot and try again."
        }
      />
    )
  }

  return (
    <div className="relative flex h-full overflow-hidden bg-background">
      {/* The svg displacement filter for liquid-glass surfaces inside
          the side panel — kept at the root so chips/buttons that
          reference `url(#bl-glass-displace)` always have the filter
          mounted regardless of where the panel renders. */}
      <GlassFilter />

      {/* Main column — masthead + masonry. Shrinks horizontally when
          the detail panel opens, like a Finder preview pane. */}
      <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
      {/* ── Masthead ──────────────────────────────────────────────────── */}
      <header className="no-drag flex h-12 shrink-0 items-center gap-4 border-b border-border/70 px-5">
        <div className="flex shrink-0 items-center gap-2">
          <span className="h-3.5 w-[3px] rounded-full bg-primary" />
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            Library
          </span>
          {items.length > 0 && (
            <span className="font-mono text-[10px] tabular-nums text-muted-foreground/55">
              · {items.length}
            </span>
          )}
        </div>
        <KindSwitch value={filter} onChange={setFilter} counts={counts} />
        <SourceSwitch
          value={sourceFilter}
          onChange={setSourceFilter}
          counts={sourceCounts}
        />
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <div
            className={cn(
              "flex h-7 items-center gap-1.5 rounded-lg bg-foreground/[0.05] px-2",
              "border border-transparent transition-colors",
              "focus-within:bg-background focus-within:border-border",
            )}
          >
            <Search className="h-3 w-3 text-muted-foreground/60" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search title, tag, id…"
              className={cn(
                "w-[200px] bg-transparent",
                "text-[12px] text-foreground placeholder:text-muted-foreground/55",
                "focus:outline-none",
              )}
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                aria-label="Clear search"
                className="press grid h-4 w-4 place-items-center rounded-full text-muted-foreground/60 hover:text-foreground"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              setCreateKind(
                filter === "all" ? "workflow" : (filter as LibraryItemKind),
              )
              // Default the destination to whichever tier the user
              // is filtering on; "all" defaults to project so new
              // entries stay scoped to the current film unless the
              // writer explicitly picks studio.
              setCreateSource(
                sourceFilter === "studio" ? "studio" : "project",
              )
              setCreateOpen(true)
            }}
            className={cn(
              "press flex h-7 items-center gap-1.5 rounded-lg px-2.5",
              "bg-primary text-primary-foreground",
              "font-mono text-[10px] font-semibold uppercase tracking-[0.1em]",
              "hover:bg-primary/90 transition-colors",
            )}
          >
            <Plus className="h-3.5 w-3.5" />
            New entry
          </button>
        </div>
      </header>

      {/* ── Body — masonry or empty ───────────────────────────────────── */}
      {items.length === 0 ? (
        <FirstRunEmpty
          onCreate={(kind) => {
            setCreateKind(kind)
            setCreateOpen(true)
          }}
        />
      ) : visible.length === 0 ? (
        <LibraryEmpty
          title="No matching entries"
          message={
            search
              ? `Nothing in the library matches "${search}".`
              : "Switch the filter, or add a new entry."
          }
        />
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-28 pt-5">
          <Masonry>
            {visible.map((item) => (
              <LibraryItemView
                key={`${item.source}:${item.id}`}
                item={item}
                onOpen={() =>
                  setOpenKey({ source: item.source, id: item.id })
                }
                onCopy={async () => {
                  // Fetch the entry's markdown body so the gallery's
                  // one-click Copy hands the agent the same full
                  // payload as the panel's Copy button.
                  const md = await utils.library.readMarkdown.fetch({
                    ...entityRoot,
                    source: item.source,
                    itemId: item.id,
                  })
                  await copyItemPayload(item, md.body)
                }}
              />
            ))}
          </Masonry>
        </div>
      )}

      </div>{/* /main column */}

      {/* ── Detail panel — slides in from the right, resizable ─────── */}
      <ResizableSidebar
        isOpen={!!openItem}
        onClose={() => setOpenKey(null)}
        widthAtom={libraryPanelWidthAtom}
        side="right"
        minWidth={360}
        maxWidth={900}
        disableClickToClose
        className="border-l border-border/70 bg-background"
      >
        {openItem && (
          <LibraryDetail
            item={openItem}
            entityRoot={entityRoot}
            onClose={() => setOpenKey(null)}
            onUpdate={(patch) =>
              updateItem.mutate({
                ...entityRoot,
                source: openItem.source,
                itemId: openItem.id,
                patch,
              })
            }
            onDelete={() => {
              removeItem.mutate({
                ...entityRoot,
                source: openItem.source,
                itemId: openItem.id,
              })
              setOpenKey(null)
            }}
            onAddReferences={(paths) =>
              addRefs.mutate({
                ...entityRoot,
                source: openItem.source,
                itemId: openItem.id,
                sourcePaths: paths,
              })
            }
            onRemoveReference={(filename) =>
              removeRef.mutate({
                ...entityRoot,
                source: openItem.source,
                itemId: openItem.id,
                filename,
              })
            }
            onSetCover={(filename) =>
              setCover.mutate({
                ...entityRoot,
                source: openItem.source,
                itemId: openItem.id,
                filename,
              })
            }
            addRefsPending={
              addRefs.isPending && addRefs.variables?.itemId === openItem.id
            }
            onForkIntoProject={
              openItem.source === "studio"
                ? () =>
                    forkMut.mutate(
                      { ...entityRoot, studioId: openItem.id },
                      {
                        onSuccess: (r) =>
                          setOpenKey({ source: "project", id: r.id }),
                      },
                    )
                : undefined
            }
            onSaveAsStudioPreset={
              openItem.source === "project"
                ? () =>
                    saveAsStudioMut.mutate({
                      ...entityRoot,
                      projectId: openItem.id,
                    })
                : undefined
            }
            onPromoteToSkill={() =>
              promoteSkillMut.mutate({
                ...entityRoot,
                source: openItem.source,
                itemId: openItem.id,
              })
            }
            forkPending={forkMut.isPending}
            extractPending={saveAsStudioMut.isPending}
            promotePending={promoteSkillMut.isPending}
          />
        )}
      </ResizableSidebar>

      {/* ── Create dialog ─────────────────────────────────────────────── */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent
          showCloseButton={false}
          className={cn(
            "w-[720px] max-w-[calc(100%-2rem)] max-h-[calc(100%-3rem)]",
            "!gap-0 !rounded-[20px] !border-0 !bg-transparent !p-0 !shadow-none",
            "overflow-hidden bl-liquid-glass",
          )}
        >
          <DialogTitle className="sr-only">Add to library</DialogTitle>
          <LibraryCreateForm
            initialKind={createKind}
            initialSource={createSource}
            submitting={addItem.isPending}
            onClose={() => setCreateOpen(false)}
            onSubmit={async (draft) => {
              const res = await addItem.mutateAsync({
                ...entityRoot,
                ...draft,
              })
              setCreateOpen(false)
              if (res) setOpenKey({ source: res.source, id: res.id })
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── Masonry — pure-CSS columns. Items stay intact across breaks. ─────────

function Masonry({ children }: { children: ReactNode }) {
  // CSS Grid with `auto-fill` — the gallery always fills the
  // container's width. Each cell minimum 220px, growing equally to
  // absorb leftover space, so five entries across a wide viewport
  // sit as five evenly-spaced cells instead of three clustered cards
  // and a wall of empty pixels.
  //
  // Item heights vary because each cell's content does — the row
  // aligns to the tallest member, which reads more like a magazine
  // contact sheet than a chaotic Pinterest wall. That's the right
  // trade-off here: the library is a curated index, not a feed.
  return (
    <div
      className={cn(
        "grid items-start gap-x-5 gap-y-7",
        "[grid-template-columns:repeat(auto-fill,minmax(200px,1fr))]",
      )}
    >
      {children}
    </div>
  )
}

// ── LibraryItem — cardless masonry entry ─────────────────────────────────
//
// No surrounding box, no ring. The image is the visual anchor; the
// title and metadata float directly below it. Multi-image entries
// cross-fade through their references on a slow loop while visible
// (and paused on hover). Click anywhere on the item opens the modal.

function LibraryItemView({
  item,
  onOpen,
  onCopy,
}: {
  item: LibraryItem
  onOpen: () => void
  onCopy: () => void
}) {
  const [copied, setCopied] = useState(false)
  const [hovered, setHovered] = useState(false)

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation()
    onCopy()
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1400)
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onOpen()
        }
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={cn(
        "group flex cursor-pointer flex-col",
        "focus-visible:outline-none",
      )}
    >
      <div className="relative">
        <RotatingThumb item={item} paused={hovered} />

        {/* Subtle hover halo — no box, just a faint primary glow. */}
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute -inset-1 -z-10 rounded-[18px] opacity-0",
            "transition-opacity duration-300",
            "bg-[radial-gradient(60%_60%_at_50%_50%,hsl(var(--primary)/0.16),transparent_75%)]",
            "group-hover:opacity-100",
          )}
        />

        {/* Source chip — top-left, only for studio entries. Project
            entries are the default and don't need a label. */}
        {item.source === "studio" && (
          <span
            className={cn(
              "pointer-events-none absolute left-2 top-2 inline-flex h-5 items-center gap-1 rounded-full px-2",
              "bg-background/80 text-[9px] font-semibold uppercase tracking-[0.12em]",
              "text-foreground/75 backdrop-blur-md ring-1 ring-border/55",
            )}
          >
            Studio
          </span>
        )}

        {/* Top-right Copy button — appears on hover. */}
        <button
          type="button"
          onClick={handleCopy}
          title="Copy the agent payload to clipboard"
          aria-label="Copy workflow for agent"
          className={cn(
            "press absolute right-2 top-2 inline-flex h-8 items-center gap-1.5 rounded-full px-3",
            "text-[10px] font-semibold uppercase tracking-[0.1em]",
            "bg-background/80 text-foreground backdrop-blur-md ring-1 ring-border/55",
            "opacity-0 translate-y-1 transition-all duration-200",
            "group-hover:opacity-100 group-hover:translate-y-0",
            "focus-visible:opacity-100 focus-visible:translate-y-0 focus:outline-none",
            "hover:bg-background hover:ring-primary/45",
            copied &&
              "opacity-100 translate-y-0 bg-primary text-primary-foreground ring-primary/40",
          )}
        >
          {copied ? (
            <>
              <Check className="h-3 w-3" />
              Copied
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              Copy
            </>
          )}
        </button>
      </div>

      {/* ── Text block — directly under the image, no chrome. Just
          the title and (optional) subtitle, nothing else. The id,
          kind, and reference count all live in the detail modal —
          the gallery is for visual scanning. ── */}
      <div className="mt-2.5 flex flex-col gap-0.5">
        <h3 className="text-[13px] font-medium leading-snug text-foreground line-clamp-2">
          {item.title}
        </h3>
        {item.subtitle && (
          <p className="text-[11.5px] leading-snug text-muted-foreground line-clamp-2">
            {item.subtitle}
          </p>
        )}
      </div>
    </div>
  )
}

// ── RotatingThumb ────────────────────────────────────────────────────────
//
// Cross-fades through up to ROTATE_LIMIT reference images on a slow
// loop while the item is on-screen. Two stacked <img> layers swap
// their opacity each tick to keep the transition GPU-cheap. Pauses
// when off-screen (IntersectionObserver) or hovered.

const ROTATE_INTERVAL_MS = 3600
const ROTATE_LIMIT = 5

function RotatingThumb({
  item,
  paused,
}: {
  item: LibraryItem
  paused: boolean
}) {
  const meta = KIND_META[item.kind]

  // Build the rotation list — cover image first, then the rest, capped.
  // De-duplicated so a cover that also appears in references doesn't
  // get a double-tick. The router gave us a folder path and bare
  // filenames; the browser fetches each via the backlot-asset://
  // scheme without any tRPC round-trip.
  const urls = useMemo(() => {
    const seen = new Set<string>()
    const out: string[] = []
    const push = (filename: string | undefined) => {
      if (!filename || seen.has(filename)) return
      seen.add(filename)
      out.push(assetUrl(`${item.folderPath}/${filename}`))
    }
    push(item.coverImage)
    for (const p of item.referenceImages) {
      push(p)
      if (out.length >= ROTATE_LIMIT) break
    }
    return out
  }, [item.coverImage, item.referenceImages, item.folderPath])

  const [index, setIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [visible, setVisible] = useState(true)

  // Only run the rotation when the thumb is actually visible.
  useEffect(() => {
    const node = containerRef.current
    if (!node) return
    if (typeof IntersectionObserver === "undefined") return
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(!!entry?.isIntersecting),
      { rootMargin: "100px" },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (paused || !visible) return
    if (urls.length <= 1) return
    const id = window.setInterval(() => {
      setIndex((i) => (i + 1) % urls.length)
    }, ROTATE_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [paused, visible, urls.length])

  // Empty / unresolved → painterly placeholder so the masonry still
  // has visual rhythm even when the writer hasn't added images yet.
  if (urls.length === 0) {
    return (
      <div
        ref={containerRef}
        className="relative w-full overflow-hidden rounded-xl"
      >
        <PlaceholderTile meta={meta} title={item.title} />
      </div>
    )
  }

  // Single image — just render it, no rotation chrome.
  if (urls.length === 1) {
    return (
      <div
        ref={containerRef}
        className="relative w-full overflow-hidden rounded-xl bg-foreground/[0.03]"
      >
        <img
          src={urls[0]}
          alt=""
          draggable={false}
          loading="lazy"
          className="block w-full transition-transform duration-500 group-hover:scale-[1.015]"
        />
      </div>
    )
  }

  // Two stacked layers, opacity swap. The "below" layer holds the
  // previous image so the cross-fade has something to reveal under it.
  const top = urls[index] ?? urls[0]
  const beneath = urls[(index - 1 + urls.length) % urls.length] ?? urls[0]

  return (
    <div
      ref={containerRef}
      className="relative w-full overflow-hidden rounded-xl bg-foreground/[0.03]"
    >
      {/* Beneath — last-shown image. Static, gives the fade a substrate. */}
      <img
        src={beneath}
        alt=""
        draggable={false}
        loading="lazy"
        className="block w-full"
      />
      {/* Top — current image, fades in over the beneath. */}
      <img
        key={top}
        src={top}
        alt=""
        draggable={false}
        loading="lazy"
        className={cn(
          "absolute inset-0 block w-full opacity-0 transition-opacity duration-700",
          "[animation:bl-fade-in_700ms_forwards] group-hover:[animation:none] group-hover:opacity-100",
        )}
      />

      {/* Dot indicator — bottom-right when paused, hidden otherwise. */}
      <div
        className={cn(
          "pointer-events-none absolute bottom-2 right-2 flex items-center gap-1 rounded-full bg-background/75 px-1.5 py-1 ring-1 ring-border/55 backdrop-blur-md",
          "opacity-0 transition-opacity duration-200",
          "group-hover:opacity-100",
        )}
      >
        {urls.map((_, i) => (
          <span
            key={i}
            className={cn(
              "h-1 w-1 rounded-full transition-colors",
              i === index ? "bg-foreground" : "bg-foreground/30",
            )}
          />
        ))}
      </div>
    </div>
  )
}

function PlaceholderTile({ meta, title }: { meta: KindMeta; title: string }) {
  const initials = title
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("")
  return (
    <div
      className={cn(
        "relative grid aspect-[4/3] w-full place-items-center rounded-xl",
        meta.swatch,
      )}
    >
      <span className="font-mono text-[36px] font-semibold leading-none text-foreground/45">
        {initials || meta.short}
      </span>
    </div>
  )
}

// ── Detail dialog ────────────────────────────────────────────────────────

function LibraryDetail({
  item,
  entityRoot,
  onClose,
  onUpdate,
  onDelete,
  onAddReferences,
  onRemoveReference,
  onSetCover,
  onForkIntoProject,
  onSaveAsStudioPreset,
  onPromoteToSkill,
  addRefsPending,
  forkPending,
  extractPending,
  promotePending,
}: {
  item: LibraryItem
  entityRoot: EntityRoot
  onClose: () => void
  onUpdate: (patch: { title?: string; subtitle?: string; tags?: string[]; kind?: LibraryItemKind }) => void
  onDelete: () => void
  onAddReferences: (paths: string[]) => void
  onRemoveReference: (filename: string) => void
  onSetCover: (filename: string) => void
  onForkIntoProject?: () => void
  onSaveAsStudioPreset?: () => void
  onPromoteToSkill: () => void
  addRefsPending: boolean
  forkPending: boolean
  extractPending: boolean
  promotePending: boolean
}) {
  const meta = KIND_META[item.kind]
  const [editingTitle, setEditingTitle] = useState(false)
  const [copied, setCopied] = useState(false)
  const [refIndex, setRefIndex] = useState(0)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [heroHeight, setHeroHeight] = useAtom(libraryHeroHeightAtom)
  const heroRef = useRef<HTMLDivElement>(null)
  const [rawMode, setRawMode] = useState(false)

  // Clamps for the hero resize. Min is small but still readable; max
  // is a soft cap so the markdown body always has room to breathe.
  const HERO_MIN = 120
  const HERO_MAX = 640
  const usingAuto = heroHeight === 0

  /**
   * Resize handler — when in "auto" 16:9 mode (heroHeight === 0),
   * the first drag measures the currently rendered height off the
   * DOM, so deviation starts smoothly from whatever 16:9 produced.
   * After that we just add the delta to the stored pixel value.
   */
  const handleHeroResize = (delta: number) => {
    setHeroHeight((h) => {
      const base =
        h === 0
          ? heroRef.current?.offsetHeight ?? 240
          : h
      return Math.min(HERO_MAX, Math.max(HERO_MIN, base + delta))
    })
  }

  // Load the entry's markdown body from disk. With the JSON index
  // gone, `workflow.md` IS the entry — the only way to render the
  // prose is to read it.
  const markdownQuery = trpc.library.readMarkdown.useQuery(
    { ...entityRoot, source: item.source, itemId: item.id },
    { staleTime: 5_000 },
  )
  const markdownBody = useMemo(() => {
    const fromDisk = markdownQuery.data?.body
    if (fromDisk && fromDisk.trim()) return stripFrontmatter(fromDisk)
    return null
  }, [markdownQuery.data?.body])

  // Keep refIndex in range if images are removed while the panel is open.
  useEffect(() => {
    if (refIndex >= item.referenceImages.length) {
      setRefIndex(Math.max(0, item.referenceImages.length - 1))
    }
  }, [item.referenceImages.length, refIndex])

  const handleCopy = async () => {
    await copyItemPayload(item, markdownQuery.data?.body ?? null)
    setCopied(true)
    setTimeout(() => setCopied(false), 1400)
  }

  const handleDrop = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return
    e.preventDefault()
    const files = Array.from(e.dataTransfer.files)
    const paths = classifyDroppedImages(files)
    if (paths.length > 0) onAddReferences(paths)
  }

  // ── RAW VIEW ──────────────────────────────────────────────────
  // The whole panel transforms to show what the agent reads when it
  // opens this entry: the JSON index record and the `workflow.md`
  // body, verbatim. No hero, no editorial chrome — just the two
  // files concatenated under labels, exactly as they sit on disk.
  if (rawMode) {
    return (
      <div className="flex h-full flex-col overflow-hidden bg-background">
        <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-4 py-2.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-primary">
            Raw
          </span>
          <span className="truncate text-[12px] text-muted-foreground">
            What the agent reads
          </span>
          <HeaderIdChip id={item.id} />
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={handleCopy}
              title="Copy the full agent payload"
              className={cn(
                "press inline-flex h-7 items-center gap-1.5 rounded-lg bg-primary px-2.5",
                "text-[11px] font-semibold text-primary-foreground hover:bg-primary/90",
              )}
            >
              {copied ? (
                <>
                  <Check className="h-3 w-3" /> Copied
                </>
              ) : (
                <>
                  <Copy className="h-3 w-3" /> Copy
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => setRawMode(false)}
              title="Back to rendered view"
              className="press grid h-7 w-7 place-items-center rounded-lg text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
            >
              <Eye className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={onClose}
              title="Close panel"
              className="press grid h-7 w-7 place-items-center rounded-lg text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto bg-foreground/[0.02] px-4 py-4">
          <RawAgentView
            item={item}
            markdown={markdownQuery.data?.body ?? null}
          />
        </div>
      </div>
    )
  }

  return (
    <div
      className="flex h-full flex-col overflow-hidden bg-background"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) e.preventDefault()
      }}
      onDrop={handleDrop}
    >
      {/* ── HERO — defaults to a native 16:9 cinematic frame; the
          handle below switches to an explicit pixel height the
          moment the user drags. ───────────────────────────────── */}
      <div
        ref={heroRef}
        className="w-full shrink-0"
        style={
          usingAuto
            ? { aspectRatio: "16 / 9" }
            : { height: Math.min(HERO_MAX, Math.max(HERO_MIN, heroHeight)) }
        }
      >
        <HeroCarousel
          item={item}
          index={refIndex}
          setIndex={setRefIndex}
          onRemove={onRemoveReference}
          onSetCover={onSetCover}
          onAdd={onAddReferences}
          pending={addRefsPending}
          onClose={onClose}
          kindLabel={meta.label}
          KindIcon={meta.Icon}
          kindAccent={meta.accent}
        />
      </div>

      {/* Resize handle — drag down to grow the hero, drag up to shrink
          it. The Resizer paints a 1px hairline in the middle and lights
          up Coral on hover/drag so the affordance is discoverable.
          Persisted via libraryHeroHeightAtom across sessions. */}
      <Resizer axis="y" onResize={handleHeroResize} className="h-2" />

      {/* ── HEADER STRIP — title, id, copy ─────────────────────────── */}
      <div className="flex items-start gap-3 border-b border-border/60 px-4 pb-3 pt-3">
        <div className="min-w-0 flex-1">
          {editingTitle ? (
            <input
              autoFocus
              type="text"
              defaultValue={item.title}
              onBlur={(e) => {
                const v = e.currentTarget.value.trim()
                if (v && v !== item.title) onUpdate({ title: v })
                setEditingTitle(false)
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur()
                if (e.key === "Escape") setEditingTitle(false)
              }}
              className="w-full bg-transparent text-[15px] font-semibold leading-tight text-foreground focus:outline-none"
            />
          ) : (
            <button
              type="button"
              onDoubleClick={() => setEditingTitle(true)}
              title="Double-click to rename"
              className="block w-full truncate text-left text-[15px] font-semibold leading-tight text-foreground"
            >
              {item.title}
            </button>
          )}
          {item.subtitle && (
            <p className="mt-1 text-[12px] leading-snug text-muted-foreground line-clamp-2">
              {item.subtitle}
            </p>
          )}
          <div className="mt-1.5">
            <HeaderIdChip id={item.id} />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => setRawMode((v) => !v)}
            title={
              rawMode ? "Show rendered markdown" : "Show raw workflow.md content"
            }
            aria-pressed={rawMode}
            className={cn(
              "press grid h-8 w-8 place-items-center rounded-lg transition-colors",
              rawMode
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground",
            )}
          >
            {rawMode ? <Eye className="h-3.5 w-3.5" /> : <Braces className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            onClick={handleCopy}
            title="Copy the full workflow into the agent chat"
            className={cn(
              "press inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3",
              "text-[11.5px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90",
            )}
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5" />
                Copied
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                Copy for agent
              </>
            )}
          </button>
        </div>
      </div>

      {/* ── BODY — rendered markdown in the brand's editorial style.
          The raw view (toggled via the `{ }` button in the header)
          takes over the entire panel instead — see the early return
          above for that mode. ─────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-5 pb-4 pt-5">
        {markdownQuery.isPending ? (
          <div className="flex h-32 items-center justify-center text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : markdownBody ? (
          <MarkdownPreview content={markdownBody} className="library-md" />
        ) : (
          <FallbackProse item={item} />
        )}

        {item.tags.length > 0 && (
          <div className="mt-6 flex flex-wrap gap-1.5 border-t border-border/40 pt-4">
            {item.tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex rounded-md bg-foreground/[0.05] px-2 py-0.5 text-[11px] text-foreground/75"
              >
                #{tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ── ACTIONS — fork / extract / promote-to-skill ────────────── */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-t border-border/60 px-5 py-2.5">
        {onForkIntoProject && (
          <button
            type="button"
            onClick={onForkIntoProject}
            disabled={forkPending}
            title="Clone this studio preset into the project's library so you can tune it for this film."
            className="press inline-flex h-7 items-center gap-1.5 rounded-lg bg-foreground/[0.06] px-2.5 text-[11px] font-medium text-foreground hover:bg-foreground/[0.1] disabled:opacity-50"
          >
            {forkPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <ArrowDown className="h-3 w-3" />
            )}
            Fork into project
          </button>
        )}
        {onSaveAsStudioPreset && (
          <button
            type="button"
            onClick={onSaveAsStudioPreset}
            disabled={extractPending}
            title="Copy this project entry to the studio library so future projects can use it."
            className="press inline-flex h-7 items-center gap-1.5 rounded-lg bg-foreground/[0.06] px-2.5 text-[11px] font-medium text-foreground hover:bg-foreground/[0.1] disabled:opacity-50"
          >
            {extractPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <ArrowUp className="h-3 w-3" />
            )}
            Save as studio preset
          </button>
        )}
        <button
          type="button"
          onClick={onPromoteToSkill}
          disabled={promotePending}
          title="Copy this entry into ~/.backlot/skills/ so the agent treats it as a callable skill."
          className="press inline-flex h-7 items-center gap-1.5 rounded-lg bg-foreground/[0.06] px-2.5 text-[11px] font-medium text-foreground hover:bg-foreground/[0.1] disabled:opacity-50"
        >
          {promotePending ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Wrench className="h-3 w-3" />
          )}
          Save as skill
        </button>
      </div>

      {/* ── FOOTER — id + tier + path hint + delete ────────────────── */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border/60 px-5 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <FooterIdChip id={item.id} />
          <span
            className={cn(
              "font-mono text-[9.5px] uppercase tracking-[0.14em]",
              item.source === "studio"
                ? "text-primary/80"
                : "text-muted-foreground/55",
            )}
          >
            {item.source}
          </span>
          <span
            className="truncate font-mono text-[10px] text-muted-foreground/45"
            title={item.markdownPath}
          >
            {item.markdownPath}
          </span>
        </div>
        {confirmDelete ? (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="press rounded-lg px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="press inline-flex items-center gap-1.5 rounded-lg bg-destructive px-2.5 py-1 text-[11px] font-semibold text-destructive-foreground hover:bg-destructive/90"
            >
              <Trash2 className="h-3 w-3" />
              Delete entry
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="press inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="h-3 w-3" />
            Delete
          </button>
        )}
      </div>
    </div>
  )
}

/** Strip a leading YAML frontmatter block so MarkdownPreview's
 *  frontmatter renderer doesn't double up — we already show the
 *  title/tags in the panel header. */
function stripFrontmatter(content: string): string {
  const trimmed = content.replace(/^﻿/, "")
  const match = trimmed.match(/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/)
  if (!match) return trimmed
  return trimmed.slice(match[0].length).replace(/^\r?\n+/, "")
}

/**
 * Raw agent view — renders the two files the agent reads when it
 * picks up this library entry, exactly as they sit on disk:
 *
 *   1. The JSON record inside `library.backlot.json` (the index
 *      entry) — metadata, kind, paths.
 *   2. The `workflow.md` file body — frontmatter + prose sections.
 *
 * Each block is preceded by a file-path label and a thin divider so
 * the writer can see at a glance which file's contents they're
 * looking at. The MD body falls back to a JSON-derived markdown when
 * the file hasn't been created yet (legacy entries).
 */
function RawAgentView({
  item,
  markdown,
}: {
  item: LibraryItem
  markdown: string | null
}) {
  const jsonText = JSON.stringify(item, null, 2)
  const mdText =
    (markdown && markdown.trim()) ||
    buildMarkdownBody({
      id: item.id,
      kind: item.kind,
      title: item.title,
      ...(item.subtitle ? { subtitle: item.subtitle } : {}),
      tags: item.tags,
      ...(item.coverImage ? { cover: item.coverImage } : {}),
    })
  return (
    <div className="flex flex-col gap-5">
      <RawSection
        path={item.markdownPath}
        hint="The workflow body — frontmatter + sections. This is the file the agent edits."
        body={mdText}
      />
      <RawSection
        path={`${item.folderPath} (parsed)`}
        hint="What the gallery sees after scanning this entry's folder."
        body={jsonText}
      />
    </div>
  )
}

function RawSection({
  path,
  hint,
  body,
}: {
  path: string
  hint: string
  body: string
}) {
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    void navigator.clipboard.writeText(body)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }
  return (
    <section>
      <header className="mb-1.5 flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-mono text-[11px] text-foreground/80">
            {path}
          </p>
          <p className="text-[10.5px] text-muted-foreground/65">{hint}</p>
        </div>
        <button
          type="button"
          onClick={handleCopy}
          className="press shrink-0 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
        >
          {copied ? (
            <>
              <Check className="h-2.5 w-2.5" />
              Copied
            </>
          ) : (
            <>
              <Copy className="h-2.5 w-2.5" />
              Copy
            </>
          )}
        </button>
      </header>
      <pre
        className={cn(
          "whitespace-pre-wrap break-words rounded-lg border border-border/60",
          "bg-background px-3 py-2.5",
          "font-mono text-[12px] leading-relaxed text-foreground/85",
        )}
      >
        {body}
      </pre>
    </section>
  )
}

/** Shown when an entry's `workflow.md` has no readable body —
 *  rare, but the gallery still renders the card so we point the
 *  writer (or the agent) at the file to author it. */
function FallbackProse({ item }: { item: LibraryItem }) {
  return (
    <p className="text-sm text-muted-foreground/65">
      No body yet. Edit{" "}
      <code className="rounded bg-foreground/[0.06] px-1 py-0.5 font-mono text-[11px]">
        {item.markdownPath}
      </code>{" "}
      to add a description, agent instructions, and prompt templates.
    </p>
  )
}

/**
 * The id is the canonical reference the user (and the agent) uses to
 * point at a workflow in chat. Surfacing it in the header — and making
 * it one-click copyable — is what closes the loop between the masonry
 * gallery and the rest of the app.
 */
function HeaderIdChip({ id }: { id: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(id)
        setCopied(true)
        toast.success(`Copied id: ${id}`)
        window.setTimeout(() => setCopied(false), 1200)
      }}
      title="Reference this workflow by id — click to copy"
      className={cn(
        "press shrink-0 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5",
        "font-mono text-[11px] tracking-tight",
        "text-muted-foreground/75 hover:bg-foreground/[0.05] hover:text-foreground",
        copied && "text-primary bg-primary/[0.08]",
      )}
    >
      {copied ? (
        <Check className="h-2.5 w-2.5" />
      ) : (
        <Hash className="h-2.5 w-2.5" />
      )}
      {id}
    </button>
  )
}

function FooterIdChip({ id }: { id: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(id)
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1200)
      }}
      title="Copy id"
      className={cn(
        "press inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.14em]",
        "text-muted-foreground/55 hover:text-foreground",
      )}
    >
      {copied ? <Check className="h-2.5 w-2.5" /> : <Hash className="h-2.5 w-2.5" />}
      {id}
    </button>
  )
}

const inputBoxClass = cn(
  "w-full resize-none rounded-lg border border-border/70 bg-background px-3 py-2",
  "text-[13px] leading-relaxed text-foreground placeholder:text-muted-foreground/45",
  "focus:border-primary/55 focus:outline-none focus:ring-1 focus:ring-primary/30",
)

function DetailSection({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <section className="pb-4 pt-5">
      <h4 className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/65">
        {title}
      </h4>
      {children}
    </section>
  )
}

function PromptBlock({
  label,
  description,
  value,
  editing,
  onChange,
}: {
  label: string
  description: string
  value: string | undefined
  editing: boolean
  onChange: (next: string) => void
}) {
  const [copied, setCopied] = useState(false)
  if (!editing && !value) return null
  return (
    <section className="pb-4 pt-5">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <h4 className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/65">
            {label}
          </h4>
          {editing && (
            <p className="mt-0.5 text-[11px] text-muted-foreground/65">
              {description}
            </p>
          )}
        </div>
        {value && !editing && (
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(value)
              setCopied(true)
              setTimeout(() => setCopied(false), 1200)
            }}
            className="press inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
          >
            {copied ? (
              <>
                <Check className="h-3 w-3" />
                Copied
              </>
            ) : (
              <>
                <Copy className="h-3 w-3" />
                Copy
              </>
            )}
          </button>
        )}
      </div>
      {editing ? (
        <textarea
          defaultValue={value ?? ""}
          onBlur={(e) => onChange(e.currentTarget.value)}
          rows={6}
          placeholder={description}
          className={inputBoxClass}
        />
      ) : (
        <pre
          className={cn(
            "max-h-[260px] overflow-y-auto rounded-lg border border-border/60",
            "bg-foreground/[0.03] px-3 py-2",
            "whitespace-pre-wrap font-mono text-[12px] leading-relaxed text-foreground/85",
          )}
        >
          {value}
        </pre>
      )}
    </section>
  )
}

function TagsEditor({
  tags,
  editing,
  onChange,
}: {
  tags: string[]
  editing: boolean
  onChange: (next: string[]) => void
}) {
  const [draft, setDraft] = useState("")
  if (!editing) {
    if (tags.length === 0) {
      return (
        <p className="text-[12px] text-muted-foreground/55">No tags.</p>
      )
    }
    return (
      <div className="flex flex-wrap gap-1.5">
        {tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex rounded-md bg-foreground/[0.06] px-2 py-0.5 text-[11px] text-foreground/80"
          >
            {tag}
          </span>
        ))}
      </div>
    )
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 rounded-md bg-foreground/[0.06] px-2 py-0.5 text-[11px] text-foreground/80"
        >
          {tag}
          <button
            type="button"
            onClick={() => onChange(tags.filter((t) => t !== tag))}
            className="press text-muted-foreground/70 hover:text-destructive"
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </span>
      ))}
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault()
            const v = draft.trim().replace(/,$/, "")
            if (v && !tags.includes(v)) {
              onChange([...tags, v])
            }
            setDraft("")
          } else if (e.key === "Backspace" && draft === "" && tags.length > 0) {
            onChange(tags.slice(0, -1))
          }
        }}
        placeholder="Add tag…"
        className={cn(
          "min-w-[80px] flex-1 rounded-md bg-transparent px-1 py-0.5",
          "text-[11px] text-foreground placeholder:text-muted-foreground/45",
          "focus:outline-none",
        )}
      />
    </div>
  )
}

/**
 * HeroCarousel — the modal's headlining image strip.
 *
 * The image is rendered TWICE: once heavily blurred to fill the entire
 * letterbox area (the "backdrop"), and once with `object-contain` on
 * top so the source is always visible in full. The effect is the
 * Apple Music / Spotify treatment: the image "leaks" into the panel's
 * frame, no negative white space, but the source is never cropped.
 *
 * Floating chrome on top — kind chip, close button, navigation
 * chevrons, set-cover / remove, dot indicator, thumb strip — all
 * uses the studio's liquid-glass surface (`bl-liquid-glass`) so they
 * read as the same physical material as the mode dock and the
 * carousel thumbs.
 */
/**
 * Cinematic dark-glass — a single reusable surface for every hero
 * chrome control. Reads white-on-dark over any backdrop (light or
 * dark image) without the chalky-pill effect translucent-white had.
 *
 * - `bg-black/45` is enough opacity to carry contrast for the icon
 *   without erasing the image behind it.
 * - `backdrop-blur-md` is GPU-cheap (≈12px) compared to the larger
 *   blurs the studio uses for full panels — appropriate here because
 *   these chips are small and don't need to obscure rich content.
 * - 1px white inner ring + 1px black outer "halo" gives the surface
 *   an edge that survives both pure-white and pure-black backdrops.
 */
const DARK_GLASS = cn(
  "bg-black/45 text-white/90 backdrop-blur-md",
  "ring-1 ring-inset ring-white/15",
  "shadow-[0_1px_2px_rgba(0,0,0,0.45),0_4px_14px_-6px_rgba(0,0,0,0.55)]",
)

function HeroCarousel({
  item,
  index,
  setIndex,
  onRemove,
  onSetCover,
  onAdd,
  pending,
  onClose,
  kindLabel,
  KindIcon,
  kindAccent: _kindAccent, // accent colour comes from the brand
}: {
  item: LibraryItem
  index: number
  setIndex: (n: number) => void
  onRemove: (filename: string) => void
  onSetCover: (filename: string) => void
  onAdd: (paths: string[]) => void
  pending: boolean
  onClose: () => void
  kindLabel: string
  KindIcon: typeof Wand2
  kindAccent: string
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [hoverThumb, setHoverThumb] = useState<string | null>(null)
  const refs = item.referenceImages
  const active = refs[index] ?? null
  const isCover = active != null && item.coverImage === active
  const url = active ? assetUrl(`${item.folderPath}/${active}`) : null

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return
    const paths = classifyDroppedImages(Array.from(files))
    if (paths.length > 0) onAdd(paths)
  }

  const next = () => setIndex((index + 1) % Math.max(1, refs.length))
  const prev = () =>
    setIndex((index - 1 + Math.max(1, refs.length)) % Math.max(1, refs.length))

  return (
    <div className="group relative h-full w-full overflow-hidden bg-[hsl(0_0%_8%)]">
      {/* Blurred backdrop — same image source as the foreground.
          Lower blur radius (`blur-2xl` ≈ 40px) than before so the
          backdrop renders cheaper on weak GPUs while still smoothing
          edge colours. `transform-gpu` hints the compositor to keep
          the layer cached. */}
      {url ? (
        <img
          src={url}
          alt=""
          aria-hidden
          loading="eager"
          decoding="async"
          className="absolute inset-0 h-full w-full scale-105 transform-gpu object-cover opacity-60 blur-2xl"
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-black/40" />
      )}

      {/* Soft vignette — boosts contrast on the chip rail at top and
          the thumb dock at bottom without darkening the image's
          middle band. */}
      <span
        aria-hidden
        className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.35)_0%,transparent_22%,transparent_72%,rgba(0,0,0,0.45)_100%)]"
      />

      {/* The actual image — `object-contain`, centred, never cropped. */}
      {url ? (
        <img
          src={url}
          alt={active ?? item.title}
          draggable={false}
          loading="eager"
          decoding="async"
          className="relative z-[1] mx-auto h-full max-h-full transform-gpu object-contain drop-shadow-[0_18px_40px_rgba(0,0,0,0.55)]"
        />
      ) : (
        <div className="relative z-[1] grid h-full w-full place-items-center text-white/40">
          <ImageOff className="h-10 w-10" />
        </div>
      )}

      {/* ── TOP-LEFT — kind chip only ─────────────────────────────────
          The Cover state is conveyed by a small dot on the active
          thumb in the bottom dock — no need for a redundant chip
          taking up the top-left corner. */}
      <div className="pointer-events-none absolute left-3 top-3 z-[2]">
        <span
          className={cn(
            DARK_GLASS,
            "inline-flex h-6 items-center gap-1 rounded-full px-2",
            "text-[9.5px] font-semibold uppercase tracking-[0.1em]",
          )}
        >
          <KindIcon className="h-3 w-3" />
          {kindLabel}
        </span>
      </div>

      {/* ── TOP-RIGHT — close only ──────────────────────────────────── */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className={cn(
          "press absolute right-3 top-3 z-[2] grid h-7 w-7 place-items-center rounded-full",
          DARK_GLASS,
          "hover:text-white",
        )}
      >
        <X className="h-3.5 w-3.5" />
      </button>

      {/* ── CHEVRONS — hover-only, mid-axis ─────────────────────────── */}
      {refs.length > 1 && (
        <>
          <button
            type="button"
            onClick={prev}
            aria-label="Previous reference"
            className={cn(
              "press absolute left-3 top-1/2 z-[2] grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full",
              DARK_GLASS,
              "opacity-0 transition-opacity duration-150",
              "group-hover:opacity-100 focus-visible:opacity-100",
            )}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={next}
            aria-label="Next reference"
            className={cn(
              "press absolute right-3 top-1/2 z-[2] grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full",
              DARK_GLASS,
              "opacity-0 transition-opacity duration-150",
              "group-hover:opacity-100 focus-visible:opacity-100",
            )}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </>
      )}

      {/* ── BOTTOM DOCK ─────────────────────────────────────────────────
          Single pill with counter · thumbs · add. Set-cover / remove
          live as hover actions on each thumb so the dock stays
          compact even with many refs. */}
      <div className="absolute inset-x-0 bottom-3 z-[2] flex justify-center px-3">
        <div
          className={cn(
            DARK_GLASS,
            "flex max-w-full items-center gap-1.5 rounded-xl px-2 py-1",
          )}
        >
          {refs.length > 0 && (
            <>
              <span className="px-0.5 font-mono text-[10px] tabular-nums text-white/65">
                {index + 1}/{refs.length}
              </span>
              <div className="flex max-w-[380px] items-center gap-1 overflow-x-auto">
                {refs.map((filename, i) => (
                  <HeroThumb
                    key={filename}
                    folderPath={item.folderPath}
                    filename={filename}
                    active={i === index}
                    isCover={filename === item.coverImage}
                    isHovered={hoverThumb === filename}
                    onClick={() => setIndex(i)}
                    onHover={(h) => setHoverThumb(h ? filename : null)}
                    onRemove={() => onRemove(filename)}
                  />
                ))}
              </div>
              {active && !isCover && (
                <button
                  type="button"
                  onClick={() => onSetCover(active)}
                  title="Use this image as the gallery cover"
                  className={cn(
                    "press inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-2",
                    "bg-white/10 text-[9.5px] font-semibold uppercase tracking-[0.08em] text-white/85",
                    "hover:bg-white/20 hover:text-white transition-colors",
                  )}
                >
                  Set cover
                </button>
              )}
            </>
          )}
          {refs.length === 0 && (
            <span className="px-1.5 text-[11px] text-white/70">
              Drop an image here, or click +
            </span>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              handleFiles(e.target.files)
              e.target.value = ""
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={pending}
            title="Add reference images"
            className={cn(
              "press grid h-6 w-6 shrink-0 place-items-center rounded-md",
              "bg-white/10 text-white/85 hover:bg-white/20 hover:text-white",
              "disabled:opacity-50",
            )}
          >
            {pending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Plus className="h-3 w-3" />
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Thumb tile in the hero's bottom dock. On hover the tile reveals
 * a small inline trash icon to remove that specific reference —
 * keeps the destructive action close to its target without parking
 * a permanent button in the chrome.
 */
function HeroThumb({
  folderPath,
  filename,
  active,
  isCover,
  isHovered,
  onClick,
  onHover,
  onRemove,
}: {
  folderPath: string
  filename: string
  active: boolean
  isCover: boolean
  isHovered: boolean
  onClick: () => void
  onHover: (hovered: boolean) => void
  onRemove: () => void
}) {
  const url = assetUrl(`${folderPath}/${filename}`)
  return (
    <div
      className="relative shrink-0"
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
    >
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "press h-7 w-7 overflow-hidden rounded-md ring-1 transition-all duration-150",
          active
            ? "ring-2 ring-primary"
            : "ring-white/15 opacity-60 hover:opacity-100",
        )}
      >
        <img
          src={url}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover"
        />
      </button>

      {/* Cover badge — a small primary dot when this thumb is the
          gallery cover. */}
      {isCover && (
        <span
          aria-hidden
          className="pointer-events-none absolute -left-0.5 -top-0.5 grid h-2.5 w-2.5 place-items-center rounded-full bg-primary ring-2 ring-black/70"
          title="Gallery cover"
        />
      )}

      {/* Hover trash — sits on top-right of the thumb. */}
      {isHovered && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          aria-label="Remove this reference"
          title="Remove this reference"
          className={cn(
            "press absolute -right-1 -top-1 grid h-3.5 w-3.5 place-items-center rounded-full",
            "bg-black/75 text-white/85 ring-1 ring-white/20",
            "hover:bg-destructive hover:text-destructive-foreground",
          )}
        >
          <X className="h-2 w-2" />
        </button>
      )}
    </div>
  )
}

// ── Create form ──────────────────────────────────────────────────────────

interface CreateDraft {
  source: LibrarySource
  kind: LibraryItemKind
  title: string
  subtitle?: string
  description?: string
  tags: string[]
  agentInstructions?: string
  characterSheetPrompt?: string
  seedancePrompt?: string
  notes?: string
  sourceImages: string[]
}

function LibraryCreateForm({
  initialKind,
  initialSource,
  submitting,
  onClose,
  onSubmit,
}: {
  initialKind: LibraryItemKind
  initialSource: LibrarySource
  submitting: boolean
  onClose: () => void
  onSubmit: (draft: CreateDraft) => Promise<void> | void
}) {
  const [source, setSource] = useState<LibrarySource>(initialSource)
  const [kind, setKind] = useState<LibraryItemKind>(initialKind)
  const [title, setTitle] = useState("")
  const [subtitle, setSubtitle] = useState("")
  const [description, setDescription] = useState("")
  const [tagInput, setTagInput] = useState("")
  const [tags, setTags] = useState<string[]>([])
  const [agentInstructions, setAgentInstructions] = useState("")
  const [characterSheetPrompt, setCharacterSheetPrompt] = useState("")
  const [seedancePrompt, setSeedancePrompt] = useState("")
  const [notes, setNotes] = useState("")
  const [images, setImages] = useState<File[]>([])
  const [previews, setPreviews] = useState<string[]>([])

  // Build/cleanup preview object URLs as images change.
  useEffect(() => {
    const urls = images.map((f) => URL.createObjectURL(f))
    setPreviews(urls)
    return () => urls.forEach((u) => URL.revokeObjectURL(u))
  }, [images])

  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return
    const added = Array.from(files).filter((f) => f.type.startsWith("image/"))
    if (added.length > 0) setImages((prev) => [...prev, ...added])
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!title.trim()) {
      toast.error("Give the entry a title")
      return
    }
    const sourcePaths: string[] = []
    for (const f of images) {
      const p = pathForDroppedFile(f)
      if (p) sourcePaths.push(p)
    }
    await onSubmit({
      source,
      kind,
      title: title.trim(),
      subtitle: subtitle.trim() || undefined,
      description: description.trim() || undefined,
      tags,
      agentInstructions: agentInstructions.trim() || undefined,
      characterSheetPrompt: characterSheetPrompt.trim() || undefined,
      seedancePrompt: seedancePrompt.trim() || undefined,
      notes: notes.trim() || undefined,
      sourceImages: sourcePaths,
    })
  }

  return (
    <form
      onSubmit={submit}
      className="flex max-h-[calc(100vh-4rem)] flex-col"
    >
      <div className="flex items-center gap-3 border-b border-border/70 px-6 py-4">
        <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-primary/10 px-2.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-primary">
          <Plus className="h-3.5 w-3.5" />
          New entry
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={onClose}
            className="press rounded-lg px-3 py-1.5 text-[12px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || !title.trim()}
            className={cn(
              "press inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5",
              "text-[12px] font-semibold text-primary-foreground",
              "hover:bg-primary/90 disabled:opacity-50",
            )}
          >
            {submitting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="h-3.5 w-3.5" />
            )}
            Save to library
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {/* Destination — which tier the new entry lands in. Defaults
            to project (scoped to this film). Picking studio saves the
            entry as a global preset other projects can pull from. */}
        <div className="mb-5">
          <label className="mb-2 block font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/65">
            Save to
          </label>
          <div className="grid grid-cols-2 gap-2">
            {(["project", "studio"] as LibrarySource[]).map((s) => {
              const active = source === s
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSource(s)}
                  className={cn(
                    "press flex flex-col items-start gap-0.5 rounded-xl border p-3 text-left transition-colors",
                    active
                      ? "border-primary/60 bg-primary/[0.06]"
                      : "border-border/60 hover:border-border bg-background hover:bg-foreground/[0.03]",
                  )}
                >
                  <span
                    className={cn(
                      "text-[11px] font-mono uppercase tracking-[0.14em]",
                      active ? "text-primary" : "text-muted-foreground",
                    )}
                  >
                    {s}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {s === "studio"
                      ? "Universal preset — visible in every project."
                      : "This film only — keeps the studio library tidy."}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Kind picker */}
        <div className="mb-5">
          <label className="mb-2 block font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/65">
            Kind
          </label>
          <div className="grid grid-cols-3 gap-2">
            {KIND_ORDER.map((k) => {
              const meta = KIND_META[k]
              const active = kind === k
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={cn(
                    "press flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-colors",
                    active
                      ? "border-primary/60 bg-primary/[0.06]"
                      : "border-border/60 hover:border-border bg-background hover:bg-foreground/[0.03]",
                  )}
                >
                  <meta.Icon
                    className={cn(
                      "h-4 w-4",
                      active ? "text-primary" : "text-muted-foreground",
                    )}
                  />
                  <span className="text-[12px] font-medium text-foreground">
                    {meta.label}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Title / subtitle */}
        <div className="mb-4 grid gap-3">
          <div>
            <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/65">
              Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Hero turnaround sheet"
              className={inputBoxClass}
            />
          </div>
          <div>
            <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/65">
              Subtitle <span className="font-sans normal-case tracking-normal text-muted-foreground/45">(optional)</span>
            </label>
            <input
              type="text"
              value={subtitle}
              onChange={(e) => setSubtitle(e.target.value)}
              placeholder="Four-pose character reference at 2K, then Seedance 2 spin"
              className={inputBoxClass}
            />
          </div>
          <div>
            <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/65">
              Description <span className="font-sans normal-case tracking-normal text-muted-foreground/45">(optional)</span>
            </label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this workflow is for, in two or three sentences."
              className={inputBoxClass}
            />
          </div>
        </div>

        {/* Tags */}
        <div className="mb-4">
          <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/65">
            Tags <span className="font-sans normal-case tracking-normal text-muted-foreground/45">(comma or enter)</span>
          </label>
          <div className={cn(inputBoxClass, "flex flex-wrap items-center gap-1.5 py-2")}>
            {tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 rounded-md bg-foreground/[0.06] px-2 py-0.5 text-[11px] text-foreground/80"
              >
                {tag}
                <button
                  type="button"
                  onClick={() => setTags(tags.filter((t) => t !== tag))}
                  className="press text-muted-foreground/70 hover:text-destructive"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            ))}
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault()
                  const v = tagInput.trim().replace(/,$/, "")
                  if (v && !tags.includes(v)) setTags([...tags, v])
                  setTagInput("")
                } else if (
                  e.key === "Backspace" &&
                  tagInput === "" &&
                  tags.length > 0
                ) {
                  setTags(tags.slice(0, -1))
                }
              }}
              placeholder="character, turnaround, banana-pro…"
              className="min-w-[120px] flex-1 bg-transparent text-[12px] placeholder:text-muted-foreground/40 focus:outline-none"
            />
          </div>
        </div>

        {/* Cover / reference images */}
        <div className="mb-4">
          <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/65">
            Reference images <span className="font-sans normal-case tracking-normal text-muted-foreground/45">(first becomes the cover)</span>
          </label>
          <div
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes("Files")) e.preventDefault()
            }}
            onDrop={(e) => {
              if (!e.dataTransfer.types.includes("Files")) return
              e.preventDefault()
              handleFiles(e.dataTransfer.files)
            }}
            className={cn(
              "flex min-h-[100px] flex-wrap items-center gap-2 rounded-xl border border-dashed border-border/70",
              "bg-foreground/[0.02] p-2",
            )}
          >
            {previews.map((url, i) => (
              <div
                key={i}
                className={cn(
                  "group relative h-20 w-20 overflow-hidden rounded-lg ring-1",
                  i === 0 ? "ring-primary" : "ring-border/70",
                )}
              >
                <img
                  src={url}
                  alt=""
                  className="h-full w-full object-cover"
                />
                {i === 0 && (
                  <span className="absolute bottom-0 left-0 right-0 bg-primary/85 py-0.5 text-center text-[9px] font-semibold uppercase tracking-[0.12em] text-primary-foreground">
                    Cover
                  </span>
                )}
                <button
                  type="button"
                  onClick={() =>
                    setImages((prev) => prev.filter((_, idx) => idx !== i))
                  }
                  className="press absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-background/85 text-foreground/70 opacity-0 ring-1 ring-border/60 transition-opacity group-hover:opacity-100 hover:bg-destructive hover:text-destructive-foreground"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="press grid h-20 w-20 place-items-center rounded-lg border border-dashed border-border/70 text-muted-foreground hover:border-primary/60 hover:bg-primary/[0.04] hover:text-primary"
            >
              <Plus className="h-5 w-5" />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                handleFiles(e.target.files)
                e.target.value = ""
              }}
            />
            {images.length === 0 && (
              <p className="ml-1 text-[12px] text-muted-foreground/55">
                Drop images here, or click + to pick.
              </p>
            )}
          </div>
        </div>

        {/* Prompt fields */}
        <PromptFieldEditor
          label="Agent instructions"
          description="What the agent should do when this entry is loaded."
          value={agentInstructions}
          onChange={setAgentInstructions}
          placeholder="1. Read the project brief.\n2. Generate a 4-pose character sheet of [CHARACTER] with Nano Banana Pro.\n3. Pass the sheet into Seedance 2 with the prompt below."
        />
        <PromptFieldEditor
          label="Character-sheet prompt"
          description="Templatized character-sheet prompt. Use `[BLANKS]` for the parts the agent should fill."
          value={characterSheetPrompt}
          onChange={setCharacterSheetPrompt}
          placeholder="A 4-pose character sheet of [CHARACTER]: 3/4 front, full front, profile, full back. Locked outfit: [OUTFIT]. Neutral expression, even key light, 2K, clean white background."
        />
        <PromptFieldEditor
          label="Seedance 2 animation prompt"
          description="Seedance 2 prompt to animate the sheet (or progress the workflow)."
          value={seedancePrompt}
          onChange={setSeedancePrompt}
          placeholder="Slow 360 turnaround of [CHARACTER] from the character sheet. Locked-off camera, 50mm, soft key light, clean white cyc. 6 seconds."
        />
        <PromptFieldEditor
          label="Notes"
          description="Credits, sources, gotchas."
          value={notes}
          onChange={setNotes}
          placeholder="Works best when the source sheet is 2K. Lower res confuses the spin."
        />
      </div>
    </form>
  )
}

function PromptFieldEditor({
  label,
  description,
  value,
  onChange,
  placeholder,
}: {
  label: string
  description: string
  value: string
  onChange: (next: string) => void
  placeholder: string
}) {
  return (
    <div className="mb-4">
      <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/65">
        {label}
      </label>
      <textarea
        rows={4}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(inputBoxClass, "font-mono text-[12px]")}
      />
      <p className="mt-1 text-[11px] text-muted-foreground/55">{description}</p>
    </div>
  )
}

// ── Filter switch + empty / first-run states ─────────────────────────────

function KindSwitch({
  value,
  onChange,
  counts,
}: {
  value: KindFilter
  onChange: (next: KindFilter) => void
  counts: Record<KindFilter, number>
}) {
  const options: { id: KindFilter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "workflow", label: KIND_META.workflow.label },
    { id: "character-sheet", label: KIND_META["character-sheet"].label },
    { id: "prompt", label: KIND_META.prompt.label },
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
              : "text-muted-foreground/65 hover:text-foreground",
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

function SourceSwitch({
  value,
  onChange,
  counts,
}: {
  value: SourceFilter
  onChange: (next: SourceFilter) => void
  counts: Record<SourceFilter, number>
}) {
  const options: { id: SourceFilter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "studio", label: "Studio" },
    { id: "project", label: "Project" },
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
              : "text-muted-foreground/65 hover:text-foreground",
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

function LibraryEmpty({
  title,
  message,
}: {
  title: string
  message: string
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-10 pb-20 text-center">
      <LibraryBig className="mb-3 h-7 w-7 text-muted-foreground/30" />
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted-foreground">
        {message}
      </p>
    </div>
  )
}

function FirstRunEmpty({
  onCreate,
}: {
  onCreate: (kind: LibraryItemKind) => void
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-10 pb-20 text-center">
      <div
        className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-primary/[0.08] ring-1 ring-primary/25"
        style={
          {
            background:
              "radial-gradient(circle at 30% 25%, hsl(var(--primary) / 0.25), transparent 60%), hsl(var(--primary) / 0.06)",
          } as CSSProperties
        }
      >
        <LibraryBig className="h-7 w-7 text-primary" />
      </div>
      <h2 className="text-[18px] font-semibold text-foreground">
        Your project library
      </h2>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
        Park the workflows and character-sheet recipes you use over and
        over. Each entry carries the agent instructions, prompt
        templates and example images — one click to copy the whole
        package into chat. You or the agent can save here; the file is
        git-tracked.
      </p>
      <div className="mt-5 flex items-center gap-2">
        {KIND_ORDER.map((kind) => {
          const meta = KIND_META[kind]
          return (
            <button
              key={kind}
              type="button"
              onClick={() => onCreate(kind)}
              className={cn(
                "press inline-flex items-center gap-1.5 rounded-lg px-3 py-2",
                "bg-foreground/[0.05] ring-1 ring-border/60 hover:ring-primary/45",
                "text-[12px] font-medium text-foreground transition-all",
              )}
            >
              <meta.Icon className={cn("h-3.5 w-3.5", meta.accent)} />
              Add {meta.label.toLowerCase()}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── Clipboard ────────────────────────────────────────────────────────────

async function copyItemPayload(
  item: LibraryItem,
  markdownBody?: string | null,
) {
  const payload = buildLibraryClipboard(item, markdownBody ?? undefined)
  try {
    await navigator.clipboard.writeText(payload)
    toast.success("Workflow copied — paste it into chat")
  } catch (err) {
    console.warn("[library] clipboard write failed:", err)
    toast.error("Couldn't copy to clipboard")
  }
}
