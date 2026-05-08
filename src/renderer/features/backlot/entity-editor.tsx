"use client"

/**
 * EntityEditor — generic markdown editor for the active entity.
 *
 * Used for World / Character / Location entities. The Scene entity
 * has its own specialised SceneFocusView (script + prompt + refs);
 * everything else is a single markdown file the user and the agent
 * both edit freely.
 *
 * The flow matches a Cursor-style file editor:
 *   1. User clicks an entity in the project tree → activeEntityAtom set
 *   2. This component reads the real file via entities.read
 *   3. User types → debounced autosave to entities.write
 *   4. Agent uses Edit/Write tools on the same path → next poll picks up
 *
 * Save status appears as a tiny indicator in the top-right.
 */

import { useEffect, useRef, useState } from "react"
import { useAtomValue } from "jotai"
import {
  BookOpen,
  Check,
  Clapperboard,
  FileText,
  Globe2,
  Layers,
  Loader2,
  MapPin,
  User,
} from "lucide-react"
import { selectedAgentChatIdAtom } from "../agents/atoms"
import { activeEntityAtom, type ActiveEntity } from "./atoms"
import { trpc } from "../../lib/trpc"
import { cn } from "../../lib/utils"

const POLL_MS = 5000 // refetch interval — picks up agent-side edits
const AUTOSAVE_DEBOUNCE = 600

export function EntityEditor() {
  const chatId = useAtomValue(selectedAgentChatIdAtom)
  const active = useAtomValue(activeEntityAtom)

  if (!active) {
    return <PlaceholderState />
  }
  if (!chatId) {
    return <PlaceholderState message="Open a chat first." />
  }
  if (active.kind === "scene" || active.kind === "shot" || active.kind === "master-script") {
    // Scenes and shots have their own surfaces (PromptsModeView /
    // ScreenplayPane). This component only handles atomic markdown
    // entities (brief, world, main-script, character, location, act).
    return null
  }

  return <ActiveEntityFile chatId={chatId} active={active} />
}

// ────────────────────────────────────────────────────────────────────────
// Inner — only renders when there's a real chatId + entity
// ────────────────────────────────────────────────────────────────────────

function ActiveEntityFile({
  chatId,
  active,
}: {
  chatId: string
  active: NonNullable<ActiveEntity>
}) {
  const path = "path" in active ? active.path : ""

  const read = trpc.entities.read.useQuery(
    { chatId, entityPath: path },
    {
      enabled: !!chatId && !!path,
      refetchInterval: POLL_MS,
      refetchOnWindowFocus: true,
    },
  )
  const write = trpc.entities.write.useMutation()

  const [buffer, setBuffer] = useState<string>("")
  const lastTypedRef = useRef<number>(0)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  )

  // Pull server content into the buffer when the user is idle. Same idiom
  // as the screenplay editor — don't blow away mid-typing edits.
  useEffect(() => {
    const remote = read.data?.content ?? ""
    if (read.isPending) return
    if (Date.now() - lastTypedRef.current < 1000) return
    if (remote !== buffer) setBuffer(remote)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [read.data?.content])

  // Cleanup pending save on entity change.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [path])

  const flush = (next: string) => {
    if (!chatId || !path) return
    setSaveState("saving")
    write.mutate(
      { chatId, entityPath: path, content: next },
      {
        onSuccess: () => {
          setSaveState("saved")
          setTimeout(() => setSaveState((s) => (s === "saved" ? "idle" : s)), 1400)
        },
        onError: () => setSaveState("error"),
      },
    )
  }

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.target.value
    setBuffer(next)
    lastTypedRef.current = Date.now()
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => flush(next), AUTOSAVE_DEBOUNCE)
  }

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between gap-3 px-6 py-3 border-b border-border bg-card/30 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <KindIcon kind={active.kind} />
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 font-mono">
              {kindLabel(active.kind)}
            </div>
            <div
              className="text-[18px] font-semibold leading-tight text-foreground truncate"
              style={{ fontFamily: "'Darker Grotesque', sans-serif" }}
              title={"label" in active ? active.label : ""}
            >
              {"label" in active ? active.label : "Untitled"}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <SaveIndicator state={saveState} />
          <span
            className="text-[10px] font-mono text-muted-foreground/50 truncate max-w-[300px]"
            title={path}
          >
            {path}
          </span>
        </div>
      </header>

      {/* Body — single textarea, autosaves */}
      <div className="flex-1 min-h-0 overflow-auto bg-card/10">
        {read.isPending ? (
          <div className="px-6 py-12 text-[12px] text-muted-foreground/70">
            Loading…
          </div>
        ) : !read.data?.exists ? (
          <NotYetCreatedState
            path={path}
            onCreate={() => flush(buildTemplate(active))}
          />
        ) : (
          <textarea
            value={buffer}
            onChange={onChange}
            spellCheck
            className={cn(
              "w-full h-full min-h-full px-8 py-6 bg-transparent",
              "border-0 outline-none resize-none",
              "font-mono text-[13px] leading-7 text-foreground/90",
            )}
          />
        )}
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
// States
// ────────────────────────────────────────────────────────────────────────

function PlaceholderState({
  message = "Pick something from the project tree to start editing.",
}: {
  message?: string
}) {
  return (
    <div className="flex h-full items-center justify-center px-8">
      <div className="text-center text-muted-foreground max-w-md">
        <FileText className="h-7 w-7 mx-auto mb-3 text-muted-foreground/40" />
        <p className="text-[13px] leading-relaxed">{message}</p>
      </div>
    </div>
  )
}

function NotYetCreatedState({
  path,
  onCreate,
}: {
  path: string
  onCreate: () => void
}) {
  return (
    <div className="flex h-full items-center justify-center px-8">
      <div className="text-center max-w-md">
        <FileText className="h-7 w-7 mx-auto mb-3 text-muted-foreground/40" />
        <div className="text-[13px] text-foreground/80 font-medium mb-1">
          File doesn't exist yet
        </div>
        <div className="text-[12px] text-muted-foreground mb-3 font-mono">
          {path}
        </div>
        <button
          type="button"
          onClick={onCreate}
          className={cn(
            "press px-3 py-1.5 rounded-md text-[12px] font-medium",
            "bg-primary text-primary-foreground",
            "shadow-[0_1px_2px_-1px_rgba(0,0,0,0.15)] hover:shadow-[0_2px_8px_-2px_rgba(0,0,0,0.18)]",
            "transition-[box-shadow] duration-150 [transition-timing-function:var(--ease-out)]",
          )}
        >
          Create starter
        </button>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

function KindIcon({ kind }: { kind: NonNullable<ActiveEntity>["kind"] }) {
  const cls = "h-4 w-4 text-primary/80 shrink-0"
  if (kind === "brief") return <BookOpen className={cls} />
  if (kind === "world") return <Globe2 className={cls} />
  if (kind === "main-script") return <Clapperboard className={cls} />
  if (kind === "character") return <User className={cls} />
  if (kind === "location") return <MapPin className={cls} />
  if (kind === "act") return <Layers className={cls} />
  return <FileText className={cls} />
}

function kindLabel(kind: NonNullable<ActiveEntity>["kind"]) {
  switch (kind) {
    case "brief":
      return "Project brief"
    case "world":
      return "World bible"
    case "main-script":
      return "Main script"
    case "character":
      return "Character"
    case "location":
      return "Location"
    case "act":
      return "Act"
    case "scene":
      return "Scene"
    case "shot":
      return "Shot"
    case "master-script":
      return "Master script"
    default:
      return "File"
  }
}

function SaveIndicator({ state }: { state: "idle" | "saving" | "saved" | "error" }) {
  if (state === "idle") return null
  if (state === "saving") {
    return (
      <span className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
        <Loader2 className="h-3 w-3 animate-spin" />
        Saving…
      </span>
    )
  }
  if (state === "saved") {
    return (
      <span className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-emerald-600 dark:text-emerald-400 font-mono">
        <Check className="h-3 w-3" />
        Saved
      </span>
    )
  }
  return (
    <span className="text-[10px] uppercase tracking-wider text-rose-600 dark:text-rose-400 font-mono">
      Save failed
    </span>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Templates — written when user clicks "Create starter" on a missing file
// ────────────────────────────────────────────────────────────────────────

function buildTemplate(active: NonNullable<ActiveEntity>): string {
  switch (active.kind) {
    case "brief":
      return `# Project Brief

## Logline

(One sentence — what's the story, in twenty words or less?)

## Short description

(A paragraph or two. The pitch you'd give to a producer.)

## Style

(Visual / tonal direction. References, mood, what this should *feel*
like. The agent uses this when composing prompts.)
`
    case "main-script":
      return `Title: Untitled
Credit: Written by
Author:

FADE IN:

# Act I

EXT. — — DAY

`
    case "act":
      return `# ${"label" in active ? active.label : "Act"}

## Logline

(One-sentence summary of this act's beat.)

## Beats

- (key story moment 1)
- (key story moment 2)
- (key story moment 3)
`
    case "world":
      return `# World Bible

The art-direction spine of this project. Every prompt eventually
references this — palette, era, lens choices, tone, technology level,
visual references.

## Tone

(How does this world *feel*? One paragraph.)

## Visual palette

(Colours, lighting style, material qualities. Reference film stills
if useful.)

## Era + technology

(When + what level of tech?)

## Lens / camera language

(Anamorphic, handheld, locked-off? Default focal length feel?)

## Visual references

(Drag images or reference filenames inside this project.)
`
    case "character":
      return `# ${"label" in active ? active.label : "Character"}

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

(Filenames inside assets/refs/, or leave blank for now.)
`
    case "location":
      return `# ${"label" in active ? active.label : "Location"}

Reference card for this place.

## Description

(Where is it? What does it look like? One paragraph.)

## Time of day variants

(Dawn / day / dusk / night — different prompts likely need different versions.)

## Lighting setup

(Key light direction, intensity, colour temperature, atmosphere.)

## Reference images

(Filenames inside assets/refs/, or leave blank.)
`
    default:
      return `# ${"label" in active ? active.label : "Untitled"}\n\n`
  }
}
