"use client"

/**
 * ProjectTreeRail — the left-side hierarchy navigator.
 *
 *    World · Characters · Locations · Scenes (with nested Shots)
 *
 * Reads the project structure from `trpc.entities.list({ chatId })` — a
 * pure filesystem walk on the active chat's worktree. Click any entity →
 * `activeEntityAtom` updates, the screenplay center pane (and chat
 * context) react to load that entity's artifact.
 *
 * When the worktree hasn't been bootstrapped to the new hierarchy yet,
 * the rail shows an empty-state CTA that calls `entities.bootstrap` to
 * scaffold the folder structure with placeholder content + READMEs.
 */

import { useAtom, useAtomValue } from "jotai"
import {
  Book,
  ChevronDown,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Clapperboard,
  FileText,
  Film,
  Globe2,
  MapPin,
  Plus,
  Sparkles,
  User,
} from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { trpc } from "../../lib/trpc"
import { cn } from "../../lib/utils"
import { selectedAgentChatIdAtom } from "../agents/atoms"
import { activeEntityAtom, projectTreeOpenAtom, type ActiveEntity } from "./atoms"

const RAIL_WIDTH = 240

export function ProjectTreeRail() {
  const [open, setOpen] = useAtom(projectTreeOpenAtom)

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "shrink-0 flex flex-col items-center justify-start py-3 gap-2",
          "w-7 border-r border-border bg-card/30",
          "text-muted-foreground hover:text-foreground hover:bg-card/60",
          "transition-colors",
        )}
        title="Show project tree"
        aria-label="Show project tree"
      >
        <Clapperboard className="h-4 w-4" />
        <span
          className="text-[10px] uppercase tracking-[0.18em] font-mono"
          style={{ writingMode: "vertical-rl" }}
        >
          Project
        </span>
        <ChevronsRight className="h-3 w-3" />
      </button>
    )
  }

  return (
    <aside
      className="shrink-0 border-r border-border bg-card/30 flex flex-col"
      style={{ width: RAIL_WIDTH }}
    >
      {/* Rail header */}
      <div className="flex items-center justify-between h-9 px-3 border-b border-border bg-card/40 select-none shrink-0">
        <div className="flex items-center gap-2">
          <Clapperboard className="h-3 w-3 text-muted-foreground" />
          <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 font-mono">
            Project
          </span>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-muted-foreground hover:text-foreground transition-colors"
          title="Hide project tree"
          aria-label="Hide project tree"
        >
          <ChevronsLeft className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        <ProjectTreeContent />
      </div>
    </aside>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Content — separate component so we can suspense-style return early
// without re-running the rail header.
// ────────────────────────────────────────────────────────────────────────

function ProjectTreeContent() {
  const chatId = useAtomValue(selectedAgentChatIdAtom)

  const tree = trpc.entities.list.useQuery(
    { chatId: chatId ?? "" },
    {
      enabled: !!chatId,
      refetchInterval: 5000,
      refetchOnWindowFocus: true,
    },
  )
  const bootstrap = trpc.entities.bootstrap.useMutation({
    onSuccess: (res) => {
      tree.refetch()
      toast.success(
        res.count > 0
          ? `Created ${res.count} starter file${res.count === 1 ? "" : "s"}.`
          : "Project structure already in place.",
      )
    },
    onError: (err) => {
      toast.error(err.message || "Couldn't bootstrap the project.")
    },
  })

  if (!chatId) {
    return (
      <div className="p-4 text-xs text-muted-foreground">
        Open a chat to see its project structure.
      </div>
    )
  }
  if (tree.isPending) {
    return (
      <div className="p-4 text-xs text-muted-foreground">Loading…</div>
    )
  }
  const data = tree.data
  if (!data) {
    return (
      <div className="p-4 text-xs text-muted-foreground">
        Couldn't read this project's structure.
      </div>
    )
  }

  if (!data.bootstrapped) {
    return (
      <EmptyState
        onBootstrap={() => bootstrap.mutate({ chatId })}
        isPending={bootstrap.isPending}
      />
    )
  }

  return (
    <div className="py-2">
      <WorldRow exists={data.world.exists} />
      <SectionGroup
        icon={User}
        label="Characters"
        empty="No characters yet"
        items={data.characters.map((c) => ({
          id: c.id,
          label: c.label,
          entity: { kind: "character", id: c.id, label: c.label, path: c.path } as ActiveEntity,
        }))}
      />
      <SectionGroup
        icon={MapPin}
        label="Locations"
        empty="No locations yet"
        items={data.locations.map((l) => ({
          id: l.id,
          label: l.label,
          entity: { kind: "location", id: l.id, label: l.label, path: l.path } as ActiveEntity,
        }))}
      />
      <ScenesGroup scenes={data.scenes} />
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Empty state — shown when the worktree hasn't been bootstrapped.
// ────────────────────────────────────────────────────────────────────────

function EmptyState({
  onBootstrap,
  isPending,
}: {
  onBootstrap: () => void
  isPending: boolean
}) {
  return (
    <div className="p-4 flex flex-col gap-3 text-xs">
      <div className="text-muted-foreground leading-relaxed">
        This project doesn't have the screenwriter structure yet. Bootstrap
        it to add a world bible, characters, locations, and scene folders —
        each one editable by you and the agent.
      </div>
      <button
        type="button"
        onClick={onBootstrap}
        disabled={isPending}
        className={cn(
          "flex items-center justify-center gap-1.5 px-3 py-2 rounded-md",
          "bg-primary text-primary-foreground hover:opacity-90",
          "text-xs font-medium transition-opacity",
          "disabled:opacity-50 disabled:cursor-progress",
        )}
      >
        {isPending ? (
          <Sparkles className="h-3.5 w-3.5 animate-pulse" />
        ) : (
          <Plus className="h-3.5 w-3.5" />
        )}
        Set up screenwriter project
      </button>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Single-entity rows + section groups
// ────────────────────────────────────────────────────────────────────────

function WorldRow({ exists }: { exists: boolean }) {
  const [active, setActive] = useAtom(activeEntityAtom)
  const isActive = active?.kind === "world"
  return (
    <button
      type="button"
      onClick={() =>
        setActive({ kind: "world", path: "world.md" } as ActiveEntity)
      }
      className={cn(
        "w-full flex items-center gap-2 px-3 py-1.5 text-xs",
        "transition-colors",
        isActive
          ? "bg-primary/10 text-foreground font-medium"
          : "text-foreground/85 hover:bg-secondary/50",
      )}
      title="World bible — art-direction spine of the project"
    >
      <Globe2 className="h-3.5 w-3.5 text-primary/80 shrink-0" />
      <span className="truncate flex-1 text-left">World</span>
      {!exists && (
        <span className="text-[9px] uppercase tracking-wider text-muted-foreground/60 font-mono">
          empty
        </span>
      )}
    </button>
  )
}

interface SectionItem {
  id: string
  label: string
  entity: ActiveEntity
}

function SectionGroup({
  icon: Icon,
  label,
  items,
  empty,
}: {
  icon: typeof User
  label: string
  items: SectionItem[]
  empty: string
}) {
  const [collapsed, setCollapsed] = useState(false)
  const [active, setActive] = useAtom(activeEntityAtom)
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className={cn(
          "w-full flex items-center gap-1.5 px-3 py-1",
          "text-[10px] uppercase tracking-[0.14em] font-mono",
          "text-muted-foreground/70 hover:text-foreground/80 transition-colors",
        )}
      >
        {collapsed ? (
          <ChevronRight className="h-3 w-3" />
        ) : (
          <ChevronDown className="h-3 w-3" />
        )}
        <Icon className="h-3 w-3" />
        <span className="flex-1 text-left">{label}</span>
        <span className="text-[9px] tabular-nums text-muted-foreground/50">
          {items.length}
        </span>
      </button>
      {!collapsed && (
        <>
          {items.length === 0 ? (
            <div className="px-3 py-1.5 text-[11px] text-muted-foreground/60 italic pl-9">
              {empty}
            </div>
          ) : (
            items.map((it) => {
              const isActive = active?.path === it.entity?.path
              return (
                <button
                  key={it.id}
                  type="button"
                  onClick={() => setActive(it.entity)}
                  className={cn(
                    "w-full flex items-center gap-2 pl-9 pr-3 py-1 text-xs",
                    "transition-colors",
                    isActive
                      ? "bg-primary/10 text-foreground font-medium"
                      : "text-foreground/80 hover:bg-secondary/50",
                  )}
                  title={it.label}
                >
                  <span className="truncate flex-1 text-left">{it.label}</span>
                </button>
              )
            })
          )}
        </>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Scenes (with nested shots)
// ────────────────────────────────────────────────────────────────────────

interface SceneNode {
  id: string
  label: string
  order: number | null
  scriptPath: string
  shots: { id: string; label: string; path: string }[]
}

function ScenesGroup({ scenes }: { scenes: SceneNode[] }) {
  const [collapsed, setCollapsed] = useState(false)
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className={cn(
          "w-full flex items-center gap-1.5 px-3 py-1",
          "text-[10px] uppercase tracking-[0.14em] font-mono",
          "text-muted-foreground/70 hover:text-foreground/80 transition-colors",
        )}
      >
        {collapsed ? (
          <ChevronRight className="h-3 w-3" />
        ) : (
          <ChevronDown className="h-3 w-3" />
        )}
        <Film className="h-3 w-3" />
        <span className="flex-1 text-left">Scenes</span>
        <span className="text-[9px] tabular-nums text-muted-foreground/50">
          {scenes.length}
        </span>
      </button>
      {!collapsed &&
        (scenes.length === 0 ? (
          <div className="px-3 py-1.5 text-[11px] text-muted-foreground/60 italic pl-9">
            No scenes yet
          </div>
        ) : (
          scenes.map((s) => <SceneRow key={s.id} scene={s} />)
        ))}
    </div>
  )
}

function SceneRow({ scene }: { scene: SceneNode }) {
  const [collapsed, setCollapsed] = useState(false)
  const [active, setActive] = useAtom(activeEntityAtom)
  const isActive = active?.path === scene.scriptPath

  return (
    <div>
      <div
        className={cn(
          "group flex items-center gap-1 pl-5 pr-2 text-xs",
          "transition-colors",
          isActive
            ? "bg-primary/10 text-foreground font-medium"
            : "text-foreground/85 hover:bg-secondary/50",
        )}
      >
        {scene.shots.length > 0 ? (
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="text-muted-foreground/70 hover:text-foreground p-0.5"
            aria-label={collapsed ? "Expand shots" : "Collapse shots"}
          >
            {collapsed ? (
              <ChevronRight className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            )}
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <button
          type="button"
          onClick={() =>
            setActive({
              kind: "scene",
              id: scene.id,
              label: scene.label,
              path: scene.scriptPath,
            } as ActiveEntity)
          }
          className="flex items-center gap-2 flex-1 py-1 text-left min-w-0"
          title={scene.label}
        >
          <FileText className="h-3.5 w-3.5 text-muted-foreground/80 shrink-0" />
          {scene.order != null && (
            <span className="text-muted-foreground/60 font-mono tabular-nums text-[10px] shrink-0">
              {String(scene.order).padStart(2, "0")}
            </span>
          )}
          <span className="truncate flex-1">{scene.label}</span>
        </button>
      </div>
      {!collapsed &&
        scene.shots.map((sh) => {
          const isShotActive = active?.path === sh.path
          return (
            <button
              key={sh.id}
              type="button"
              onClick={() =>
                setActive({
                  kind: "shot",
                  sceneId: scene.id,
                  id: sh.id,
                  label: sh.label,
                  path: sh.path,
                } as ActiveEntity)
              }
              className={cn(
                "w-full flex items-center gap-2 pl-12 pr-3 py-0.5 text-[11px]",
                "transition-colors",
                isShotActive
                  ? "bg-primary/10 text-foreground font-medium"
                  : "text-foreground/70 hover:bg-secondary/50",
              )}
              title={sh.label}
            >
              <Book className="h-3 w-3 text-muted-foreground/60 shrink-0" />
              <span className="truncate flex-1 text-left">{sh.label}</span>
            </button>
          )
        })}
    </div>
  )
}
