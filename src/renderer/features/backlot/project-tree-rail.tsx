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

import { useAtom, useAtomValue, useSetAtom } from "jotai"
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Clapperboard,
  Globe2,
  Layers,
  MapPin,
  Plus,
  Sparkles,
  User,
} from "lucide-react"
import { useRef, useState } from "react"
import { toast } from "sonner"
import { trpc } from "../../lib/trpc"
import { cn } from "../../lib/utils"
import { selectedAgentChatIdAtom } from "../agents/atoms"
import {
  activeEntityAtom,
  projectTreeOpenAtom,
  projectTreeWidthAtom,
  type ActiveEntity,
} from "./atoms"
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

export function ProjectTreeRail() {
  const [open, setOpen] = useAtom(projectTreeOpenAtom)
  const [width, setWidth] = useAtom(projectTreeWidthAtom)

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "press shrink-0 flex flex-col items-center justify-start py-3 gap-2",
          "w-7 border-r border-border bg-card/30",
          "text-muted-foreground hover:text-foreground hover:bg-card/60",
          "transition-[color,background-color] duration-150 [transition-timing-function:var(--ease-natural)]",
        )}
        title="Show project"
        aria-label="Show project"
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
    <div className="flex shrink-0 h-full">
      <aside
        className="border-r border-border bg-card/30 flex flex-col"
        style={{ width }}
      >
        {/* Header */}
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
            className="press text-muted-foreground hover:text-foreground transition-[color] duration-150 [transition-timing-function:var(--ease-natural)]"
            title="Hide project"
          >
            <ChevronsLeft className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-auto">
          <ProjectTreeContent />
        </div>
      </aside>

      <Resizer
        axis="x"
        onResize={(d) => setWidth((w) => Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, w + d)))}
      />
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Content
// ────────────────────────────────────────────────────────────────────────

function ProjectTreeContent() {
  const chatId = useAtomValue(selectedAgentChatIdAtom)
  const setActive = useSetAtom(activeEntityAtom)
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
    onError: (err) => toast.error(err.message || "Couldn't bootstrap."),
  })
  const write = trpc.entities.write.useMutation({
    onSuccess: () => tree.refetch(),
    onError: (err) => toast.error(err.message || "Couldn't create file."),
  })

  // What kind of entity is being created right now (inline input shown).
  const [creating, setCreating] = useState<
    null | "scene" | "character" | "location"
  >(null)

  const onCreate = async (
    kind: "scene" | "character" | "location",
    label: string,
  ) => {
    if (!chatId || !label.trim()) {
      setCreating(null)
      return
    }
    const slug = slugify(label) || `untitled-${Date.now()}`
    let entityPath: string
    let active: ActiveEntity
    let template: string
    if (kind === "character") {
      entityPath = `characters/${slug}.md`
      template = characterTemplate(label)
      active = {
        kind: "character",
        id: slug,
        label,
        path: entityPath,
      } as ActiveEntity
    } else if (kind === "location") {
      entityPath = `locations/${slug}.md`
      template = locationTemplate(label)
      active = {
        kind: "location",
        id: slug,
        label,
        path: entityPath,
      } as ActiveEntity
    } else {
      // scene — compute next order from existing scenes
      const existing = tree.data?.scenes ?? []
      const nextNum =
        Math.max(0, ...existing.map((s) => s.order ?? 0)) + 1
      const order = String(nextNum).padStart(2, "0")
      const folderId = `${order}-${slug}`
      entityPath = `scenes/${folderId}/scene.fountain`
      template = sceneTemplate(label)
      active = {
        kind: "scene",
        id: folderId,
        label,
        path: entityPath,
      } as ActiveEntity
    }
    try {
      await write.mutateAsync({ chatId, entityPath, content: template })
      setActive(active)
      setCreating(null)
      toast.success(`Created ${entityPath}`)
    } catch {
      // mutation onError already toasts
      setCreating(null)
    }
  }

  if (!chatId) {
    return (
      <div className="px-4 py-6 text-[12px] text-muted-foreground">
        Open a chat to see its project.
      </div>
    )
  }
  if (tree.isPending) {
    return <div className="px-4 py-6 text-[12px] text-muted-foreground/70">Loading…</div>
  }
  const data = tree.data
  if (!data) {
    return (
      <div className="px-4 py-6 text-[12px] text-muted-foreground/70">
        Couldn't read this project.
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
    <div className="py-3">
      {/* Top-level singletons — always rendered, "empty" badge when missing */}
      <SingletonRow
        icon={BookOpen}
        label="Brief"
        kind="brief"
        path={data.brief.path}
        exists={data.brief.exists}
      />
      <SingletonRow
        icon={Globe2}
        label="World"
        kind="world"
        path={data.world.path}
        exists={data.world.exists}
      />
      <SingletonRow
        icon={Clapperboard}
        label="Main script"
        kind="main-script"
        path={data.mainScript.path}
        exists={data.mainScript.exists}
      />

      <Divider />

      {/* Scenes — flat or grouped by acts depending on what exists */}
      <ScenesAndActsSection
        acts={data.acts}
        scenes={data.scenes}
        creating={creating === "scene"}
        onStart={() => setCreating("scene")}
        onCancel={() => setCreating(null)}
        onCreate={(label) => onCreate("scene", label)}
      />

      <Divider />

      <EntityGroup
        icon={User}
        label="Characters"
        items={data.characters.map((c) => ({
          id: c.id,
          label: c.label,
          entity: { kind: "character", id: c.id, label: c.label, path: c.path } as ActiveEntity,
        }))}
        addCta="Add character"
        creating={creating === "character"}
        onStart={() => setCreating("character")}
        onCancel={() => setCreating(null)}
        onCreate={(label) => onCreate("character", label)}
      />

      <EntityGroup
        icon={MapPin}
        label="Locations"
        items={data.locations.map((l) => ({
          id: l.id,
          label: l.label,
          entity: { kind: "location", id: l.id, label: l.label, path: l.path } as ActiveEntity,
        }))}
        addCta="Add location"
        creating={creating === "location"}
        onStart={() => setCreating("location")}
        onCancel={() => setCreating(null)}
        onCreate={(label) => onCreate("location", label)}
      />

      <Divider />

      <DemoTrigger />
    </div>
  )
}

function Divider() {
  return <div className="my-3 mx-3 h-px bg-border/70" />
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
    <section className="px-1.5">
      <div className="flex items-center justify-between px-2 py-1">
        <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 font-mono">
          Scenes
        </span>
        <span className="text-[10px] tabular-nums text-muted-foreground/50 font-mono">
          {scenes.length}
        </span>
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
    <section className="mt-1 px-1.5">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className={cn(
          "press w-full flex items-center gap-1.5 px-2 py-1",
          "text-[10px] uppercase tracking-[0.16em] font-mono",
          "text-muted-foreground/70 hover:text-foreground/90",
          "transition-[color] duration-150 [transition-timing-function:var(--ease-natural)]",
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

// ────────────────────────────────────────────────────────────────────────
// Demo trigger — small footer link, less aggressive than the button stack
// from the previous iteration. Comes out completely once E1.4 wires real
// scene data.
// ────────────────────────────────────────────────────────────────────────

function DemoTrigger() {
  const setActive = useSetAtom(activeEntityAtom)
  return (
    <div className="px-4 py-2">
      <button
        type="button"
        onClick={() =>
          setActive({
            kind: "scene",
            id: "01-opening",
            label: "Opening (demo)",
            path: "__demo/scenes/01-opening/scene.fountain",
          } as ActiveEntity)
        }
        className={cn(
          "press flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] font-mono",
          "text-muted-foreground/60 hover:text-primary",
          "transition-[color] duration-150 [transition-timing-function:var(--ease-natural)]",
        )}
        title="Load mock data so the scene focus view is testable before E1.4"
      >
        <Sparkles className="h-2.5 w-2.5" />
        Preview demo
      </button>
    </div>
  )
}
