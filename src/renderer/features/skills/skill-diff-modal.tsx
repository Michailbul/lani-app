"use client"

/**
 * SkillDiffDrawer — right-side slide-in panel that surfaces an
 * agent-proposed change to a SKILL.md.
 *
 * Why a drawer, not a center modal: the user wants to see the change
 * in context with the rest of their workspace (project tree, file
 * preview, chat). A modal yanks them out of the work; a drawer pulls
 * the change into the work. Same physical gesture as Cursor's "Open
 * in chat" panel, Stripe Dashboard's resource side-pane, Bear's note
 * inspector — slide in from the right, dim the workspace very lightly,
 * close on Apply / Dismiss / X / overlay-click / Esc.
 *
 * Visual register: editorial. Mono kicker ("SKILL CHANGE PROPOSED"),
 * display headline (skill name in Darker Grotesque), Coral hairline
 * tick as the only accent, full hairline rules between regions, no
 * coloured bg pads or shadow-bling. The diff body is the densest
 * region — keep everything else airy so the diff reads cleanly.
 */

import { memo, useMemo } from "react"
import { diffLines } from "diff"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { motion } from "motion/react"
import { Check, Loader2, X } from "lucide-react"
import { cn } from "../../lib/utils"

export interface SkillProposalForUi {
  id: string
  skillName: string
  skillPath: string
  source: "user" | "project" | "plugin"
  oldContent: string
  newContent: string
  summary: string
  createdAt: number
}

interface SkillDiffDrawerProps {
  proposal: SkillProposalForUi | null
  /** True while waiting for the resolveProposal mutation to land. */
  pending: "apply" | "dismiss" | null
  onApply: () => void
  onDismiss: () => void
  /** User closed via X / Esc / overlay — same semantics as dismiss. */
  onClose: () => void
}

interface DiffSegment {
  kind: "add" | "del" | "ctx"
  /** lines, each WITHOUT trailing newline */
  lines: string[]
  /** True for the synthetic "… N lines …" collapse marker. */
  isCollapse?: boolean
}

/**
 * Convert raw `diffLines` chunks into renderable segments. Long
 * unchanged regions get visually collapsed to head + tail with a
 * "… N lines …" marker so the diff stays scannable.
 */
function buildSegments(
  oldContent: string,
  newContent: string,
  contextLines = 3,
): DiffSegment[] {
  const chunks = diffLines(oldContent, newContent)
  const segments: DiffSegment[] = []

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]
    const text = chunk.value.replace(/\n$/, "")
    const lines = text.length > 0 ? text.split("\n") : []
    if (chunk.added) {
      segments.push({ kind: "add", lines })
    } else if (chunk.removed) {
      segments.push({ kind: "del", lines })
    } else {
      const isFirst = i === 0
      const isLast = i === chunks.length - 1
      if (lines.length > contextLines * 2 + 1 && !isFirst && !isLast) {
        segments.push({ kind: "ctx", lines: lines.slice(0, contextLines) })
        segments.push({
          kind: "ctx",
          isCollapse: true,
          lines: [`${lines.length - contextLines * 2} unchanged lines`],
        })
        segments.push({ kind: "ctx", lines: lines.slice(-contextLines) })
      } else if (isFirst && lines.length > contextLines + 1) {
        segments.push({
          kind: "ctx",
          isCollapse: true,
          lines: [`${lines.length - contextLines} unchanged lines`],
        })
        segments.push({ kind: "ctx", lines: lines.slice(-contextLines) })
      } else if (isLast && lines.length > contextLines + 1) {
        segments.push({ kind: "ctx", lines: lines.slice(0, contextLines) })
        segments.push({
          kind: "ctx",
          isCollapse: true,
          lines: [`${lines.length - contextLines} unchanged lines`],
        })
      } else {
        segments.push({ kind: "ctx", lines })
      }
    }
  }

  return segments
}

function diffStats(oldContent: string, newContent: string) {
  const chunks = diffLines(oldContent, newContent)
  let added = 0
  let removed = 0
  for (const chunk of chunks) {
    if (!chunk.added && !chunk.removed) continue
    const lineCount = chunk.value.replace(/\n$/, "").split("\n").length
    if (chunk.added) added += lineCount
    else removed += lineCount
  }
  return { added, removed }
}

const SOURCE_LABEL: Record<SkillProposalForUi["source"], string> = {
  user: "User",
  project: "Project",
  plugin: "Plugin",
}

export const SkillDiffDrawer = memo(function SkillDiffDrawer({
  proposal,
  pending,
  onApply,
  onDismiss,
  onClose,
}: SkillDiffDrawerProps) {
  const open = !!proposal

  const segments = useMemo(
    () =>
      proposal
        ? buildSegments(proposal.oldContent, proposal.newContent)
        : [],
    [proposal?.id],
  )
  const stats = useMemo(
    () =>
      proposal
        ? diffStats(proposal.oldContent, proposal.newContent)
        : { added: 0, removed: 0 },
    [proposal?.id],
  )

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next && proposal && !pending) onClose()
      }}
    >
      <DialogPrimitive.Portal>
        {/* Very soft backdrop — we want the workspace to stay visible
            so the user keeps context. Just a hint that something is
            modal-blocking. */}
        <DialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 z-50 bg-foreground/[0.04] backdrop-blur-[1px]",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
          )}
        />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={cn(
            "fixed right-0 top-0 bottom-0 z-50 flex flex-col",
            "w-[min(720px,calc(100vw-3rem))]",
            "bg-background border-l border-border",
            "shadow-[-24px_0_60px_-30px_rgba(0,0,0,0.25)]",
            "outline-none",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right",
            "duration-200 [animation-timing-function:cubic-bezier(0.2,0.8,0.2,1)]",
          )}
        >
          {proposal && (
            <DrawerBody
              proposal={proposal}
              pending={pending}
              segments={segments}
              stats={stats}
              onApply={onApply}
              onDismiss={onDismiss}
              onClose={onClose}
            />
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
})

// ──────────────────────────────────────────────────────────────────────
// Body — kept separate so the entrance animation orchestration is
// scoped to a re-mounted node when a new proposal pops, instead of the
// outer Radix container which only animates on open/close transitions.
// ──────────────────────────────────────────────────────────────────────

interface DrawerBodyProps extends Omit<SkillDiffDrawerProps, "proposal"> {
  proposal: SkillProposalForUi
  segments: DiffSegment[]
  stats: { added: number; removed: number }
}

function DrawerBody({
  proposal,
  pending,
  segments,
  stats,
  onApply,
  onDismiss,
  onClose,
}: DrawerBodyProps) {
  return (
    <>
      {/* ── Header ───────────────────────────────────────────────── */}
      <header className="relative shrink-0 px-7 pt-7 pb-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            {/* Mono kicker with Coral hairline tick — same idiom as
                EntityEditor's masthead, so the drawer sits in the same
                editorial register as the rest of the workspace. */}
            <div className="flex items-center gap-2">
              <span
                aria-hidden
                className="inline-block w-[14px] h-[1px] bg-primary"
              />
              <span
                className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground/80"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                Skill change proposed
              </span>
              <span className="text-muted-foreground/30">·</span>
              <span
                className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground/65"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                {SOURCE_LABEL[proposal.source]}
              </span>
            </div>

            {/* Display headline */}
            <DialogPrimitive.Title asChild>
              <motion.h2
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, delay: 0.04 }}
                className="mt-3 text-[26px] leading-[1.1] tracking-[-0.012em] text-foreground truncate"
                style={{ fontFamily: "var(--font-display)", fontWeight: 600 }}
                title={proposal.skillName}
              >
                {proposal.skillName}
              </motion.h2>
            </DialogPrimitive.Title>

            {proposal.summary && (
              <motion.p
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.22, delay: 0.08 }}
                className="mt-3 text-[14px] leading-[1.55] text-foreground/80 break-words"
                style={{ fontFamily: "var(--font-body)" }}
              >
                {proposal.summary}
              </motion.p>
            )}

            <p
              className="mt-3 text-[10.5px] tracking-tight text-muted-foreground/55 truncate"
              style={{ fontFamily: "var(--font-mono)" }}
              title={proposal.skillPath}
            >
              {proposal.skillPath}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={!!pending}
            aria-label="Close"
            className={cn(
              "press shrink-0 -mt-1 -mr-1 h-8 w-8 rounded-full",
              "flex items-center justify-center",
              "text-muted-foreground/70 hover:text-foreground",
              "hover:bg-foreground/[0.05]",
              "disabled:opacity-40 disabled:pointer-events-none",
              "transition-colors duration-150",
            )}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      {/* Hairline + diff stats — single line under the masthead, same
          rhythm as EntityEditor's bottom rule + path. */}
      <div className="px-7">
        <div className="h-px bg-border/70" />
      </div>
      <div className="shrink-0 px-7 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className="text-[10px] uppercase tracking-[0.20em] text-muted-foreground/65"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            Diff
          </span>
          <span
            className="flex items-center gap-1.5 text-[11.5px] tabular-nums"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            <span className="text-emerald-700 dark:text-emerald-400">
              +{stats.added}
            </span>
            <span className="text-muted-foreground/35">·</span>
            <span className="text-rose-700 dark:text-rose-400">
              −{stats.removed}
            </span>
          </span>
        </div>
        <span
          className="text-[10px] uppercase tracking-[0.20em] text-muted-foreground/45"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          SKILL.md
        </span>
      </div>

      {/* ── Diff body ───────────────────────────────────────────── */}
      <div
        className={cn(
          "flex-1 min-h-0 overflow-auto",
          "border-y border-border/60",
          // very faint zebra by region — the segment chrome itself
          // carries the green/red so the container can stay neutral
          "bg-muted/20",
        )}
      >
        <pre
          className="text-[12.5px] leading-[1.65] m-0 py-3"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {segments.map((seg, idx) => (
            <DiffBlock key={idx} seg={seg} />
          ))}
        </pre>
      </div>

      {/* ── Footer ──────────────────────────────────────────────── */}
      <footer className="shrink-0 px-7 py-4 flex items-center justify-between gap-3">
        <p className="text-[11px] text-muted-foreground/65 leading-[1.5] max-w-[280px]">
          Apply writes the file. Dismiss leaves it untouched. Either way the
          agent is told the verdict.
        </p>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onDismiss}
            disabled={!!pending}
            className={cn(
              "press h-9 px-4 rounded-md",
              "text-[13px] text-foreground/80 hover:text-foreground",
              "hover:bg-foreground/[0.04]",
              "disabled:opacity-50 disabled:pointer-events-none",
              "transition-colors duration-150",
            )}
            style={{ fontFamily: "var(--font-body)", fontWeight: 500 }}
          >
            {pending === "dismiss" ? (
              <span className="inline-flex items-center gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Dismissing
              </span>
            ) : (
              "Dismiss"
            )}
          </button>
          <button
            type="button"
            onClick={onApply}
            disabled={!!pending}
            className={cn(
              "press h-9 px-5 rounded-md",
              "bg-primary text-primary-foreground",
              "hover:bg-primary/90",
              "shadow-[0_1px_0_0_hsl(var(--primary)_/_0.6)]",
              "disabled:opacity-60 disabled:pointer-events-none",
              "transition-colors duration-150",
              "inline-flex items-center gap-1.5 text-[13px]",
            )}
            style={{ fontFamily: "var(--font-body)", fontWeight: 500 }}
          >
            {pending === "apply" ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Applying
              </>
            ) : (
              <>
                <Check className="h-3.5 w-3.5" />
                Apply change
              </>
            )}
          </button>
        </div>
      </footer>
    </>
  )
}

/**
 * One contiguous block of diff lines. Adds + dels get a 2px Coral-ish
 * left accent bar (green/red respectively) and a very faint background
 * tint. Context is plain. Collapse markers render as a single italic
 * mono line.
 */
function DiffBlock({ seg }: { seg: DiffSegment }) {
  if (seg.lines.length === 0) return null

  if (seg.kind === "ctx") {
    if (seg.isCollapse) {
      return (
        <div className="px-7 py-1 text-muted-foreground/45 italic select-none flex items-center gap-2">
          <span className="inline-block w-3 h-px bg-muted-foreground/30" />
          <span>{seg.lines[0]}</span>
          <span className="inline-block flex-1 h-px bg-muted-foreground/15" />
        </div>
      )
    }
    return (
      <div className="px-7 text-foreground/55">
        {seg.lines.map((line, i) => (
          <div key={i} className="whitespace-pre-wrap break-words">
            <span className="inline-block w-3 mr-2 select-none text-muted-foreground/30">
              {" "}
            </span>
            {line || " "}
          </div>
        ))}
      </div>
    )
  }

  const isAdd = seg.kind === "add"
  return (
    <div
      className={cn(
        "pl-7 pr-7 py-[1px] border-l-2",
        isAdd
          ? "bg-emerald-500/[0.045] border-emerald-500/55 text-emerald-900 dark:bg-emerald-400/[0.06] dark:border-emerald-400/55 dark:text-emerald-100"
          : "bg-rose-500/[0.045] border-rose-500/50 text-rose-900 dark:bg-rose-400/[0.06] dark:border-rose-400/50 dark:text-rose-100",
      )}
    >
      {seg.lines.map((line, i) => (
        <div key={i} className="whitespace-pre-wrap break-words">
          <span
            className={cn(
              "inline-block w-3 mr-2 select-none",
              isAdd
                ? "text-emerald-600/80 dark:text-emerald-400/80"
                : "text-rose-600/80 dark:text-rose-400/80",
            )}
          >
            {isAdd ? "+" : "−"}
          </span>
          {line || " "}
        </div>
      ))}
    </div>
  )
}
