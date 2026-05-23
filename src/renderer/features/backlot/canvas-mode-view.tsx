"use client"

import {
  AlignLeft,
  Bold,
  Combine,
  Crop as CropIcon,
  Highlighter,
  ImageIcon,
  Italic,
  LayoutGrid,
  Minus,
  Pilcrow,
  Plus,
  Sparkles,
  Trash2,
  X,
} from "lucide-react"
import type { CSSProperties, DragEvent, PointerEvent, ReactNode } from "react"
import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { GlassFilter } from "../../components/ui/liquid-glass-filter"
import { trpc } from "../../lib/trpc"
import { cn } from "../../lib/utils"
import { InCanvasCropOverlay, type CropRect } from "./canvas-crop-overlay"
import {
  autoStitchContainerWidth,
  composeStitch,
  justifiedLayout,
  type StitchMode,
} from "./canvas-stitch"
import { CANVAS_DROP_MIME, isImagePath } from "./entity-kind"

// Image nodes carry a plain label row above the image card: h-5 (20px)
// plus the gap-1.5 (6px) between label and card.
const NODE_HEADER_HEIGHT = 26

// Builds a `backlot-asset://` URL for a worktree-relative media path so
// the renderer can preview it without a `file://` web-security violation.
function assetUrl(worktreePath: string, projectRelativePath: string): string {
  return `backlot-asset://asset/?p=${encodeURIComponent(
    `${worktreePath}/${projectRelativePath}`,
  )}`
}

// Load an image element from a URL with CORS — used by Apply to read
// the source pixels back into a `<canvas>` for the crop.
function loadImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = "anonymous"
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Could not load image: ${url}`))
    img.src = url
  })
}

interface CanvasModeViewProps {
  worktreeId: string | null
}

// `prompt` is a legacy node type — new prompts land as `textBlock`.
// Kept in the union so existing rows in the DB still type-check on read.
type CanvasNodeKind =
  | "prompt"
  | "image"
  | "imageGeneration"
  | "textBlock"
  | "description"
  | "group"

interface CanvasNodeView {
  id: string
  type: CanvasNodeKind
  x: number
  y: number
  width: number
  height: number
  data: string
  locked: boolean
  dataJson: Record<string, unknown>
}

interface CanvasSnapshot {
  nodes: Array<{
    id: string
    type: CanvasNodeKind
    x: number
    y: number
    width: number
    height: number
    data: Record<string, unknown>
    locked: boolean
  }>
  edges: Array<{
    id: string
    sourceNodeId: string
    sourceHandle: string
    targetNodeId: string
    targetHandle: string
  }>
}

const MAX_UNDO_DEPTH = 50

interface CanvasEdgeView {
  id: string
  sourceNodeId: string
  sourceHandle: string
  targetNodeId: string
  targetHandle: string
}

interface Viewport {
  x: number
  y: number
  zoom: number
}

interface PendingConnection {
  nodeId: string
  handle: "text" | "image"
  point: { x: number; y: number }
}

// A box-select rectangle, in world coordinates, while the writer drags it.
interface SelectionBox {
  x1: number
  y1: number
  x2: number
  y2: number
}

const MIN_ZOOM = 0.25
// Wide ceiling — crop work and image inspection lean on real zoom-in.
// At 6x a 1024×1024 image fills a 6000px wall, plenty to nudge a crop
// rect to the pixel.
const MAX_ZOOM = 6

const DEFAULT_CANVAS_PAGE = "main"

// localStorage key for the writer's last active page on a given worktree —
// so reopening the canvas lands on the page they were just working in.
const activePageStorageKey = (worktreeId: string | null) =>
  worktreeId ? `backlot:canvas-page:${worktreeId}` : null

// The Lime brand accent, resolved at runtime from the theme token so the
// SVG edge stroke tracks light/dark with the rest of the canvas.
const EDGE_COLOR = "hsl(var(--primary))"

// Liquid-glass refraction — the same SVG displacement filter the mode dock
// uses, layered over a frosted blur so toolbars bend the canvas behind them.
const liquidGlassStyle: CSSProperties = {
  backdropFilter: "url(#bl-glass-displace) blur(8px) saturate(160%)",
  WebkitBackdropFilter: "url(#bl-glass-displace) blur(8px) saturate(160%)",
}

export function CanvasModeView({ worktreeId }: CanvasModeViewProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1 })
  const [pendingConnection, setPendingConnection] =
    useState<PendingConnection | null>(null)
  const [pointerWorld, setPointerWorld] = useState<{ x: number; y: number } | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null)
  const [stitchOpen, setStitchOpen] = useState(false)
  const [stitchMode, setStitchMode] = useState<StitchMode>("auto")
  const [stitchRowHeight, setStitchRowHeight] = useState(360)
  const [stitchSpacing, setStitchSpacing] = useState(16)
  const [stitchBackground, setStitchBackground] = useState("transparent")
  const [stitching, setStitching] = useState(false)
  const [stitchError, setStitchError] = useState<string | null>(null)
  // Live auto-stitch preview: while the stitch panel is open in auto mode,
  // we rearrange the selected image nodes on the canvas using the same
  // justified-layout the composite will use. The override map carries the
  // preview positions/sizes; the snapshot remembers where each node was
  // before the preview so we can snap back on Cancel / mode-switch /
  // Apply (Apply restores originals AND adds the composite below).
  const [stitchPreviewOverrides, setStitchPreviewOverrides] = useState<Map<
    string,
    { x: number; y: number; width: number; height: number }
  > | null>(null)
  const stitchPreviewBoundsRef = useRef<{
    minX: number
    minY: number
    maxY: number
  } | null>(null)
  const [isDropTarget, setIsDropTarget] = useState(false)
  // In-place crop on the canvas: when a node id is set, that image
  // node renders the crop overlay and the canvas swaps the selection
  // toolbar for a Cancel/Apply pill. `cropRect` is the chosen region
  // in display-pixels relative to the image's rendered rect inside
  // its card. `null` triggers the overlay to initialize to "full
  // image" once it knows the natural aspect.
  const [croppingNodeId, setCroppingNodeId] = useState<string | null>(null)
  const [cropRect, setCropRect] = useState<CropRect | null>(null)
  const [cropping, setCropping] = useState(false)
  const [cropError, setCropError] = useState<string | null>(null)
  // "keep" trims to the selection (classic crop); "cutout" punches the
  // selection out and leaves the rest at original dimensions so the user
  // can drop a replacement image over the hole and stitch the two.
  const [cropMode, setCropMode] = useState<"keep" | "cutout">("keep")
  // Inline-rename state for the page selector pill — keyed by the
  // current page name so submitting commits the rename in one trip.
  const [renamingPage, setRenamingPage] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState("")

  // Active canvas page — one worktree can hold many pages (each a separate
  // canvas graph). The renderer remembers the last page per worktree in
  // localStorage so reopening the canvas lands where the writer left off.
  // Defaults to "main", which is also what the backend lazy-creates the
  // first time a worktree's canvas is touched.
  const [activePage, setActivePage] = useState<string>(() => {
    const key = activePageStorageKey(worktreeId)
    if (!key || typeof window === "undefined") return DEFAULT_CANVAS_PAGE
    return window.localStorage.getItem(key) ?? DEFAULT_CANVAS_PAGE
  })

  useEffect(() => {
    const key = activePageStorageKey(worktreeId)
    if (!key || typeof window === "undefined") return
    const stored = window.localStorage.getItem(key)
    setActivePage(stored ?? DEFAULT_CANVAS_PAGE)
  }, [worktreeId])

  useEffect(() => {
    const key = activePageStorageKey(worktreeId)
    if (!key || typeof window === "undefined") return
    window.localStorage.setItem(key, activePage)
  }, [worktreeId, activePage])

  const canvas = trpc.canvas.read.useQuery(
    { worktreeId: worktreeId ?? "", page: activePage },
    {
      enabled: Boolean(worktreeId),
      refetchOnWindowFocus: false,
    },
  )
  const pagesQuery = trpc.canvas.listPages.useQuery(
    { worktreeId: worktreeId ?? "" },
    {
      enabled: Boolean(worktreeId),
      refetchOnWindowFocus: false,
    },
  )
  const utils = trpc.useUtils()

  const refresh = () => {
    if (!worktreeId) return
    void utils.canvas.read.invalidate({ worktreeId, page: activePage })
  }
  const refreshPages = () => {
    if (!worktreeId) return
    void utils.canvas.listPages.invalidate({ worktreeId })
  }

  // If localStorage points at a page that no longer exists (renamed in
  // a different window, deleted on the backend), fall back to "main" or
  // the first available page so the writer doesn't strand on an empty
  // ghost page.
  useEffect(() => {
    if (!worktreeId || !pagesQuery.data || pagesQuery.data.length === 0) return
    if (pagesQuery.data.some((page) => page.name === activePage)) return
    const fallback =
      pagesQuery.data.find((page) => page.name === DEFAULT_CANVAS_PAGE) ??
      pagesQuery.data[0]
    setActivePage(fallback.name)
  }, [worktreeId, pagesQuery.data, activePage])

  const ensure = trpc.canvas.ensure.useMutation({ onSuccess: refresh })
  const createNode = trpc.canvas.createNode.useMutation({ onSuccess: refresh })
  const updateNode = trpc.canvas.updateNode.useMutation({ onSuccess: refresh })
  const deleteNode = trpc.canvas.deleteNode.useMutation({ onSuccess: refresh })
  const connect = trpc.canvas.connect.useMutation({
    onSuccess: () => {
      setPendingConnection(null)
      refresh()
    },
  })
  const pickImages = trpc.canvas.pickImages.useMutation({ onSuccess: refresh })
  const importImage = trpc.canvas.importImage.useMutation()
  const stitch = trpc.canvas.stitch.useMutation()
  const replaceImage = trpc.canvas.replaceImage.useMutation()
  const groupNodesMutation = trpc.canvas.groupNodes.useMutation({ onSuccess: refresh })
  const applySnapshotMutation = trpc.canvas.applySnapshot.useMutation({
    onSuccess: refresh,
  })
  const createPageMutation = trpc.canvas.createPage.useMutation({
    onSuccess: refreshPages,
  })
  const deletePageMutation = trpc.canvas.deletePage.useMutation({
    onSuccess: () => {
      refreshPages()
      refresh()
    },
  })
  const renamePageMutation = trpc.canvas.renamePage.useMutation({
    onSuccess: refreshPages,
  })

  // Session-local undo / redo stacks. A snapshot is the full nodes+edges
  // graph at one point in time; pushing one before every mutation lets a
  // single restore-snapshot call walk the canvas back through any step,
  // including crops and stitches (the previous asset is still on disk).
  const undoStackRef = useRef<CanvasSnapshot[]>([])
  const redoStackRef = useRef<CanvasSnapshot[]>([])
  const canvasDataRef = useRef(canvas.data)
  canvasDataRef.current = canvas.data

  const snapshotFromData = (
    data: typeof canvas.data,
  ): CanvasSnapshot | null => {
    if (!data) return null
    return {
      nodes: data.nodes.map((node) => ({
        id: node.id,
        type: node.type as CanvasNodeKind,
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        // Deep-clone the data bag so a later mutation can't mutate the
        // snapshot in place. JSON round-trip is enough — node data is
        // always JSON-serialisable (it lives in a TEXT column).
        data: JSON.parse(JSON.stringify(node.dataJson)) as Record<string, unknown>,
        locked: Boolean(node.locked),
      })),
      edges: data.edges.map((edge) => ({
        id: edge.id,
        sourceNodeId: edge.sourceNodeId,
        sourceHandle: edge.sourceHandle,
        targetNodeId: edge.targetNodeId,
        targetHandle: edge.targetHandle,
      })),
    }
  }

  // Call before any mutation that should be undoable. Captures the
  // currently-displayed graph, pushes it onto the undo stack (capped at
  // MAX_UNDO_DEPTH), and clears the redo stack — a fresh action breaks
  // any redo branch, matching how Notion/Figma/most editors behave.
  const pushUndo = () => {
    const snapshot = snapshotFromData(canvasDataRef.current)
    if (!snapshot) return
    const stack = undoStackRef.current
    stack.push(snapshot)
    if (stack.length > MAX_UNDO_DEPTH) stack.shift()
    redoStackRef.current = []
  }

  const applySnapshot = (snapshot: CanvasSnapshot) => {
    if (!worktreeId) return
    applySnapshotMutation.mutate({ worktreeId, page: activePage, snapshot })
  }

  // updateNode covers drag-to-move, corner-resize, and text-edit commits.
  // Each call is a discrete user step (handlers only fire on pointer-up
  // or blur, never on every move), so one snapshot per call is what the
  // undo stack should hold.
  const updateNodeWithUndo = (input: Parameters<typeof updateNode.mutate>[0]) => {
    pushUndo()
    updateNode.mutate(input)
  }

  // ───── Page management ──────────────────────────────────────────────
  // Switching pages resets the per-session state that doesn't carry
  // over: undo/redo stacks (snapshots are page-local), selection (ids
  // refer to nodes on the old page), pending connection, crop, stitch.
  const goToPage = (name: string) => {
    if (name === activePage) return
    undoStackRef.current = []
    redoStackRef.current = []
    setSelectedIds(new Set())
    setPendingConnection(null)
    setCroppingNodeId(null)
    setCropRect(null)
    setStitchOpen(false)
    setActivePage(name)
  }

  // Generate a "Page N" label that doesn't collide with any existing
  // page. Counts up from 2, since the first page is named "main".
  const nextPageName = (): string => {
    const existing = new Set((pagesQuery.data ?? []).map((page) => page.name))
    let n = (pagesQuery.data?.length ?? 1) + 1
    while (existing.has(`Page ${n}`)) n += 1
    return `Page ${n}`
  }

  const createPage = async () => {
    if (!worktreeId) return
    const name = nextPageName()
    try {
      const page = await createPageMutation.mutateAsync({ worktreeId, name })
      goToPage(page.name)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't create the page",
      )
    }
  }

  const renamePage = async (oldName: string, newName: string) => {
    if (!worktreeId) return
    const trimmed = newName.trim()
    if (!trimmed || trimmed === oldName) return
    try {
      await renamePageMutation.mutateAsync({
        worktreeId,
        name: oldName,
        newName: trimmed,
      })
      if (activePage === oldName) setActivePage(trimmed)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't rename the page",
      )
    }
  }

  const deletePage = async (name: string) => {
    if (!worktreeId) return
    const pages = pagesQuery.data ?? []
    if (pages.length <= 1) {
      toast.error("Can't delete the only canvas page — make another first.")
      return
    }
    try {
      const result = await deletePageMutation.mutateAsync({ worktreeId, name })
      if (name === activePage) {
        const fallback =
          result.remainingPages[0] ?? DEFAULT_CANVAS_PAGE
        goToPage(fallback)
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't delete the page",
      )
    }
  }

  const undo = () => {
    const prev = undoStackRef.current.pop()
    if (!prev) return
    const current = snapshotFromData(canvasDataRef.current)
    if (current) redoStackRef.current.push(current)
    applySnapshot(prev)
  }

  const redo = () => {
    const next = redoStackRef.current.pop()
    if (!next) return
    const current = snapshotFromData(canvasDataRef.current)
    if (current) undoStackRef.current.push(current)
    applySnapshot(next)
  }

  const worktreePath = canvas.data?.worktreePath ?? null
  const nodes = (canvas.data?.nodes ?? []) as CanvasNodeView[]
  const edges = (canvas.data?.edges ?? []) as CanvasEdgeView[]
  const canvasGroupNodes = useMemo(
    () => nodes.filter((node) => node.type === "group"),
    [nodes],
  )
  const canvasContentNodes = useMemo(
    () => nodes.filter((node) => node.type !== "group"),
    [nodes],
  )
  const nodesById = useMemo(
    () => new Map(nodes.map((node) => [node.id, node])),
    [nodes],
  )

  // The image nodes inside the current selection — the stitch operates
  // on these, and the Stitch control only appears once two are picked.
  const selectedImageNodes = useMemo(
    () => nodes.filter((node) => selectedIds.has(node.id) && node.type === "image"),
    [nodes, selectedIds],
  )
  const selectedGroupableNodes = useMemo(
    () => nodes.filter((node) => selectedIds.has(node.id) && node.type !== "group"),
    [nodes, selectedIds],
  )

  // Live auto-stitch preview: whenever the panel is open in auto mode
  // with two or more images selected, lay the bodies out into justified
  // rows and project that onto the canvas via the override map. Manual
  // mode and closing the panel both clear the preview so the nodes snap
  // back to where the writer put them.
  useEffect(() => {
    if (!stitchOpen || stitchMode !== "auto" || selectedImageNodes.length < 2) {
      setStitchPreviewOverrides((prev) => (prev === null ? prev : null))
      stitchPreviewBoundsRef.current = null
      return
    }

    // Reading order matches composeStitch so the preview rearrangement
    // ends up identical to the composite.
    const sorted = [...selectedImageNodes].sort(
      (a, b) => a.y - b.y || a.x - b.x,
    )
    const aspects = sorted.map((node) => {
      const bodyHeight = Math.max(1, node.height - NODE_HEADER_HEIGHT)
      return node.width > 0 ? node.width / bodyHeight : 1
    })
    const layout = justifiedLayout(aspects, {
      containerWidth: autoStitchContainerWidth(stitchRowHeight),
      targetRowHeight: stitchRowHeight,
      spacing: stitchSpacing,
    })

    // Anchor the laid-out group at the top-left of the bodies the writer
    // already had selected — that's the least surprising place for the
    // preview to land.
    const originBodyX = Math.min(...sorted.map((node) => node.x))
    const originBodyY = Math.min(
      ...sorted.map((node) => node.y + NODE_HEADER_HEIGHT),
    )

    const next = new Map<
      string,
      { x: number; y: number; width: number; height: number }
    >()
    sorted.forEach((node, i) => {
      const rect = layout.rects[i]
      if (!rect) return
      next.set(node.id, {
        x: originBodyX + rect.x,
        y: originBodyY + rect.y - NODE_HEADER_HEIGHT,
        width: rect.width,
        height: rect.height + NODE_HEADER_HEIGHT,
      })
    })

    stitchPreviewBoundsRef.current = {
      minX: originBodyX,
      minY: originBodyY - NODE_HEADER_HEIGHT,
      maxY: originBodyY + layout.height,
    }
    setStitchPreviewOverrides(next)
  }, [
    stitchOpen,
    stitchMode,
    stitchRowHeight,
    stitchSpacing,
    selectedImageNodes,
  ])


  // Crop targets a single image at a time. When exactly one image node
  // is selected, the Crop tool lights up against that node.
  const cropTargetNode = selectedImageNodes.length === 1 ? selectedImageNodes[0] : null

  // The node currently being cropped, if any — kept in sync with the
  // node list so a delete from the agent / file watcher ends crop mode.
  const croppingNode = useMemo(
    () => (croppingNodeId ? nodes.find((node) => node.id === croppingNodeId) ?? null : null),
    [croppingNodeId, nodes],
  )

  useEffect(() => {
    if (croppingNodeId && !croppingNode) {
      setCroppingNodeId(null)
      setCropRect(null)
    }
  }, [croppingNodeId, croppingNode])

  // A live mirror of the node list — box-select resolves its hits on
  // pointer-up, after the closure that started the gesture was created.
  const nodesRef = useRef<CanvasNodeView[]>(nodes)
  nodesRef.current = nodes

  const addDescription = () => {
    if (!worktreeId) return
    const world = screenToWorld({ x: 84, y: 96 }, viewport)
    pushUndo()
    createNode.mutate({
      worktreeId,
      page: activePage,
      type: "description",
      x: Math.round(world.x),
      y: Math.round(world.y),
      width: 360,
      height: 160,
      data: {
        text: "",
        fontSize: 22,
        color: "default",
        highlight: "none",
        bold: false,
        italic: false,
      },
    })
  }

  const addGeneration = () => {
    if (!worktreeId) return
    const world = screenToWorld({ x: 700, y: 116 }, viewport)
    pushUndo()
    createNode.mutate({
      worktreeId,
      page: activePage,
      type: "imageGeneration",
      x: Math.round(world.x),
      y: Math.round(world.y),
      width: 560,
      height: 320,
      data: { model: "gpt-image-2", status: "idle" },
    })
  }

  const addTextBlock = () => {
    if (!worktreeId) return
    const world = screenToWorld({ x: 280, y: 160 }, viewport)
    pushUndo()
    createNode.mutate({
      worktreeId,
      page: activePage,
      type: "textBlock",
      x: Math.round(world.x),
      y: Math.round(world.y),
      width: 360,
      height: 120,
      data: { text: "", fontSize: 18 },
    })
  }

  const addImages = () => {
    if (!worktreeId) return
    const world = screenToWorld({ x: 120, y: 220 }, viewport)
    pushUndo()
    pickImages.mutate({
      worktreeId,
      page: activePage,
      x: Math.round(world.x),
      y: Math.round(world.y),
    })
  }

  // Drop-to-import — accepts both an OS/Finder file drag and an in-app
  // drag of an image row from the project file tree. The dataTransfer is
  // emptied once the handler returns, so every value is read up front,
  // before the first await.
  const dropToWorld = (event: DragEvent<HTMLDivElement>) => {
    const rect = viewportRef.current?.getBoundingClientRect()
    const point = rect
      ? { x: event.clientX - rect.left, y: event.clientY - rect.top }
      : { x: 0, y: 0 }
    return screenToWorld(point, viewport)
  }

  const onCanvasDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!worktreeId) return
    const { types } = event.dataTransfer
    if (!types.includes("Files") && !types.includes(CANVAS_DROP_MIME)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = "copy"
    if (!isDropTarget) setIsDropTarget(true)
  }

  const onCanvasDragLeave = (event: DragEvent<HTMLDivElement>) => {
    // dragleave fires when crossing onto a child too — only clear once
    // the pointer has actually left the viewport.
    const next = event.relatedTarget as Node | null
    if (!next || !event.currentTarget.contains(next)) setIsDropTarget(false)
  }

  const onCanvasDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!worktreeId) return
    const types = Array.from(event.dataTransfer.types)
    const isFileDrop = types.includes("Files")
    const inAppPath = event.dataTransfer.getData(CANVAS_DROP_MIME)
    if (!isFileDrop && !inAppPath) return

    event.preventDefault()
    setIsDropTarget(false)
    const world = dropToWorld(event)
    const activeWorktreeId = worktreeId

    // In-app drag — an image row from the project file tree, carrying
    // its project-relative path.
    if (inAppPath) {
      pushUndo()
      void importImage
        .mutateAsync({
          worktreeId: activeWorktreeId,
          page: activePage,
          sourcePath: inAppPath,
          x: Math.round(world.x),
          y: Math.round(world.y),
          createNode: true,
        })
        .then(() => refresh())
        .catch((error: unknown) => {
          toast.error(
            error instanceof Error ? error.message : "Couldn't add image",
          )
        })
      return
    }

    // OS / Finder drag — keep only image files, fan them out in a row.
    const paths = Array.from(event.dataTransfer.files)
      .map(
        (file) =>
          window.webUtils?.getPathForFile(file) ??
          (file as File & { path?: string }).path ??
          null,
      )
      .filter((path): path is string => Boolean(path) && isImagePath(path))
    if (paths.length === 0) {
      toast.error("Drop image files to add them to the canvas.")
      return
    }

    pushUndo()
    void (async () => {
      for (let index = 0; index < paths.length; index += 1) {
        try {
          await importImage.mutateAsync({
            worktreeId: activeWorktreeId,
            page: activePage,
            sourcePath: paths[index],
            x: Math.round(world.x) + index * 300,
            y: Math.round(world.y),
            createNode: true,
          })
        } catch (error) {
          toast.error(
            error instanceof Error ? error.message : "Couldn't add image",
          )
        }
      }
      refresh()
    })()
  }

  const zoomBy = (delta: number) => {
    setViewport((current) => ({
      ...current,
      zoom: clampZoom(current.zoom + delta),
    }))
  }

  const selectNode = (id: string, additive: boolean) => {
    setSelectedIds((prev) => {
      if (additive) {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      }
      // A plain press on a node already inside a multi-selection keeps that
      // selection (so the writer can grab one of several). Otherwise it
      // becomes the sole selection.
      if (prev.has(id)) return prev
      return new Set([id])
    })
  }

  const deleteSelected = () => {
    if (!worktreeId || selectedIds.size === 0) return
    pushUndo()
    for (const id of selectedIds) {
      deleteNode.mutate({ worktreeId, nodeId: id })
    }
    setSelectedIds(new Set())
  }

  const groupSelected = () => {
    if (!worktreeId || selectedGroupableNodes.length === 0) return
    pushUndo()
    groupNodesMutation.mutate(
      {
        worktreeId,
        page: activePage,
        label: "Group",
        nodeIds: selectedGroupableNodes.map((node) => node.id),
        padding: 36,
      },
      {
        onSuccess: (result) => {
          setSelectedIds(new Set([result.group.id]))
        },
      },
    )
  }

  // Composite the selected image nodes into one PNG and drop it back as a
  // new image node below the picked group. Auto packs them into justified
  // rows; manual keeps the arrangement they already have on the canvas.
  // In auto mode the rects come from the live preview overrides so the
  // composite matches exactly what the writer just saw on the canvas.
  const runStitch = async () => {
    if (!worktreeId || !worktreePath) return
    const imageNodes = selectedImageNodes
    if (imageNodes.length < 2) return

    setStitching(true)
    setStitchError(null)
    try {
      const sources = imageNodes
        .map((node) => {
          const relPath = node.dataJson.projectRelativePath
          if (typeof relPath !== "string") return null
          const override = stitchPreviewOverrides?.get(node.id)
          const rect = override ?? {
            x: node.x,
            y: node.y,
            width: node.width,
            height: node.height,
          }
          return {
            url: assetUrl(worktreePath, relPath),
            isCutout: node.dataJson.cutout === true,
            rect: {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: Math.max(1, rect.height - NODE_HEADER_HEIGHT),
            },
          }
        })
        .filter((source): source is NonNullable<typeof source> => source !== null)

      if (sources.length < 2) {
        throw new Error("Selected image nodes have no resolvable files.")
      }

      const result = await composeStitch({
        sources,
        mode: stitchMode,
        settings: {
          targetRowHeight: stitchRowHeight,
          spacing: stitchSpacing,
          background: stitchBackground,
        },
      })

      // Drop point lands beneath whatever the writer was just looking at —
      // the preview bounds while auto previewing, the persisted rects
      // otherwise.
      const bounds = stitchPreviewBoundsRef.current
      const minX = bounds
        ? bounds.minX
        : Math.min(...imageNodes.map((node) => node.x))
      const maxY = bounds
        ? bounds.maxY
        : Math.max(...imageNodes.map((node) => node.y + node.height))
      const aspect = result.height > 0 ? result.width / result.height : 1
      const displayWidth = Math.min(460, result.width)
      const displayHeight =
        Math.round(displayWidth / aspect) + NODE_HEADER_HEIGHT

      pushUndo()
      await stitch.mutateAsync({
        worktreeId,
        page: activePage,
        base64Png: result.base64,
        x: Math.round(minX),
        y: Math.round(maxY + 48),
        width: Math.round(displayWidth),
        height: displayHeight,
        label: `Stitched · ${imageNodes.length} images`,
      })
      // The preview was visual only; the originals stayed put in the
      // store, so closing the panel restores them automatically.
      setStitchOpen(false)
      refresh()
    } catch (error) {
      setStitchError(error instanceof Error ? error.message : String(error))
    } finally {
      setStitching(false)
    }
  }

  const cancelCrop = () => {
    setCroppingNodeId(null)
    setCropRect(null)
    setCropError(null)
    setCropMode("keep")
  }

  // Apply the chosen crop region to the node's actual image. Two paths:
  // "keep" trims the image to the selection rect (classic crop); "cutout"
  // keeps the image at its original size and erases just the selection,
  // leaving a transparent hole so a replacement image can be slotted in
  // over the void and stitched later. Either way the backend writes a new
  // asset and repoints the existing node (id, position, edges all stay).
  const applyCrop = async () => {
    if (!worktreeId || !worktreePath || !croppingNode || !cropRect) return
    const relPath =
      typeof croppingNode.dataJson.projectRelativePath === "string"
        ? croppingNode.dataJson.projectRelativePath
        : null
    if (!relPath) {
      setCropError("This image node has no file to crop.")
      return
    }
    const isFullImage =
      cropRect.x === 0 &&
      cropRect.y === 0 &&
      cropRect.width === 1 &&
      cropRect.height === 1
    // A full-image rect is a no-op for both modes: keep would be the
    // original, cutout would erase the entire image. Either is a wasted
    // round-trip — quietly exit.
    if (isFullImage) {
      cancelCrop()
      return
    }

    setCropping(true)
    setCropError(null)
    try {
      const img = await loadImageElement(assetUrl(worktreePath, relPath))
      const sx = Math.max(0, Math.round(cropRect.x * img.naturalWidth))
      const sy = Math.max(0, Math.round(cropRect.y * img.naturalHeight))
      const sw = Math.max(1, Math.round(cropRect.width * img.naturalWidth))
      const sh = Math.max(1, Math.round(cropRect.height * img.naturalHeight))

      const offscreen = document.createElement("canvas")
      let outputWidth: number
      let outputHeight: number
      if (cropMode === "cutout") {
        // Keep the full image size; punch out the selection with
        // destination-out so the rect becomes fully transparent.
        outputWidth = img.naturalWidth
        outputHeight = img.naturalHeight
      } else {
        // Keep the selection; output is sized to the selection rect.
        outputWidth = sw
        outputHeight = sh
      }
      offscreen.width = outputWidth
      offscreen.height = outputHeight
      const ctx = offscreen.getContext("2d")
      if (!ctx) throw new Error("Could not get a 2D canvas context.")
      ctx.imageSmoothingQuality = "high"
      if (cropMode === "cutout") {
        ctx.drawImage(img, 0, 0)
        ctx.globalCompositeOperation = "destination-out"
        ctx.fillRect(sx, sy, sw, sh)
        ctx.globalCompositeOperation = "source-over"
      } else {
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh)
      }
      const dataUrl = offscreen.toDataURL("image/png")
      const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1)

      pushUndo()
      await replaceImage.mutateAsync({
        worktreeId,
        nodeId: croppingNode.id,
        base64Png: base64,
        mode: cropMode === "cutout" ? "cutout" : "crop",
      })
      cancelCrop()
      refresh()
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Couldn't apply the crop"
      setCropError(message)
      toast.error(message)
    } finally {
      setCropping(false)
    }
  }

  // Trackpad navigation — a non-passive wheel listener so preventDefault
  // actually lands (React routes onWheel through a passive listener). Two-
  // finger scroll pans; pinch (macOS dispatches it as a ctrl-wheel) and
  // ⌘-wheel zoom toward the cursor. No modifier key needed to move around.
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return

    const onWheelNative = (event: WheelEvent) => {
      // ⌘/ctrl-wheel always zooms the canvas, even over a text body —
      // pinch and explicit zoom shouldn't be hijacked by scroll regions.
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault()
        const factor = event.ctrlKey ? 0.01 : 0.0015
        setViewport((current) => {
          const nextZoom = clampZoom(current.zoom - event.deltaY * factor)
          if (nextZoom === current.zoom) return current
          const rect = el.getBoundingClientRect()
          const mouse = {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
          }
          const before = screenToWorld(mouse, current)
          return {
            zoom: nextZoom,
            x: mouse.x - before.x * nextZoom,
            y: mouse.y - before.y * nextZoom,
          }
        })
        return
      }

      // Plain wheel inside a scrollable text body — let the browser scroll
      // the text instead of panning the canvas. Bail before preventDefault
      // so the native scroll lands.
      const target = event.target as HTMLElement | null
      const textBody = target?.closest?.(
        "[data-canvas-text-body]",
      ) as HTMLElement | null
      if (
        textBody &&
        (textBody.scrollHeight > textBody.clientHeight ||
          textBody.scrollWidth > textBody.clientWidth)
      ) {
        return
      }

      event.preventDefault()
      setViewport((current) => ({
        ...current,
        x: current.x - event.deltaX,
        y: current.y - event.deltaY,
      }))
    }

    el.addEventListener("wheel", onWheelNative, { passive: false })
    return () => el.removeEventListener("wheel", onWheelNative)
  }, [])

  // Delete / Backspace removes the selection; Escape clears it; Cmd/Ctrl+Z
  // undoes the last canvas step and Cmd/Ctrl+Shift+Z redoes it. The
  // delete/Esc/Enter branch is skipped while a text field is focused so
  // editing a prompt never drops nodes, but Cmd+Z is honored even from
  // inside a textarea so a writer can undo a node-level step without
  // losing focus first (the browser's textarea-local undo handles their
  // own typing edits).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName ?? "").toUpperCase()
      const inTextField = tag === "TEXTAREA" || tag === "INPUT"

      // Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z — undo / redo. Live across text
      // fields so a stuck textarea doesn't strand the canvas at an old
      // state, but only when the canvas itself has at least one entry on
      // the stack.
      const meta = event.metaKey || event.ctrlKey
      const isZ = event.key === "z" || event.key === "Z"
      if (meta && isZ && !event.altKey) {
        if (event.shiftKey) {
          if (redoStackRef.current.length === 0) return
          event.preventDefault()
          redo()
        } else {
          if (undoStackRef.current.length === 0) return
          event.preventDefault()
          undo()
        }
        return
      }

      if (inTextField) return

      if (event.key === "Escape") {
        if (croppingNodeId) {
          event.preventDefault()
          cancelCrop()
          return
        }
        setSelectedIds(new Set())
        setPendingConnection(null)
        return
      }
      if (event.key === "Enter" && croppingNodeId && !cropping) {
        event.preventDefault()
        void applyCrop()
        return
      }
      if (event.key !== "Delete" && event.key !== "Backspace") return
      // Don't blow away the source while the user is mid-crop.
      if (croppingNodeId) return
      if (selectedIds.size === 0) return
      event.preventDefault()
      deleteSelected()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds, worktreeId, croppingNodeId, cropping, cropRect, worktreePath])

  const onBoardPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!pendingConnection) return
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect) return
    setPointerWorld(
      screenToWorld(
        { x: event.clientX - rect.left, y: event.clientY - rect.top },
        viewport,
      ),
    )
  }

  const onBoardPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    // Presses on a node or on canvas chrome are handled by those elements.
    if (
      (event.target as HTMLElement).closest(
        "[data-canvas-node],[data-canvas-ui]",
      )
    )
      return

    const element = event.currentTarget
    const rect = element.getBoundingClientRect()

    // Middle-button drag still pans, a convenience for mouse users — the
    // trackpad handles panning for everyone else.
    if (event.button === 1) {
      const start = {
        x: event.clientX,
        y: event.clientY,
        vx: viewport.x,
        vy: viewport.y,
      }
      element.setPointerCapture(event.pointerId)
      const onMove = (moveEvent: PointerEvent<HTMLDivElement>) => {
        setViewport((current) => ({
          ...current,
          x: start.vx + moveEvent.clientX - start.x,
          y: start.vy + moveEvent.clientY - start.y,
        }))
      }
      const onUp = () => {
        element.releasePointerCapture(event.pointerId)
        element.removeEventListener(
          "pointermove",
          onMove as unknown as EventListener,
        )
        element.removeEventListener("pointerup", onUp)
        element.removeEventListener("pointercancel", onUp)
      }
      element.addEventListener("pointermove", onMove as unknown as EventListener)
      element.addEventListener("pointerup", onUp)
      element.addEventListener("pointercancel", onUp)
      return
    }

    if (event.button !== 0) return

    // Left-press on empty canvas opens a box selection. A press that never
    // travels reads as "click empty" — it clears the selection and any
    // half-made connection.
    const startWorld = screenToWorld(
      { x: event.clientX - rect.left, y: event.clientY - rect.top },
      viewport,
    )
    const captured = viewport
    let current = startWorld
    setSelectionBox({
      x1: startWorld.x,
      y1: startWorld.y,
      x2: startWorld.x,
      y2: startWorld.y,
    })
    element.setPointerCapture(event.pointerId)

    const onMove = (moveEvent: PointerEvent<HTMLDivElement>) => {
      current = screenToWorld(
        { x: moveEvent.clientX - rect.left, y: moveEvent.clientY - rect.top },
        captured,
      )
      setSelectionBox({
        x1: startWorld.x,
        y1: startWorld.y,
        x2: current.x,
        y2: current.y,
      })
    }

    const onUp = () => {
      element.releasePointerCapture(event.pointerId)
      element.removeEventListener(
        "pointermove",
        onMove as unknown as EventListener,
      )
      element.removeEventListener("pointerup", onUp)
      element.removeEventListener("pointercancel", onUp)
      setSelectionBox(null)

      const dragged =
        Math.abs(current.x - startWorld.x) > 4 ||
        Math.abs(current.y - startWorld.y) > 4
      if (!dragged) {
        setSelectedIds(new Set())
        setPendingConnection(null)
        return
      }
      const minX = Math.min(startWorld.x, current.x)
      const minY = Math.min(startWorld.y, current.y)
      const maxX = Math.max(startWorld.x, current.x)
      const maxY = Math.max(startWorld.y, current.y)
      const hits = nodesRef.current
        .filter(
          (node) =>
            node.x < maxX &&
            node.x + node.width > minX &&
            node.y < maxY &&
            node.y + node.height > minY,
        )
        .map((node) => node.id)
      setSelectedIds(new Set(hits))
    }

    element.addEventListener("pointermove", onMove as unknown as EventListener)
    element.addEventListener("pointerup", onUp)
    element.addEventListener("pointercancel", onUp)
  }

  const startConnection = (node: CanvasNodeView, handle: "text" | "image") => {
    setPendingConnection({
      nodeId: node.id,
      handle,
      point: { x: node.x + node.width, y: node.y + node.height / 2 },
    })
  }

  const finishConnection = (
    target: CanvasNodeView,
    targetHandle: "prompt" | "referenceImage",
  ) => {
    if (!worktreeId || !pendingConnection) return
    if (pendingConnection.nodeId === target.id) return
    pushUndo()
    connect.mutate({
      worktreeId,
      sourceNodeId: pendingConnection.nodeId,
      sourceHandle: pendingConnection.handle,
      targetNodeId: target.id,
      targetHandle,
    })
  }

  const selBox = selectionBox
    ? {
        left: Math.min(selectionBox.x1, selectionBox.x2),
        top: Math.min(selectionBox.y1, selectionBox.y2),
        width: Math.abs(selectionBox.x2 - selectionBox.x1),
        height: Math.abs(selectionBox.y2 - selectionBox.y1),
      }
    : null

  return (
    <div
      ref={viewportRef}
      className="@container/canvas relative h-full w-full overflow-hidden"
      // No painted fill — the canvas is transparent so the workspace's master
      // surface and the ambient lime halo show through, exactly like the
      // editor page. The dot grid is a faint ink texture over that surface.
      style={{
        backgroundImage:
          "radial-gradient(circle at 1px 1px, hsl(var(--foreground) / 0.09) 1px, transparent 0)",
        backgroundSize: `${18 * viewport.zoom}px ${18 * viewport.zoom}px`,
        backgroundPosition: `${viewport.x}px ${viewport.y}px`,
      }}
      onPointerMove={onBoardPointerMove}
      onPointerDown={onBoardPointerDown}
      onDragOver={onCanvasDragOver}
      onDragLeave={onCanvasDragLeave}
      onDrop={onCanvasDrop}
    >
      {/* Liquid-glass displacement filter — referenced by the toolbars below. */}
      <GlassFilter />

      {/* Drop affordance — shown while an image drag hovers the canvas. */}
      {isDropTarget && (
        <div
          data-canvas-ui
          className="pointer-events-none absolute inset-4 z-40 flex items-center justify-center rounded-2xl border-2 border-dashed border-primary/70 bg-primary/[0.06]"
        >
          <span className="bl-island rounded-xl px-3 py-1.5 text-[12px] font-medium text-foreground">
            Drop images to add to the canvas
          </span>
        </div>
      )}

      {/* Build toolbar — liquid-glass island, top-centre. The
          three-zone top chrome reads left→right as scope → actions →
          viewport (page selector top-left, this toolbar middle, zoom
          controls top-right) so each corner has a clear purpose. */}
      <div
        data-canvas-ui
        className="bl-liquid-glass absolute left-1/2 top-4 z-30 flex -translate-x-1/2 items-center gap-0.5 rounded-xl p-1"
        style={liquidGlassStyle}
      >
        <CanvasToolButton
          icon={<Pilcrow className="h-3.5 w-3.5" />}
          label="Text"
          disabled={!worktreeId}
          onClick={addTextBlock}
        />
        <CanvasToolButton
          icon={<AlignLeft className="h-3.5 w-3.5" />}
          label="Description"
          disabled={!worktreeId}
          onClick={addDescription}
        />
        <CanvasToolButton
          icon={<Sparkles className="h-3.5 w-3.5" />}
          label="Generate"
          disabled={!worktreeId}
          onClick={addGeneration}
        />
        <CanvasToolButton
          icon={<ImageIcon className="h-3.5 w-3.5" />}
          label="Image"
          disabled={!worktreeId || pickImages.isPending}
          onClick={addImages}
        />
        {/* Divider — visually separates "add" tools from tools that
            transform something already on the canvas. */}
        <span aria-hidden className="mx-0.5 h-4 w-px bg-foreground/10" />
        <CanvasToolButton
          icon={<CropIcon className="h-3.5 w-3.5" />}
          label="Crop"
          disabled={!worktreeId || !cropTargetNode || cropping}
          onClick={() => {
            if (!cropTargetNode) return
            setCroppingNodeId(cropTargetNode.id)
            setCropRect(null)
            setCropError(null)
          }}
        />
        <CanvasToolButton
          icon={<Combine className="h-3.5 w-3.5" />}
          label="Stitch"
          disabled={!worktreeId || selectedImageNodes.length < 2}
          onClick={() => {
            if (selectedImageNodes.length >= 2) {
              setStitchError(null)
              setStitchOpen((open) => !open)
            }
          }}
        />
      </div>

      {/* Selection actions — anchored above the workdesk mode dock
          (which sits at bottom-5 / h-11). Top-left build toolbar and
          top-right zoom stay uncovered on narrow canvases. Crop uses
          a different slot (top-center) since it locks out new-node
          tools anyway. */}
      {selectedIds.size > 0 && !croppingNode && (
        <div
          data-canvas-ui
          className="bl-liquid-glass absolute left-1/2 bottom-20 z-30 flex -translate-x-1/2 items-center gap-1 rounded-xl py-1 pl-3 pr-1"
          style={liquidGlassStyle}
        >
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] tabular-nums text-muted-foreground/75">
            {selectedIds.size} selected
          </span>
          <span aria-hidden className="mx-1 h-3.5 w-px bg-foreground/15" />
          {selectedImageNodes.length >= 2 && (
            <button
              type="button"
              onClick={() => {
                setStitchError(null)
                setStitchOpen((open) => !open)
              }}
              className={cn(
                "press inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5",
                "font-mono text-[10px] font-semibold uppercase tracking-[0.1em]",
                "bg-primary text-primary-foreground hover:bg-primary/90",
                stitchOpen && "ring-1 ring-inset ring-primary-foreground/35",
              )}
              title="Stitch selected images into one"
            >
              <Combine className="h-3.5 w-3.5" />
              Stitch {selectedImageNodes.length}
            </button>
          )}
          {selectedGroupableNodes.length > 0 && (
            <button
              type="button"
              onClick={groupSelected}
              disabled={groupNodesMutation.isPending}
              className={cn(
                "press inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[11.5px] font-medium",
                "text-muted-foreground hover:bg-foreground/[0.07] hover:text-foreground",
                "disabled:opacity-50 disabled:hover:bg-transparent",
              )}
              title="Group selected nodes"
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              Group
            </button>
          )}
          <button
            type="button"
            onClick={deleteSelected}
            className={cn(
              "press inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[11.5px] font-medium",
              "text-muted-foreground hover:bg-destructive/10 hover:text-destructive",
            )}
            title="Delete selected (⌫)"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </button>
        </div>
      )}

      {/* Crop action pill — appears while the user is cropping a node.
          Replaces the selection toolbar (which can't change selection
          mid-crop anyway). The mode toggle picks between keeping the
          selection (classic crop) and cutting it out (punch a hole into
          the image). Esc cancels, Enter applies. */}
      {croppingNode && (
        <div
          data-canvas-ui
          className="bl-liquid-glass absolute left-1/2 top-4 z-30 flex -translate-x-1/2 items-center gap-1.5 rounded-xl py-1 pl-3 pr-1"
          style={liquidGlassStyle}
        >
          <CropIcon className="h-3.5 w-3.5 text-primary" />
          <div className="flex h-7 items-center gap-0.5 rounded-lg bg-foreground/[0.06] p-0.5">
            <button
              type="button"
              onClick={() => setCropMode("keep")}
              disabled={cropping}
              className={cn(
                "press inline-flex h-6 items-center rounded-md px-2 text-[11px] font-medium disabled:opacity-50",
                cropMode === "keep"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground/75 hover:text-foreground",
              )}
              title="Keep the selected region"
            >
              Keep
            </button>
            <button
              type="button"
              onClick={() => setCropMode("cutout")}
              disabled={cropping}
              className={cn(
                "press inline-flex h-6 items-center rounded-md px-2 text-[11px] font-medium disabled:opacity-50",
                cropMode === "cutout"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground/75 hover:text-foreground",
              )}
              title="Cut the selected region out — leaves a transparent hole the rest of the image still surrounds"
            >
              Cut out
            </button>
          </div>
          {cropError && (
            <span className="ml-1 text-[10px] text-destructive">{cropError}</span>
          )}
          <button
            type="button"
            onClick={cancelCrop}
            disabled={cropping}
            className={cn(
              "press inline-flex h-7 items-center rounded-lg px-2.5 text-[11.5px] font-medium",
              "text-muted-foreground hover:bg-foreground/[0.07] hover:text-foreground",
              "disabled:opacity-50 disabled:hover:bg-transparent",
            )}
            title="Cancel crop (Esc)"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void applyCrop()}
            disabled={cropping || !cropRect}
            className={cn(
              "press inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5",
              "font-mono text-[10px] font-semibold uppercase tracking-[0.1em]",
              "bg-primary text-primary-foreground hover:bg-primary/90",
              "disabled:opacity-60 disabled:hover:bg-primary",
            )}
            title={
              cropMode === "cutout"
                ? "Cut out the selection (Enter)"
                : "Apply crop (Enter)"
            }
          >
            {cropping
              ? "Applying…"
              : cropMode === "cutout"
                ? "Cut out"
                : "Apply crop"}
          </button>
        </div>
      )}

      {/* Stitch panel — layout controls for combining the selected images. */}
      {stitchOpen && selectedImageNodes.length >= 2 && (
        <StitchPanel
          imageCount={selectedImageNodes.length}
          mode={stitchMode}
          rowHeight={stitchRowHeight}
          spacing={stitchSpacing}
          background={stitchBackground}
          stitching={stitching}
          error={stitchError}
          onModeChange={setStitchMode}
          onRowHeightChange={setStitchRowHeight}
          onSpacingChange={setStitchSpacing}
          onBackgroundChange={setStitchBackground}
          onCancel={() => setStitchOpen(false)}
          onStitch={runStitch}
        />
      )}

      {/* Zoom controls — liquid-glass island, top-right. Slimmer pill
          (h-7 children inside p-1) so it pairs with the page selector
          at the symmetric top-left corner. */}
      <div
        data-canvas-ui
        className="bl-liquid-glass absolute right-4 top-4 z-30 flex items-center gap-0.5 rounded-xl p-1"
        style={liquidGlassStyle}
      >
        <IconButton label="Zoom out" onClick={() => zoomBy(-0.1)}>
          <Minus className="h-3.5 w-3.5" />
        </IconButton>
        <button
          type="button"
          onClick={() => setViewport({ x: 0, y: 0, zoom: 1 })}
          className="press h-7 rounded-lg px-2 text-[11px] font-medium tabular-nums text-foreground/80 hover:bg-foreground/[0.07] hover:text-foreground"
        >
          {Math.round(viewport.zoom * 100)}%
        </button>
        <IconButton label="Zoom in" onClick={() => zoomBy(0.1)}>
          <Plus className="h-3.5 w-3.5" />
        </IconButton>
      </div>

      {pendingConnection && (
        <div
          data-canvas-ui
          className="bl-liquid-glass absolute bottom-32 left-1/2 z-30 -translate-x-1/2 rounded-full px-3.5 py-1.5 text-[11px] font-medium text-foreground"
          style={liquidGlassStyle}
        >
          Select an image generation input handle
        </div>
      )}

      {/* Page selector — top-left, symmetric with the zoom controls
          at top-right. Each canvas page is a fully independent graph;
          the selector tab-strips them like a Figma file's pages.
          Click to switch, double-click the active tab to rename
          inline, hover and click × to delete (with a confirm since
          deletion is not in the per-page undo stack). Appears once
          the first page exists (the "Open Canvas" placeholder
          handles the empty state). */}
      {worktreeId && (pagesQuery.data ?? []).length > 0 && (
        <div
          data-canvas-ui
          className="bl-liquid-glass absolute left-4 top-4 z-30 flex max-w-[calc(50%-13rem)] @max-4xl/canvas:max-w-[calc(50%-7rem)] items-center gap-0.5 rounded-xl p-1"
          style={liquidGlassStyle}
        >
          <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto">
            {(pagesQuery.data ?? []).map((page) => {
              const isActive = page.name === activePage
              const isRenaming = renamingPage === page.name
              const commitRename = () => {
                const next = renameDraft.trim()
                setRenamingPage(null)
                if (!next || next === page.name) return
                void renamePage(page.name, next)
              }
              return (
                <div
                  key={page.id}
                  className={cn(
                    "group flex h-7 shrink-0 items-center rounded-lg pl-2 pr-1 text-[11.5px] font-medium transition-colors",
                    isActive
                      ? "bg-background/85 text-foreground shadow-sm"
                      : "text-muted-foreground/75 hover:bg-foreground/[0.07] hover:text-foreground",
                  )}
                >
                  {isRenaming ? (
                    <input
                      autoFocus
                      value={renameDraft}
                      onChange={(event) => setRenameDraft(event.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault()
                          commitRename()
                        } else if (event.key === "Escape") {
                          event.preventDefault()
                          setRenamingPage(null)
                        }
                      }}
                      className="h-5 w-28 rounded bg-background/80 px-1.5 text-[11.5px] font-medium text-foreground outline-none ring-1 ring-primary/40"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => goToPage(page.name)}
                      onDoubleClick={() => {
                        setRenamingPage(page.name)
                        setRenameDraft(page.name)
                      }}
                      className="press max-w-[140px] @max-4xl/canvas:max-w-[88px] truncate text-left"
                      title={
                        isActive
                          ? "Double-click to rename"
                          : `Switch to ${page.name}`
                      }
                    >
                      {page.name}
                    </button>
                  )}
                  {(pagesQuery.data ?? []).length > 1 && !isRenaming && (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        if (
                          window.confirm(
                            `Delete page "${page.name}"? Its nodes and edges go with it.`,
                          )
                        ) {
                          void deletePage(page.name)
                        }
                      }}
                      className={cn(
                        "press ml-0.5 flex h-4 w-4 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-foreground/10 hover:text-foreground group-hover:opacity-100",
                        isActive && "opacity-60 hover:opacity-100",
                      )}
                      title={`Delete ${page.name}`}
                      aria-label={`Delete page ${page.name}`}
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
          <span aria-hidden className="mx-0.5 h-4 w-px shrink-0 bg-foreground/10" />
          <button
            type="button"
            onClick={() => void createPage()}
            disabled={createPageMutation.isPending}
            className="press flex h-7 shrink-0 items-center gap-1 rounded-lg px-2 @max-4xl/canvas:px-1.5 text-[11.5px] font-medium text-muted-foreground hover:bg-foreground/[0.07] hover:text-foreground disabled:opacity-50"
            title="New page"
            aria-label="New page"
          >
            <Plus className="h-3 w-3" />
            <span className="@max-4xl/canvas:hidden">New page</span>
          </button>
        </div>
      )}

      {worktreeId && !canvas.data && !canvas.isLoading && (
        <button
          type="button"
          data-canvas-ui
          onClick={() => ensure.mutate({ worktreeId, page: activePage })}
          className={cn(
            "press absolute left-1/2 top-1/2 z-20 inline-flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-lg px-3.5 py-2",
            "font-mono text-[10px] font-semibold uppercase tracking-[0.12em]",
            "bg-primary text-primary-foreground hover:bg-primary/90",
          )}
        >
          <LayoutGrid className="h-3.5 w-3.5" />
          Open Canvas
        </button>
      )}

      <div
        className="absolute left-0 top-0 h-[4000px] w-[4000px] origin-top-left"
        style={{
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
        }}
      >
        {canvasGroupNodes.map((node) => (
          <CanvasNodeShell
            key={node.id}
            worktreeId={worktreeId}
            worktreePath={worktreePath}
            node={node}
            viewport={viewport}
            selected={selectedIds.has(node.id)}
            onSelect={selectNode}
            updateNode={updateNodeWithUndo}
            onStartConnection={startConnection}
            onFinishConnection={finishConnection}
            pendingConnection={pendingConnection}
            isCropping={false}
            cropRect={null}
            onCropRectChange={setCropRect}
            previewOverride={stitchPreviewOverrides?.get(node.id) ?? null}
          />
        ))}
        <CanvasEdges
          edges={edges}
          nodesById={nodesById}
          pendingConnection={pendingConnection}
          pointerWorld={pointerWorld}
        />
        {canvasContentNodes.map((node) => (
          <CanvasNodeShell
            key={node.id}
            worktreeId={worktreeId}
            worktreePath={worktreePath}
            node={node}
            viewport={viewport}
            selected={selectedIds.has(node.id)}
            onSelect={selectNode}
            updateNode={updateNodeWithUndo}
            onStartConnection={startConnection}
            onFinishConnection={finishConnection}
            pendingConnection={pendingConnection}
            isCropping={croppingNodeId === node.id}
            cropRect={croppingNodeId === node.id ? cropRect : null}
            onCropRectChange={setCropRect}
            previewOverride={stitchPreviewOverrides?.get(node.id) ?? null}
          />
        ))}
        {selBox && (
          <div
            className="pointer-events-none absolute rounded-[3px] border border-primary bg-primary/10"
            style={{
              left: selBox.left,
              top: selBox.top,
              width: selBox.width,
              height: selBox.height,
            }}
          />
        )}
      </div>
    </div>
  )
}

function CanvasToolButton({
  icon,
  label,
  disabled,
  onClick,
}: {
  icon: ReactNode
  label: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "press flex h-7 items-center gap-1.5 rounded-lg px-2 @max-4xl/canvas:px-1.5 text-[11.5px] font-medium",
        "text-muted-foreground hover:bg-foreground/[0.07] hover:text-foreground",
        "disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 disabled:hover:bg-transparent",
      )}
      title={label}
      aria-label={label}
    >
      {icon}
      <span className="@max-4xl/canvas:hidden">{label}</span>
    </button>
  )
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="press flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-foreground/[0.07] hover:text-foreground"
      title={label}
      aria-label={label}
    >
      {children}
    </button>
  )
}

// StitchPanel — the layout controls for combining selected image nodes.
// Auto packs them into justified rows; manual composites them exactly as
// they sit on the canvas. The panel floats under the selection toolbar.
function StitchPanel({
  imageCount,
  mode,
  rowHeight,
  spacing,
  background,
  stitching,
  error,
  onModeChange,
  onRowHeightChange,
  onSpacingChange,
  onBackgroundChange,
  onCancel,
  onStitch,
}: {
  imageCount: number
  mode: StitchMode
  rowHeight: number
  spacing: number
  background: string
  stitching: boolean
  error: string | null
  onModeChange: (mode: StitchMode) => void
  onRowHeightChange: (value: number) => void
  onSpacingChange: (value: number) => void
  onBackgroundChange: (value: string) => void
  onCancel: () => void
  onStitch: () => void
}) {
  const backgrounds: Array<{ label: string; value: string }> = [
    { label: "None", value: "transparent" },
    { label: "White", value: "#FFFFFF" },
    { label: "Carbon", value: "#191919" },
  ]

  return (
    <div
      data-canvas-ui
      className="bl-island absolute left-1/2 top-[4.25rem] z-30 w-72 -translate-x-1/2 rounded-2xl p-3"
    >
      <div className="mb-2.5 flex items-center gap-1.5 px-0.5">
        <Combine className="h-3.5 w-3.5 text-primary" />
        <span className="text-[12px] font-semibold text-foreground">
          Stitch {imageCount} images
        </span>
      </div>

      {/* Arrangement mode */}
      <div className="mb-2.5 flex h-7 gap-0.5 rounded-lg bg-foreground/[0.06] p-0.5">
        {(["auto", "manual"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => onModeChange(value)}
            className={cn(
              "press inline-flex h-6 flex-1 items-center justify-center rounded-md px-2 text-[11px] font-medium capitalize",
              mode === value
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground/75 hover:text-foreground",
            )}
          >
            {value}
          </button>
        ))}
      </div>
      <p className="mb-2.5 px-0.5 text-[10px] leading-snug text-muted-foreground">
        {mode === "auto"
          ? "Previewing on the canvas — tweak row height or spacing to restitch."
          : "Composites the images where they sit on the canvas."}
      </p>

      {mode === "auto" && (
        <div className="mb-2.5 flex gap-2">
          <StitchNumberField
            label="Row height"
            value={rowHeight}
            min={120}
            max={720}
            step={20}
            onChange={onRowHeightChange}
          />
          <StitchNumberField
            label="Spacing"
            value={spacing}
            min={0}
            max={80}
            step={2}
            onChange={onSpacingChange}
          />
        </div>
      )}

      {/* Background fill */}
      <div className="mb-3">
        <span className="mb-1 block px-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Background
        </span>
        <div className="flex gap-1">
          {backgrounds.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => onBackgroundChange(option.value)}
              className={cn(
                "press inline-flex h-7 flex-1 items-center justify-center rounded-lg border px-2 text-[11px] font-medium",
                background === option.value
                  ? "border-primary/55 bg-primary/[0.10] text-foreground"
                  : "border-border/60 text-muted-foreground hover:border-border hover:text-foreground",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p className="mb-2.5 rounded-lg bg-destructive/10 px-2 py-1.5 text-[10px] leading-snug text-destructive">
          {error}
        </p>
      )}

      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={onCancel}
          disabled={stitching}
          className={cn(
            "press inline-flex h-7 flex-1 items-center justify-center rounded-lg px-2.5 text-[11.5px] font-medium",
            "text-muted-foreground hover:bg-foreground/[0.07] hover:text-foreground",
            "disabled:opacity-50 disabled:hover:bg-transparent",
          )}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onStitch}
          disabled={stitching}
          className={cn(
            "press inline-flex h-7 flex-[1.4] items-center justify-center rounded-lg px-3",
            "font-mono text-[10px] font-semibold uppercase tracking-[0.1em]",
            "bg-primary text-primary-foreground hover:bg-primary/90",
            "disabled:opacity-60 disabled:hover:bg-primary",
          )}
        >
          {stitching
            ? "Stitching…"
            : mode === "auto"
              ? `Apply ${imageCount}`
              : `Stitch ${imageCount}`}
        </button>
      </div>
    </div>
  )
}

function StitchNumberField({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
}) {
  return (
    <label className="flex-1">
      <span className="mb-1 block px-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => {
          const next = Number(event.target.value)
          if (Number.isFinite(next)) {
            onChange(Math.min(max, Math.max(min, next)))
          }
        }}
        className="h-8 w-full rounded-lg border border-border bg-background px-2 text-[12px] font-medium tabular-nums text-foreground outline-none focus:border-primary"
      />
    </label>
  )
}

function CanvasNodeShell({
  worktreeId,
  worktreePath,
  node,
  viewport,
  selected,
  onSelect,
  updateNode,
  onStartConnection,
  onFinishConnection,
  pendingConnection,
  isCropping,
  cropRect,
  onCropRectChange,
  previewOverride,
}: {
  worktreeId: string | null
  worktreePath: string | null
  node: CanvasNodeView
  viewport: Viewport
  selected: boolean
  onSelect: (id: string, additive: boolean) => void
  updateNode: (input: {
    worktreeId: string
    nodeId: string
    x?: number
    y?: number
    width?: number
    height?: number
    data?: Record<string, unknown>
  }) => void
  onStartConnection: (node: CanvasNodeView, handle: "text" | "image") => void
  onFinishConnection: (
    target: CanvasNodeView,
    targetHandle: "prompt" | "referenceImage",
  ) => void
  pendingConnection: PendingConnection | null
  isCropping: boolean
  cropRect: CropRect | null
  onCropRectChange: (next: CropRect | null) => void
  // While the auto-stitch preview is live the parent rewrites the node's
  // visible rect via this override — pointer drag and resize are also
  // suppressed so the writer can't fight the layout.
  previewOverride: { x: number; y: number; width: number; height: number } | null
}) {
  const [dragPosition, setDragPosition] = useState<{ x: number; y: number } | null>(null)
  const [dragSize, setDragSize] = useState<{ width: number; height: number } | null>(
    null,
  )
  // Text-block edit state lives at the wrapper so the press-up handler below
  // can flip into editing on a tap (click without drag). Empty blocks open
  // straight into typing so a freshly added node is ready to write into.
  // Legacy `prompt` nodes share this state — they now render through the
  // same text-box visual.
  const isTextBox = node.type === "textBlock" || node.type === "prompt"
  const isDescription = node.type === "description"
  const isEditableText = isTextBox || isDescription
  // Text boxes (incl. legacy prompts) auto-open into editing when empty —
  // their reason to exist is the text. Description nodes never auto-edit:
  // first click selects (revealing the format bar), second click edits.
  const [textBlockEditing, setTextBlockEditing] = useState(() => {
    if (!isTextBox) return false
    const initialText =
      typeof node.dataJson.text === "string" ? node.dataJson.text : ""
    return initialText.length === 0
  })
  // The live stitch preview wins over the persisted rect, but the user's
  // own drag/resize (which is locked anyway while the preview is active)
  // would still win if it ever fired — local interaction always trumps a
  // remote override so input feels responsive.
  const renderedX = dragPosition?.x ?? previewOverride?.x ?? node.x
  const renderedY = dragPosition?.y ?? previewOverride?.y ?? node.y
  const renderedWidth = dragSize?.width ?? previewOverride?.width ?? node.width
  const renderedHeight =
    dragSize?.height ?? previewOverride?.height ?? node.height

  // Hold the local drag offset until the persisted node catches up. Clearing
  // it the instant the pointer lifts would snap the card back to its old
  // coordinates for the frame before the refetch lands.
  useEffect(() => {
    setDragPosition((prev) =>
      prev && prev.x === node.x && prev.y === node.y ? null : prev,
    )
  }, [node.x, node.y])

  useEffect(() => {
    setDragSize((prev) =>
      prev && prev.width === node.width && prev.height === node.height
        ? null
        : prev,
    )
  }, [node.width, node.height])

  // The stored name on the node — may be empty. EditableNodeName renders
  // a typed placeholder when this is blank so the asset still has a title
  // chip; the placeholder is also what the rename input uses.
  const storedLabel =
    typeof node.dataJson.label === "string" ? node.dataJson.label : ""
  const namePlaceholder =
    node.type === "imageGeneration"
      ? "Untitled generation"
      : node.type === "image"
        ? "Untitled image"
        : node.type === "group"
          ? "Untitled group"
          : node.type === "description"
            ? "Untitled description"
            : "Untitled text"
  // Legacy callers (the alt-text on the <img>) want a non-empty string.
  const label = storedLabel || namePlaceholder

  const Icon =
    node.type === "imageGeneration"
      ? Sparkles
      : node.type === "group"
        ? LayoutGrid
        : ImageIcon

  const imageRelPath =
    typeof node.dataJson.projectRelativePath === "string"
      ? node.dataJson.projectRelativePath
      : null
  const imageUrl =
    node.type === "image" && worktreePath && imageRelPath
      ? assetUrl(worktreePath, imageRelPath)
      : null

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!worktreeId || event.button !== 0) return
    // Presses on the textarea, a control, or a connection handle are not a
    // node drag — they belong to those elements.
    if (
      (event.target as HTMLElement).closest(
        "textarea, input, button, [data-canvas-handle]",
      )
    )
      return
    // While the auto-stitch preview is live this node sits at a computed
    // layout position; a drag would fight the layout and the press-up
    // would persist whichever rect the layout last produced, baking the
    // preview in by accident. Keep the press-stops-here behavior so
    // marquee selection on the canvas surface doesn't pick this node up.
    if (previewOverride) {
      event.stopPropagation()
      return
    }

    event.stopPropagation()
    // Capture the selection state *before* onSelect changes it — description
    // nodes use this to implement the two-stage gesture (first tap selects
    // and reveals the format bar, second tap enters edit mode).
    const wasSelected = selected
    onSelect(node.id, event.shiftKey)

    // While a text box is already being edited, the body owns its own
    // pointer; skipping the drag start here keeps caret placement responsive.
    if (isEditableText && textBlockEditing) return

    const start = {
      x: event.clientX,
      y: event.clientY,
      nodeX: renderedX,
      nodeY: renderedY,
    }
    const element = event.currentTarget
    element.setPointerCapture(event.pointerId)

    const dragPositionRef = { current: null as { x: number; y: number } | null }

    const onUp = () => {
      const next = dragPositionRef.current
      element.releasePointerCapture(event.pointerId)
      element.removeEventListener("pointermove", trackedMove as unknown as EventListener)
      element.removeEventListener("pointerup", onUp)
      element.removeEventListener("pointercancel", onUp)
      if (next && worktreeId) {
        updateNode({
          worktreeId,
          nodeId: node.id,
          x: next.x,
          y: next.y,
        })
      } else if (isTextBox) {
        // Tap without drag on a text box enters edit mode. Pointer capture
        // re-targets click/dblclick away from the inner div, so we drive
        // editing from the press-up here instead of an onClick handler.
        setTextBlockEditing(true)
      } else if (isDescription && wasSelected) {
        // Description nodes are two-stage: the first tap selects (so the
        // format bar can appear and stop the gesture there); only a tap on
        // an already-selected description drops into the text editor.
        setTextBlockEditing(true)
      }
      // dragPosition is kept here on purpose — the effect above drops it once
      // the refetched node reports the new coordinates, so there is no snap.
    }

    const trackedMove = (moveEvent: PointerEvent<HTMLDivElement>) => {
      // Movement under ~4 screen pixels is jitter from a click, not a drag —
      // ignoring it preserves the tap-to-edit affordance on text blocks and
      // avoids accidental position writes for all node types.
      const screenDx = moveEvent.clientX - start.x
      const screenDy = moveEvent.clientY - start.y
      if (!dragPositionRef.current && Math.hypot(screenDx, screenDy) < 4) {
        return
      }
      const dx = screenDx / viewport.zoom
      const dy = screenDy / viewport.zoom
      const next = {
        x: Math.round(start.nodeX + dx),
        y: Math.round(start.nodeY + dy),
      }
      dragPositionRef.current = next
      setDragPosition(next)
    }

    element.addEventListener("pointermove", trackedMove as unknown as EventListener)
    element.addEventListener("pointerup", onUp)
    element.addEventListener("pointercancel", onUp)
  }

  // Corner-handle drag — resizes the node by tracking the pointer delta and
  // committing the new width/height on release. Sizes are held locally so the
  // box follows the pointer before the refetched node catches up.
  const onResizePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!worktreeId || event.button !== 0) return
    event.stopPropagation()
    // Same reason as the body drag: resizing during preview would fight
    // the layout and persist a half-recomputed rect on pointer-up.
    if (previewOverride) return

    const start = {
      x: event.clientX,
      y: event.clientY,
      width: renderedWidth,
      height: renderedHeight,
    }
    const element = event.currentTarget
    element.setPointerCapture(event.pointerId)

    const sizeRef = { current: null as { width: number; height: number } | null }

    const onUp = () => {
      const next = sizeRef.current
      element.releasePointerCapture(event.pointerId)
      element.removeEventListener("pointermove", trackedMove as unknown as EventListener)
      element.removeEventListener("pointerup", onUp)
      element.removeEventListener("pointercancel", onUp)
      if (next && worktreeId) {
        updateNode({
          worktreeId,
          nodeId: node.id,
          width: next.width,
          height: next.height,
        })
      }
    }

    const trackedMove = (moveEvent: PointerEvent<HTMLDivElement>) => {
      const dx = (moveEvent.clientX - start.x) / viewport.zoom
      const dy = (moveEvent.clientY - start.y) / viewport.zoom
      const next = {
        width: Math.max(80, Math.round(start.width + dx)),
        height: Math.max(40, Math.round(start.height + dy)),
      }
      sizeRef.current = next
      setDragSize(next)
    }

    element.addEventListener("pointermove", trackedMove as unknown as EventListener)
    element.addEventListener("pointerup", onUp)
    element.addEventListener("pointercancel", onUp)
  }

  if (node.type === "group") {
    const nodeIds = Array.isArray(node.dataJson.nodeIds)
      ? node.dataJson.nodeIds.filter((id): id is string => typeof id === "string")
      : []
    return (
      <div
        data-canvas-node
        className="absolute cursor-grab active:cursor-grabbing"
        style={{
          left: renderedX,
          top: renderedY,
          width: renderedWidth,
          height: renderedHeight,
          zIndex: 0,
          ...(selected
            ? { outline: "1.5px solid hsl(var(--primary))", outlineOffset: "3px" }
            : {}),
        }}
        onPointerDown={onPointerDown}
      >
        <div className="absolute inset-0 rounded-2xl border border-dashed border-primary/45 bg-primary/[0.035]" />
        <div className="absolute left-3 top-2 flex max-w-[calc(100%-24px)] items-center gap-1.5 rounded-full border border-primary/25 bg-background/80 px-2 py-1 shadow-sm backdrop-blur-sm">
          <LayoutGrid className="h-3.5 w-3.5 shrink-0 text-primary" />
          <EditableNodeName
            worktreeId={worktreeId}
            nodeId={node.id}
            value={storedLabel}
            placeholder={namePlaceholder}
            updateNode={updateNode}
            className="text-[11px] font-semibold uppercase tracking-wide text-foreground/85"
            inputClassName="text-[11px] font-semibold uppercase tracking-wide text-foreground/85"
          />
          {nodeIds.length > 0 && (
            <span className="rounded-full bg-primary/12 px-1.5 text-[10px] font-medium tabular-nums text-muted-foreground">
              {nodeIds.length}
            </span>
          )}
        </div>
        {selected && <CanvasResizeHandle onPointerDown={onResizePointerDown} />}
      </div>
    )
  }

  // The unified text box — used for plain notes and for prompts feeding
  // image generation. A slight border so it reads as a real card on the
  // canvas, with a right-side output handle for wiring it into a generation
  // node. Tap to edit, drag the body to move, corner handle to resize.
  // Legacy `prompt` nodes flow through here too, so the canvas reads
  // consistently regardless of when the node was added.
  if (isTextBox) {
    return (
      <div
        data-canvas-node
        className={cn(
          "absolute flex cursor-grab flex-col rounded-lg border bg-card/40 px-3 py-2.5 backdrop-blur-[1px] active:cursor-grabbing",
          "border-border/55 shadow-[0_1px_2px_rgba(0,0,0,0.18)]",
        )}
        style={{
          left: renderedX,
          top: renderedY,
          width: renderedWidth,
          height: renderedHeight,
          zIndex: 2,
          ...(selected
            ? { outline: "1.5px solid hsl(var(--primary))", outlineOffset: "2px" }
            : {}),
        }}
        onPointerDown={onPointerDown}
      >
        <CanvasHandle
          side="right"
          active={pendingConnection?.nodeId === node.id}
          label="Text output"
          onClick={() => onStartConnection(node, "text")}
        />
        <div className="mb-1.5 flex h-4 shrink-0 items-center gap-1.5 px-0.5">
          <Pilcrow className="h-3 w-3 shrink-0 text-muted-foreground/70" />
          <EditableNodeName
            worktreeId={worktreeId}
            nodeId={node.id}
            value={storedLabel}
            placeholder={namePlaceholder}
            updateNode={updateNode}
            className="text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground/80"
            inputClassName="text-[10.5px] font-medium uppercase tracking-wide text-foreground"
          />
        </div>
        <div className="min-h-0 flex-1">
          <TextBlockNodeBody
            worktreeId={worktreeId}
            nodeId={node.id}
            data={node.dataJson}
            updateNode={updateNode}
            editing={textBlockEditing}
            setEditing={setTextBlockEditing}
          />
        </div>
        {selected && <CanvasResizeHandle onPointerDown={onResizePointerDown} />}
      </div>
    )
  }

  // The description card — a chrome-free editorial text block. No input or
  // output handles (it never wires into a generation), no card border. The
  // text is what you see; selecting it reveals a floating formatting bar
  // (size, color, bold, italic) above the node.
  if (isDescription) {
    return (
      <div
        data-canvas-node
        className="absolute flex cursor-grab flex-col active:cursor-grabbing"
        style={{
          left: renderedX,
          top: renderedY,
          width: renderedWidth,
          height: renderedHeight,
          zIndex: 2,
          ...(selected
            ? { outline: "1.5px dashed hsl(var(--primary) / 0.7)", outlineOffset: "6px", borderRadius: 4 }
            : {}),
        }}
        onPointerDown={onPointerDown}
      >
        {selected && !textBlockEditing && (
          <DescriptionFormatBar
            worktreeId={worktreeId}
            nodeId={node.id}
            data={node.dataJson}
            updateNode={updateNode}
          />
        )}
        <div className="mb-1.5 flex h-4 shrink-0 items-center gap-1.5 px-0.5">
          <AlignLeft className="h-3 w-3 shrink-0 text-muted-foreground/70" />
          <EditableNodeName
            worktreeId={worktreeId}
            nodeId={node.id}
            value={storedLabel}
            placeholder={namePlaceholder}
            updateNode={updateNode}
            className="text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground/80"
            inputClassName="text-[10.5px] font-medium uppercase tracking-wide text-foreground"
          />
        </div>
        <div className="min-h-0 flex-1">
          <DescriptionNodeBody
            worktreeId={worktreeId}
            nodeId={node.id}
            data={node.dataJson}
            updateNode={updateNode}
            editing={textBlockEditing}
            setEditing={setTextBlockEditing}
          />
        </div>
        {selected && <CanvasResizeHandle onPointerDown={onResizePointerDown} />}
      </div>
    )
  }

  // Image nodes drop the header strip entirely — the filename sits as a
  // plain label above a full-bleed image card, so the picture reads as
  // the content, not as a field inside a form.
  if (node.type === "image") {
    // While cropping, suppress node drag (the overlay owns the pointer
    // inside the image card; the letterbox margin around it would
    // otherwise grab a drag) and the selection ring (the dim + rect
    // already mark the active region clearly).
    const onNodePointerDown = isCropping ? undefined : onPointerDown
    // Aspect-lock the card to the image's natural dimensions so the
    // picture always reads edge-to-edge — width is what the user
    // controls (and what we store as the source of truth), height
    // follows. Falls back to the stored height when natural dims are
    // unknown (legacy nodes from before we recorded them).
    const naturalW =
      typeof node.dataJson.naturalWidth === "number" &&
      node.dataJson.naturalWidth > 0
        ? node.dataJson.naturalWidth
        : null
    const naturalH =
      typeof node.dataJson.naturalHeight === "number" &&
      node.dataJson.naturalHeight > 0
        ? node.dataJson.naturalHeight
        : null
    const displayedHeight =
      naturalW && naturalH
        ? Math.round(renderedWidth * (naturalH / naturalW)) + NODE_HEADER_HEIGHT
        : renderedHeight
    const imageBodyHeight = Math.max(1, displayedHeight - NODE_HEADER_HEIGHT)
    // Cut-out images have a transparent hole punched into them. Show a
    // transparency checker behind the <img> so the missing region reads
    // as "void to fill" instead of as "image with a confusing dark
    // patch" against the canvas backdrop.
    const isCutout = node.dataJson.cutout === true
    const checkerStyle: React.CSSProperties = isCutout
      ? {
          backgroundColor: "hsl(var(--muted) / 0.55)",
          backgroundImage:
            "linear-gradient(45deg, hsl(var(--foreground) / 0.08) 25%, transparent 25%, transparent 75%, hsl(var(--foreground) / 0.08) 75%), linear-gradient(45deg, hsl(var(--foreground) / 0.08) 25%, transparent 25%, transparent 75%, hsl(var(--foreground) / 0.08) 75%)",
          backgroundSize: "14px 14px",
          backgroundPosition: "0 0, 7px 7px",
        }
      : {}
    return (
      <div
        data-canvas-node
        className={cn(
          "absolute flex flex-col gap-1.5",
          isCropping ? "cursor-default" : "cursor-grab active:cursor-grabbing",
        )}
        style={{
          left: renderedX,
          top: renderedY,
          width: renderedWidth,
          height: displayedHeight,
          zIndex: 2,
        }}
        onPointerDown={onNodePointerDown}
      >
        <div className="flex h-5 shrink-0 items-center gap-1.5 px-0.5">
          <ImageIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <EditableNodeName
            worktreeId={worktreeId}
            nodeId={node.id}
            value={storedLabel}
            placeholder={namePlaceholder}
            updateNode={updateNode}
            className="text-[12px] font-medium text-muted-foreground"
            inputClassName="text-[12px] font-medium text-foreground"
          />
          {isCutout && (
            <span className="ml-1 rounded-full bg-muted/70 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
              Cut-out
            </span>
          )}
        </div>

        {/* Positioning parent — `relative flex-1` anchors the connector
            handle without imposing `overflow:hidden`, so the chip can
            poke past the card's right edge unclipped. The inner
            `bl-island` carries the rounded mask and selection outline;
            the handle is its sibling, not its child. */}
        <div className="relative min-h-0 flex-1">
          <div
            className="bl-island absolute inset-0 overflow-hidden rounded-xl"
            style={
              !isCropping && selected
                ? { outline: "2px solid hsl(var(--primary))", outlineOffset: "2px" }
                : undefined
            }
          >
            {imageUrl ? (
              <img
                src={imageUrl}
                alt={label}
                draggable={false}
                // The card is aspect-locked to the image's natural
                // dimensions (see above), so `object-contain` reads
                // edge-to-edge in the common case. Kept as `contain`
                // for legacy nodes (no natural dims on file) and for
                // cut-outs so the transparent region stays intact.
                className="h-full w-full select-none object-contain"
                style={isCutout ? checkerStyle : { backgroundColor: "hsl(var(--muted) / 0.4)" }}
              />
            ) : (
              <div className="flex h-full items-center justify-center bg-muted/40 p-3">
                <span className="text-[11px] text-muted-foreground">
                  {imageRelPath ?? label}
                </span>
              </div>
            )}
            {isCropping && imageUrl && (
              <InCanvasCropOverlay
                imageUrl={imageUrl}
                containerWidth={renderedWidth}
                containerHeight={imageBodyHeight}
                zoom={viewport.zoom}
                cropRect={cropRect}
                onCropRectChange={onCropRectChange}
              />
            )}
          </div>
          {!isCropping && (
            <CanvasHandle
              side="right"
              active={pendingConnection?.nodeId === node.id}
              label="Image output"
              icon={<ImageIcon className="h-3 w-3" />}
              onClick={() => onStartConnection(node, "image")}
            />
          )}
        </div>
        {selected && !isCropping && (
          <CanvasResizeHandle onPointerDown={onResizePointerDown} />
        )}
      </div>
    )
  }

  // imageGeneration node — header strip + status/model pills + canvas slot
  // for the generated image. Two input handles on the left (prompt + ref
  // image) so a text box and an image node can be wired in.
  return (
    <div
      data-canvas-node
      className="bl-island absolute flex cursor-grab flex-col rounded-xl text-card-foreground active:cursor-grabbing"
      style={{
        left: renderedX,
        top: renderedY,
        width: renderedWidth,
        height: renderedHeight,
        zIndex: 2,
        // Selection ring — an outline so it never fights .bl-island's shadow.
        ...(selected
          ? { outline: "2px solid hsl(var(--primary))", outlineOffset: "2px" }
          : {}),
      }}
      onPointerDown={onPointerDown}
    >
      {/* Header — the drag handle. A clear grab strip so the card moves from
          here while the body stays free for typing and content. */}
      <div className="flex h-9 shrink-0 items-center gap-1.5 rounded-t-xl border-b border-border bg-muted/40 px-3">
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <EditableNodeName
          worktreeId={worktreeId}
          nodeId={node.id}
          value={storedLabel}
          placeholder={namePlaceholder}
          updateNode={updateNode}
          className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
          inputClassName="text-[11px] font-medium uppercase tracking-wide text-foreground"
        />
        {typeof node.dataJson.model === "string" && (
          <span className="shrink-0 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
            {node.dataJson.model}
          </span>
        )}
      </div>

      <CanvasHandle
        side="left"
        offset={0.46}
        active={pendingConnection?.handle === "text"}
        label="Prompt input"
        onClick={() => onFinishConnection(node, "prompt")}
      />
      <CanvasHandle
        side="left"
        offset={0.62}
        active={pendingConnection?.handle === "image"}
        label="Reference image input"
        icon={<ImageIcon className="h-3 w-3" />}
        onClick={() => onFinishConnection(node, "referenceImage")}
      />

      <div className="min-h-0 flex-1">
        <div className="flex h-full flex-col gap-3 p-4">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-primary/15 px-3 py-1 text-xs font-semibold text-foreground">
              {typeof node.dataJson.status === "string"
                ? node.dataJson.status
                : "idle"}
            </span>
            <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">
              {typeof node.dataJson.model === "string"
                ? node.dataJson.model
                : "gpt-image-2"}
            </span>
          </div>
          <div className="min-h-0 flex-1 rounded-md border border-border bg-muted/40" />
        </div>
      </div>
    </div>
  )
}

// TextBlockNodeBody — the unified text-box body. It reads as plain text
// on the canvas; a tap on the body drops into an editable textarea, and the
// draft commits on blur. A freshly created empty block opens straight into
// editing. External edits (the agent rewriting the text) flow back while
// unfocused. Edit state is owned by the wrapper so a press-up without drag
// can flip into editing without fighting the outer drag handler's pointer
// capture.
function TextBlockNodeBody({
  worktreeId,
  nodeId,
  data,
  updateNode,
  editing,
  setEditing,
}: {
  worktreeId: string | null
  nodeId: string
  data: Record<string, unknown>
  updateNode: (input: {
    worktreeId: string
    nodeId: string
    data?: Record<string, unknown>
  }) => void
  editing: boolean
  setEditing: (next: boolean) => void
}) {
  const initialText = typeof data.text === "string" ? data.text : ""
  const fontSize = typeof data.fontSize === "number" ? data.fontSize : 18
  const [text, setText] = useState(initialText)
  const focusedRef = useRef(false)

  useEffect(() => {
    if (!focusedRef.current) setText(initialText)
  }, [initialText])

  const commit = () => {
    focusedRef.current = false
    setEditing(false)
    if (!worktreeId || text === initialText) return
    updateNode({ worktreeId, nodeId, data: { text } })
  }

  if (editing) {
    return (
      <textarea
        autoFocus
        data-canvas-text-body
        value={text}
        spellCheck={false}
        placeholder="Write something…"
        onChange={(event) => setText(event.target.value)}
        onFocus={() => {
          focusedRef.current = true
        }}
        onBlur={commit}
        onPointerDown={(event) => event.stopPropagation()}
        style={{ fontSize }}
        className={cn(
          "h-full w-full resize-none overflow-y-auto bg-transparent p-0",
          "font-medium leading-relaxed text-foreground outline-none",
          "placeholder:text-muted-foreground/45",
        )}
      />
    )
  }

  return (
    <div
      data-canvas-text-body
      style={{ fontSize }}
      className={cn(
        "h-full w-full overflow-y-auto whitespace-pre-wrap break-words",
        "font-medium leading-relaxed text-foreground",
      )}
    >
      {text || (
        <span className="text-muted-foreground/45">Click to write…</span>
      )}
    </div>
  )
}

// Description-node colour palette. Named tokens, not raw hex — the canvas
// is themed and "Default" should always match the current foreground.
const DESCRIPTION_COLORS: Array<{ id: string; label: string; cssVar: string }> = [
  { id: "default", label: "Default", cssVar: "hsl(var(--foreground))" },
  { id: "primary", label: "Coral", cssVar: "hsl(var(--primary))" },
  { id: "muted", label: "Muted", cssVar: "hsl(var(--muted-foreground))" },
  { id: "teal", label: "Teal", cssVar: "#79B791" },
  { id: "linen", label: "Linen", cssVar: "#FFF4EA" },
  { id: "ember", label: "Ember", cssVar: "#FF8C42" },
]

function resolveDescriptionColor(id: unknown): string {
  const match = DESCRIPTION_COLORS.find((entry) => entry.id === id)
  return (match ?? DESCRIPTION_COLORS[0]).cssVar
}

// Highlight palette — softer/translucent brand colours that sit behind
// the text without drowning it. `"none"` is the unhighlighted default.
const DESCRIPTION_HIGHLIGHTS: Array<{
  id: string
  label: string
  cssVar: string | null
}> = [
  { id: "none", label: "None", cssVar: null },
  { id: "amber", label: "Amber", cssVar: "rgba(232, 168, 56, 0.55)" },
  { id: "coral", label: "Coral", cssVar: "rgba(242, 97, 87, 0.45)" },
  { id: "teal", label: "Teal", cssVar: "rgba(121, 183, 145, 0.5)" },
  { id: "ember", label: "Ember", cssVar: "rgba(255, 140, 66, 0.45)" },
  { id: "linen", label: "Linen", cssVar: "rgba(255, 244, 234, 0.85)" },
]

function resolveDescriptionHighlight(id: unknown): string | null {
  const match = DESCRIPTION_HIGHLIGHTS.find((entry) => entry.id === id)
  return (match ?? DESCRIPTION_HIGHLIGHTS[0]).cssVar
}

// DescriptionNodeBody — chrome-free editorial text. Renders the saved
// formatting (size, color, weight, slant) in both the read and edit views
// so what you write is what stays on the canvas. Tap to edit, blur to
// commit.
function DescriptionNodeBody({
  worktreeId,
  nodeId,
  data,
  updateNode,
  editing,
  setEditing,
}: {
  worktreeId: string | null
  nodeId: string
  data: Record<string, unknown>
  updateNode: (input: {
    worktreeId: string
    nodeId: string
    data?: Record<string, unknown>
  }) => void
  editing: boolean
  setEditing: (next: boolean) => void
}) {
  const initialText = typeof data.text === "string" ? data.text : ""
  const fontSize = typeof data.fontSize === "number" ? data.fontSize : 22
  const bold = data.bold === true
  const italic = data.italic === true
  const color = resolveDescriptionColor(data.color)
  const highlight = resolveDescriptionHighlight(data.highlight)
  const [text, setText] = useState(initialText)
  const focusedRef = useRef(false)

  useEffect(() => {
    if (!focusedRef.current) setText(initialText)
  }, [initialText])

  const commit = () => {
    focusedRef.current = false
    setEditing(false)
    if (!worktreeId || text === initialText) return
    updateNode({ worktreeId, nodeId, data: { text } })
  }

  const textStyle: CSSProperties = {
    fontSize,
    color,
    fontWeight: bold ? 700 : 500,
    fontStyle: italic ? "italic" : "normal",
    lineHeight: 1.4,
    letterSpacing: "-0.005em",
  }

  if (editing) {
    // In edit mode the highlight lands as a panel behind the textarea
    // (with a hair of padding) so the writer sees the same coloured slab
    // they'll see in read mode, without fighting per-line text-decoration.
    return (
      <textarea
        autoFocus
        data-canvas-text-body
        value={text}
        spellCheck={false}
        placeholder="Write a description…"
        onChange={(event) => setText(event.target.value)}
        onFocus={() => {
          focusedRef.current = true
        }}
        onBlur={commit}
        onPointerDown={(event) => event.stopPropagation()}
        style={{
          ...textStyle,
          ...(highlight
            ? { background: highlight, borderRadius: 4, padding: "2px 4px" }
            : {}),
        }}
        className="h-full w-full resize-none overflow-y-auto bg-transparent p-0 outline-none placeholder:text-muted-foreground/40"
      />
    )
  }

  // Read mode wraps the text in a span so the highlight, when set, hugs
  // the actual lines via `box-decoration-break: clone` — a true
  // highlighter look, not a full-block tint.
  const highlightStyle: CSSProperties = highlight
    ? {
        background: highlight,
        boxDecorationBreak: "clone",
        WebkitBoxDecorationBreak: "clone",
        padding: "2px 6px",
        borderRadius: 4,
        boxShadow: `4px 0 0 ${highlight}, -4px 0 0 ${highlight}`,
      }
    : {}

  return (
    <div
      data-canvas-text-body
      style={textStyle}
      className="h-full w-full overflow-y-auto whitespace-pre-wrap break-words"
    >
      {text ? (
        <span style={highlightStyle}>{text}</span>
      ) : (
        <span className="text-muted-foreground/40" style={{ fontStyle: "italic" }}>
          Click to write a description…
        </span>
      )}
    </div>
  )
}

// DescriptionFormatBar — floats above a selected description node. Houses
// the size steppers, colour swatches, and bold/italic toggles. The bar
// carries `data-canvas-handle` so a press here neither drags the node nor
// starts a marquee selection on the canvas.
function DescriptionFormatBar({
  worktreeId,
  nodeId,
  data,
  updateNode,
}: {
  worktreeId: string | null
  nodeId: string
  data: Record<string, unknown>
  updateNode: (input: {
    worktreeId: string
    nodeId: string
    data?: Record<string, unknown>
  }) => void
}) {
  const fontSize = typeof data.fontSize === "number" ? data.fontSize : 22
  const bold = data.bold === true
  const italic = data.italic === true
  const colorId = typeof data.color === "string" ? data.color : "default"
  const highlightId = typeof data.highlight === "string" ? data.highlight : "none"
  const [openPalette, setOpenPalette] = useState<"none" | "color" | "highlight">(
    "none",
  )
  const activeSwatch =
    DESCRIPTION_COLORS.find((entry) => entry.id === colorId) ?? DESCRIPTION_COLORS[0]
  const activeHighlight =
    DESCRIPTION_HIGHLIGHTS.find((entry) => entry.id === highlightId) ??
    DESCRIPTION_HIGHLIGHTS[0]

  const patch = (next: Record<string, unknown>) => {
    if (!worktreeId) return
    updateNode({ worktreeId, nodeId, data: next })
  }

  const bumpSize = (delta: number) => {
    const next = Math.min(96, Math.max(12, fontSize + delta))
    if (next === fontSize) return
    patch({ fontSize: next })
  }

  return (
    <div
      data-canvas-handle
      onPointerDown={(event) => event.stopPropagation()}
      className={cn(
        "absolute -top-12 left-1/2 z-30 flex -translate-x-1/2 items-center gap-0.5",
        "rounded-xl border border-border/60 bg-background/95 px-1 py-1 shadow-[0_6px_20px_rgba(0,0,0,0.18)] backdrop-blur",
      )}
    >
      <button
        type="button"
        onClick={() => bumpSize(-2)}
        className="press flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-foreground/8 hover:text-foreground"
        title="Smaller text"
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      <span className="min-w-[28px] text-center text-[10px] font-semibold tabular-nums text-muted-foreground">
        {fontSize}
      </span>
      <button
        type="button"
        onClick={() => bumpSize(2)}
        className="press flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-foreground/8 hover:text-foreground"
        title="Larger text"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>

      <span aria-hidden className="mx-1 h-4 w-px bg-foreground/10" />

      <button
        type="button"
        onClick={() => patch({ bold: !bold })}
        className={cn(
          "press flex h-7 w-7 items-center justify-center rounded-md transition-colors",
          bold ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-foreground/8 hover:text-foreground",
        )}
        title="Bold"
      >
        <Bold className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={() => patch({ italic: !italic })}
        className={cn(
          "press flex h-7 w-7 items-center justify-center rounded-md transition-colors",
          italic ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-foreground/8 hover:text-foreground",
        )}
        title="Italic"
      >
        <Italic className="h-3.5 w-3.5" />
      </button>

      <span aria-hidden className="mx-1 h-4 w-px bg-foreground/10" />

      <div className="relative">
        <button
          type="button"
          onClick={() =>
            setOpenPalette((open) => (open === "color" ? "none" : "color"))
          }
          className="press flex h-7 items-center gap-1.5 rounded-md px-1.5 text-muted-foreground hover:bg-foreground/8 hover:text-foreground"
          title="Text colour"
        >
          <span
            aria-hidden
            className="h-3.5 w-3.5 rounded-full border border-foreground/15"
            style={{ background: activeSwatch.cssVar }}
          />
        </button>
        {openPalette === "color" && (
          <div
            data-canvas-handle
            onPointerDown={(event) => event.stopPropagation()}
            className="absolute right-0 top-9 z-40 flex items-center gap-1 rounded-lg border border-border/60 bg-background p-1.5 shadow-[0_8px_24px_rgba(0,0,0,0.2)]"
          >
            {DESCRIPTION_COLORS.map((swatch) => (
              <button
                key={swatch.id}
                type="button"
                onClick={() => {
                  patch({ color: swatch.id })
                  setOpenPalette("none")
                }}
                className={cn(
                  "press flex h-6 w-6 items-center justify-center rounded-full border-2 transition-transform hover:scale-110",
                  swatch.id === colorId ? "border-primary" : "border-transparent",
                )}
                title={swatch.label}
              >
                <span
                  className="h-4 w-4 rounded-full border border-foreground/10"
                  style={{ background: swatch.cssVar }}
                />
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="relative">
        <button
          type="button"
          onClick={() =>
            setOpenPalette((open) =>
              open === "highlight" ? "none" : "highlight",
            )
          }
          className={cn(
            "press relative flex h-7 w-7 items-center justify-center rounded-md transition-colors",
            activeHighlight.cssVar
              ? "text-foreground"
              : "text-muted-foreground hover:bg-foreground/8 hover:text-foreground",
          )}
          title="Highlight"
        >
          <Highlighter className="h-3.5 w-3.5" />
          <span
            aria-hidden
            className="absolute bottom-0.5 left-1/2 h-[3px] w-3.5 -translate-x-1/2 rounded-full"
            style={{
              background:
                activeHighlight.cssVar ?? "hsl(var(--muted-foreground) / 0.35)",
            }}
          />
        </button>
        {openPalette === "highlight" && (
          <div
            data-canvas-handle
            onPointerDown={(event) => event.stopPropagation()}
            className="absolute right-0 top-9 z-40 flex items-center gap-1 rounded-lg border border-border/60 bg-background p-1.5 shadow-[0_8px_24px_rgba(0,0,0,0.2)]"
          >
            {DESCRIPTION_HIGHLIGHTS.map((swatch) => (
              <button
                key={swatch.id}
                type="button"
                onClick={() => {
                  patch({ highlight: swatch.id })
                  setOpenPalette("none")
                }}
                className={cn(
                  "press flex h-6 w-6 items-center justify-center rounded-md border-2 transition-transform hover:scale-110",
                  swatch.id === highlightId ? "border-primary" : "border-transparent",
                )}
                title={swatch.label}
              >
                {swatch.cssVar ? (
                  <span
                    className="h-4 w-4 rounded-sm border border-foreground/10"
                    style={{ background: swatch.cssVar }}
                  />
                ) : (
                  <span className="relative h-4 w-4 rounded-sm border border-foreground/15 bg-background">
                    <span
                      aria-hidden
                      className="absolute left-1/2 top-1/2 h-[1.5px] w-4 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-full bg-foreground/40"
                    />
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// EditableNodeName — the small editable title shown above (or atop) every
// canvas node. Click on the value to rename, Enter to commit, Escape to
// cancel, blur to commit. Placeholder is the type's default label; while
// the value is empty AND the user isn't editing it, the placeholder is
// rendered in a muted tone so the asset still has a recognizable title.
function EditableNodeName({
  worktreeId,
  nodeId,
  value,
  placeholder,
  updateNode,
  className,
  inputClassName,
}: {
  worktreeId: string | null
  nodeId: string
  value: string
  placeholder: string
  updateNode: (input: {
    worktreeId: string
    nodeId: string
    data?: Record<string, unknown>
  }) => void
  className?: string
  inputClassName?: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const focusedRef = useRef(false)

  useEffect(() => {
    if (!focusedRef.current) setDraft(value)
  }, [value])

  const commit = () => {
    focusedRef.current = false
    setEditing(false)
    if (!worktreeId) return
    const next = draft.trim()
    if (next === value) return
    updateNode({ worktreeId, nodeId, data: { label: next } })
  }

  if (editing) {
    return (
      <input
        autoFocus
        data-canvas-handle
        value={draft}
        spellCheck={false}
        placeholder={placeholder}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={() => {
          focusedRef.current = true
        }}
        onBlur={commit}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault()
            commit()
          } else if (event.key === "Escape") {
            event.preventDefault()
            setDraft(value)
            setEditing(false)
            focusedRef.current = false
          }
        }}
        className={cn(
          "min-w-0 flex-1 bg-transparent outline-none ring-1 ring-primary/40 rounded px-1 -mx-1",
          inputClassName,
        )}
      />
    )
  }

  return (
    <button
      type="button"
      data-canvas-handle
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation()
        setDraft(value)
        setEditing(true)
      }}
      title="Click to rename"
      className={cn(
        "press min-w-0 flex-1 truncate text-left rounded px-1 -mx-1 hover:bg-foreground/[0.06]",
        !value && "italic text-muted-foreground/60",
        className,
      )}
    >
      {value || placeholder}
    </button>
  )
}

// CanvasResizeHandle — the corner grip shown on a selected node. It carries
// `data-canvas-handle` so a press here resizes instead of starting a drag.
function CanvasResizeHandle({
  onPointerDown,
}: {
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void
}) {
  return (
    <div
      data-canvas-handle
      onPointerDown={onPointerDown}
      className={cn(
        "absolute -bottom-1.5 -right-1.5 z-20 h-3 w-3 cursor-nwse-resize",
        "rounded-[3px] border border-primary bg-background shadow-sm",
      )}
      title="Resize"
    />
  )
}

function CanvasHandle({
  side,
  offset = 0.5,
  active,
  label,
  icon,
  onClick,
}: {
  side: "left" | "right"
  offset?: number
  active?: boolean
  label: string
  icon?: ReactNode
  onClick: () => void
}) {
  return (
    <button
      data-canvas-handle
      type="button"
      onPointerDown={(event) => {
        event.stopPropagation()
      }}
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
      className={cn(
        "press absolute z-20 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border text-[11px] font-semibold shadow-md",
        "border-border bg-foreground text-background",
        "hover:border-primary hover:bg-primary hover:text-primary-foreground",
        active && "border-primary bg-primary text-primary-foreground ring-2 ring-primary/35",
        side === "left" ? "-left-3.5" : "-right-3.5",
      )}
      style={{ top: `${offset * 100}%` }}
      title={label}
      aria-label={label}
    >
      {icon ?? <span>T</span>}
    </button>
  )
}

function CanvasEdges({
  edges,
  nodesById,
  pendingConnection,
  pointerWorld,
}: {
  edges: CanvasEdgeView[]
  nodesById: Map<string, CanvasNodeView>
  pendingConnection: PendingConnection | null
  pointerWorld: { x: number; y: number } | null
}) {
  return (
    <svg
      className="pointer-events-none absolute left-0 top-0 z-[1] h-[4000px] w-[4000px] overflow-visible"
      width={4000}
      height={4000}
    >
      {edges.map((edge) => {
        const source = nodesById.get(edge.sourceNodeId)
        const target = nodesById.get(edge.targetNodeId)
        if (!source || !target) return null
        const start = outputPoint(source)
        const end = inputPoint(target, edge.targetHandle)
        return (
          <path
            key={edge.id}
            d={bezierPath(start, end)}
            fill="none"
            stroke={EDGE_COLOR}
            strokeWidth={2}
            strokeLinecap="round"
            opacity={0.85}
          />
        )
      })}
      {pendingConnection && pointerWorld && (
        <path
          d={bezierPath(pendingConnection.point, pointerWorld)}
          fill="none"
          stroke={EDGE_COLOR}
          strokeWidth={2}
          strokeDasharray="7 7"
          strokeLinecap="round"
          opacity={0.6}
        />
      )}
    </svg>
  )
}

function outputPoint(node: CanvasNodeView): { x: number; y: number } {
  return { x: node.x + node.width, y: node.y + node.height / 2 }
}

function inputPoint(
  node: CanvasNodeView,
  targetHandle: string,
): { x: number; y: number } {
  const offset = targetHandle === "referenceImage" ? 0.62 : 0.46
  return { x: node.x, y: node.y + node.height * offset }
}

function bezierPath(
  start: { x: number; y: number },
  end: { x: number; y: number },
): string {
  const distance = Math.max(120, Math.abs(end.x - start.x) * 0.5)
  return `M ${start.x} ${start.y} C ${start.x + distance} ${start.y}, ${end.x - distance} ${end.y}, ${end.x} ${end.y}`
}

function screenToWorld(
  point: { x: number; y: number },
  viewport: Viewport,
): { x: number; y: number } {
  return {
    x: (point.x - viewport.x) / viewport.zoom,
    y: (point.y - viewport.y) / viewport.zoom,
  }
}

function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(value.toFixed(2))))
}
