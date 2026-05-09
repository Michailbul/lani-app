"use client"

/**
 * SelectRepoPage — Backlot's front cover.
 *
 * The first thing the user sees when no project is selected. Three ways
 * in:
 *
 *   1. Resume a recent project (most common — one click)
 *   2. Start a new project from scratch (named, scaffolded fresh)
 *   3. Import an existing folder from disk (copied into ~/.backlot)
 *
 * Cloning from GitHub stays accessible as a quiet tertiary link so the
 * 1Code-era flow doesn't disappear. Visual register: editorial - the
 * page reads like the inside cover of a director's journal, not a SaaS
 * dashboard. Dark-mode-first (Obsidian + Ember), light-mode polished.
 */

import { useState, useMemo, useEffect, useCallback } from "react"
import { useAtom } from "jotai"
import {
  ChevronLeft,
  ChevronRight,
  FolderInput,
  Sparkles,
  X,
} from "lucide-react"

import {
  IconSpinner,
  GitHubIcon,
} from "../../components/ui/icons"
import { Logo } from "../../components/ui/logo"
import { Input } from "../../components/ui/input"
import { ProjectIcon } from "../../components/ui/project-icon"
import { Skeleton } from "../../components/ui/skeleton"
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "../../components/ui/dialog"
import { trpc } from "../../lib/trpc"
import {
  selectedAgentChatIdAtom,
  selectedProjectAtom,
  showNewChatFormAtom,
} from "../agents/atoms"
import { cn } from "../../lib/utils"
import { toast } from "sonner"

// ─── helpers ─────────────────────────────────────────────────────────

/** Shortest-possible "edited 2h ago" / "yesterday" / "Mar 14" labelling. */
function formatRelative(input: string | Date | null | undefined): string {
  if (!input) return "—"
  const d = input instanceof Date ? input : new Date(input)
  const now = Date.now()
  const diff = now - d.getTime()
  const sec = Math.floor(diff / 1000)
  const min = Math.floor(sec / 60)
  const hr = Math.floor(min / 60)
  const day = Math.floor(hr / 24)
  if (sec < 60) return "just now"
  if (min < 60) return `${min}m ago`
  if (hr < 24) return `${hr}h ago`
  if (day === 1) return "yesterday"
  if (day < 7) return `${day}d ago`
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

/** Replace the user's home prefix with `~` and middle-truncate. */
function prettyPath(p: string): string {
  if (typeof window === "undefined") return p
  // Match anything up to "/.backlot/projects/..." — that's the canonical Backlot layout.
  const idx = p.indexOf("/.backlot/projects/")
  if (idx >= 0) return `~${p.slice(idx)}`
  return p
}

// ─── selection helpers ──────────────────────────────────────────────

type ProjectRow = {
  id: string
  name: string
  path: string
  iconPath?: string | null
  updatedAt?: string | Date | null
  gitRemoteUrl?: string | null
  gitProvider?: string | null
  gitOwner?: string | null
  gitRepo?: string | null
}

function toSelectedProject(p: ProjectRow) {
  return {
    id: p.id,
    name: p.name,
    path: p.path,
    gitRemoteUrl: p.gitRemoteUrl ?? null,
    gitProvider: (p.gitProvider as
      | "github"
      | "gitlab"
      | "bitbucket"
      | null) ?? null,
    gitOwner: p.gitOwner ?? null,
    gitRepo: p.gitRepo ?? null,
  }
}

// ─── page ────────────────────────────────────────────────────────────

export function SelectRepoPage() {
  const [, setSelectedProject] = useAtom(selectedProjectAtom)
  const [, setSelectedChatId] = useAtom(selectedAgentChatIdAtom)
  const [, setShowNewChatForm] = useAtom(showNewChatFormAtom)
  const [showClonePage, setShowClonePage] = useState(false)
  const [githubUrl, setGithubUrl] = useState("")
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState("")
  const [newTagline, setNewTagline] = useState("")
  const [openingProjectId, setOpeningProjectId] = useState<string | null>(null)

  const utils = trpc.useUtils()
  const { data: projects, isLoading: isLoadingProjects } =
    trpc.projects.list.useQuery()
  /** Optimistic insert/refresh of a project in the cached list. */
  const upsertProjectInCache = useCallback(
    (project: ProjectRow) => {
      utils.projects.list.setData(undefined, (oldData) => {
        if (!oldData) return [project as never]
        const exists = oldData.some((p) => p.id === project.id)
        if (exists) {
          return oldData.map((p) =>
            p.id === project.id
              ? { ...p, updatedAt: project.updatedAt ?? p.updatedAt }
              : p,
          ) as never
        }
        return [project as never, ...oldData] as never
      })
    },
    [utils.projects.list],
  )

  /**
   * Open a project end-to-end: select it and land on the project workspace.
   * The user can browse/edit the canonical project files first, then start
   * a local chat when they actually want an agent on the page.
   */
  const openProject = useCallback(
    async (project: ProjectRow) => {
      setOpeningProjectId(project.id)
      // Make sure the form atom is off. Landing-driven entry should open the
      // project workspace first, not force the new-chat composer.
      setShowNewChatForm(false)
      setSelectedProject(toSelectedProject(project))
      try {
        setSelectedChatId(null)
        await utils.chats.list.invalidate({ projectId: project.id })
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Couldn't open project.",
        )
      } finally {
        setOpeningProjectId(null)
      }
    },
    [
      utils.chats.list,
      setSelectedChatId,
      setSelectedProject,
      setShowNewChatForm,
    ],
  )

  // Mutations
  const pickAndImport = trpc.projects.pickAndImport.useMutation({
    onSuccess: async (project) => {
      if (!project) return
      upsertProjectInCache(project as ProjectRow)
      await openProject(project as ProjectRow)
    },
    onError: (err) => toast.error(err.message || "Could not import folder"),
  })

  const createNewProject = trpc.projects.createNewProject.useMutation({
    onSuccess: async (project) => {
      if (!project) return
      upsertProjectInCache(project as ProjectRow)
      setCreateOpen(false)
      setNewName("")
      setNewTagline("")
      await openProject(project as ProjectRow)
    },
    onError: (err) => toast.error(err.message || "Could not create project"),
  })

  const cloneFromGitHub = trpc.projects.cloneFromGitHub.useMutation({
    onSuccess: async (project) => {
      if (!project) return
      upsertProjectInCache(project as ProjectRow)
      setShowClonePage(false)
      setGithubUrl("")
      await openProject(project as ProjectRow)
    },
    onError: (err) => toast.error(err.message || "Could not clone repository"),
  })

  const recentProjects = useMemo(() => {
    if (!projects) return []
    return projects.slice(0, 12) as ProjectRow[]
  }, [projects])

  const isCreating = createNewProject.isPending
  const isImporting = pickAndImport.isPending
  const isCloning = cloneFromGitHub.isPending
  const isOpening = openingProjectId !== null
  const isBusy = isCreating || isImporting || isCloning || isOpening

  // Keyboard: Cmd/Ctrl+N opens the new-project dialog, Cmd/Ctrl+O imports.
  useEffect(() => {
    if (showClonePage) return
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      if (e.key.toLowerCase() === "n") {
        e.preventDefault()
        setCreateOpen(true)
      } else if (e.key.toLowerCase() === "o") {
        e.preventDefault()
        if (!isBusy) pickAndImport.mutate()
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [showClonePage, isBusy, pickAndImport])

  // ─── clone view (kept as a quiet sub-flow) ────────────────────────
  if (showClonePage) {
    const handleBack = () => {
      if (cloneFromGitHub.isPending) return
      setShowClonePage(false)
      setGithubUrl("")
    }
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-background select-none">
        <div
          className="fixed top-0 left-0 right-0 h-10"
          style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
        />
        <button
          onClick={handleBack}
          disabled={cloneFromGitHub.isPending}
          className="fixed top-12 left-4 flex items-center justify-center h-8 w-8 rounded-full hover:bg-foreground/5 transition-colors disabled:opacity-50"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>

        <div className="w-full max-w-[440px] space-y-8 px-4">
          <div className="text-center space-y-4">
            <div className="flex items-center justify-center gap-2 p-2 mx-auto w-max rounded-full border border-border">
              <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center">
                <Logo className="w-5 h-5" fill="white" />
              </div>
              <div className="w-10 h-10 rounded-full bg-foreground flex items-center justify-center">
                <GitHubIcon className="w-5 h-5 text-background" />
              </div>
            </div>
            <div className="space-y-1">
              <h1 className="font-display text-xl font-semibold tracking-tight">
                Clone from GitHub
              </h1>
              <p className="text-sm text-muted-foreground">
                Enter a repository URL or owner/repo
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="relative">
              <Input
                value={githubUrl}
                onChange={(e) => setGithubUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && githubUrl.trim()) {
                    cloneFromGitHub.mutate({ repoUrl: githubUrl.trim() })
                  }
                }}
                placeholder="owner/repo"
                className="text-center pr-10 font-mono"
                autoFocus
                disabled={cloneFromGitHub.isPending}
              />
              {cloneFromGitHub.isPending && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  <IconSpinner className="h-4 w-4" />
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground/80 text-center font-mono">
              facebook/react · https://github.com/owner/repo
            </p>
          </div>
        </div>
      </div>
    )
  }

  // ─── main landing ─────────────────────────────────────────────────
  return (
    <div className="h-screen w-screen flex flex-col bg-background select-none overflow-hidden">
      {/* Draggable title bar — empty so the macOS traffic-lights have room. */}
      <div
        className="h-10 flex-shrink-0"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      />

      {/* Scrolling middle column */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="w-full max-w-[640px] mx-auto px-6 pb-16 pt-6 space-y-10">
          {/* ── Wordmark block ── */}
          <header className="flex flex-col items-center text-center gap-3">
            <div className="w-11 h-11 rounded-[10px] bg-primary flex items-center justify-center shadow-[0_1px_0_0_rgba(255,255,255,0.18)_inset,0_4px_16px_-6px_rgba(242,97,87,0.45)]">
              <Logo className="w-5 h-5" fill="white" />
            </div>
            <div className="space-y-1.5">
              <h1 className="font-display text-3xl font-bold tracking-[-0.02em] leading-none">
                Backlot
              </h1>
              <p className="text-[13px] text-muted-foreground/85 font-light tracking-wide">
                Where the screenplay meets the generative shot.
              </p>
            </div>
          </header>

          {/* ── Two primary action cards ── */}
          <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <ActionCard
              tone="primary"
              icon={<Sparkles className="h-4 w-4" />}
              title="New project"
              description="Start fresh — name it, scaffold it."
              shortcut={["⌘", "N"]}
              onClick={() => setCreateOpen(true)}
              disabled={isBusy}
              loading={isCreating}
            />
            <ActionCard
              tone="muted"
              icon={<FolderInput className="h-4 w-4" />}
              title="Import a folder"
              description="Pick a folder on disk. Backlot works on its copy."
              shortcut={["⌘", "O"]}
              onClick={() => pickAndImport.mutate()}
              disabled={isBusy}
              loading={isImporting}
            />
          </section>

          {/* ── Recent projects ── */}
          <section className="space-y-3">
            <div className="flex items-baseline justify-between gap-3">
              <div className="flex items-baseline gap-2.5">
                <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground/70">
                  Recent projects
                </span>
                <span className="h-px flex-1 bg-border/70 self-center" />
              </div>
              {!isLoadingProjects && recentProjects.length > 0 && (
                <span className="text-[10px] font-mono tabular-nums text-muted-foreground/55">
                  {recentProjects.length.toString().padStart(2, "0")}
                </span>
              )}
            </div>

            {isLoadingProjects ? (
              <div className="space-y-1">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 rounded-md px-2.5 py-2"
                  >
                    <Skeleton className="h-7 w-7 rounded-md" />
                    <div className="flex-1 space-y-1.5">
                      <Skeleton className="h-3 w-32" />
                      <Skeleton className="h-2.5 w-48" />
                    </div>
                    <Skeleton className="h-2.5 w-12" />
                  </div>
                ))}
              </div>
            ) : recentProjects.length === 0 ? (
              <EmptyState onCreate={() => setCreateOpen(true)} />
            ) : (
              <ul className="space-y-0.5">
                {recentProjects.map((project) => (
                  <li key={project.id}>
                    <RecentRow
                      project={project}
                      isOpening={openingProjectId === project.id}
                      disabled={isBusy && openingProjectId !== project.id}
                      onSelect={() => {
                        upsertProjectInCache({
                          ...project,
                          updatedAt: new Date().toISOString(),
                        })
                        void openProject(project)
                      }}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ── Tertiary: clone from GitHub ── */}
          <section className="pt-2 flex items-center justify-center">
            <button
              onClick={() => setShowClonePage(true)}
              disabled={isBusy}
              className="group inline-flex items-center gap-1.5 px-2 py-1.5 text-[11px] font-mono uppercase tracking-[0.16em] text-muted-foreground/65 hover:text-foreground transition-colors disabled:opacity-50"
            >
              <GitHubIcon className="h-3 w-3" />
              <span>Clone from GitHub</span>
              <ChevronRight className="h-3 w-3 -translate-x-0.5 group-hover:translate-x-0 transition-transform" />
            </button>
          </section>
        </div>
      </div>

      {/* ── New project dialog ── */}
      <Dialog
        open={createOpen}
        onOpenChange={(v) => !isCreating && setCreateOpen(v)}
      >
        <DialogContent
          className="max-w-[440px] p-0 gap-0 overflow-hidden"
          showCloseButton={false}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (!newName.trim() || isCreating) return
              createNewProject.mutate({
                name: newName.trim(),
                tagline: newTagline.trim() || undefined,
              })
            }}
          >
            <div className="px-5 pt-5 pb-3 flex items-start gap-3 border-b border-border/60">
              <div className="w-8 h-8 rounded-md bg-primary/10 text-primary flex items-center justify-center flex-shrink-0 mt-0.5">
                <Sparkles className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0 space-y-0.5">
                <DialogTitle className="font-display text-base font-semibold tracking-tight leading-snug">
                  Start a new project
                </DialogTitle>
                <DialogDescription className="text-[12px] text-muted-foreground/85 leading-snug">
                  We'll create a working project under{" "}
                  <span className="font-mono text-[11px]">~/.backlot/projects/</span>
                  .
                </DialogDescription>
              </div>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                disabled={isCreating}
                className="text-muted-foreground/70 hover:text-foreground rounded p-0.5 -mr-1 transition-colors disabled:opacity-40"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="px-5 py-4 space-y-3.5">
              <div className="space-y-1.5">
                <label className="text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground/80">
                  Project name
                </label>
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. daddy issues"
                  autoFocus
                  disabled={isCreating}
                  className="h-9"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground/80">
                  Logline{" "}
                  <span className="text-muted-foreground/50 normal-case tracking-normal font-sans">
                    — optional
                  </span>
                </label>
                <Input
                  value={newTagline}
                  onChange={(e) => setNewTagline(e.target.value)}
                  placeholder="A daughter, a father, one quiet apartment."
                  disabled={isCreating}
                  className="h-9"
                />
              </div>
            </div>

            <div className="px-5 py-3 bg-muted/30 border-t border-border/60 flex items-center justify-between gap-3">
              <span className="text-[10px] font-mono text-muted-foreground/55 tracking-wide">
                ↵ create
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  disabled={isCreating}
                  className="h-8 px-3 rounded-md text-[13px] font-medium text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors disabled:opacity-40"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!newName.trim() || isCreating}
                  className={cn(
                    "h-8 px-4 rounded-md text-[13px] font-medium",
                    "bg-primary text-primary-foreground",
                    "shadow-[0_0_0_0.5px_rgb(23,23,23),inset_0_0_0_1px_rgba(255,255,255,0.14)]",
                    "transition-[background-color,transform] duration-150 ease-out",
                    "hover:bg-primary/90 active:scale-[0.97]",
                    "disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-primary",
                    "flex items-center justify-center gap-1.5 min-w-[88px]",
                  )}
                >
                  {isCreating ? (
                    <IconSpinner className="h-3.5 w-3.5" />
                  ) : (
                    "Create"
                  )}
                </button>
              </div>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── building blocks ─────────────────────────────────────────────────

function ActionCard({
  tone,
  icon,
  title,
  description,
  shortcut,
  onClick,
  disabled,
  loading,
}: {
  tone: "primary" | "muted"
  icon: React.ReactNode
  title: string
  description: string
  shortcut: [string, string]
  onClick: () => void
  disabled?: boolean
  loading?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={cn(
        "group relative text-left rounded-xl p-4 overflow-hidden",
        "border transition-[background-color,border-color,transform] duration-150 ease-out",
        "active:scale-[0.99]",
        "disabled:opacity-60 disabled:cursor-not-allowed",
        tone === "primary"
          ? [
              "bg-primary/[0.06] border-primary/30",
              "hover:bg-primary/[0.1] hover:border-primary/50",
              "dark:bg-primary/[0.08] dark:border-primary/35 dark:hover:bg-primary/[0.14]",
            ]
          : [
              "bg-muted/40 border-border/70",
              "hover:bg-muted/70 hover:border-border",
            ],
      )}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div
          className={cn(
            "w-7 h-7 rounded-md flex items-center justify-center",
            tone === "primary"
              ? "bg-primary/15 text-primary"
              : "bg-foreground/5 text-foreground/70",
          )}
        >
          {loading ? (
            <IconSpinner className="h-3.5 w-3.5" />
          ) : (
            icon
          )}
        </div>
        <span className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground/55 tabular-nums">
          {shortcut.map((k, i) => (
            <kbd
              key={i}
              className="inline-flex items-center justify-center h-4 min-w-[16px] px-1 rounded border border-border/70 bg-background/60 text-[10px] leading-none"
            >
              {k}
            </kbd>
          ))}
        </span>
      </div>
      <div className="space-y-1">
        <div
          className={cn(
            "font-display text-[15px] font-semibold tracking-tight leading-tight",
            tone === "primary" ? "text-foreground" : "text-foreground",
          )}
        >
          {title}
        </div>
        <div className="text-[12px] text-muted-foreground leading-snug">
          {description}
        </div>
      </div>
    </button>
  )
}

function RecentRow({
  project,
  onSelect,
  isOpening,
  disabled,
}: {
  project: ProjectRow
  onSelect: () => void
  isOpening?: boolean
  disabled?: boolean
}) {
  return (
    <button
      onClick={onSelect}
      disabled={disabled || isOpening}
      className={cn(
        "group w-full flex items-center gap-3 rounded-md px-2.5 py-2 text-left",
        "transition-colors duration-100",
        "hover:bg-foreground/[0.04] dark:hover:bg-foreground/[0.06]",
        "disabled:opacity-60 disabled:cursor-not-allowed",
      )}
    >
      <div className="w-7 h-7 rounded-md bg-muted/70 border border-border/60 flex items-center justify-center flex-shrink-0 overflow-hidden">
        <ProjectIcon project={project} className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="font-display text-[14px] font-semibold tracking-tight text-foreground truncate">
            {project.name}
          </span>
          <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/55 flex-shrink-0">
            {formatRelative(project.updatedAt)}
          </span>
        </div>
        <div className="text-[11px] font-mono text-muted-foreground/65 truncate">
          {prettyPath(project.path)}
        </div>
      </div>
      {isOpening ? (
        <IconSpinner className="h-3.5 w-3.5 text-muted-foreground/60 flex-shrink-0" />
      ) : (
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 text-muted-foreground/40 flex-shrink-0",
            "transition-[opacity,transform] duration-150",
            "opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0",
          )}
        />
      )}
    </button>
  )
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-8 px-4 rounded-lg border border-dashed border-border/60 bg-muted/20">
      <div className="text-[12px] text-muted-foreground/85 leading-relaxed max-w-[300px]">
        No projects yet. Start with a fresh one above, or import an existing
        folder.
      </div>
      <button
        onClick={onCreate}
        className="mt-3 text-[11px] font-mono uppercase tracking-[0.16em] text-primary hover:text-primary/80 transition-colors"
      >
        + Start your first project
      </button>
    </div>
  )
}
