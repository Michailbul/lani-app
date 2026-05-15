import {
  useCallback,
  useEffect,
  useState,
  useMemo,
  useRef,
  type ReactNode,
} from "react"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { FolderTree, PanelLeft } from "lucide-react"
import { isDesktopApp } from "../../lib/utils/platform"
import { cn } from "../../lib/utils"
import { projectTreeOpenAtom } from "../backlot/atoms"
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
} from "../../lib/atoms"
import { selectedAgentChatIdAtom, selectedProjectAtom, selectedDraftIdAtom, showNewChatFormAtom, desktopViewAtom, fileSearchDialogOpenAtom } from "../agents/atoms"
import { trpc } from "../../lib/trpc"
import { useAgentsHotkeys } from "../agents/lib/agents-hotkeys-manager"
import { toggleSearchAtom } from "../agents/search"
import { ClaudeLoginModal } from "../../components/dialogs/claude-login-modal"
import { CodexLoginModal } from "../../components/dialogs/codex-login-modal"
import { SkillProposalsHost } from "../skills/skill-proposals-host"
import { TooltipProvider } from "../../components/ui/tooltip"
import { ResizableSidebar } from "../../components/ui/resizable-sidebar"
import { AgentsSidebar } from "../sidebar/agents-sidebar"
import { AgentsContent } from "../agents/ui/agents-content"
import { UpdateBanner } from "../../components/update-banner"
import { WindowsTitleBar } from "../../components/windows-title-bar"
import { useUpdateChecker } from "../../lib/hooks/use-update-checker"
import { useAgentSubChatStore } from "../agents/stores/sub-chat-store"
import { QueueProcessor } from "../agents/components/queue-processor"
import { SettingsSidebar } from "../settings/settings-sidebar"

// ============================================================================
// Constants
// ============================================================================

const SIDEBAR_MIN_WIDTH = 160
const SIDEBAR_MAX_WIDTH = 300
const SIDEBAR_ANIMATION_DURATION = 0
const SIDEBAR_CLOSE_HOTKEY = "⌘\\"

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

  return (
    <TooltipProvider delayDuration={300}>
      {/* Global queue processor - handles message queues for all sub-chats */}
      <QueueProcessor />
      <ClaudeLoginModal />
      <CodexLoginModal />
      {/* Renders the SkillDiffModal whenever the in-process MCP tool
          `propose_skill_change` fires. One host for the whole app. */}
      <SkillProposalsHost />
      <div className="flex flex-col w-full h-full relative overflow-hidden bg-background select-none">
        {/* Windows Title Bar (only shown on Windows with frameless window) */}
        <WindowsTitleBar />
        {/* macOS chrome strip — reserves the top band for the native
            traffic lights and the panel collapse/expand toggles. */}
        <AppTopBar />
        <div className="flex flex-1 overflow-hidden">
          {/* Left Sidebar - switches between chat list and settings nav */}
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
          showResizeTooltip={!isSettingsView}
          className="overflow-hidden bg-background border-r"
          style={{ borderRightWidth: "0.5px" }}
        >
          {isSettingsView ? (
            <SettingsSidebar />
          ) : (
            <AgentsSidebar
              desktopUser={sidebarDesktopUser}
              onSignOut={handleSignOut}
              onToggleSidebar={handleCloseSidebar}
            />
          )}
        </ResizableSidebar>

          {/* Main Content */}
          <div className="flex-1 overflow-hidden flex flex-col min-w-0">
            <AgentsContent />
          </div>
        </div>

        {/* Update Banner */}
        <UpdateBanner />
      </div>
    </TooltipProvider>
  )
}

// ============================================================================
// AppTopBar — the macOS chrome strip. A reserved full-width band at the very
// top of the window: it holds the native traffic lights on the left and the
// panel collapse/expand toggles. The band is itself a window-drag region, so
// no app content sits in it and nothing collides with the OS controls.
// ============================================================================

function AppTopBar() {
  const isDesktop = useAtomValue(isDesktopAtom)
  const isFullscreen = useAtomValue(isFullscreenAtom)
  const [sidebarOpen, setSidebarOpen] = useAtom(agentsSidebarOpenAtom)
  const [treeOpen, setTreeOpen] = useAtom(projectTreeOpenAtom)

  const isMac =
    typeof navigator !== "undefined" &&
    navigator.platform.toUpperCase().includes("MAC")

  // Windows has its own WindowsTitleBar; the web build has no chrome.
  if (!isDesktop || !isMac) return null

  return (
    <div
      className="relative z-30 shrink-0 flex items-center gap-1 h-9 bg-background border-b border-border/70"
      style={{
        // @ts-expect-error - WebKit-specific property
        WebkitAppRegion: "drag",
      }}
    >
      {/* Reserve + un-drag the native traffic-light cluster so the OS
          buttons stay clickable. */}
      {!isFullscreen && (
        <div
          aria-hidden
          className="w-[72px] shrink-0 self-stretch"
          style={{
            // @ts-expect-error - WebKit-specific property
            WebkitAppRegion: "no-drag",
          }}
        />
      )}
      <div
        className="flex items-center gap-0.5"
        style={{
          // @ts-expect-error - WebKit-specific property
          WebkitAppRegion: "no-drag",
        }}
      >
        <TopBarToggle
          onClick={() => setSidebarOpen((v) => !v)}
          title={sidebarOpen ? "Hide projects sidebar" : "Show projects sidebar"}
        >
          <PanelLeft className="h-4 w-4" />
        </TopBarToggle>
        <TopBarToggle
          onClick={() => setTreeOpen((v) => !v)}
          title={treeOpen ? "Hide file explorer" : "Show file explorer"}
        >
          <FolderTree className="h-4 w-4" />
        </TopBarToggle>
      </div>
    </div>
  )
}

function TopBarToggle({
  onClick,
  title,
  children,
}: {
  onClick: () => void
  title: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={cn(
        "press flex items-center justify-center h-7 w-7 rounded-md",
        "text-muted-foreground hover:text-foreground hover:bg-foreground/10",
        "transition-[color,background-color] duration-150 [transition-timing-function:var(--ease-natural)]",
      )}
    >
      {children}
    </button>
  )
}
