"use client"

/**
 * AgentsSkillsTab — the skill preset manager.
 *
 * Backlot's Claude agent does not get the user's whole ~/.claude/skills
 * library. It gets a curated **preset** — a factory default list that
 * ships in code, which the user edits here. The preset persists to
 * ~/.backlot/skills-preset.json; at session start Backlot symlinks
 * exactly those skills into the agent's config dir.
 *
 * This tab lists every installed user skill with an Active switch.
 * Switched on = in the preset = the agent can use it. Factory-default
 * skills are marked. Project and plugin skills load automatically and
 * are not governed here.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useAtomValue } from "jotai"
import {
  selectedProjectAtom,
  settingsSkillsSidebarWidthAtom,
} from "../../../features/agents/atoms"
import { trpc } from "../../../lib/trpc"
import { cn } from "../../../lib/utils"
import { useListKeyboardNav } from "./use-list-keyboard-nav"
import { SkillIcon, MarkdownIcon, CodeIcon } from "../../ui/icons"
import { Input } from "../../ui/input"
import { Label } from "../../ui/label"
import { Textarea } from "../../ui/textarea"
import { Button } from "../../ui/button"
import { Switch } from "../../ui/switch"
import { ResizableSidebar } from "../../ui/resizable-sidebar"
import { ChatMarkdownRenderer } from "../../chat-markdown-renderer"
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/tooltip"
import { toast } from "sonner"

interface InstalledSkill {
  name: string
  description: string
  source: "user" | "project" | "plugin"
  path: string
  content: string
}

// ──────────────────────────────────────────────────────────────────────
// Detail panel — view / edit a skill's SKILL.md, with an Active switch.
// ──────────────────────────────────────────────────────────────────────

function SkillDetail({
  skill,
  isActive,
  isFactory,
  onToggleActive,
  onSave,
  isSaving,
}: {
  skill: InstalledSkill
  isActive: boolean
  isFactory: boolean
  onToggleActive: (next: boolean) => void
  onSave: (data: { description: string; content: string }) => void
  isSaving: boolean
}) {
  const [description, setDescription] = useState(skill.description)
  const [content, setContent] = useState(skill.content)
  const [viewMode, setViewMode] = useState<"rendered" | "editor">("editor")

  useEffect(() => {
    setDescription(skill.description)
    setContent(skill.content)
    setViewMode("editor")
  }, [skill.name, skill.description, skill.content])

  const hasChanges =
    description !== skill.description || content !== skill.content

  const save = useCallback(() => {
    if (description !== skill.description || content !== skill.content) {
      onSave({ description, content })
    }
  }, [description, content, skill.description, skill.content, onSave])

  const toggleViewMode = useCallback(() => {
    setViewMode((prev) => {
      if (prev === "editor") save()
      return prev === "rendered" ? "editor" : "rendered"
    })
  }, [save])

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex items-center justify-end gap-1.5 px-6 py-3 shrink-0">
        <Switch checked={isActive} onCheckedChange={onToggleActive} />
        <span className="text-xs text-muted-foreground">Active</span>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto p-8 space-y-5">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground">
                {skill.name}
              </h3>
              {isFactory && (
                <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/15 text-primary">
                  Default
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 font-mono">
              {skill.path}
            </p>
            {!isActive && (
              <p className="text-[11px] text-amber-500 mt-1.5">
                Off — not in the preset, the agent can't use it.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>Description</Label>
              {hasChanges && (
                <Button size="sm" onClick={save} disabled={isSaving}>
                  {isSaving ? "Saving..." : "Save"}
                </Button>
              )}
            </div>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={save}
              placeholder="Skill description..."
            />
          </div>

          <div className="space-y-1.5">
            <Label>Usage</Label>
            <div className="px-3 py-2 text-sm bg-muted/50 border border-border rounded-lg">
              <code className="text-xs text-foreground">@{skill.name}</code>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>Instructions</Label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={toggleViewMode}
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
                  {viewMode === "rendered" ? "Edit markdown" : "Preview markdown"}
                </TooltipContent>
              </Tooltip>
            </div>

            {viewMode === "rendered" ? (
              <div
                className="min-h-[620px] cursor-text text-foreground/90"
                onClick={toggleViewMode}
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
                onBlur={save}
                rows={32}
                className={cn(
                  "min-h-[620px] resize-none border-0 bg-transparent p-0 shadow-none rounded-none",
                  "font-mono text-[13.5px] leading-[1.65] text-foreground/90",
                  "focus-visible:ring-0 focus-visible:border-0",
                  "selection:bg-primary/25 caret-primary",
                )}
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
// Empty state — preset summary, shown when no skill is selected.
// ──────────────────────────────────────────────────────────────────────

function PresetSummary({
  activeCount,
  totalCount,
  isFactoryDefault,
  onResetFactory,
  isPending,
}: {
  activeCount: number
  totalCount: number
  isFactoryDefault: boolean
  onResetFactory: () => void
  isPending: boolean
}) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto p-6 space-y-6">
        <div className="flex flex-col space-y-1.5">
          <h3 className="text-sm font-semibold text-foreground">Skill preset</h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            The agent loads a curated set of skills, not your whole
            library. Switch skills on or off in the list — changes take
            effect on the next agent turn. Project and plugin skills load
            automatically and aren't listed here.
          </p>
        </div>

        <div className="bg-background rounded-lg border border-border overflow-hidden">
          <div className="flex items-center justify-between p-4">
            <div className="flex flex-col space-y-1">
              <span className="text-sm font-medium text-foreground">
                Active skills
              </span>
              <span className="text-xs text-muted-foreground">
                Passed to the Claude agent each session.
              </span>
            </div>
            <span className="text-sm tabular-nums text-foreground">
              {activeCount}{" "}
              <span className="text-muted-foreground">/ {totalCount}</span>
            </span>
          </div>
          <div className="flex items-center justify-between p-4 border-t border-border">
            <div className="flex flex-col space-y-1">
              <span className="text-sm font-medium text-foreground">
                Factory default
              </span>
              <span className="text-xs text-muted-foreground">
                {isFactoryDefault
                  ? "The preset matches the shipped default."
                  : "Restore the shipped default skill set."}
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={onResetFactory}
              disabled={isFactoryDefault || isPending}
            >
              Reset to factory
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <SkillIcon className="h-3.5 w-3.5 shrink-0" />
          <span>Pick a skill on the left to inspect or edit it.</span>
        </div>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Sidebar row.
// ──────────────────────────────────────────────────────────────────────

function SkillRow({
  skill,
  isSelected,
  isActive,
  isFactory,
  onSelect,
  onToggle,
}: {
  skill: InstalledSkill
  isSelected: boolean
  isActive: boolean
  isFactory: boolean
  onSelect: (name: string) => void
  onToggle: (name: string, next: boolean) => void
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
              !isActive && "text-muted-foreground/55",
            )}
          >
            {skill.name}
          </span>
          {isFactory && (
            <span
              className="h-1.5 w-1.5 rounded-full bg-primary/70 shrink-0"
              title="Factory default"
            />
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
          onCheckedChange={(next) => onToggle(skill.name, next)}
          className="scale-75 origin-right"
        />
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Main tab.
// ──────────────────────────────────────────────────────────────────────

export function AgentsSkillsTab() {
  const selectedProject = useAtomValue(selectedProjectAtom)
  const utils = trpc.useUtils()

  const { data: allSkills = [], isLoading: isSkillsLoading, refetch: refetchSkills } =
    trpc.skills.list.useQuery(
      selectedProject?.path ? { cwd: selectedProject.path } : undefined,
    )
  const { data: preset, isLoading: isPresetLoading } =
    trpc.skills.getPreset.useQuery()
  const { data: factory = [] } = trpc.skills.factory.useQuery()

  const setPreset = trpc.skills.setPreset.useMutation({
    onMutate: async (next) => {
      await utils.skills.getPreset.cancel()
      const prev = utils.skills.getPreset.getData()
      utils.skills.getPreset.setData(undefined, { skills: next.skills })
      return { prev }
    },
    onError: (_err, _next, ctx) => {
      if (ctx?.prev) utils.skills.getPreset.setData(undefined, ctx.prev)
      toast.error("Couldn't save the skill preset.")
    },
    onSettled: () => {
      void utils.skills.getPreset.invalidate()
    },
  })
  const updateMutation = trpc.skills.update.useMutation()

  const [selectedSkillName, setSelectedSkillName] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Focus search on "/" hotkey.
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

  // The preset governs user-scope skills only — project/plugin skills
  // load automatically and aren't toggled here.
  const userSkills = useMemo<InstalledSkill[]>(
    () =>
      allSkills
        .filter((s): s is InstalledSkill => s.source === "user")
        .sort((a, b) => a.name.localeCompare(b.name)),
    [allSkills],
  )

  const activeSet = useMemo(
    () => new Set(preset?.skills ?? []),
    [preset?.skills],
  )
  const factorySet = useMemo(() => new Set(factory), [factory])

  const visibleSkills = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return userSkills
    return userSkills.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q),
    )
  }, [userSkills, searchQuery])

  const activeCount = useMemo(
    () => userSkills.filter((s) => activeSet.has(s.name)).length,
    [userSkills, activeSet],
  )

  // Preset matches factory when the active sets are identical.
  const isFactoryDefault = useMemo(() => {
    if (!preset) return true
    if (preset.skills.length !== factory.length) return false
    return preset.skills.every((n) => factorySet.has(n))
  }, [preset, factory, factorySet])

  const toggle = useCallback(
    (name: string, next: boolean) => {
      const current = new Set(preset?.skills ?? [])
      if (next) current.add(name)
      else current.delete(name)
      setPreset.mutate({ skills: [...current] })
    },
    [preset?.skills, setPreset],
  )

  const resetFactory = useCallback(() => {
    setPreset.mutate({ skills: factory })
  }, [factory, setPreset])

  // Keyboard nav.
  const visibleNames = useMemo(
    () => visibleSkills.map((s) => s.name),
    [visibleSkills],
  )
  const { containerRef: listRef, onKeyDown: listKeyDown } = useListKeyboardNav({
    items: visibleNames,
    selectedItem: selectedSkillName,
    onSelect: setSelectedSkillName,
  })

  const selectedSkill = useMemo(
    () => userSkills.find((s) => s.name === selectedSkillName) ?? null,
    [userSkills, selectedSkillName],
  )

  const handleSave = useCallback(
    async (
      skill: InstalledSkill,
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
        toast.error("Failed to save", {
          description: error instanceof Error ? error.message : "Failed to save",
        })
      }
    },
    [updateMutation, selectedProject?.path, refetchSkills],
  )

  const isLoading = isSkillsLoading || isPresetLoading

  return (
    <div className="flex h-full overflow-hidden">
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
            ) : visibleSkills.length === 0 ? (
              <div className="flex items-center justify-center py-8">
                <p className="text-xs text-muted-foreground">
                  {searchQuery
                    ? "No results found"
                    : "No skills installed in ~/.claude/skills"}
                </p>
              </div>
            ) : (
              <div className="space-y-0.5">
                {visibleSkills.map((skill) => (
                  <SkillRow
                    key={skill.name}
                    skill={skill}
                    isSelected={selectedSkillName === skill.name}
                    isActive={activeSet.has(skill.name)}
                    isFactory={factorySet.has(skill.name)}
                    onSelect={setSelectedSkillName}
                    onToggle={toggle}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </ResizableSidebar>

      <div className="flex-1 min-w-0 h-full overflow-hidden">
        {selectedSkill ? (
          <SkillDetail
            skill={selectedSkill}
            isActive={activeSet.has(selectedSkill.name)}
            isFactory={factorySet.has(selectedSkill.name)}
            onToggleActive={(next) => toggle(selectedSkill.name, next)}
            onSave={(data) => handleSave(selectedSkill, data)}
            isSaving={updateMutation.isPending}
          />
        ) : (
          <PresetSummary
            activeCount={activeCount}
            totalCount={userSkills.length}
            isFactoryDefault={isFactoryDefault}
            onResetFactory={resetFactory}
            isPending={setPreset.isPending}
          />
        )}
      </div>
    </div>
  )
}
