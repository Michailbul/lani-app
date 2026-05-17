import {
  useCallback,
  useEffect,
  useState,
  useMemo,
  useRef,
} from "react"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { isDesktopApp } from "../../lib/utils/platform"
import { cn } from "../../lib/utils"
import { assistantRailOpenAtom, projectTreeOpenAtom } from "../backlot/atoms"
import { useIsMobile } from "../../lib/hooks/use-mobile"

import {
  agentsSidebarOpenAtom,
  agentsSidebarWidthAtom,
  agentsSettingsDialogActiveTabAtom,
  isDesktopAtom,
  isFullscreenAtom,
  anthropicOnboardingCompletedAtom,
  customHotkeysAtom,
  betaKanbanEnabledAtom,
  betaAutomationsEnabledAtom,
  chatSourceModeAtom,
} from "../../lib/atoms"
import { selectedAgentChatIdAtom, selectedProjectAtom, selectedDraftIdAtom, showNewChatFormAtom, desktopViewAtom, fileSearchDialogOpenAtom, agentsSubChatsSidebarModeAtom } from "../agents/atoms"
import { trpc } from "../../lib/trpc"
import { useAgentsHotkeys } from "../agents/lib/agents-hotkeys-manager"
import { toggleSearchAtom } from "../agents/search"
import { ClaudeLoginModal } from "../../components/dialogs/claude-login-modal"
import { CodexLoginModal } from "../../components/dialogs/codex-login-modal"
import { SkillProposalsHost } from "../skills/skill-proposals-host"
import { SkillWorkbenchFocusHost } from "../backlot/skill-workbench-focus-host"
import { TooltipProvider } from "../../components/ui/tooltip"
import { ResizableSidebar } from "../../components/ui/resizable-sidebar"
import { ProjectsSidebar } from "../sidebar/projects-sidebar"
import { AgentsContent } from "../agents/ui/agents-content"
import { UpdateBanner } from "../../components/update-banner"
import { WindowsTitleBar } from "../../components/windows-title-bar"
import { useUpdateChecker } from "../../lib/hooks/use-update-checker"
import { useAgentSubChatStore } from "../agents/stores/sub-chat-store"
import { QueueProcessor } from "../agents/components/queue-processor"
import { SettingsSidebar } from "../settings/settings-sidebar"
import { ChatView } from "../agents/main/active-chat"
import { NoChatAssistantPanel } from "../agents/ui/no-chat-assistant-panel"
import { AssistantRail } from "../backlot/assistant-rail"
import { AppTopBar } from "../backlot/screenplay-workspace"

// ============================================================================
// Constants
// ============================================================================

const SIDEBAR_MIN_WIDTH = 160
const SIDEBAR_MAX_WIDTH = 600
const SIDEBAR_ANIMATION_DURATION = 0
const SIDEBAR_CLOSE_HOTKEY = "⌘\\"

// Soft all-around shadow that lifts the Projects panel off the canvas as a
// floating island.
const FLOATING_PANEL_SHADOW =
  "0 0 0 0.5px hsl(var(--border) / 0.55), 0 2px 5px rgba(20, 20, 20, 0.05), 0 12px 30px -10px rgba(20, 20, 20, 0.17)"

// ============================================================================
// Component
// ============================================================================

export function AgentsLayout() {
  // No useHydrateAtoms - desktop doesn't need SSR, atomWithStorage handles persistence
  const isMobile = useIsMobile()

  // Global desktop/fullscreen state - initialized here at root level
  const [isDesktop, setIsDesktop] = useAtom(isDesktopAtom)
  const [, setIsFullscreen] = useAtom(isFullscreenAtom)

  // Initialize isDesktop on mount
  useEffect(() => {
    setIsDesktop(isDesktopApp())
  }, [setIsDesktop])

  // Subscribe to fullscreen changes from Electron
  useEffect(() => {
    if (
      !isDesktop ||
      typeof window === "undefined" ||
      !window.desktopApi?.windowIsFullscreen
    )
      return

    // Get initial fullscreen state
    window.desktopApi.windowIsFullscreen().then(setIsFullscreen)

    // In dev mode, HMR breaks IPC event subscriptions, so we poll instead
    const isDev = import.meta.env.DEV
    if (isDev) {
      const interval = setInterval(() => {
        window.desktopApi?.windowIsFullscreen?.().then(setIsFullscreen)
      }, 300)
      return () => clearInterval(interval)
    }

    // In production, use events (more efficient)
    const unsubscribe = window.desktopApi.onFullscreenChange?.(setIsFullscreen)
    return unsubscribe
  }, [isDesktop, setIsFullscreen])

  // Check for updates on mount and periodically
  useUpdateChecker()

  // Backlot never mounts the upstream sub-chats sidebar — the project
  // tree rail is the navigator. Pin sub-chat display to inline tabs:
  // "sidebar" mode reserves dead vertical space in the chat header and
  // above the title for a pane that isn't there.
  const setSubChatsSidebarMode = useSetAtom(agentsSubChatsSidebarModeAtom)
  useEffect(() => {
    setSubChatsSidebarMode("tabs")
  }, [setSubChatsSidebarMode])

  const [sidebarOpen, setSidebarOpen] = useAtom(agentsSidebarOpenAtom)
  const [sidebarWidth, setSidebarWidth] = useAtom(agentsSidebarWidthAtom)
  const setSettingsActiveTab = useSetAtom(agentsSettingsDialogActiveTabAtom)
  const desktopView = useAtomValue(desktopViewAtom)
  const setFileSearchDialogOpen = useSetAtom(fileSearchDialogOpenAtom)
  const [selectedChatId, setSelectedChatId] = useAtom(selectedAgentChatIdAtom)
  const [selectedProject, setSelectedProject] = useAtom(selectedProjectAtom)
  const setSelectedDraftId = useSetAtom(selectedDraftIdAtom)
  const setShowNewChatForm = useSetAtom(showNewChatFormAtom)
  const betaKanbanEnabled = useAtomValue(betaKanbanEnabledAtom)
  const betaAutomationsEnabled = useAtomValue(betaAutomationsEnabledAtom)
  const selectedDraftId = useAtomValue(selectedDraftIdAtom)
  const showNewChatForm = useAtomValue(showNewChatFormAtom)
  const chatSourceMode = useAtomValue(chatSourceModeAtom)
  const setDesktopView = useSetAtom(desktopViewAtom)
  const setAnthropicOnboardingCompleted = useSetAtom(
    anthropicOnboardingCompletedAtom
  )

  // Fetch projects to validate selectedProject exists
  const { data: projects, isLoading: isLoadingProjects } =
    trpc.projects.list.useQuery()

  // Validated project - only valid if exists in DB
  // While loading, trust localStorage value to prevent clearing on app restart
  const validatedProject = useMemo(() => {
    if (!selectedProject) return null
    // While loading, trust localStorage value to prevent flicker and clearing
    if (isLoadingProjects) return selectedProject
    // After loading, validate against DB
    if (!projects) return null
    const exists = projects.some((p) => p.id === selectedProject.id)
    return exists ? selectedProject : null
  }, [selectedProject, projects, isLoadingProjects])

  // Clear invalid project from storage (only after loading completes)
  useEffect(() => {
    if (
      selectedProject &&
      projects &&
      !isLoadingProjects &&
      !validatedProject
    ) {
      setSelectedProject(null)
    }
  }, [
    selectedProject,
    projects,
    isLoadingProjects,
    validatedProject,
    setSelectedProject,
  ])

  // Show/hide native traffic lights based on sidebar state
  useEffect(() => {
    if (!isDesktop) return
    if (
      typeof window === "undefined" ||
      !window.desktopApi?.setTrafficLightVisibility
    )
      return

    // Traffic lights live in the always-present AppTopBar now, so keep
    // them visible regardless of the Projects-sidebar state.
    window.desktopApi.setTrafficLightVisibility(true)
  }, [isDesktop])

  const setChatId = useAgentSubChatStore((state) => state.setChatId)

  // Desktop user state
  const [desktopUser, setDesktopUser] = useState<{
    id: string
    email: string
    name: string | null
    imageUrl: string | null
    username: string | null
  } | null>(null)

  // Fetch desktop user on mount
  useEffect(() => {
    async function fetchUser() {
      if (window.desktopApi?.getUser) {
        const user = await window.desktopApi.getUser()
        setDesktopUser(user)
      }
    }
    fetchUser()
  }, [])

  // Track if this is the initial load - skip auto-open on first load to respect saved state
  const isInitialLoadRef = useRef(true)

  // Auto-open sidebar when project is selected, close when no project
  // Skip on initial load to preserve user's saved sidebar preference
  useEffect(() => {
    if (!projects) return // Don't change sidebar state while loading

    // On initial load, just mark as loaded and don't change sidebar state
    if (isInitialLoadRef.current) {
      isInitialLoadRef.current = false
      return
    }

    // After initial load, react to project changes
    if (validatedProject) {
      setSidebarOpen(true)
    } else {
      setSidebarOpen(false)
    }
  }, [validatedProject, projects, setSidebarOpen])

  // Handle sign out
  const handleSignOut = useCallback(async () => {
    // Clear selected project and anthropic onboarding on logout
    setSelectedProject(null)
    setSelectedChatId(null)
    setAnthropicOnboardingCompleted(false)
    if (window.desktopApi?.logout) {
      await window.desktopApi.logout()
    }
  }, [setSelectedProject, setSelectedChatId, setAnthropicOnboardingCompleted])

  // Initialize sub-chats when chat is selected
  useEffect(() => {
    if (selectedChatId) {
      setChatId(selectedChatId)
    } else {
      setChatId(null)
    }
  }, [selectedChatId, setChatId])

  // Chat search toggle
  const toggleChatSearch = useSetAtom(toggleSearchAtom)

  // Custom hotkeys config
  const customHotkeysConfig = useAtomValue(customHotkeysAtom)

  // Initialize hotkeys manager
  useAgentsHotkeys({
    setSelectedChatId,
    setSelectedDraftId,
    setShowNewChatForm,
    setDesktopView,
    setSidebarOpen,
    setSettingsActiveTab,
    setFileSearchDialogOpen,
    toggleChatSearch,
    selectedChatId,
    customHotkeysConfig,
    betaKanbanEnabled,
  })

  const handleCloseSidebar = useCallback(() => {
    setSidebarOpen(false)
  }, [setSidebarOpen])

  const isSettingsView = desktopView === "settings"
  const sidebarDesktopUser = desktopUser
    ? {
        id: desktopUser.id,
        email: desktopUser.email,
        name: desktopUser.name ?? undefined,
      }
    : null

  // Assistant rail — hoisted here so it spans the full window height as a
  // top-level column, beside the macOS chrome strip rather than tucked
  // under it. It shows for exactly the views that render
  // ScreenplayWorkspace; this mirrors the branch order in AgentsContent's
  // desktop layout (settings / automations take over the whole surface;
  // a draft, the new-chat form, or Kanban replace the project view).
  const isAutomationsView =
    betaAutomationsEnabled &&
    (desktopView === "automations" ||
      desktopView === "automations-detail" ||
      desktopView === "inbox")
  const isWorkspaceSurface =
    !isMobile &&
    !isSettingsView &&
    !isAutomationsView &&
    (selectedChatId != null ||
      (validatedProject != null &&
        !selectedDraftId &&
        !showNewChatForm &&
        !betaKanbanEnabled))

  // The chat itself — the existing <ChatView />, preserved verbatim with a
  // stable key so the stream and chat state survive across re-renders.
  const assistantNode = selectedChatId ? (
    <ChatView
      key={`${chatSourceMode}-${selectedChatId}`}
      chatId={selectedChatId}
      isSidebarOpen={sidebarOpen}
      onToggleSidebar={() => setSidebarOpen((prev) => !prev)}
    />
  ) : (
    <NoChatAssistantPanel />
  )

  return (
    <TooltipProvider delayDuration={300}>
      {/* Global queue processor - handles message queues for all sub-chats */}
      <QueueProcessor />
      <ClaudeLoginModal />
      <CodexLoginModal />
      {/* Renders the SkillDiffModal whenever the in-process MCP tool
          `propose_skill_change` fires. One host for the whole app. */}
      <SkillProposalsHost />
      {/* Flips into Skill Workbench mode when the agent's
          `open_skill_workbench` MCP tool fires. */}
      <SkillWorkbenchFocusHost />
      <div className="flex flex-col w-full h-full relative overflow-hidden bg-background select-none">
        {/* Windows Title Bar (only shown on Windows with frameless window) */}
        <WindowsTitleBar />
        <div className="flex flex-1 overflow-hidden">
          {/* Projects sidebar — a full-window-height column. Its own macOS
              band sits on top so the panel reaches the window's top edge. */}
          <ResizableSidebar
            isOpen={!isMobile && sidebarOpen}
            onClose={handleCloseSidebar}
            widthAtom={agentsSidebarWidthAtom}
            minWidth={SIDEBAR_MIN_WIDTH}
            maxWidth={SIDEBAR_MAX_WIDTH}
            side="left"
            closeHotkey={SIDEBAR_CLOSE_HOTKEY}
            animationDuration={SIDEBAR_ANIMATION_DURATION}
            initialWidth={0}
            exitWidth={0}
            disableClickToClose
            showResizeTooltip
            className="bg-background p-2"
            style={{ overflow: "visible" }}
          >
            {/* Floating island — full height, rounded, inset from the
                window edges so the panel reads as a lifted card. The
                sidebar's own header carries the macOS chrome: its wordmark
                row clears the traffic lights, no empty band on top. */}
            <div
              className="h-full overflow-hidden rounded-xl bg-tl-background"
              style={{ boxShadow: FLOATING_PANEL_SHADOW }}
            >
              {isSettingsView ? (
                <SettingsSidebar />
              ) : (
                <ProjectsSidebar
                  desktopUser={sidebarDesktopUser}
                  onSignOut={handleSignOut}
                  onToggleSidebar={handleCloseSidebar}
                />
              )}
            </div>
          </ResizableSidebar>

          {/* Editor area. On the workspace surface, ScreenplayWorkspace
              renders its own macOS strip per column; other views get the
              fallback AppTopBar here. */}
          <div className="flex-1 overflow-hidden flex flex-col min-w-0">
            {!isMobile && !isWorkspaceSurface && <AppTopBar />}
            <div className="flex-1 overflow-hidden flex flex-col min-w-0">
              <AgentsContent />
            </div>
          </div>

          {/* Right — assistant rail. A full-window-height column so its
              header strip sits on the macOS-chrome line. */}
          {isWorkspaceSurface && <AssistantRail>{assistantNode}</AssistantRail>}
        </div>

        {/* Update Banner */}
        <UpdateBanner />
      </div>
    </TooltipProvider>
  )
}
