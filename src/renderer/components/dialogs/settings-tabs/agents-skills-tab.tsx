import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from "react"
import { useAtomValue } from "jotai"
import {
  selectedProjectAtom,
  settingsSkillsSidebarWidthAtom,
} from "../../../features/agents/atoms"
import { trpc } from "../../../lib/trpc"
import { cn } from "../../../lib/utils"
import { useListKeyboardNav } from "./use-list-keyboard-nav"
import { AlertCircle } from "lucide-react"
import { SkillIcon, MarkdownIcon, CodeIcon } from "../../ui/icons"
import { Input } from "../../ui/input"
import { Label } from "../../ui/label"
import { Textarea } from "../../ui/textarea"
import { Button } from "../../ui/button"
import { Switch } from "../../ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "../../ui/select"
import { ResizableSidebar } from "../../ui/resizable-sidebar"
import { ChatMarkdownRenderer } from "../../chat-markdown-renderer"
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/tooltip"
import { toast } from "sonner"

// ──────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────

type FilterMode = "allow" | "deny"

interface RegistrySkill {
  name: string
  description: string | null
  installed: boolean
  path: string | null
}

interface RegistryCategory {
  label: string
  blurb: string
  skills: RegistrySkill[]
}

// ──────────────────────────────────────────────────────────────────────
// Detail panel (mirrors agents-plugins-tab structure)
// ──────────────────────────────────────────────────────────────────────

function SkillDetail({
  skill,
  isActive,
  filterMode,
  isSelected,
  onToggleSelected,
  onSave,
  isSaving,
}: {
  skill: {
    name: string
    description: string
    source: "user" | "project"
    path: string
    content: string
  }
  isActive: boolean
  filterMode: FilterMode
  isSelected: boolean
  onToggleSelected: (next: boolean) => void
  onSave: (data: { description: string; content: string }) => void
  isSaving: boolean
}) {
  const [description, setDescription] = useState(skill.description)
  const [content, setContent] = useState(skill.content)
  const [viewMode, setViewMode] = useState<"rendered" | "editor">("rendered")

  useEffect(() => {
    setDescription(skill.description)
    setContent(skill.content)
    setViewMode("rendered")
  }, [skill.name, skill.description, skill.content])

  const hasChanges =
    description !== skill.description || content !== skill.content

  const handleSave = useCallback(() => {
    if (description !== skill.description || content !== skill.content) {
      onSave({ description, content })
    }
  }, [description, content, skill.description, skill.content, onSave])

  const handleBlur = useCallback(() => {
    if (description !== skill.description || content !== skill.content) {
      onSave({ description, content })
    }
  }, [description, content, skill.description, skill.content, onSave])

  const handleToggleViewMode = useCallback(() => {
    setViewMode((prev) => {
      if (prev === "editor") {
        if (description !== skill.description || content !== skill.content) {
          onSave({ description, content })
        }
      }
      return prev === "rendered" ? "editor" : "rendered"
    })
  }, [description, content, skill.description, skill.content, onSave])

  // Switch always means "active" — wrap the underlying selection toggle.
  const handleActiveToggle = (next: boolean) => {
    if (filterMode === "allow") {
      onToggleSelected(next) // active ↔ selected in allow mode
    } else {
      onToggleSelected(!next) // active ↔ NOT selected in deny mode
    }
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Top bar — Active toggle, mirrors plugins detail */}
      <div className="flex items-center justify-end px-6 py-3 shrink-0">
        <div className="flex items-center gap-1.5">
          <Switch checked={isActive} onCheckedChange={handleActiveToggle} />
          <span className="text-xs text-muted-foreground">Active</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto p-6 space-y-5">
          {/* Header */}
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              {skill.name}
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5 font-mono">
              {skill.path}
            </p>
            {!isActive && (
              <p className="text-[11px] text-amber-500 mt-1.5">
                Filtered out — won't be injected into the agent.
              </p>
            )}
            {isSelected && filterMode === "deny" && (
              <p className="text-[11px] text-muted-foreground mt-1.5">
                On the exclude list. Toggle Active above to remove.
              </p>
            )}
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>Description</Label>
              {hasChanges && (
                <Button size="sm" onClick={handleSave} disabled={isSaving}>
                  {isSaving ? "Saving..." : "Save"}
                </Button>
              )}
            </div>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={handleBlur}
              placeholder="Skill description..."
            />
          </div>

          {/* Usage */}
          <div className="space-y-1.5">
            <Label>Usage</Label>
            <div className="px-3 py-2 text-sm bg-muted/50 border border-border rounded-lg">
              <code className="text-xs text-foreground">@{skill.name}</code>
            </div>
          </div>

          {/* Instructions */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>Instructions</Label>
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
            </div>

            {viewMode === "rendered" ? (
              <div
                className="rounded-lg border border-border bg-background overflow-hidden px-4 py-3 min-h-[120px] cursor-pointer hover:border-foreground/20 transition-colors"
                onClick={handleToggleViewMode}
              >
                {content ? (
                  <ChatMarkdownRenderer content={content} size="sm" />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No instructions
                  </p>
                )}
              </div>
            ) : (
              <Textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                onBlur={handleBlur}
                rows={16}
                className="font-mono resize-y"
                placeholder="Skill instructions (markdown)..."
                autoFocus
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Filter card (sits at the top of the right pane, no-selection state)
// ──────────────────────────────────────────────────────────────────────

function FilterEmptyState({
  mode,
  onModeChange,
  activeCount,
  totalCount,
  onClearSelection,
  hasSelection,
  isPending,
}: {
  mode: FilterMode
  onModeChange: (mode: FilterMode) => void
  activeCount: number
  totalCount: number
  onClearSelection: () => void
  hasSelection: boolean
  isPending: boolean
}) {
  const modeBlurb =
    mode === "allow"
      ? "Only skills toggled Active are injected. Empty list = nothing active."
      : "Skills toggled Active stay on; toggling one off adds it to the exclude list."

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto p-6 space-y-6">
        <div className="flex flex-col space-y-1.5">
          <h3 className="text-sm font-semibold text-foreground">Skills</h3>
          <p className="text-xs text-muted-foreground">
            Curated AI-creatorship skills the agent has access to. Pick a
            skill on the left to inspect or edit its instructions.
          </p>
        </div>

        {/* Filter mode card */}
        <div className="bg-background rounded-lg border border-border overflow-hidden">
          <div className="flex items-center justify-between p-4">
            <div className="flex flex-col space-y-1">
              <span className="text-sm font-medium text-foreground">
                Filter mode
              </span>
              <span className="text-xs text-muted-foreground">{modeBlurb}</span>
            </div>
            <Select
              value={mode}
              onValueChange={(v) => onModeChange(v as FilterMode)}
              disabled={isPending}
            >
              <SelectTrigger className="w-auto px-2">
                <span className="text-xs">
                  {mode === "allow" ? "Include only" : "Exclude"}
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="allow">Include only</SelectItem>
                <SelectItem value="deny">Exclude</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between p-4 border-t border-border">
            <div className="flex flex-col space-y-1">
              <span className="text-sm font-medium text-foreground">
                Active skills
              </span>
              <span className="text-xs text-muted-foreground">
                Skills currently passed to the agent on each turn.
              </span>
            </div>
            <span className="text-sm tabular-nums text-foreground">
              {activeCount}{" "}
              <span className="text-muted-foreground">/ {totalCount}</span>
            </span>
          </div>
          {hasSelection && (
            <div className="flex items-center justify-between p-4 border-t border-border">
              <div className="flex flex-col space-y-1">
                <span className="text-sm font-medium text-foreground">
                  Reset selection
                </span>
                <span className="text-xs text-muted-foreground">
                  Clear all manual choices and revert to defaults for this mode.
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={onClearSelection}
                disabled={isPending}
              >
                Reset
              </Button>
            </div>
          )}
        </div>

        {/* Hint */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <SkillIcon className="h-3.5 w-3.5 shrink-0" />
          <span>
            Toggle skills on the left to control what the agent can use.
          </span>
        </div>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Sidebar list item — matches plugins-tab styling, with Switch on right
// ──────────────────────────────────────────────────────────────────────

function SkillListItem({
  skill,
  isSelected,
  isActive,
  onSelect,
  onToggleActive,
}: {
  skill: RegistrySkill
  isSelected: boolean
  isActive: boolean
  onSelect: (name: string) => void
  onToggleActive: (name: string, next: boolean) => void
}) {
  return (
    <div
      data-item-id={skill.name}
      className={cn(
        "w-full flex items-start gap-2 py-1.5 px-2 rounded-md transition-colors duration-150",
        isSelected
          ? "bg-foreground/5 text-foreground"
          : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
      )}
    >
      <button
        type="button"
        onClick={() => onSelect(skill.name)}
        className="flex-1 min-w-0 text-left outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring/70 focus-visible:-outline-offset-2 rounded"
      >
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              "text-sm leading-tight truncate",
              !skill.installed && "text-muted-foreground/55",
            )}
          >
            {skill.name}
          </span>
          {!skill.installed && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <AlertCircle className="h-3 w-3 text-amber-500 shrink-0" />
                </span>
              </TooltipTrigger>
              <TooltipContent side="right" className="text-xs">
                Not installed at ~/.claude/skills/{skill.name}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
        {skill.description && (
          <div className="text-[11px] text-muted-foreground/60 truncate mt-0.5">
            {skill.description}
          </div>
        )}
      </button>
      <div className="shrink-0 pt-[2px]">
        <Switch
          checked={isActive}
          onCheckedChange={(next) => onToggleActive(skill.name, next)}
          disabled={!skill.installed}
          className="scale-75 origin-right"
        />
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Main tab
// ──────────────────────────────────────────────────────────────────────

export function AgentsSkillsTab() {
  const selectedProject = useAtomValue(selectedProjectAtom)
  const utils = trpc.useUtils()

  const { data: registry = [], isLoading: isRegistryLoading } =
    trpc.skills.registry.useQuery()
  const { data: filter, isLoading: isFilterLoading } =
    trpc.skills.getFilter.useQuery()

  const { data: allSkills = [], refetch: refetchSkills } =
    trpc.skills.list.useQuery(
      selectedProject?.path ? { cwd: selectedProject.path } : undefined,
    )

  const setFilter = trpc.skills.setFilter.useMutation({
    onMutate: async (next) => {
      await utils.skills.getFilter.cancel()
      const prev = utils.skills.getFilter.getData()
      utils.skills.getFilter.setData(undefined, next)
      return { prev }
    },
    onError: (_err, _next, ctx) => {
      if (ctx?.prev) utils.skills.getFilter.setData(undefined, ctx.prev)
      toast.error("Couldn't save filter.")
    },
    onSettled: () => {
      void utils.skills.active.invalidate()
    },
  })

  const updateMutation = trpc.skills.update.useMutation()

  const [selectedSkillName, setSelectedSkillName] = useState<string | null>(
    null,
  )
  const [searchQuery, setSearchQuery] = useState("")
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Focus search on "/" hotkey — same as other settings tabs
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const tag = (e.target as HTMLElement)?.tagName
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return
        e.preventDefault()
        searchInputRef.current?.focus()
      }
    }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [])

  // Apply search to the categorised registry — drop empty categories.
  const filteredRegistry = useMemo<RegistryCategory[]>(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return registry
    return registry
      .map((cat) => ({
        ...cat,
        skills: cat.skills.filter(
          (s) =>
            s.name.toLowerCase().includes(q) ||
            (s.description ?? "").toLowerCase().includes(q),
        ),
      }))
      .filter((cat) => cat.skills.length > 0)
  }, [registry, searchQuery])

  const selectedSet = useMemo(
    () => new Set(filter?.selected ?? []),
    [filter?.selected],
  )

  // Active = "currently passed to the agent". Computed off mode + selection.
  const isActive = useCallback(
    (name: string) => {
      if (!filter) return true
      return filter.mode === "allow"
        ? selectedSet.has(name)
        : !selectedSet.has(name)
    },
    [filter, selectedSet],
  )

  const totalRegistry = useMemo(
    () => registry.reduce((acc, cat) => acc + cat.skills.length, 0),
    [registry],
  )
  const activeCount = useMemo(() => {
    if (!filter) return totalRegistry
    if (filter.mode === "allow") return selectedSet.size
    return totalRegistry - selectedSet.size
  }, [filter, selectedSet, totalRegistry])

  const handleModeChange = useCallback(
    (mode: FilterMode) => {
      if (!filter) return
      if (mode === filter.mode) return
      setFilter.mutate({ mode, selected: filter.selected })
    },
    [filter, setFilter],
  )

  // Switch on a row directly toggles "active". The selection set is
  // updated to reflect the chosen mode (allow ↔ in-set, deny ↔ not-in-set).
  const handleToggleActive = useCallback(
    (name: string, nextActive: boolean) => {
      if (!filter) return
      const selected = new Set(filter.selected)
      const shouldBeInSelected =
        filter.mode === "allow" ? nextActive : !nextActive
      if (shouldBeInSelected) selected.add(name)
      else selected.delete(name)
      setFilter.mutate({
        mode: filter.mode,
        selected: Array.from(selected),
      })
    },
    [filter, setFilter],
  )

  const handleClear = useCallback(() => {
    if (!filter) return
    setFilter.mutate({ mode: filter.mode, selected: [] })
  }, [filter, setFilter])

  // Keyboard navigation across all visible items
  const allSkillNames = useMemo(
    () => filteredRegistry.flatMap((cat) => cat.skills.map((s) => s.name)),
    [filteredRegistry],
  )
  const { containerRef: listRef, onKeyDown: listKeyDown } =
    useListKeyboardNav({
      items: allSkillNames,
      selectedItem: selectedSkillName,
      onSelect: setSelectedSkillName,
    })

  // Detail panel data
  const selectedSkill = useMemo(() => {
    if (!selectedSkillName) return null
    const found = allSkills.find((s) => s.name === selectedSkillName)
    if (!found) return null
    if (found.source === "plugin") return null
    return {
      name: found.name,
      description: found.description,
      source: found.source as "user" | "project",
      path: found.path,
      content: found.content,
    }
  }, [allSkills, selectedSkillName])

  const handleSave = useCallback(
    async (
      skill: { name: string; path: string },
      data: { description: string; content: string },
    ) => {
      try {
        await updateMutation.mutateAsync({
          path: skill.path,
          name: skill.name,
          description: data.description,
          content: data.content,
          cwd: selectedProject?.path,
        })
        toast.success("Skill saved", { description: skill.name })
        await refetchSkills()
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to save"
        toast.error("Failed to save", { description: message })
      }
    },
    [updateMutation, selectedProject?.path, refetchSkills],
  )

  const handleToggleSelectedFromDetail = useCallback(
    (next: boolean) => {
      if (!selectedSkillName) return
      const cur = selectedSet.has(selectedSkillName)
      if (next === cur) return
      const selected = new Set(selectedSet)
      if (next) selected.add(selectedSkillName)
      else selected.delete(selectedSkillName)
      if (!filter) return
      setFilter.mutate({
        mode: filter.mode,
        selected: Array.from(selected),
      })
    },
    [filter, selectedSet, selectedSkillName, setFilter],
  )

  const isLoading = isRegistryLoading || isFilterLoading

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left sidebar */}
      <ResizableSidebar
        isOpen={true}
        onClose={() => {}}
        widthAtom={settingsSkillsSidebarWidthAtom}
        minWidth={240}
        maxWidth={420}
        side="left"
        animationDuration={0}
        initialWidth={280}
        exitWidth={280}
        disableClickToClose={true}
      >
        <div
          className="flex flex-col h-full bg-background border-r overflow-hidden"
          style={{ borderRightWidth: "0.5px" }}
        >
          {/* Search */}
          <div className="px-2 pt-2 flex-shrink-0 flex items-center gap-1.5">
            <input
              ref={searchInputRef}
              placeholder="Search skills..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={listKeyDown}
              className="h-7 w-full rounded-lg text-sm bg-muted border border-input px-3 placeholder:text-muted-foreground/40 outline-none"
            />
          </div>

          {/* List */}
          <div
            ref={listRef}
            onKeyDown={listKeyDown}
            tabIndex={-1}
            className="flex-1 overflow-y-auto px-2 pt-2 pb-2 outline-none"
          >
            {isLoading ? (
              <div className="flex items-center justify-center h-full">
                <p className="text-xs text-muted-foreground">Loading...</p>
              </div>
            ) : filteredRegistry.length === 0 ? (
              <div className="flex items-center justify-center py-8">
                <p className="text-xs text-muted-foreground">
                  {searchQuery ? "No results found" : "Registry is empty"}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredRegistry.map((cat) => (
                  <div key={cat.label}>
                    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-2 mb-1">
                      {cat.label}
                    </p>
                    <div className="space-y-0.5">
                      {cat.skills.map((skill) => (
                        <SkillListItem
                          key={skill.name}
                          skill={skill}
                          isSelected={selectedSkillName === skill.name}
                          isActive={isActive(skill.name)}
                          onSelect={setSelectedSkillName}
                          onToggleActive={handleToggleActive}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </ResizableSidebar>

      {/* Right content */}
      <div className="flex-1 min-w-0 h-full overflow-hidden">
        {selectedSkill ? (
          <SkillDetail
            skill={selectedSkill}
            isActive={isActive(selectedSkill.name)}
            filterMode={filter?.mode ?? "deny"}
            isSelected={selectedSet.has(selectedSkill.name)}
            onToggleSelected={handleToggleSelectedFromDetail}
            onSave={(data) => handleSave(selectedSkill, data)}
            isSaving={updateMutation.isPending}
          />
        ) : (
          <FilterEmptyState
            mode={filter?.mode ?? "deny"}
            onModeChange={handleModeChange}
            activeCount={activeCount}
            totalCount={totalRegistry}
            onClearSelection={handleClear}
            hasSelection={selectedSet.size > 0}
            isPending={setFilter.isPending}
          />
        )}
      </div>
    </div>
  )
}
