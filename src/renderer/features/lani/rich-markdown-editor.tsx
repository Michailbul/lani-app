"use client"

/**
 * RichMarkdownEditor — TipTap-backed WYSIWYG markdown editor.
 *
 * The editor's job: let the user write markdown without ever seeing
 * the markdown markup. Headings render as headings while you type;
 * `**bold**` becomes bold; `## heading` becomes a heading the moment
 * you type a space; bullet lists, blockquotes, code, all rendered
 * live. Same typography as MarkdownPreview so the writer never feels
 * a visual jolt between read-mode and edit-mode.
 *
 * Frontmatter is parsed off the top before content reaches TipTap and
 * rendered as a styled non-editable strip above the editor (mirrors
 * MarkdownPreview's FrontmatterBlock). On serialize, the frontmatter
 * is re-stitched onto the body markdown so the on-disk file stays
 * intact. To edit frontmatter the user toggles to Source mode.
 *
 * Used by EntityEditor for any markdown entity (brief, world bible,
 * characters, etc). Fountain files keep the raw textarea since they
 * aren't markdown.
 */

import { memo, useCallback, useEffect, useRef } from "react"
import matter from "gray-matter"
import { useEditor, EditorContent } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import { Markdown } from "tiptap-markdown"
import { cn } from "../../lib/utils"

interface RichMarkdownEditorProps {
  /** Raw file content — frontmatter + body. */
  value: string
  /** Called with the full file content (frontmatter re-stitched). */
  onChange: (next: string) => void
  /** Called when the editor loses focus — typically used to flush. */
  onBlur?: () => void
  /** Focus the editor on mount (when editable). */
  autoFocus?: boolean
  /**
   * Whether the editor accepts input. Defaults to true. When false
   * the editor renders identically to the editable mode (same DOM,
   * same typography) but ignores keystrokes — used by EntityEditor
   * to flip between "rendered preview" and "rich edit" without
   * remounting a different component, which is what caused the
   * click-to-edit displacement bug.
   */
  editable?: boolean
  /**
   * Viewport-relative click coords (clientX, clientY). When provided,
   * after the editor mounts we map the coords to a ProseMirror
   * position and place the cursor there. Used by EntityEditor's
   * click-to-edit flow so the user's cursor lands where they clicked
   * on the rendered preview, not at the end of the document.
   */
  focusPoint?: { x: number; y: number } | null
  /**
   * How the frontmatter strip is rendered. "entity" (default) is the
   * compact metadata grid screenplay entities use. "skill" renders the
   * Skill Workbench preamble card — skill name as a title, description
   * as prose, remaining keys as a meta grid.
   */
  frontmatterVariant?: "entity" | "skill"
  className?: string
}

type MarkdownStorage = {
  markdown: {
    getMarkdown: () => string
  }
}

/**
 * Pull frontmatter off the top of a file, leaving the body markdown.
 * Empty / malformed frontmatter falls through to body-only mode so a
 * mid-edit broken state still shows what's there.
 */
function splitFrontmatter(content: string): {
  data: Record<string, unknown> | null
  rawHeader: string
  body: string
} {
  const normalized = content.replace(/^\uFEFF/, "")
  const frontmatterMatch = normalized.match(
    /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/,
  )

  if (!frontmatterMatch) {
    return { data: null, rawHeader: "", body: content }
  }

  const rawHeader = frontmatterMatch[0]
  const fallbackBody = normalized.slice(rawHeader.length).replace(/^\r?\n+/, "")

  try {
    const parsed = matter(normalized)
    const data = parsed.data ?? {}
    if (Object.keys(data).length === 0) {
      return { data: null, rawHeader: "", body: fallbackBody }
    }
    return {
      data: data as Record<string, unknown>,
      rawHeader,
      body: fallbackBody,
    }
  } catch {
    return { data: null, rawHeader: "", body: fallbackBody }
  }
}

function formatFrontmatterValue(value: unknown): string {
  if (value == null) return ""
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value)
  }
  if (Array.isArray(value)) {
    return value.map((v) => formatFrontmatterValue(v)).join(", ")
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10)
  }
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/**
 * The metadata strip rendered above the editor. Identical visual
 * register to MarkdownPreview's FrontmatterBlock — the writer should
 * not see a layout difference between read-mode and edit-mode.
 */
function FrontmatterReadonly({
  data,
}: {
  data: Record<string, unknown>
}) {
  const entries: Array<{ key: string; value: string }> = []
  for (const [key, raw] of Object.entries(data)) {
    const value = formatFrontmatterValue(raw)
    if (!value) continue
    entries.push({ key, value })
  }

  if (entries.length === 0) return null

  return (
    // No extra divider here — the entity-editor header already
    // terminates in a hairline rule.
    <section
      className="relative not-prose mb-8"
      aria-label="File metadata"
      // Block click-to-edit propagation: clicking on the metadata
      // strip should not move the cursor into the body editor.
      onClick={(e) => e.stopPropagation()}
    >
      <dl className="grid grid-cols-[110px_1fr] gap-x-5 gap-y-2 max-w-[640px]">
        {entries.map(({ key, value }) => (
          <div key={key} className="contents">
            <dt
              className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 leading-[1.6] pt-[3px]"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              {key}
            </dt>
            <dd
              className="text-[13px] text-foreground/85 leading-[1.55] whitespace-pre-wrap break-words"
              style={{ fontFamily: "var(--font-body)" }}
            >
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

/**
 * The Skill Workbench preamble card. Renders a skill's frontmatter as
 * a designed header instead of raw YAML — name as a title, description
 * as readable prose, remaining keys as a hairline-divided meta grid.
 */
function SkillPreamble({
  data,
}: {
  data: Record<string, unknown>
}) {
  const name =
    typeof data.name === "string" && data.name.trim()
      ? data.name.trim()
      : null
  const description = formatFrontmatterValue(data.description).trim()

  const rest: Array<{ key: string; value: string }> = []
  for (const [key, raw] of Object.entries(data)) {
    if (key === "name" || key === "description") continue
    const value = formatFrontmatterValue(raw)
    if (!value) continue
    rest.push({ key, value })
  }

  return (
    <section
      className="not-prose mb-9"
      aria-label="Skill preamble"
      // Clicking the preamble should not drop a cursor into the body.
      onClick={(e) => e.stopPropagation()}
    >
      <div className="relative overflow-hidden rounded-xl border border-border/60 bg-foreground/[0.025] dark:bg-foreground/[0.045]">
        <div className="absolute inset-y-0 left-0 w-[3px] bg-primary/70" />
        <div className="px-5 py-4 pl-6">
          <div className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            <span
              className="text-[10px] uppercase tracking-[0.22em] text-primary/85"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              Skill
            </span>
          </div>

          {name && (
            <h2
              className="mt-2 text-[18px] font-semibold leading-tight text-foreground"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              {name}
            </h2>
          )}

          {description && (
            <p
              className="mt-2 max-w-[640px] whitespace-pre-wrap break-words text-[13px] leading-[1.62] text-foreground/75"
              style={{ fontFamily: "var(--font-body)" }}
            >
              {description}
            </p>
          )}

          {rest.length > 0 && (
            <dl className="mt-4 grid max-w-[640px] grid-cols-[110px_1fr] gap-x-5 gap-y-2 border-t border-border/50 pt-3">
              {rest.map(({ key, value }) => (
                <div key={key} className="contents">
                  <dt
                    className="pt-[3px] text-[10px] uppercase tracking-[0.18em] leading-[1.6] text-muted-foreground/70"
                    style={{ fontFamily: "var(--font-mono)" }}
                  >
                    {key}
                  </dt>
                  <dd
                    className="whitespace-pre-wrap break-words text-[12.5px] leading-[1.55] text-foreground/80"
                    style={{ fontFamily: "var(--font-body)" }}
                  >
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </div>
    </section>
  )
}

export const RichMarkdownEditor = memo(function RichMarkdownEditor({
  value,
  onChange,
  onBlur,
  autoFocus,
  editable = true,
  focusPoint,
  frontmatterVariant = "entity",
  className,
}: RichMarkdownEditorProps) {
  // Split on every render — cheap, and we need fresh frontmatter when
  // the source file is updated externally (poll picks up agent edits).
  const { data, rawHeader, body } = splitFrontmatter(value)

  // Track the last serialized body that we *emitted* — used to guard
  // the external-update effect against feedback loops.
  const lastEmittedBodyRef = useRef<string>(body)
  const rawHeaderRef = useRef<string>(rawHeader)
  rawHeaderRef.current = rawHeader

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // We render h1/h2/h3/h4/h5/h6 — let StarterKit cover all six.
        heading: { levels: [1, 2, 3, 4, 5, 6] },
        // Keep paragraph hard-break behaviour predictable: `Enter`
        // splits, `Shift-Enter` inserts a hard break.
        codeBlock: { HTMLAttributes: { class: "rich-codeblock" } },
      }),
      Markdown.configure({
        html: false,
        tightLists: true,
        breaks: true,
        linkify: true,
        transformPastedText: true,
        transformCopiedText: true,
      }),
    ],
    content: body,
    editable,
    // When focusPoint is provided we'll place the cursor explicitly
    // after mount via posAtCoords; suppress the SDK's default "end"
    // jump in that case so the cursor doesn't visibly snap twice.
    autofocus: autoFocus && editable && !focusPoint ? "end" : false,
    editorProps: {
      attributes: {
        // The class hooks the ProseMirror surface into our editorial
        // typography. CSS is in styles/globals.css under `.rich-prose`.
        // No min-height — letting the surface size to its content
        // means clicking the rendered preview doesn't suddenly snap
        // the edit area to 40% viewport (which felt like the page
        // was "expanding" on click). The editor grows naturally as
        // the user types.
        //
        // The skill variant adds `rich-prose-skill`, which tints
        // headings with the brand accent (Lime). The screenplay
        // entity editor keeps ink-coloured headings.
        class: cn(
          "rich-prose focus:outline-none",
          frontmatterVariant === "skill" && "rich-prose-skill",
        ),
      },
    },
    onUpdate: ({ editor }) => {
      const md = (
        editor.storage as unknown as MarkdownStorage
      ).markdown.getMarkdown()
      lastEmittedBodyRef.current = md
      const stitched =
        rawHeaderRef.current.length > 0
          ? `${rawHeaderRef.current}${md}`
          : md
      onChange(stitched)
    },
    onBlur: () => {
      onBlur?.()
    },
  })

  // Pull the editor in sync when the file content changes from the
  // outside (poll, agent edit, mode switch). Avoid replacing content
  // when the user is mid-keystroke or the body just round-tripped
  // through us.
  useEffect(() => {
    if (!editor) return
    if (editor.isFocused) return
    if (body === lastEmittedBodyRef.current) return
    editor.commands.setContent(body, { emitUpdate: false })
  }, [editor, body])

  // Keep the editor's editable flag in sync with the prop. This is
  // the seam that makes "rendered preview" and "rich edit" the SAME
  // mounted editor — only this flag changes on click, so the DOM
  // never remounts and the page can't shift on the swap.
  useEffect(() => {
    if (!editor) return
    if (editor.isEditable !== editable) {
      editor.setEditable(editable, false)
    }
  }, [editor, editable])

  // Click-to-edit cursor placement. Fires when (a) editor is editable
  // AND (b) we have fresh click coords — i.e. the user just clicked
  // the read-only surface to start editing. We translate coords to a
  // ProseMirror position via `posAtCoords` and drop the cursor there
  // with `preventScroll: true` so focusing doesn't yank the viewport.
  useEffect(() => {
    if (!editor || !editable || !focusPoint) return
    const raf = requestAnimationFrame(() => {
      try {
        const pos = editor.view.posAtCoords({
          left: focusPoint.x,
          top: focusPoint.y,
        })
        if (pos && typeof pos.pos === "number") {
          editor.chain().focus(pos.pos, { scrollIntoView: false }).run()
          return
        }
      } catch {
        /* fall through */
      }
      editor.commands.focus("start", { scrollIntoView: false })
    })
    return () => cancelAnimationFrame(raf)
    // Key on focusPoint identity — every fresh click delivers a new
    // object so the cursor re-places correctly.
  }, [editor, editable, focusPoint])

  return (
    <div className={cn("max-w-[720px] mx-auto px-10 pt-2 pb-24", className)}>
      {data &&
        (frontmatterVariant === "skill" ? (
          <SkillPreamble data={data} />
        ) : (
          <FrontmatterReadonly data={data} />
        ))}
      <EditorContent editor={editor} />
    </div>
  )
})
