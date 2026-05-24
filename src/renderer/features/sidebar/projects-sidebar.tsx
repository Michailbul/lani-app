"use client"

/**
 * ProjectsSidebar — Lani's left navigation column.
 *
 * The left panel is a project switcher and nothing else. Conversations
 * (chats / sub-chats) live in the assistant rail on the right; this
 * column only lists the writer's projects and opens them. One row per
 * project — no chat threads, no drafts, no inbox.
 *
 * Replaces the chat-list AgentsSidebar on desktop. (AgentsSidebar still
 * backs the mobile fullscreen chats list.)
 */

import { useCallback, useMemo, useState } from "react"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { ChevronRight, LogOut, Plus, Search, Settings, Trash2 } from "lucide-react"
import { toast } from "sonner"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../components/ui/alert-dialog"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "../../components/ui/context-menu"
import { IconDoubleChevronLeft, IconSpinner } from "../../components/ui/icons"
import { Input } from "../../components/ui/input"
import { ProjectIcon } from "../../components/ui/project-icon"
import { Skeleton } from "../../components/ui/skeleton"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../components/ui/tooltip"
import { cn } from "../../lib/utils"
import { trpc } from "../../lib/trpc"
import {
  agentsSettingsDialogActiveTabAtom,
  isDesktopAtom,
  isFullscreenAtom,
} from "../../lib/atoms"
import {
  desktopViewAtom,
  selectedProjectAtom,
  showNewChatFormAtom,
} from "../agents/atoms"

// ─── helpers ─────────────────────────────────────────────────────────

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

/** Shortest-possible "2h ago" / "yesterday" / "Mar 14" labelling. */
function formatRelative(input: string | Date | null | undefined): string {
  if (!input) return ""
  const d = input instanceof Date ? input : new Date(input)
  const diff = Date.now() - d.getTime()
  const min = Math.floor(diff / 60000)
  const hr = Math.floor(min / 60)
  const day = Math.floor(hr / 24)
  if (min < 1) return "just now"
  if (min < 60) return `${min}m ago`
  if (hr < 24) return `${hr}h ago`
  if (day === 1) return "yesterday"
  if (day < 7) return `${day}d ago`
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

function toSelectedProject(p: ProjectRow) {
  return {
    id: p.id,
    name: p.name,
    path: p.path,
    gitRemoteUrl: p.gitRemoteUrl ?? null,
    gitProvider:
      (p.gitProvider as "github" | "gitlab" | "bitbucket" | null) ?? null,
    gitOwner: p.gitOwner ?? null,
    gitRepo: p.gitRepo ?? null,
  }
}

// ─── component ───────────────────────────────────────────────────────

interface ProjectsSidebarProps {
  desktopUser: { id: string; email: string; name?: string } | null
  onSignOut: () => void
  onToggleSidebar?: () => void
}

export function ProjectsSidebar({
  desktopUser,
  onSignOut,
  onToggleSidebar,
}: ProjectsSidebarProps) {
  const isDesktop = useAtomValue(isDesktopAtom)
  const isFullscreen = useAtomValue(isFullscreenAtom)
  const [selectedProject, setSelectedProject] = useAtom(selectedProjectAtom)
  const setShowNewChatForm = useSetAtom(showNewChatFormAtom)
  const setDesktopView = useSetAtom(desktopViewAtom)
  const setSettingsTab = useSetAtom(agentsSettingsDialogActiveTabAtom)

  const [query, setQuery] = useState("")
  const [openingId, setOpeningId] = useState<string | null>(null)
  const [projectToDelete, setProjectToDelete] = useState<ProjectRow | null>(null)

  const utils = trpc.useUtils()
  const { data: projects, isLoading } = trpc.projects.list.useQuery()

  // Deleting a project removes it (and its chats) from Lani. The
  // folder on disk is left alone — this is a "remove from the list",
  // not a destructive wipe.
  const deleteProject = trpc.projects.delete.useMutation({
    onSuccess: (_res, vars) => {
      if (selectedProject?.id === vars.id) setSelectedProject(null)
      void utils.projects.list.invalidate()
      setProjectToDelete(null)
    },
    onError: (err) => {
      toast.error(err.message || "Couldn't delete the project.")
      setProjectToDelete(null)
    },
  })

  const filtered = useMemo(() => {
    const list = (projects ?? []) as ProjectRow[]
    const q = query.trim().toLowerCase()
    return q ? list.filter((p) => p.name.toLowerCase().includes(q)) : list
  }, [projects, query])

  // Open a project: select it. Chat and view state are keyed per project,
  // so this restores whatever the writer had open in this project last.
  const openProject = useCallback(
    async (project: ProjectRow) => {
      if (selectedProject?.id === project.id) return
      setOpeningId(project.id)
      setShowNewChatForm(false)
      setDesktopView(null)
      setSelectedProject(toSelectedProject(project))
      try {
        await utils.chats.list.invalidate({ projectId: project.id })
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Couldn't open project.",
        )
      } finally {
        setOpeningId(null)
      }
    },
    [
      selectedProject?.id,
      utils.chats.list,
      setSelectedProject,
      setShowNewChatForm,
      setDesktopView,
    ],
  )

  // "New Project" drops back to the project picker (SelectRepoPage),
  // which App renders whenever no project is selected.
  const handleNewProject = useCallback(() => {
    setShowNewChatForm(false)
    setDesktopView(null)
    setSelectedProject(null)
  }, [setShowNewChatForm, setDesktopView, setSelectedProject])

  const openSettings = useCallback(() => {
    setSettingsTab("preferences")
    setDesktopView("settings")
  }, [setSettingsTab, setDesktopView])

  // The panel reaches the window's top edge, so the header row must
  // clear the native macOS traffic lights.
  const needsTrafficLightInset = isDesktop && !isFullscreen
  const dragStyle = { WebkitAppRegion: "drag" } as React.CSSProperties
  const noDragStyle = { WebkitAppRegion: "no-drag" } as React.CSSProperties

  return (
    <div className="flex h-full flex-col select-none">
      {/* ── Header — wordmark + collapse, on the macOS chrome line ── */}
      <div className="relative flex-shrink-0">
        {needsTrafficLightInset && (
          <div
            className="absolute inset-x-0 top-0 h-8 z-0"
            style={dragStyle}
          />
        )}
        <div
          className={cn(
            "relative z-10 flex items-center justify-between gap-2 pr-2 pb-1.5 pt-2.5",
            needsTrafficLightInset ? "pl-[74px]" : "pl-3",
          )}
        >
          <div aria-hidden />
          {onToggleSidebar && (
            <Tooltip delayDuration={500}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={onToggleSidebar}
                  style={noDragStyle}
                  aria-label="Collapse sidebar"
                  className="press flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
                >
                  <IconDoubleChevronLeft className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">Collapse sidebar</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      {/* ── Search + New Project ── */}
      <div className="flex-shrink-0 space-y-1.5 px-2 pb-2 pt-1">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/50" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search projects"
            className="h-7 rounded-lg border-input bg-muted pl-7 text-sm placeholder:text-muted-foreground/40"
          />
        </div>
        <button
          type="button"
          onClick={handleNewProject}
          className={cn(
            "press flex h-7 w-full items-center justify-center gap-1.5 rounded-lg",
            "border border-input text-foreground",
            "transition-colors hover:bg-foreground/10",
          )}
        >
          <Plus className="h-3.5 w-3.5" />
          <span className="text-sm font-medium">New Project</span>
        </button>
      </div>

      {/* ── Projects list ── */}
      <div className="flex items-center gap-2 px-3 pb-1 pt-1">
        <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground/60">
          Projects
        </span>
        <span className="h-px flex-1 bg-border/60" />
        {!isLoading && projects && projects.length > 0 && (
          <span className="text-[10px] font-mono tabular-nums text-muted-foreground/45">
            {projects.length.toString().padStart(2, "0")}
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {isLoading ? (
          <div className="space-y-0.5">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-2.5 px-2 py-2">
                <Skeleton className="h-7 w-7 rounded-md" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-2 w-14" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-3 py-6 text-center text-[12px] leading-relaxed text-muted-foreground/75">
            {query.trim()
              ? "No projects match that search."
              : "No projects yet. Start one with New Project."}
          </div>
        ) : (
          <ul className="space-y-0.5">
            {filtered.map((project) => (
              <li key={project.id}>
                <ProjectListRow
                  project={project}
                  isSelected={selectedProject?.id === project.id}
                  isOpening={openingId === project.id}
                  onClick={() => void openProject(project)}
                  onRequestDelete={setProjectToDelete}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── Footer — settings + account ── */}
      <div className="flex flex-shrink-0 items-center gap-1.5 border-t border-border/60 p-2">
        <Tooltip delayDuration={500}>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={openSettings}
              aria-label="Settings"
              className="press flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
            >
              <Settings className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">Settings</TooltipContent>
        </Tooltip>

        {desktopUser && (
          <div className="min-w-0 flex-1 px-1">
            <div className="truncate text-[11px] font-medium text-foreground/85">
              {desktopUser.name || desktopUser.email}
            </div>
          </div>
        )}

        <Tooltip delayDuration={500}>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onSignOut}
              aria-label="Sign out"
              className="press flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">Sign out</TooltipContent>
        </Tooltip>
      </div>

      {/* ── Delete confirmation ── */}
      <AlertDialog
        open={projectToDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deleteProject.isPending) setProjectToDelete(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete “{projectToDelete?.name}”?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This removes the project and its chats from Lani. The
              project files on disk are left untouched — you can re-import
              the folder later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteProject.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (projectToDelete) {
                  deleteProject.mutate({ id: projectToDelete.id })
                }
              }}
              disabled={deleteProject.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteProject.isPending ? "Deleting…" : "Delete project"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ─── project row ─────────────────────────────────────────────────────

function ProjectListRow({
  project,
  isSelected,
  isOpening,
  onClick,
  onRequestDelete,
}: {
  project: ProjectRow
  isSelected: boolean
  isOpening: boolean
  onClick: () => void
  onRequestDelete: (project: ProjectRow) => void
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          disabled={isOpening}
          className={cn(
            "group flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left",
            "transition-colors duration-100 [transition-timing-function:var(--ease-natural)]",
            "disabled:cursor-progress",
            isSelected
              ? "bg-foreground/[0.07] text-foreground"
              : "text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground",
          )}
        >
          <div
            className={cn(
              "flex h-7 w-7 flex-shrink-0 items-center justify-center overflow-hidden rounded-md border bg-background",
              isSelected ? "border-primary/40" : "border-border/60",
            )}
          >
            <ProjectIcon project={project} className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate font-display text-[14px] font-bold tracking-tight text-foreground">
              {project.name}
            </div>
            <div className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground/55">
              {formatRelative(project.updatedAt)}
            </div>
          </div>
          {isOpening ? (
            <IconSpinner className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground/60" />
          ) : (
            <ChevronRight
              className={cn(
                "h-3.5 w-3.5 flex-shrink-0 transition-[opacity,transform] duration-150",
                isSelected
                  ? "text-primary/70 opacity-100"
                  : "-translate-x-1 text-muted-foreground/40 opacity-0 group-hover:translate-x-0 group-hover:opacity-100",
              )}
            />
          )}
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-44">
        <ContextMenuItem
          onClick={() => onRequestDelete(project)}
          className="gap-2 text-destructive focus:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete project
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
