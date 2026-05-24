"use client"

/**
 * AssetPreviewPane — the center surface for an image or video asset.
 *
 * Screenwriting projects accumulate reference stills, character plates,
 * and AI-generated clips alongside the prose. When the writer clicks one
 * in the project tree it opens here: the media floats on the ambient
 * canvas inside a soft frame, with a liquid-glass toolbar carrying its
 * name, dimensions, and quick actions. Expand blows it up to a
 * full-window lightbox.
 *
 * Media streams off disk over the `lani-asset://` protocol — no
 * base64, no size cap — so a 40 MB clip scrubs smoothly.
 */

import { useCallback, useEffect, useState } from "react"
import type { CSSProperties, ReactNode } from "react"
import { useAtomValue } from "jotai"
import {
  AlertCircle,
  ExternalLink,
  FolderOpen,
  ImageIcon,
  Loader2,
  Maximize2,
  Video as VideoIcon,
  X,
} from "lucide-react"
import { GlassFilter } from "../../components/ui/liquid-glass-filter"
import { trpc } from "../../lib/trpc"
import { cn } from "../../lib/utils"
import { selectedAgentChatIdAtom, selectedProjectAtom } from "../agents/atoms"
import { activeEntityAtom, type ActiveEntity } from "./atoms"

type EntityRoot = { chatId: string } | { projectId: string }
type MediaEntity = Extract<NonNullable<ActiveEntity>, { kind: "image" | "video" }>
type MediaMeta = { width: number; height: number; duration?: number }

// Liquid-glass refraction — the same SVG displacement filter the canvas
// mode dock uses, layered over a frosted blur.
const liquidGlassStyle: CSSProperties = {
  backdropFilter: "url(#bl-glass-displace) blur(8px) saturate(160%)",
  WebkitBackdropFilter: "url(#bl-glass-displace) blur(8px) saturate(160%)",
}

/** Build a streaming URL for the lani-asset:// protocol. */
function assetUrl(absPath: string): string {
  return `lani-asset://asset/?p=${encodeURIComponent(absPath)}`
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return ""
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, "0")}`
}

export function AssetPreviewPane() {
  const active = useAtomValue(activeEntityAtom)
  const chatId = useAtomValue(selectedAgentChatIdAtom)
  const selectedProject = useAtomValue(selectedProjectAtom)

  if (!active || (active.kind !== "image" && active.kind !== "video")) {
    return null
  }

  const entityRoot: EntityRoot | null = chatId
    ? { chatId }
    : selectedProject?.id
      ? { projectId: selectedProject.id }
      : null

  if (!entityRoot) {
    return (
      <CenteredState
        label="No project"
        body="Pick a project to open this asset."
        icon={<AlertCircle className="h-9 w-9 text-muted-foreground/70" />}
      />
    )
  }

  return (
    <AssetPreviewInner
      key={`${"chatId" in entityRoot ? entityRoot.chatId : entityRoot.projectId}:${active.path}`}
      active={active}
      entityRoot={entityRoot}
    />
  )
}

function AssetPreviewInner({
  active,
  entityRoot,
}: {
  active: MediaEntity
  entityRoot: EntityRoot
}) {
  const resolved = trpc.entities.resolvePath.useQuery(
    { ...entityRoot, entityPath: active.path },
    { staleTime: 60_000 },
  )
  const openInFinder = trpc.external.openInFinder.useMutation()
  const openPath = trpc.external.openPath.useMutation()

  const [meta, setMeta] = useState<MediaMeta | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const [expanded, setExpanded] = useState(false)

  // Esc leaves the lightbox.
  useEffect(() => {
    if (!expanded) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        setExpanded(false)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [expanded])

  const absPath = resolved.data?.absPath ?? null
  const url = absPath ? assetUrl(absPath) : null
  const fileName = active.path.split("/").pop() ?? active.label
  const isVideo = active.kind === "video"

  const handleReveal = useCallback(() => {
    if (absPath) openInFinder.mutate(absPath)
  }, [absPath, openInFinder])

  const handleOpenExternal = useCallback(() => {
    if (absPath) openPath.mutate(absPath)
  }, [absPath, openPath])

  const dimText = meta ? `${meta.width} × ${meta.height}` : null
  const durationText =
    meta?.duration != null ? formatDuration(meta.duration) : null
  const canExpand = !!url && loaded && !failed

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden">
      <GlassFilter />

      {/* Stage — the media floats on the ambient canvas. Padding clears
          the floating toolbar (top) and the workflow mode dock (bottom). */}
      <div className="flex min-h-0 flex-1 items-center justify-center px-8 pb-24 pt-20">
        {resolved.isPending ? (
          <SkeletonFrame label="Resolving asset…" />
        ) : !resolved.data?.exists || !url ? (
          <CenteredState
            label="Missing"
            body="This file is no longer on disk."
            icon={<AlertCircle className="h-9 w-9 text-muted-foreground/70" />}
          />
        ) : failed ? (
          <CenteredState
            label="Could not load"
            body={`Lani couldn't open ${fileName}.`}
            icon={<AlertCircle className="h-9 w-9 text-muted-foreground/70" />}
          />
        ) : (
          <div className="relative flex h-full w-full min-h-0 items-center justify-center">
            {!loaded && (
              <SkeletonFrame label={isVideo ? "Loading video…" : "Loading image…"} />
            )}
            <MediaFrame
              url={url}
              isVideo={isVideo}
              fileName={fileName}
              controls={isVideo}
              loaded={loaded}
              onExpand={isVideo ? undefined : () => setExpanded(true)}
              onMeta={setMeta}
              onLoaded={() => setLoaded(true)}
              onError={() => setFailed(true)}
            />
          </div>
        )}
      </div>

      {/* Liquid-glass toolbar — floats at the top of the pane. */}
      <div className="pointer-events-none absolute inset-x-0 top-4 flex justify-center px-4">
        <div
          className="bl-liquid-glass pointer-events-auto flex max-w-full items-center gap-2.5 rounded-full py-1.5 pl-2.5 pr-1.5"
          style={liquidGlassStyle}
        >
          <span
            className="flex items-center gap-1.5 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-primary"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {isVideo ? (
              <VideoIcon className="h-3 w-3" />
            ) : (
              <ImageIcon className="h-3 w-3" />
            )}
            {isVideo ? "Video" : "Image"}
          </span>

          <span
            className="max-w-[28ch] truncate text-[13px] font-medium text-foreground"
            title={active.path}
          >
            {fileName}
          </span>

          {(dimText || durationText) && (
            <span
              className="hidden shrink-0 items-center gap-2 text-[11px] text-muted-foreground sm:flex"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              <span className="h-3 w-px bg-foreground/15" />
              {dimText && <span>{dimText}</span>}
              {durationText && <span>{durationText}</span>}
            </span>
          )}

          <span className="h-4 w-px shrink-0 bg-foreground/12" />

          <div className="flex shrink-0 items-center gap-0.5">
            <ToolbarButton
              label="Expand"
              onClick={() => setExpanded(true)}
              disabled={!canExpand}
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </ToolbarButton>
            <ToolbarButton
              label={isVideo ? "Open in player" : "Open in default app"}
              onClick={handleOpenExternal}
              disabled={!absPath}
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </ToolbarButton>
            <ToolbarButton
              label="Reveal in Finder"
              onClick={handleReveal}
              disabled={!absPath}
            >
              <FolderOpen className="h-3.5 w-3.5" />
            </ToolbarButton>
          </div>
        </div>
      </div>

      {/* Lightbox — full-window blow-up. */}
      {expanded && url && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${fileName} preview`}
          onClick={() => setExpanded(false)}
          className="fixed inset-0 z-[120] flex items-center justify-center bg-[hsl(0_0%_3%/0.92)] p-12 backdrop-blur-2xl"
        >
          <button
            type="button"
            aria-label="Close preview"
            onClick={() => setExpanded(false)}
            className="bl-liquid-glass absolute right-5 top-5 grid h-9 w-9 cursor-pointer place-items-center rounded-full text-foreground/80 transition-colors duration-150 hover:text-foreground"
            style={liquidGlassStyle}
          >
            <X className="h-4 w-4" />
          </button>
          <div
            onClick={(e) => e.stopPropagation()}
            className="overflow-hidden rounded-2xl ring-1 ring-white/10"
          >
            {isVideo ? (
              <video
                src={url}
                controls
                autoPlay
                playsInline
                className="block max-h-[calc(100vh-6rem)] max-w-[calc(100vw-6rem)]"
              />
            ) : (
              <img
                src={url}
                alt={fileName}
                className="block max-h-[calc(100vh-6rem)] max-w-[calc(100vw-6rem)] object-contain"
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * The framed media element. While loading it sits invisibly on top of
 * the SkeletonFrame (so it can fetch); once loaded it becomes the sized,
 * visible element and the skeleton unmounts.
 */
function MediaFrame({
  url,
  isVideo,
  fileName,
  controls,
  loaded,
  onExpand,
  onMeta,
  onLoaded,
  onError,
}: {
  url: string
  isVideo: boolean
  fileName: string
  controls: boolean
  loaded: boolean
  onExpand?: () => void
  onMeta: (m: MediaMeta) => void
  onLoaded: () => void
  onError: () => void
}) {
  // Fit the media inside the stage box (which is already padded to clear
  // the toolbar + mode dock). max-h/max-w-full keeps any aspect ratio —
  // tall portrait clips and wide stills both stay fully visible.
  const visibleCls = cn(
    "relative block max-h-full max-w-full object-contain rounded-2xl",
    "ring-1 ring-foreground/10",
    "shadow-[0_28px_70px_-28px_rgba(0,0,0,0.6)]",
    "transition-[box-shadow] duration-200",
  )
  const hiddenCls = "pointer-events-none absolute inset-0 h-full w-full opacity-0"

  if (isVideo) {
    return (
      <video
        src={url}
        controls={controls}
        playsInline
        preload="metadata"
        className={loaded ? visibleCls : hiddenCls}
        onLoadedMetadata={(e) => {
          const v = e.currentTarget
          onMeta({
            width: v.videoWidth,
            height: v.videoHeight,
            duration: v.duration,
          })
          onLoaded()
        }}
        onError={(e) => {
          const err = e.currentTarget.error
          console.error(
            "[asset-preview] video load failed",
            url,
            "code:",
            err?.code,
            "message:",
            err?.message,
          )
          onError()
        }}
      />
    )
  }

  return (
    <img
      src={url}
      alt={fileName}
      onClick={onExpand}
      className={cn(
        loaded
          ? cn(
              visibleCls,
              onExpand &&
                "cursor-zoom-in hover:shadow-[0_34px_84px_-26px_rgba(0,0,0,0.72)]",
            )
          : hiddenCls,
      )}
      onLoad={(e) => {
        const img = e.currentTarget
        onMeta({ width: img.naturalWidth, height: img.naturalHeight })
        onLoaded()
      }}
      onError={() => {
        console.error("[asset-preview] image load failed", url)
        onError()
      }}
    />
  )
}

function SkeletonFrame({ label }: { label: string }) {
  return (
    <div
      className={cn(
        "flex aspect-video max-h-full w-[min(72vw,820px)] flex-col items-center justify-center gap-3",
        "rounded-2xl bg-foreground/[0.03] ring-1 ring-foreground/10",
        "shadow-[0_28px_70px_-28px_rgba(0,0,0,0.5)]",
      )}
    >
      <Loader2 className="h-7 w-7 animate-spin text-muted-foreground/55" />
      <span
        className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground/55"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {label}
      </span>
    </div>
  )
}

function ToolbarButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        "grid h-7 w-7 place-items-center rounded-full text-foreground/65",
        "transition-colors duration-150",
        "hover:bg-foreground/10 hover:text-foreground",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        "disabled:pointer-events-none disabled:opacity-40",
        !disabled && "cursor-pointer",
      )}
    >
      {children}
    </button>
  )
}

function CenteredState({
  label,
  body,
  icon,
}: {
  label: string
  body: string
  icon?: ReactNode
}) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-center">
        {icon}
        <span
          className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground/55"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {label}
        </span>
        <p
          className="max-w-[340px] text-[15px] leading-[1.4] text-foreground/70"
          style={{ fontFamily: "var(--font-display)", fontWeight: 500 }}
        >
          {body}
        </p>
      </div>
    </div>
  )
}
