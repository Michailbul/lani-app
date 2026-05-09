"use client"

/**
 * MarkdownPreview — the rendered surface for a Backlot markdown file.
 *
 * Two parts:
 *
 *   1. **Frontmatter block** — the YAML preamble between `---` … `---`
 *      at the top of the file is parsed with gray-matter and rendered
 *      as a refined metadata strip: kicker mono labels, body values,
 *      restrained Coral hairline. Distinct from body, but quiet.
 *
 *   2. **Body** — markdown rendered with editorial typography. Reuses
 *      Streamdown (already a dep) for parsing, supplies its own
 *      component map for headings (Darker Grotesque), paragraphs
 *      (Inter at comfortable measure), blockquotes (Coral nib),
 *      lists, code, hairline rules. Tuned for prose, not chat.
 *
 * Pure presentation — no editing, no I/O. The parent (EntityEditor)
 * passes raw file content and decides when to swap to the textarea
 * editor. Click handling for click-to-edit lives there too.
 */

import { memo, useMemo } from "react"
import matter from "gray-matter"
import { Streamdown } from "streamdown"
import remarkBreaks from "remark-breaks"
import remarkGfm from "remark-gfm"
import { cn } from "../../lib/utils"

interface MarkdownPreviewProps {
  /** Raw file content — frontmatter + body. */
  content: string
  className?: string
}

/**
 * Try to parse YAML frontmatter from the file. Returns the parsed
 * front-matter data (or null if absent) plus the body without the
 * frontmatter delimiters. We swallow parse errors so a malformed YAML
 * preamble still renders the body — the user is in the middle of
 * editing, things are sometimes broken.
 */
function safeParseFrontmatter(content: string): {
  data: Record<string, unknown> | null
  body: string
} {
  // Quick sniff — gray-matter only looks for `---\n` at the very start.
  if (!content.startsWith("---")) {
    return { data: null, body: content }
  }
  try {
    const parsed = matter(content)
    const data = parsed.data ?? {}
    if (Object.keys(data).length === 0) {
      // Empty frontmatter or parse no-op. Drop the delimiters anyway.
      return { data: null, body: parsed.content.trim() }
    }
    return {
      data: data as Record<string, unknown>,
      body: parsed.content.trim(),
    }
  } catch {
    // Malformed YAML. Render whole content as body.
    return { data: null, body: content }
  }
}

/**
 * Stringify a frontmatter value for display. Strings, numbers and
 * booleans render flat; arrays become comma-separated; objects become
 * compact JSON. Multi-line strings preserve linebreaks via CSS.
 */
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
 * The metadata strip rendered above the body. Two-column grid: mono
 * kicker key on the left, body value on the right. Coral hairline at
 * the top sets it apart from the body without yelling. Reads more like
 * the colophon of a book than a database row.
 */
function FrontmatterBlock({
  data,
}: {
  data: Record<string, unknown>
}) {
  const entries = useMemo(() => {
    const out: Array<{ key: string; value: string }> = []
    for (const [key, raw] of Object.entries(data)) {
      const value = formatFrontmatterValue(raw)
      if (!value) continue
      out.push({ key, value })
    }
    return out
  }, [data])

  if (entries.length === 0) return null

  return (
    <section
      className={cn(
        "relative not-prose mb-8",
        "border-t border-primary/40",
        "pt-4",
      )}
      aria-label="File metadata"
    >
      <dl className="grid grid-cols-[110px_1fr] gap-x-5 gap-y-2 max-w-[640px]">
        {entries.map(({ key, value }) => (
          <div
            key={key}
            className="contents"
            // `display: contents` so the grid columns flow through dt/dd
          >
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
      <div className="mt-5 h-px bg-border/60" />
    </section>
  )
}

/**
 * The editorial markdown body. Streamdown drives parsing; the
 * component map below applies typography. No `prose` plugin — every
 * tag is styled explicitly so we keep tight control over hierarchy.
 *
 * Sizing scale (font-size / line-height):
 *   h1   28px / 1.18   Darker Grotesque 600
 *   h2   22px / 1.22   Darker Grotesque 600
 *   h3   17px / 1.30   Darker Grotesque 600 with Coral nib lead
 *   h4   14px / 1.35   Inter 600 (caps tracking)
 *   p    15px / 1.78   Inter — primary measure
 *   li   15px / 1.78   Inter
 *   blockquote        Coral 2px left rule, italic body
 *   hr                hairline + Coral 2px center notch
 *   code (inline)     JB Mono, muted bg pill
 *   pre               JB Mono, muted bg block
 */
const editorialComponents = {
  h1: ({ children, ...props }: any) => (
    <h1
      {...props}
      className="text-[28px] leading-[1.18] tracking-[-0.012em] text-foreground font-semibold mt-10 first:mt-0 mb-3"
      style={{ fontFamily: "var(--font-display)", fontWeight: 600 }}
    >
      {children}
    </h1>
  ),
  h2: ({ children, ...props }: any) => (
    <h2
      {...props}
      className="text-[22px] leading-[1.22] tracking-[-0.008em] text-foreground font-semibold mt-9 first:mt-0 mb-2.5"
      style={{ fontFamily: "var(--font-display)", fontWeight: 600 }}
    >
      {children}
    </h2>
  ),
  h3: ({ children, ...props }: any) => (
    <h3
      {...props}
      className="text-[17px] leading-[1.3] tracking-[-0.004em] text-foreground font-semibold mt-7 first:mt-0 mb-2 flex items-baseline gap-2"
      style={{ fontFamily: "var(--font-display)", fontWeight: 600 }}
    >
      <span
        aria-hidden
        className="inline-block w-[10px] h-[1.5px] bg-primary translate-y-[-3px] flex-shrink-0"
      />
      <span>{children}</span>
    </h3>
  ),
  h4: ({ children, ...props }: any) => (
    <h4
      {...props}
      className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground/85 mt-6 first:mt-0 mb-1.5 font-medium"
      style={{ fontFamily: "var(--font-mono)" }}
    >
      {children}
    </h4>
  ),
  h5: ({ children, ...props }: any) => (
    <h5
      {...props}
      className="text-[13px] text-foreground/85 mt-5 first:mt-0 mb-1 font-semibold"
      style={{ fontFamily: "var(--font-body)" }}
    >
      {children}
    </h5>
  ),
  h6: ({ children, ...props }: any) => (
    <h6
      {...props}
      className="text-[12px] text-muted-foreground mt-4 first:mt-0 mb-1 font-medium uppercase tracking-wider"
      style={{ fontFamily: "var(--font-mono)" }}
    >
      {children}
    </h6>
  ),
  p: ({ children, ...props }: any) => (
    <p
      {...props}
      className="text-[15px] leading-[1.78] text-foreground/85 my-3"
      style={{ fontFamily: "var(--font-body)" }}
    >
      {children}
    </p>
  ),
  ul: ({ children, ...props }: any) => (
    <ul
      {...props}
      className="my-3 pl-5 space-y-[3px] text-[15px] leading-[1.78] text-foreground/85 list-disc marker:text-primary/60"
      style={{ fontFamily: "var(--font-body)" }}
    >
      {children}
    </ul>
  ),
  ol: ({ children, ...props }: any) => (
    <ol
      {...props}
      className="my-3 pl-5 space-y-[3px] text-[15px] leading-[1.78] text-foreground/85 list-decimal marker:text-primary/60 marker:font-medium"
      style={{ fontFamily: "var(--font-body)" }}
    >
      {children}
    </ol>
  ),
  li: ({ children, ...props }: any) => (
    <li
      {...props}
      className="pl-1.5 [&>p]:my-0 [&>p]:inline"
    >
      {children}
    </li>
  ),
  blockquote: ({ children, ...props }: any) => (
    <blockquote
      {...props}
      className="my-5 pl-5 border-l-2 border-primary text-foreground/80 italic [&>p]:text-[15px] [&>p]:leading-[1.7] [&>p]:my-0"
      style={{ fontFamily: "var(--font-body)" }}
    >
      {children}
    </blockquote>
  ),
  hr: ({ ...props }: any) => (
    <div
      {...props}
      className="my-8 flex items-center justify-center"
      role="separator"
    >
      <div className="h-px w-full bg-border/60" />
      <span className="absolute inline-block w-[18px] h-[2px] bg-primary" />
    </div>
  ),
  a: ({ href, children, ...props }: any) => (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault()
        if (href && typeof window !== "undefined") {
          ;(window as any).desktopApi?.openExternal?.(href)
        }
      }}
      className="text-foreground border-b border-primary/60 hover:border-primary hover:text-primary transition-colors duration-150 no-underline cursor-pointer"
      {...props}
    >
      {children}
    </a>
  ),
  strong: ({ children, ...props }: any) => (
    <strong className="font-semibold text-foreground" {...props}>
      {children}
    </strong>
  ),
  em: ({ children, ...props }: any) => (
    <em className="italic text-foreground/90" {...props}>
      {children}
    </em>
  ),
  code: ({ className, children, ...props }: any) => {
    const match = /language-(\w+)/.exec(className || "")
    const isBlock = !!match || (String(children).includes("\n") && String(children).length > 80)
    if (isBlock) {
      return (
        <pre
          className="my-4 px-4 py-3 rounded-md bg-muted/60 border border-border/60 overflow-x-auto text-[12.5px] leading-[1.6] text-foreground/90"
          style={{ fontFamily: "var(--font-mono)" }}
          {...props}
        >
          <code>{children}</code>
        </pre>
      )
    }
    return (
      <code
        className="px-[0.4em] py-[0.15em] rounded bg-muted/70 border border-border/40 text-[0.9em] text-foreground/90"
        style={{ fontFamily: "var(--font-mono)" }}
        {...props}
      >
        {children}
      </code>
    )
  },
  pre: ({ children }: any) => <>{children}</>,
  table: ({ children, ...props }: any) => (
    <div className="my-5 overflow-x-auto rounded-md border border-border/70">
      <table
        {...props}
        className="w-full text-[14px] border-collapse"
        style={{ fontFamily: "var(--font-body)" }}
      >
        {children}
      </table>
    </div>
  ),
  thead: ({ children, ...props }: any) => (
    <thead {...props} className="border-b border-border/70 bg-muted/35">
      {children}
    </thead>
  ),
  tbody: ({ children, ...props }: any) => <tbody {...props}>{children}</tbody>,
  tr: ({ children, ...props }: any) => (
    <tr {...props} className="[&:not(:last-child)]:border-b [&:not(:last-child)]:border-border/55">
      {children}
    </tr>
  ),
  th: ({ children, ...props }: any) => (
    <th
      {...props}
      className="px-3 py-2 text-left text-[10px] uppercase tracking-[0.16em] font-medium text-muted-foreground/85 border-r border-border/55 last:border-r-0"
      style={{ fontFamily: "var(--font-mono)" }}
    >
      {children}
    </th>
  ),
  td: ({ children, ...props }: any) => (
    <td
      {...props}
      className="px-3 py-2 text-foreground/85 leading-[1.55] border-r border-border/40 last:border-r-0 align-top"
    >
      {children}
    </td>
  ),
}

export const MarkdownPreview = memo(function MarkdownPreview({
  content,
  className,
}: MarkdownPreviewProps) {
  const { data, body } = useMemo(
    () => safeParseFrontmatter(content),
    [content],
  )

  const isEmpty = !data && body.trim().length === 0

  if (isEmpty) {
    return (
      <div className={cn("max-w-[720px] mx-auto px-10 pt-2", className)}>
        <span
          className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground/55"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          Empty file — click to start writing
        </span>
      </div>
    )
  }

  return (
    <article
      className={cn(
        "max-w-[720px] mx-auto px-10 pt-2 pb-24",
        // Selection takes Coral the same way the editor does, so toggling
        // between preview and edit doesn't visually change selection styling.
        "selection:bg-primary/20",
        className,
      )}
    >
      {data && <FrontmatterBlock data={data} />}
      <div>
        <Streamdown
          components={editorialComponents}
          remarkPlugins={[remarkGfm, remarkBreaks]}
          parseIncompleteMarkdown={false}
          controls={false}
        >
          {body}
        </Streamdown>
      </div>
    </article>
  )
})
