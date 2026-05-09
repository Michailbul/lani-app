"use client"

/**
 * EntityEditor — generic single-file editor for the active entity.
 *
 * In Screenwriting mode this is the center pane for *any* entity that
 * lives as one file on disk: brief, world, main script, character,
 * location, act, AND scenes (their `scene.fountain`) and shots.
 *
 * Prompts mode swaps scenes/shots over to PromptsModeView (script +
 * prompt + refs split); atomic markdown entities still land here in
 * either mode because the prompts surface is scene-specific.
 *
 * Flow (Cursor-style):
 *   1. User clicks an entity in the project tree → activeEntityAtom set
 *   2. This component reads the real file via entities.read
 *   3. User types → debounced autosave to entities.write
 *   4. Agent uses Edit/Write tools on the same path → next poll picks up
 *
 * Save status appears as a tiny indicator in the top-right.
 */

import { useEffect, useRef, useState, useCallback } from "react"
import { useAtomValue } from "jotai"
import {
  BookOpen,
  Camera,
  Check,
  Clapperboard,
  Film,
  FileText,
  Globe2,
  Layers,
  Loader2,
  MapPin,
  User,
} from "lucide-react"
import { MarkdownIcon, CodeIcon } from "../../components/ui/icons"
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip"
import { Button } from "../../components/ui/button"
import { MarkdownPreview } from "./markdown-preview"
import { selectedAgentChatIdAtom, selectedProjectAtom } from "../agents/atoms"
import { activeEntityAtom, type ActiveEntity } from "./atoms"
import { trpc } from "../../lib/trpc"
import { cn } from "../../lib/utils"

const POLL_MS = 5000 // refetch interval — picks up agent-side edits
const AUTOSAVE_DEBOUNCE = 600

/** Two browse modes share the same editor. See ProjectFileTree for the
 * full rationale: chatId → worktree, projectId → canonical project root.
 * Edits in project-mode land directly on the canonical files (no fork). */
type EntityRoot =
  | { chatId: string; projectId?: undefined }
  | { chatId?: undefined; projectId: string }

export function EntityEditor() {
  const chatId = useAtomValue(selectedAgentChatIdAtom)
  const selectedProject = useAtomValue(selectedProjectAtom)
  const active = useAtomValue(activeEntityAtom)

  const entityRoot: EntityRoot | null = chatId
    ? { chatId }
    : selectedProject?.id
      ? { projectId: selectedProject.id }
      : null

  if (!active) {
    return <PlaceholderState />
  }
  if (!entityRoot) {
    return <PlaceholderState message="Pick a project to open files." />
  }
  if (active.kind === "master-script") {
    // The legacy master-script artifact still has its own surface
    // (ScreenplayPane); routing for it lives in ModeAwareCenter.
    return null
  }

  return <ActiveEntityFile entityRoot={entityRoot} active={active} />
}

// ────────────────────────────────────────────────────────────────────────
// Inner — only renders when there's a real entityRoot + entity
// ────────────────────────────────────────────────────────────────────────

function ActiveEntityFile({
  entityRoot,
  active,
}: {
  entityRoot: EntityRoot
  active: NonNullable<ActiveEntity>
}) {
  const path = "path" in active ? active.path : ""

  const read = trpc.entities.read.useQuery(
    { ...entityRoot, entityPath: path },
    {
      enabled: !!path,
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

  // View mode: rendered markdown preview vs. raw textarea editor.
  // Markdown files default to "rendered"; fountain files keep "editor"
  // because Fountain isn't really a presentation format — the writer
  // wants to see the markup. Per-file (resets when the active entity
  // changes), so opening a different file gives the appropriate default.
  const isFountain =
    active.kind === "scene" ||
    active.kind === "main-script" ||
    (active.kind === "file" && /\.fountain$/i.test(path))
  const isMarkdown =
    active.kind === "brief" ||
    active.kind === "world" ||
    active.kind === "character" ||
    active.kind === "location" ||
    active.kind === "act" ||
    active.kind === "shot" ||
    (active.kind === "file" && /\.(md|markdown|mdx)$/i.test(path))
  const previewable = isMarkdown
  const [viewMode, setViewMode] = useState<"rendered" | "editor">(
    previewable ? "rendered" : "editor",
  )
  const editorTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  // When the active entity changes, reset to the appropriate default.
  useEffect(() => {
    setViewMode(previewable ? "rendered" : "editor")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])

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
    if (!path) return
    setSaveState("saving")
    write.mutate(
      { ...entityRoot, entityPath: path, content: next },
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

  // Click on the rendered preview swaps to edit mode and focuses the
  // textarea — Notion's pattern. Blur (clicking outside) flushes any
  // pending save and swaps back to preview when previewable. The user
  // can also click the explicit Markdown/Code icon in the header.
  const handleEnterEdit = useCallback(() => {
    if (!previewable) return
    setViewMode("editor")
    // Focus on next tick so the textarea is mounted.
    setTimeout(() => editorTextareaRef.current?.focus(), 0)
  }, [previewable])

  const handleEditorBlur = useCallback(() => {
    // Flush any debounced save immediately so the preview shows what
    // disk has — the rendered view should never lag the buffer.
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
      flush(buffer)
    }
    if (previewable) setViewMode("rendered")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewable, buffer])

  const handleToggleViewMode = useCallback(() => {
    if (!previewable) return
    setViewMode((m) => {
      if (m === "editor") {
        // Leaving editor — flush.
        if (saveTimerRef.current) {
          clearTimeout(saveTimerRef.current)
          saveTimerRef.current = null
          flush(buffer)
        }
        return "rendered"
      }
      // Entering editor — focus next tick.
      setTimeout(() => editorTextareaRef.current?.focus(), 0)
      return "editor"
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewable, buffer])

  const label = "label" in active ? active.label : "Untitled"

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">
      {/* Header — editorial masthead. Kicker (mono caps) + display
          headline. Right side: save state + path in mono. The hairline
          rule is left-anchored Coral, like an editor's margin mark. */}
      <header className="relative shrink-0 px-10 pt-7 pb-5 bg-background">
        <div className="flex items-end justify-between gap-6">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span
                className="inline-block w-[14px] h-[1px] bg-primary"
                aria-hidden
              />
              <span
                className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground/75"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                {kindLabel(active.kind)}
              </span>
            </div>
            <h1
              className="mt-2 text-[34px] leading-[1.05] tracking-[-0.012em] text-foreground truncate"
              style={{ fontFamily: "var(--font-display)", fontWeight: 600 }}
              title={label}
            >
              {label}
            </h1>
          </div>
          <div className="flex flex-col items-end gap-1.5 shrink-0 pb-1">
            <div className="flex items-center gap-2">
              <SaveIndicator state={saveState} />
              {previewable && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={handleToggleViewMode}
                      className="h-6 w-6 p-0 hover:bg-foreground/10 text-muted-foreground hover:text-foreground"
                      aria-label={
                        viewMode === "rendered"
                          ? "Edit markdown"
                          : "Preview markdown"
                      }
                    >
                      <div className="relative w-4 h-4">
                        <MarkdownIcon
                          className={cn(
                            "absolute inset-0 w-4 h-4 transition-[opacity,transform] duration-200 ease-out",
                            viewMode === "rendered"
                              ? "opacity-100 scale-100"
                              : "opacity-0 scale-75",
                          )}
                        />
                        <CodeIcon
                          className={cn(
                            "absolute inset-0 w-4 h-4 transition-[opacity,transform] duration-200 ease-out",
                            viewMode === "editor"
                              ? "opacity-100 scale-100"
                              : "opacity-0 scale-75",
                          )}
                        />
                      </div>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {viewMode === "rendered"
                      ? "Edit markdown"
                      : "Preview markdown"}
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
            <span
              className="text-[10px] tracking-tight text-muted-foreground/55 truncate max-w-[320px]"
              style={{ fontFamily: "var(--font-mono)" }}
              title={path}
            >
              {path}
            </span>
          </div>
        </div>
        <div className="mt-5 h-px bg-border/70" />
      </header>

      {/* Body — manuscript surface. Constrained max-width so the writer's
          eye doesn't have to track edge-to-edge across a 27" display. */}
      <div className="flex-1 min-h-0 overflow-auto">
        {read.isPending ? (
          <div className="px-10 py-12">
            <div className="max-w-[720px] mx-auto">
              <span
                className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground/55"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                Loading…
              </span>
            </div>
          </div>
        ) : !read.data?.exists ? (
          <NotYetCreatedState
            path={path}
            onCreate={() => flush(buildTemplate(active))}
          />
        ) : viewMode === "rendered" && previewable ? (
          // Rendered preview — clicking anywhere on the article swaps to
          // the textarea editor and focuses it. We wrap in a button-like
          // div (role="button" + keyboard handlers) so screen-readers
          // and keyboard users can also enter edit mode.
          <div
            role="button"
            tabIndex={0}
            onClick={handleEnterEdit}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault()
                handleEnterEdit()
              }
            }}
            className={cn(
              "w-full h-full pt-8 cursor-text",
              "transition-[background-color] duration-150",
              "hover:bg-foreground/[0.015] dark:hover:bg-foreground/[0.02]",
              "focus:outline-none focus-visible:bg-foreground/[0.02]",
            )}
            aria-label="Edit markdown"
          >
            <MarkdownPreview content={buffer} />
          </div>
        ) : (
          <div className="w-full h-full pb-24">
            <textarea
              ref={editorTextareaRef}
              value={buffer}
              onChange={onChange}
              onBlur={previewable ? handleEditorBlur : undefined}
              spellCheck
              className={cn(
                "block w-full max-w-[760px] mx-auto h-full min-h-full",
                "px-10 pt-8 bg-transparent",
                "border-0 outline-none resize-none",
                "text-foreground/90 selection:bg-primary/25 caret-primary",
                isFountain
                  ? "text-[13px] leading-[1.85]"
                  : "text-[15px] leading-[1.78]",
              )}
              style={{
                fontFamily: isFountain
                  ? "var(--font-mono)"
                  : "var(--font-body)",
              }}
            />
          </div>
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
    <div className="flex h-full items-center justify-center px-10">
      <div className="text-center max-w-[420px]">
        <span
          className="block text-[10px] uppercase tracking-[0.24em] text-muted-foreground/55 mb-4"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          Empty surface
        </span>
        <p
          className="text-[20px] leading-[1.3] text-foreground/70"
          style={{ fontFamily: "var(--font-display)", fontWeight: 500 }}
        >
          {message}
        </p>
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
    <div className="flex h-full items-start justify-center px-10 pt-16">
      <div className="text-left max-w-[520px] w-full">
        <span
          className="block text-[10px] uppercase tracking-[0.24em] text-muted-foreground/55 mb-3"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          Not yet written
        </span>
        <p
          className="text-[24px] leading-[1.2] text-foreground/85 mb-5"
          style={{ fontFamily: "var(--font-display)", fontWeight: 500 }}
        >
          This file doesn't exist on disk yet — start it from a template,
          or let the agent draft it.
        </p>
        <div className="flex items-baseline gap-3 mb-7">
          <span
            className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground/55"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            Path
          </span>
          <span
            className="text-[11px] text-muted-foreground/80 truncate"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {path}
          </span>
        </div>
        <button
          type="button"
          onClick={onCreate}
          className={cn(
            // Typographic CTA — matches the editorial empty-state register
            // (display kicker + display sentence above) instead of a chunky
            // filled button. Coral hairline under the label tightens to a
            // full Coral text colour on hover. `.press` (from the animation
            // pass) gives it the same interactive feedback as every other
            // button in the app.
            "press group inline-flex items-baseline gap-2 px-0 py-1",
            "text-[13px] tracking-[0.02em] text-foreground",
            "border-b border-primary hover:text-primary",
          )}
          style={{ fontFamily: "var(--font-body)", fontWeight: 500 }}
        >
          <span>Create starter</span>
          <span
            className="text-[10px] tracking-[0.22em] uppercase text-muted-foreground/60 group-hover:text-primary/80 transition-colors"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            ↵
          </span>
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
  if (kind === "scene") return <Film className={cls} />
  if (kind === "shot") return <Camera className={cls} />
  if (kind === "file") return <FileText className={cls} />
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
    case "file":
      return "File"
    default:
      return "File"
  }
}

function SaveIndicator({ state }: { state: "idle" | "saving" | "saved" | "error" }) {
  // Idle: a quiet dot — present so the chrome doesn't jump when state
  // transitions in. Active states swap the dot for status type.
  const baseCls =
    "flex items-center gap-1.5 text-[10px] uppercase tracking-[0.22em]"
  const fontStyle = { fontFamily: "var(--font-mono)" } as const

  if (state === "idle") {
    return (
      <span
        className={cn(baseCls, "text-muted-foreground/45")}
        style={fontStyle}
      >
        <span className="inline-block w-[5px] h-[5px] rounded-full bg-muted-foreground/30" />
        Saved
      </span>
    )
  }
  if (state === "saving") {
    return (
      <span
        className={cn(baseCls, "text-muted-foreground")}
        style={fontStyle}
      >
        <Loader2 className="h-2.5 w-2.5 animate-spin" />
        Saving
      </span>
    )
  }
  if (state === "saved") {
    return (
      <span
        className={cn(baseCls, "text-primary/85")}
        style={fontStyle}
      >
        <Check className="h-2.5 w-2.5" />
        Saved
      </span>
    )
  }
  return (
    <span
      className={cn(baseCls, "text-rose-500/90 dark:text-rose-400/90")}
      style={fontStyle}
    >
      <span className="inline-block w-[5px] h-[5px] rounded-full bg-rose-500/80" />
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
    case "scene": {
      const label = "label" in active ? active.label : "Scene"
      const heading = label.toUpperCase()
      return `INT. ${heading} - DAY

(Action — what happens in this scene.)

`
    }
    case "shot":
      return `# ${"label" in active ? active.label : "Shot"}

## Frame

(What's in the frame? Composition, subject, action.)

## Camera

(Lens, movement, angle, distance.)

## Light

(Source, direction, quality, temperature.)

## Notes

(Anything else the model needs.)
`
    default:
      return `# ${"label" in active ? active.label : "Untitled"}\n\n`
  }
}
