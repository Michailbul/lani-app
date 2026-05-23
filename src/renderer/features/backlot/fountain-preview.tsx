"use client"

/**
 * FountainPreview — typeset rendering of a Fountain screenplay.
 *
 * Industry conventions, ported to screen:
 *   • 8.5" × 11" "page" with 1.5" left / 1" right margin (~6" body width)
 *   • Courier-family typewriter face — we stack Courier Prime, Courier New,
 *     Courier, monospace. 12pt is canonical; we render at 13px on screen
 *     for legibility (small enough to feel pro, large enough to read on
 *     a 27" display).
 *   • Scene headings in caps, hairline above + a touch of breathing room
 *   • Shot headings: Backlot's visible `SHOT A:` director-screenwriter blocks
 *   • Character names indented ~3.7" from the page left edge (caps)
 *   • Parentheticals indented ~3.1" (italic, in parens)
 *   • Dialogue indented ~2.5", wrapped to ~3.5" wide
 *   • Transitions right-aligned, caps
 *   • Centered: literal centre on the page
 *   • Sections: above-the-line scaffolding (the writer's outline) —
 *     rendered as italic kicker text in the brand register, NOT as
 *     part of the typeset page (industry convention; Final Draft hides
 *     them in print mode)
 *
 * The actual indents are in `em` so the layout scales with the font
 * size; values come from Final Draft's defaults.
 */

import { memo, useMemo } from "react"
import {
  parseFountain,
  parseInlineEmphasis,
  type FountainBlock,
} from "./fountain-parser"
import { cn } from "../../lib/utils"

/**
 * Render a string with Fountain inline emphasis (italic/bold/
 * bold-italic/underline) resolved into actual marks. The markers
 * themselves (`*`, `**`, `***`, `_`) are stripped — what the writer
 * sees on the page is the typeset emphasis, not the markup.
 */
function InlineText({ text }: { text: string }) {
  const segments = parseInlineEmphasis(text)
  if (segments.length === 0) return null
  return (
    <>
      {segments.map((seg, i) => {
        switch (seg.kind) {
          case "italic":
            return <em key={i}>{seg.text}</em>
          case "bold":
            return <strong key={i}>{seg.text}</strong>
          case "bold-italic":
            return (
              <strong key={i}>
                <em>{seg.text}</em>
              </strong>
            )
          case "underline":
            return (
              <span key={i} className="underline underline-offset-[3px]">
                {seg.text}
              </span>
            )
          default:
            return <span key={i}>{seg.text}</span>
        }
      })}
    </>
  )
}

/**
 * Render a character cue. If the cue carries an emotion tag in
 * brackets — `MOTHER [low, clipped, eyes on the Bentley]` — the tag
 * stacks as its own block beneath the name, muted and italicised.
 * The name stays the loudest element of the block.
 */
function CharacterCueText({ text }: { text: string }) {
  const match = /^([^\[]+?)(\s*\[[\s\S]*\])?$/.exec(text)
  if (!match) {
    return <span className="uppercase">{text}</span>
  }
  const name = match[1]?.trimEnd() ?? text
  const tag = match[2]?.trim() ?? ""
  return (
    <>
      <span className="uppercase tracking-[0.04em]">
        <InlineText text={name} />
      </span>
      {tag && (
        <span
          className={cn(
            "block normal-case italic font-normal",
            "text-[0.92em] mt-[0.05em]",
            "text-muted-foreground/90",
          )}
        >
          <InlineText text={tag} />
        </span>
      )}
    </>
  )
}

interface FountainPreviewProps {
  source: string
  className?: string
}

export const FountainPreview = memo(function FountainPreview({
  source,
  className,
}: FountainPreviewProps) {
  const blocks = useMemo(() => parseFountain(source), [source])

  if (blocks.length === 0) {
    return (
      <div className={cn("max-w-[760px] mx-auto px-12 pt-2", className)}>
        <span
          className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground/55"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          Empty screenplay — click to start writing
        </span>
      </div>
    )
  }

  return (
    <div className={cn("max-w-[720px] mx-auto px-10 pt-2 pb-24", className)}>
      <article
        className={cn(
          "w-full",
          "bg-transparent",
          "text-foreground",
        )}
        style={{
          fontFamily:
            '"Courier Prime", "Courier New", Courier, ui-monospace, monospace',
          fontSize: "13px",
          lineHeight: "1.55",
        }}
      >
        {blocks.map((block, idx) => (
          <BlockRenderer key={idx} block={block} />
        ))}
      </article>
    </div>
  )
})

function BlockRenderer({ block }: { block: FountainBlock }) {
  switch (block.kind) {
    case "title-page":
      return <TitlePageBlock entries={block.entries} />
    case "scene-heading":
      return (
        <h2
          className={cn(
            "uppercase tracking-[0.02em]",
            "mt-[1.6em] first:mt-0 mb-[0.6em]",
            "font-bold",
          )}
        >
          {block.text}
        </h2>
      )
    case "shot-heading":
      return (
        <p
          className={cn(
            "mt-[1.35em] mb-[0.45em]",
            "font-bold tracking-[0.03em]",
            "text-primary/90",
          )}
        >
          <InlineText text={block.text} />
        </p>
      )
    case "action":
      return (
        <p className="my-[0.9em] whitespace-pre-wrap break-words">
          <InlineText text={block.text} />
        </p>
      )
    case "character":
      // Character cues collapse to a centered column under the action
      // block above. Responsive padding-inline (clamp) keeps the column
      // narrow on wide rails and roomy on narrow ones, instead of
      // falling off the right edge the way a fixed em-indent does.
      return (
        <p
          className={cn(
            "mt-[1.1em] mb-0 font-bold text-center",
            "tracking-[0.04em]",
          )}
          style={{ paddingInline: "clamp(0.5em, 14%, 6em)" }}
        >
          <CharacterCueText text={block.text} />
          {block.dual && (
            <span className="text-muted-foreground/60 ml-1">^</span>
          )}
        </p>
      )
    case "parenthetical":
      return (
        <p
          className="italic text-muted-foreground/95 my-0 text-center"
          style={{ paddingInline: "clamp(0.5em, 22%, 9em)" }}
        >
          (<InlineText text={block.text} />)
        </p>
      )
    case "dialogue":
      // Brand accent on dialogue gives the page a glanceable rhythm:
      // olive/lime for the lines that animate, ink for the lines that
      // describe. The block stays centered no matter the rail width.
      return (
        <p
          className={cn(
            "my-0 whitespace-pre-wrap break-words text-center",
            "text-[hsl(var(--accent-deep))]",
          )}
          style={{ paddingInline: "clamp(0.5em, 12%, 5em)" }}
        >
          <InlineText text={block.text} />
        </p>
      )
    case "transition":
      return (
        <p
          className={cn(
            "uppercase tracking-[0.02em]",
            "mt-[1em] mb-[1em]",
            "text-right",
            "font-medium",
          )}
        >
          {block.text}
        </p>
      )
    case "centered":
      return (
        <p className="text-center my-[0.9em] uppercase">
          <InlineText text={block.text} />
        </p>
      )
    case "section":
      // Sections sit above the typeset page in the writer's outline;
      // render in the brand register as a margin marker so the writer
      // knows where they are without it polluting the printed look.
      return (
        <div
          className={cn(
            "not-prose my-[1.4em] flex items-baseline gap-2",
            "text-muted-foreground/75",
          )}
          style={{
            fontFamily: "var(--font-mono)",
          }}
        >
          <span
            aria-hidden
            className="inline-block w-[10px] h-[1px] bg-primary/80 translate-y-[-3px]"
          />
          <span
            className={cn(
              "uppercase tracking-[0.18em]",
              block.level === 1
                ? "text-[10px] font-semibold text-foreground/80"
                : "text-[9.5px] text-muted-foreground/75",
            )}
          >
            {block.text}
          </span>
        </div>
      )
    case "page-break":
      return (
        <div
          className="my-[2em] border-t border-dashed border-border/60 select-none relative"
          aria-label="Page break"
        >
          <span
            className="absolute right-0 -top-2.5 px-1 bg-background text-[9px] uppercase tracking-[0.18em] text-muted-foreground/55"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            Page break
          </span>
        </div>
      )
    default:
      return null
  }
}

/**
 * Title block — Title centred, Author below in smaller register, then
 * ancillary keys (Source, Draft date, Contact) right-aligned in a
 * compact strip below. Centre-aligned, separated from the body by a
 * generous gutter.
 */
function TitlePageBlock({
  entries,
}: {
  entries: Array<{ key: string; value: string }>
}) {
  const find = (k: string) =>
    entries.find((e) => e.key.toLowerCase() === k.toLowerCase())?.value
  const title = find("title")
  const credit = find("credit") ?? "written by"
  const author = find("author") ?? find("authors")
  const source = find("source")
  const draftDate = find("draft date") ?? find("date")
  const contact = find("contact")
  const notes = find("notes")

  // If a fountain file uses non-standard keys, we still want to show
  // them — render anything we didn't capture above as a key/value
  // appendix.
  const standardKeys = new Set([
    "title",
    "credit",
    "author",
    "authors",
    "source",
    "draft date",
    "date",
    "contact",
    "notes",
  ])
  const otherEntries = entries.filter(
    (e) => !standardKeys.has(e.key.toLowerCase()),
  )

  return (
    <header
      className="text-center mb-[3.5em]"
      style={{ minHeight: "11em" }}
    >
      {title && (
        <h1
          className="uppercase tracking-[0.04em] font-bold text-[18px] leading-[1.25] mb-[1.4em]"
          style={{ wordBreak: "break-word" }}
        >
          {title}
        </h1>
      )}
      {(credit || author) && (
        <div className="leading-[1.65] mb-[1.4em]">
          {credit && (
            <p className="italic text-foreground/75 my-0">{credit}</p>
          )}
          {author && (
            <p className="my-0 text-foreground/95 uppercase tracking-[0.02em]">
              {author}
            </p>
          )}
        </div>
      )}
      {source && (
        <p className="italic text-foreground/75 my-[0.4em]">{source}</p>
      )}

      {(draftDate || contact || notes || otherEntries.length > 0) && (
        <div
          className="mt-[2.5em] flex flex-col items-end gap-[0.2em] text-[12px] text-foreground/80"
          style={{ paddingRight: "1em" }}
        >
          {draftDate && <span>{draftDate}</span>}
          {contact && <span className="whitespace-pre">{contact}</span>}
          {notes && <span className="italic">{notes}</span>}
          {otherEntries.map((e) => (
            <span key={e.key}>
              <span className="text-muted-foreground/65 mr-2">{e.key}:</span>
              {e.value}
            </span>
          ))}
        </div>
      )}
    </header>
  )
}
