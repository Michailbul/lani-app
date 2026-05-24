"use client"

/**
 * ProjectTreeRail — left-side navigator.
 *
 * Editorial treatment: scenes get the typographic spotlight (Darker
 * Grotesque title, scene number in mono). Entities (characters,
 * locations, world) live in collapsible sub-sections with restrained
 * mono labels.
 *
 * Resizable horizontally via the right-edge handle (180–420 px clamp,
 * persisted in `projectTreeWidthAtom`).
 */

import { useAtom, useAtomValue } from "jotai"
import {
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Globe2,
  Layers,
  MapPin,
  Plus,
  Sparkles,
  User,
} from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import {
  selectedAgentChatIdAtom,
  selectedProjectAtom,
} from "../agents/atoms"
import { trpc } from "../../lib/trpc"
import { cn } from "../../lib/utils"
import {
  agentsSidebarOpenAtom,
  isDesktopAtom,
  isFullscreenAtom,
} from "../../lib/atoms"
import {
  activeEntityAtom,
  projectTreeOpenAtom,
  projectTreeWidthAtom,
  viewModeAtom,
  type ActiveEntity,
} from "./atoms"
import { ProjectFileTree } from "./project-file-tree"
import { SkillExplorer } from "./skill-explorer"
import { Resizer } from "./resizer"

// ────────────────────────────────────────────────────────────────────────
// Slug + templates — kept inline so the create flow doesn't need its own
// shared module. Each new entity file gets a starter template the agent
// can extend; the user can also type into them directly.
// ────────────────────────────────────────────────────────────────────────

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip accents
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 64)
}

function characterTemplate(label: string): string {
  return `# ${label}

The lock for this character — the canonical description that every
prompt referencing them pastes verbatim.

## Identity

(Age, build, distinguishing features. Lock the visual so the model
returns the same person across all prompts.)

## Voice + personality

(How they speak. What they want. What they hide.)

## Wardrobe

(Default outfit, variations per scene if any.)

## Reference images

(Filenames inside assets/refs/, or leave blank.)
`
}

function locationTemplate(label: string): string {
  return `# ${label}

Reference card for this place.

## Description

(Where is it? What does it look like? One paragraph.)

## Time of day variants

(Dawn / day / dusk / night.)

## Lighting setup

(Key light direction, intensity, colour temperature, atmosphere.)

## Reference images

(Filenames inside assets/refs/, or leave blank.)
`
}

function sceneTemplate(label: string): string {
  return `INT. ${label.toUpperCase()} - DAY

(Action / dialogue starts here.)
`
}

const MIN_WIDTH = 200
const MAX_WIDTH = 420

// Match the projects sidebar island metrics so the native macOS traffic
// lights keep the same visual relationship when this rail becomes the
// window's left-most panel.
const FILE_RAIL_TRAFFIC_LIGHT_POSITION = { x: 19, y: 20 }

export function ProjectTreeRail() {
  const open = useAtomValue(projectTreeOpenAtom)
  const sidebarOpen = useAtomValue(agentsSidebarOpenAtom)
  const isDesktop = useAtomValue(isDesktopAtom)
  const isFullscreen = useAtomValue(isFullscreenAtom)
  const [width, setWidth] = useAtom(projectTreeWidthAtom)

  // This rail is the window's left-most panel — so the native traffic
  // lights land on it — only when it's visible and the projects sidebar
  // is collapsed.
  const trafficLightInset =
    open && isDesktop && !isFullscreen && !sidebarOpen

  // Move the native traffic lights to suit this rail's chrome while it
  // owns the left-most slot; restore the default position otherwise.
  useEffect(() => {
    window.desktopApi?.setTrafficLightPosition?.(
      trafficLightInset ? FILE_RAIL_TRAFFIC_LIGHT_POSITION : null,
    )
    return () => {
      window.desktopApi?.setTrafficLightPosition?.(null)
    }
  }, [trafficLightInset])

  // Collapsed — render nothing. The file-explorer toggle lives in the
  // top navbar (IDE-style); the rail carries no collapse chrome itself.
  if (!open) return null

  return (
    <div className="relative flex shrink-0 h-full">
      <aside
        className="relative flex flex-col bl-island rounded-xl overflow-hidden"
        style={{ width }}
      >
        <div className="flex-1 min-h-0 overflow-auto">
          <ProjectTreeContent trafficLightInset={trafficLightInset} />
        </div>
      </aside>

      <Resizer
        axis="x"
        bare
        onResize={(d) => setWidth((w) => Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, w + d)))}
      />
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Content
// ────────────────────────────────────────────────────────────────────────

function ProjectTreeContent({
  trafficLightInset,
}: {
  trafficLightInset: boolean
}) {
  const viewMode = useAtomValue(viewModeAtom)

  // Skill Workbench mode swaps the project file tree for the skill
  // explorer — the rail then browses the skills Lani can edit,
  // not the writer's worktree.
  if (viewMode === "skill") {
    return <SkillExplorer />
  }

  // ProjectFileTree handles its own root resolution: it reads the
  // selected chat's worktree when a chat is active, otherwise it falls
  // back to the canonical project root. The tree shows files in both
  // modes — there's no "open a chat first" gate. When no project is
  // selected at all, ProjectFileTree renders its own empty state.
  return <ProjectFileTree trafficLightInset={trafficLightInset} />
}

// ────────────────────────────────────────────────────────────────────────
// Scenes — the editorial centerpiece.
// ────────────────────────────────────────────────────────────────────────

interface SceneNode {
  id: string
  label: string
  order: number | null
  scriptPath: string
  shots: { id: string; label: string; path: string }[]
}

/**
 * SingletonRow — a top-level entity that has exactly one file (Brief,
 * World, Main script). Always rendered; "empty" badge when the file
 * doesn't exist yet. Click → activeEntity, EntityEditor opens with
 * a Create-starter button if the file is missing.
 */
function SingletonRow({
  icon: Icon,
  label,
  kind,
  path,
  exists,
}: {
  icon: typeof BookOpen
  label: string
  kind: "brief" | "world" | "main-script"
  path: string
  exists: boolean
}) {
  const [active, setActive] = useAtom(activeEntityAtom)
  const isActive = active?.kind === kind
  return (
    <button
      type="button"
      onClick={() => setActive({ kind, path } as ActiveEntity)}
      className={cn(
        "press group relative w-full flex items-center gap-2 px-3 py-1.5 mx-1.5 rounded-md text-[12.5px]",
        "transition-[background-color,color] duration-150 [transition-timing-function:var(--ease-natural)]",
        isActive
          ? "bg-primary/12 text-foreground font-medium"
          : "text-foreground/85 hover:bg-secondary/60",
      )}
    >
      {/* Active stripe — always rendered, opacity + scaleY transition.
          Conditional rendering would pop the stripe in instantly; this
          way it slides up from a 1px sliver into a full-height bar.
          transform-origin top-left so the grow direction reads as
          "filling in" rather than "appearing centered". */}
      <span
        className={cn(
          "absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r bg-primary origin-top",
          "transition-[opacity,transform] duration-200 [transition-timing-function:var(--ease-out)]",
          isActive ? "opacity-100 scale-y-100" : "opacity-0 scale-y-50",
        )}
        aria-hidden
      />
      <Icon
        className={cn(
          "h-3.5 w-3.5 shrink-0",
          "transition-[color] duration-150 [transition-timing-function:var(--ease-natural)]",
          isActive ? "text-primary" : "text-muted-foreground/70",
        )}
      />
      <span className="flex-1 text-left">{label}</span>
      {!exists && (
        <span className="text-[9px] uppercase tracking-wider text-muted-foreground/50 font-mono">
          empty
        </span>
      )}
    </button>
  )
}

interface ActNode {
  id: string
  label: string
  order: number | null
  notesPath: string
  notesExist: boolean
}

interface SceneFromTree extends SceneNode {
  actId: string | null
}

function ScenesAndActsSection({
  acts,
  scenes,
  creating,
  onStart,
  onCancel,
  onCreate,
}: {
  acts: ActNode[]
  scenes: SceneFromTree[]
  creating: boolean
  onStart: () => void
  onCancel: () => void
  onCreate: (label: string) => void
}) {
  const [active, setActive] = useAtom(activeEntityAtom)
  // Scenes that aren't grouped under an act — render at the top of the
  // section, before the act-grouped ones.
  const flatScenes = scenes.filter((s) => !s.actId)
  const scenesByAct = new Map<string, SceneFromTree[]>()
  for (const s of scenes) {
    if (!s.actId) continue
    if (!scenesByAct.has(s.actId)) scenesByAct.set(s.actId, [])
    scenesByAct.get(s.actId)!.push(s)
  }

  return (
    <section className="group/section px-1.5">
      {/* Section header. Hover surfaces a "+" button on the right —
          one click adds a scene without scrolling to the bottom of the
          list (especially helpful once the project has many scenes). */}
      <div className="flex items-center justify-between gap-2 px-2 py-1">
        <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 font-mono">
          Scenes
        </span>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] tabular-nums text-muted-foreground/50 font-mono">
            {scenes.length}
          </span>
          <button
            type="button"
            onClick={onStart}
            aria-label="Add scene"
            title="Add scene"
            className={cn(
              "shrink-0 flex items-center justify-center",
              "text-muted-foreground/40 hover:text-primary",
              "opacity-0 group-hover/section:opacity-100 focus-visible:opacity-100",
              "transition-opacity duration-150",
            )}
          >
            <Plus className="h-3 w-3" />
          </button>
        </div>
      </div>

      {scenes.length === 0 && acts.length === 0 ? (
        <div className="px-2 pb-2 text-[11.5px] text-muted-foreground/60 italic">
          No scenes yet. Ask the agent in chat to break the screenplay
          into scenes — or click <strong>+ Add scene</strong> below.
        </div>
      ) : (
        <>
          {/* Flat (non-act-grouped) scenes first */}
          {flatScenes.length > 0 && (
            <ul className="space-y-px mb-1">
              {flatScenes.map((s) => (
                <SceneRow key={s.id} scene={s} active={active} setActive={setActive} />
              ))}
            </ul>
          )}

          {/* Acts (each with its scenes nested) */}
          {acts.map((act) => (
            <ActSubsection
              key={act.id}
              act={act}
              scenes={scenesByAct.get(act.id) ?? []}
              active={active}
              setActive={setActive}
            />
          ))}
        </>
      )}

      {creating ? (
        <CreateInline
          placeholder="Scene name (e.g. Warehouse Confrontation)"
          onCancel={onCancel}
          onSubmit={onCreate}
        />
      ) : (
        <button
          type="button"
          onClick={onStart}
          className={cn(
            "press w-full flex items-center gap-1.5 mt-0.5 px-3 py-1 rounded-md",
            "text-[11px] text-muted-foreground hover:text-primary",
            "hover:bg-primary/5 transition-[color,background-color] duration-150 [transition-timing-function:var(--ease-natural)]",
          )}
        >
          <Plus className="h-3 w-3" />
          Add scene
        </button>
      )}
    </section>
  )
}

// ────────────────────────────────────────────────────────────────────────
// SceneRow — used by both flat-scenes list and act-nested scenes
// ────────────────────────────────────────────────────────────────────────

function SceneRow({
  scene,
  active,
  setActive,
  indent,
}: {
  scene: SceneFromTree
  active: ActiveEntity
  setActive: (a: ActiveEntity) => void
  indent?: number
}) {
  const isActive = active?.path === scene.scriptPath
  return (
    <li>
      <button
        type="button"
        onClick={() =>
          setActive({
            kind: "scene",
            id: scene.id,
            label: scene.label,
            actId: scene.actId,
            path: scene.scriptPath,
          } as ActiveEntity)
        }
        style={indent ? { paddingLeft: indent } : undefined}
        className={cn(
          "press group relative w-full text-left flex items-baseline gap-2.5 pl-3 pr-2 py-1.5 rounded-md",
          "transition-[background-color] duration-150 [transition-timing-function:var(--ease-natural)]",
          isActive ? "bg-primary/12" : "hover:bg-secondary/60",
        )}
      >
        <span
          className={cn(
            "absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r bg-primary origin-top",
            "transition-[opacity,transform] duration-200 [transition-timing-function:var(--ease-out)]",
            isActive ? "opacity-100 scale-y-100" : "opacity-0 scale-y-50",
          )}
          aria-hidden
        />
        <span
          className={cn(
            "shrink-0 font-mono text-[10px] tabular-nums tracking-wider",
            "transition-[color] duration-150 [transition-timing-function:var(--ease-natural)]",
            isActive ? "text-primary" : "text-muted-foreground/60",
          )}
        >
          {scene.order != null ? String(scene.order).padStart(2, "0") : "·"}
        </span>
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            isActive
              ? "text-foreground font-medium text-[13px] leading-tight"
              : "text-foreground/85 text-[12.5px] leading-tight",
          )}
          style={{ fontFamily: isActive ? "'Darker Grotesque', sans-serif" : undefined }}
        >
          {scene.label}
        </span>
      </button>
    </li>
  )
}

// ────────────────────────────────────────────────────────────────────────
// ActSubsection — collapsible header for an act + its scenes nested
// ────────────────────────────────────────────────────────────────────────

function ActSubsection({
  act,
  scenes,
  active,
  setActive,
}: {
  act: ActNode
  scenes: SceneFromTree[]
  active: ActiveEntity
  setActive: (a: ActiveEntity) => void
}) {
  const [collapsed, setCollapsed] = useState(false)
  const isActAwake = active?.kind === "act" && active.id === act.id
  return (
    <div className="mt-2">
      <div
        className={cn(
          "group flex items-center gap-1 px-2 py-1 rounded-md",
          "text-[11px] uppercase tracking-[0.14em] font-mono",
          isActAwake
            ? "bg-primary/10 text-primary"
            : "text-muted-foreground/85 hover:bg-secondary/40",
        )}
      >
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="text-current hover:text-foreground p-0.5"
          aria-label={collapsed ? "Expand act" : "Collapse act"}
        >
          {collapsed ? (
            <ChevronRight className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )}
        </button>
        <Layers className="h-3 w-3" />
        <button
          type="button"
          onClick={() =>
            setActive({
              kind: "act",
              id: act.id,
              label: act.label,
              path: act.notesPath,
            } as ActiveEntity)
          }
          className="flex items-baseline gap-1.5 flex-1 text-left"
          title={
            act.notesExist
              ? "Open act notes"
              : "Open / create act notes (act.md)"
          }
        >
          <span className="font-mono tabular-nums text-[10px]">
            {act.order != null ? `Act ${act.order}` : "Act"}
          </span>
          <span className="truncate normal-case tracking-normal text-[12px] font-medium text-foreground/85">
            {act.label}
          </span>
        </button>
        {!act.notesExist && (
          <span className="text-[8px] text-muted-foreground/40 font-mono">
            no notes
          </span>
        )}
      </div>
      {!collapsed && (
        <ul className="space-y-px mt-0.5">
          {scenes.length === 0 ? (
            <li className="pl-9 pr-2 py-1 text-[11px] italic text-muted-foreground/55">
              no scenes in this act yet
            </li>
          ) : (
            scenes.map((s) => (
              <SceneRow
                key={s.id}
                scene={s}
                active={active}
                setActive={setActive}
                indent={28}
              />
            ))
          )}
        </ul>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
// CreateInline — small text input that replaces the "+ Add" button when
// the user starts creating an entity. Enter to submit, Esc to cancel.
// ────────────────────────────────────────────────────────────────────────

function CreateInline({
  placeholder,
  onCancel,
  onSubmit,
}: {
  placeholder: string
  onCancel: () => void
  onSubmit: (label: string) => void
}) {
  const [value, setValue] = useState("")
  const submitted = useRef(false)
  return (
    <div className="px-3 py-1 mt-0.5">
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            const v = value.trim()
            if (v) {
              submitted.current = true
              onSubmit(v)
            } else {
              onCancel()
            }
          } else if (e.key === "Escape") {
            onCancel()
          }
        }}
        onBlur={() => {
          if (submitted.current) return
          const v = value.trim()
          if (v) onSubmit(v)
          else onCancel()
        }}
        placeholder={placeholder}
        className={cn(
          "w-full px-2 py-1 rounded text-[12px] bg-background",
          "border border-primary/40 outline-none focus:border-primary",
          "focus:ring-1 focus:ring-primary/15",
        )}
      />
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground/50 font-mono mt-0.5 px-1">
        Enter to create · Esc to cancel
      </div>
    </div>
  )
}

// (Old WorldRow removed — superseded by SingletonRow which handles
//  Brief / World / Main script uniformly.)

// ────────────────────────────────────────────────────────────────────────
// Characters / Locations groups
// ────────────────────────────────────────────────────────────────────────

interface EntityItem {
  id: string
  label: string
  entity: ActiveEntity
}

function EntityGroup({
  icon: Icon,
  label,
  items,
  addCta,
  creating,
  onStart,
  onCancel,
  onCreate,
}: {
  icon: typeof User
  label: string
  items: EntityItem[]
  addCta: string
  creating: boolean
  onStart: () => void
  onCancel: () => void
  onCreate: (label: string) => void
}) {
  const [collapsed, setCollapsed] = useState(items.length === 0 && !creating)
  const [active, setActive] = useAtom(activeEntityAtom)
  // Auto-expand when creation starts so the input is visible.
  if (creating && collapsed) setCollapsed(false)

  return (
    <section className="group/section mt-1 px-1.5">
      {/* Header row — clicking the label toggles collapse; the "+" on the
          right always creates (and auto-expands) without first having to
          discover that the section is collapsible. Two affordances, one
          row, no overlap. Both buttons get `.press` so they share the
          standardised interactive feedback from the animation pass. */}
      <div className="flex items-stretch">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className={cn(
            "press flex-1 flex items-center gap-1.5 px-2 py-1",
            "text-[10px] uppercase tracking-[0.16em] font-mono",
            "text-muted-foreground/70 hover:text-foreground/90",
          )}
        >
          {collapsed ? (
            <ChevronRight className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )}
          <Icon className="h-3 w-3" />
          <span className="flex-1 text-left">{label}</span>
          <span className="text-[10px] tabular-nums text-muted-foreground/50 font-mono">
            {items.length}
          </span>
        </button>
        <button
          type="button"
          onClick={() => {
            setCollapsed(false)
            onStart()
          }}
          aria-label={addCta}
          title={addCta}
          className={cn(
            "press shrink-0 px-1.5 flex items-center justify-center",
            "text-muted-foreground/40 hover:text-primary",
            "opacity-0 group-hover/section:opacity-100 focus-visible:opacity-100",
            "transition-opacity duration-150",
          )}
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>

      {!collapsed && (
        <ul className="space-y-px">
          {items.length === 0 ? (
            <li className="px-3 pl-9 py-1 text-[11px] italic text-muted-foreground/55">
              none yet
            </li>
          ) : (
            items.map((it) => {
              const isActive = active?.path === it.entity?.path
              return (
                <li key={it.id}>
                  <button
                    type="button"
                    onClick={() => setActive(it.entity)}
                    className={cn(
                      "press relative w-full flex items-center gap-2 pl-9 pr-2 py-1 rounded-md text-[12px]",
                      "transition-[background-color,color] duration-150 [transition-timing-function:var(--ease-natural)]",
                      isActive
                        ? "bg-primary/12 text-foreground font-medium"
                        : "text-foreground/85 hover:bg-secondary/60",
                    )}
                    title={it.label}
                  >
                    <span
                      className={cn(
                        "absolute left-0 top-1 bottom-1 w-[2px] rounded-r bg-primary origin-top",
                        "transition-[opacity,transform] duration-200 [transition-timing-function:var(--ease-out)]",
                        isActive ? "opacity-100 scale-y-100" : "opacity-0 scale-y-50",
                      )}
                      aria-hidden
                    />
                    <span className="truncate flex-1 text-left">{it.label}</span>
                  </button>
                </li>
              )
            })
          )}
          <li>
            {creating ? (
              <div className="pl-7">
                <CreateInline
                  placeholder={`${label.slice(0, -1) || label} name`}
                  onCancel={onCancel}
                  onSubmit={onCreate}
                />
              </div>
            ) : (
              <button
                type="button"
                onClick={onStart}
                className={cn(
                  "press w-full flex items-center gap-1.5 pl-9 pr-2 py-1 rounded-md text-[11px]",
                  "text-muted-foreground hover:text-primary hover:bg-primary/5 transition-[color,background-color] duration-150 [transition-timing-function:var(--ease-natural)]",
                )}
              >
                <Plus className="h-3 w-3" />
                {addCta}
              </button>
            )}
          </li>
        </ul>
      )}
    </section>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Empty state — no project bootstrapped yet
// ────────────────────────────────────────────────────────────────────────

function EmptyState({
  onBootstrap,
  isPending,
}: {
  onBootstrap: () => void
  isPending: boolean
}) {
  return (
    <div className="p-4 flex flex-col gap-3">
      <div className="text-[12.5px] text-foreground/85 leading-relaxed">
        This project doesn't have the screenwriter structure yet. Bootstrap
        it to add a world bible, characters, locations, and scene folders.
      </div>
      <button
        type="button"
        onClick={onBootstrap}
        disabled={isPending}
        className={cn(
          "press flex items-center justify-center gap-1.5 px-3 py-2 rounded-md",
          "bg-primary text-primary-foreground",
          "shadow-[0_1px_2px_-1px_rgba(0,0,0,0.15)] hover:shadow-[0_2px_8px_-2px_rgba(0,0,0,0.18)]",
          "text-[12px] font-medium",
          "transition-[box-shadow] duration-150 [transition-timing-function:var(--ease-out)]",
          "disabled:opacity-50 disabled:cursor-progress disabled:active:scale-100",
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
