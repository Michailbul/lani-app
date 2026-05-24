"use client"

/**
 * AgentsSkillsTab — the Lani skill library manager.
 *
 * Lani's agent draws skills from one directory, `~/.lani/skills/`.
 * Factory skills seed it on first launch; the user adds more from their
 * own library and toggles any of them on or off.
 *
 * Layout: a fixed header (title, preferences, a Library/Add segmented
 * control, and a search box) over a single full-height scrolling list.
 * Switching segments gives each list the whole pane — the user's
 * `~/.claude/skills` can run to hundreds of entries.
 */

import { useMemo, useState } from "react"
import { Trash2, Plus, Download, Search } from "lucide-react"
import { trpc } from "../../../lib/trpc"
import { cn } from "../../../lib/utils"
import { Switch } from "../../ui/switch"
import { toast } from "sonner"

type Segment = "library" | "import"

export function AgentsSkillsTab() {
  const utils = trpc.useUtils()
  const [segment, setSegment] = useState<Segment>("library")
  const [search, setSearch] = useState("")

  const library = trpc.skills.library.useQuery()
  const importable = trpc.skills.importable.useQuery()
  const prefs = trpc.skills.getPreferences.useQuery()

  const refresh = () => {
    void utils.skills.library.invalidate()
    void utils.skills.importable.invalidate()
  }

  const toggle = trpc.skills.toggle.useMutation({ onSuccess: refresh })
  const remove = trpc.skills.remove.useMutation({
    onSuccess: () => {
      refresh()
      toast.success("Removed from Lani")
    },
    onError: (e) => toast.error(e.message || "Couldn't remove skill"),
  })
  const importOne = trpc.skills.import.useMutation({
    onSuccess: refresh,
    onError: (e) => toast.error(e.message || "Couldn't add skill"),
  })
  const importAll = trpc.skills.importAll.useMutation({
    onSuccess: (r) => {
      refresh()
      toast.success(`Added ${r.count} skill${r.count === 1 ? "" : "s"}`)
    },
    onError: (e) => toast.error(e.message || "Couldn't add skills"),
  })
  const setPrefs = trpc.skills.setPreferences.useMutation({
    onSuccess: () => utils.skills.getPreferences.invalidate(),
  })

  const libraryList = library.data ?? []
  const importList = importable.data ?? []
  const activeCount = libraryList.filter((s) => s.enabled).length

  const q = search.trim().toLowerCase()
  const filteredLibrary = useMemo(() => {
    if (!q) return libraryList
    return libraryList.filter(
      (s) =>
        s.slug.toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q),
    )
  }, [libraryList, q])
  const filteredImport = useMemo(() => {
    if (!q) return importList
    return importList.filter(
      (s) =>
        s.slug.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q),
    )
  }, [importList, q])

  const updatePref = (patch: {
    loadProjectClaudeMd?: boolean
    publishCreatedSkills?: boolean
  }) => {
    const current = prefs.data ?? {
      loadProjectClaudeMd: true,
      publishCreatedSkills: true,
    }
    setPrefs.mutate({ ...current, ...patch })
  }

  return (
    <div className="h-full flex flex-col">
      {/* ── Fixed header ───────────────────────────────────────── */}
      <div className="shrink-0 px-6 pt-6 pb-3">
        <div className="max-w-2xl mx-auto w-full space-y-4">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-foreground">Skills</h3>
          <p className="text-xs text-muted-foreground">
            The agent's skill library lives in{" "}
            <code className="text-[11px]">~/.lani/skills/</code>.
          </p>
        </div>

        {/* Preferences */}
        <div className="rounded-lg border border-border overflow-hidden">
          <PrefRow
            title="Load project CLAUDE.md"
            blurb="Inject this project's CLAUDE.md. Your global ~/.claude/CLAUDE.md is never loaded."
            checked={prefs.data?.loadProjectClaudeMd ?? true}
            onChange={(v) => updatePref({ loadProjectClaudeMd: v })}
          />
          <div className="border-t border-border" />
          <PrefRow
            title="Publish agent-created skills to ~/.claude/skills"
            blurb="Symlink new agent-created skills into your library so other tools see them."
            checked={prefs.data?.publishCreatedSkills ?? true}
            onChange={(v) => updatePref({ publishCreatedSkills: v })}
          />
        </div>

        {/* Segmented control + search */}
        <div className="flex items-center gap-2">
          <div className="flex shrink-0 rounded-lg border border-border p-0.5 bg-muted/40">
            <SegButton
              active={segment === "library"}
              onClick={() => setSegment("library")}
            >
              Library{" "}
              <span className="tabular-nums opacity-60">
                {activeCount}/{libraryList.length}
              </span>
            </SegButton>
            <SegButton
              active={segment === "import"}
              onClick={() => setSegment("import")}
            >
              Add from library{" "}
              <span className="tabular-nums opacity-60">
                {importList.length}
              </span>
            </SegButton>
          </div>

          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={
                segment === "library"
                  ? "Search the library…"
                  : "Search your skills…"
              }
              className="h-8 w-full rounded-lg bg-muted border border-input pl-8 pr-3 text-xs outline-none placeholder:text-muted-foreground/40 focus:border-primary"
            />
          </div>

          {segment === "import" && importList.length > 0 && (
            <button
              type="button"
              disabled={importAll.isPending}
              onClick={() => importAll.mutate()}
              className={cn(
                "shrink-0 h-8 px-3 flex items-center gap-1.5 rounded-lg text-xs font-medium",
                "bg-primary text-primary-foreground hover:opacity-90",
                "transition-opacity disabled:opacity-50",
              )}
            >
              <Download className="h-3.5 w-3.5" />
              Add all ({importList.length})
            </button>
          )}
        </div>
        </div>
      </div>

      {/* ── Full-height scrolling list ─────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-6">
        <div className="max-w-2xl mx-auto w-full rounded-lg border border-border divide-y divide-border overflow-hidden">
          {segment === "library" ? (
            library.isPending ? (
              <Empty text="Loading…" />
            ) : filteredLibrary.length === 0 ? (
              <Empty text={q ? "No matches" : "No skills in the library yet"} />
            ) : (
              filteredLibrary.map((skill) => (
                <div
                  key={skill.slug}
                  className="flex items-center gap-3 px-3 py-2.5"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm text-foreground truncate">
                        {skill.slug}
                      </span>
                      {skill.imported && (
                        <span className="shrink-0 text-[9px] uppercase tracking-wider font-mono text-muted-foreground/60 border border-border rounded px-1">
                          imported
                        </span>
                      )}
                    </div>
                    {skill.description && (
                      <p className="text-[11px] text-muted-foreground/70 truncate mt-0.5">
                        {skill.description}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => remove.mutate({ slug: skill.slug })}
                    title="Remove from Lani"
                    className="shrink-0 h-6 w-6 flex items-center justify-center rounded text-muted-foreground/40 hover:text-rose-500 hover:bg-rose-500/10 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                  <Switch
                    checked={skill.enabled}
                    onCheckedChange={(v) =>
                      toggle.mutate({ slug: skill.slug, enabled: v })
                    }
                  />
                </div>
              ))
            )
          ) : importable.isPending ? (
            <Empty text="Loading…" />
          ) : filteredImport.length === 0 ? (
            <Empty
              text={
                q
                  ? "No matches"
                  : "Everything in your library is already in Lani"
              }
            />
          ) : (
            filteredImport.map((skill) => (
              <div
                key={`${skill.source}:${skill.slug}`}
                className="flex items-center gap-3 px-3 py-2"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm text-foreground truncate">
                      {skill.slug}
                    </span>
                    <span className="shrink-0 text-[9px] uppercase tracking-wider font-mono text-muted-foreground/50">
                      {skill.source}
                    </span>
                  </div>
                  {skill.description && (
                    <p className="text-[11px] text-muted-foreground/70 truncate mt-0.5">
                      {skill.description}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  disabled={importOne.isPending}
                  onClick={() => importOne.mutate({ slug: skill.slug })}
                  className={cn(
                    "shrink-0 h-6 px-2 flex items-center gap-1 rounded text-[11px] font-medium",
                    "text-foreground/80 border border-border hover:border-primary hover:text-primary",
                    "transition-colors disabled:opacity-50",
                  )}
                >
                  <Plus className="h-3 w-3" />
                  Add
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

function SegButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-7 px-3 rounded-md text-xs font-medium whitespace-nowrap transition-colors",
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  )
}

function PrefRow({
  title,
  blurb,
  checked,
  onChange,
}: {
  title: string
  blurb: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="flex flex-col space-y-0.5 min-w-0">
        <span className="text-[13px] font-medium text-foreground">{title}</span>
        <span className="text-[11px] text-muted-foreground">{blurb}</span>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return (
    <div className="px-3 py-10 text-center text-xs text-muted-foreground">
      {text}
    </div>
  )
}
