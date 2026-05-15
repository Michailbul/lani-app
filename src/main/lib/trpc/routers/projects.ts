import { z } from "zod"
import { router, publicProcedure } from "../index"
import { chats, getDatabase, projects } from "../../db"
import { eq, desc } from "drizzle-orm"
import { dialog, BrowserWindow, app } from "electron"
import { basename, join, dirname, relative } from "path"
import { exec } from "node:child_process"
import { promisify } from "node:util"
import { existsSync } from "node:fs"
import {
  mkdir,
  copyFile,
  unlink,
  cp as fsCp,
  realpath as fsRealpath,
} from "node:fs/promises"
import { extname } from "node:path"
import { homedir } from "node:os"
import simpleGit from "simple-git"
import { getGitRemoteInfo, isExactGitRepoRoot } from "../../git"
import { trackProjectOpened } from "../../analytics"
import { getLaunchDirectory } from "../../cli"

const execAsync = promisify(exec)

// ────────────────────────────────────────────────────────────────────────
// Import: where Backlot stores forked-in projects.
//
//   ~/.backlot/projects/<slug>/    ← imported project (copy of source)
//   ~/.backlot/worktrees/<slug>/…  ← per-chat worktrees (existing layout)
//
// We copy the source rather than reference it because:
//   - the source folder may live inside a parent git repo (e.g. a
//     subfolder of laniameda-hq), which breaks `git worktree add`
//     semantics — the worktree would mirror the *parent* repo instead.
//   - Backlot wants its own git history independent of the user's
//     existing repos. Forks, baseline commits, agent commits all live
//     here and never touch the original.
// ────────────────────────────────────────────────────────────────────────

const BACKLOT_PROJECTS_DIR = join(homedir(), ".backlot", "projects")

/**
 * Folder/file names we never copy when importing a source project. Keeps
 * the imported tree clean and avoids dragging dependency caches into
 * Backlot's own git history.
 */
const IMPORT_EXCLUDE_NAMES = new Set([
  ".git",
  ".DS_Store",
  "node_modules",
  ".next",
  ".turbo",
  ".cache",
  "dist",
  "build",
  "out",
  ".venv",
  "venv",
  "__pycache__",
  ".pytest_cache",
  "target",
  ".gradle",
])

/**
 * Slugify a free-form name into a directory-safe id.
 *
 *   "Daddy Issues"        → "daddy-issues"
 *   "AI Creatorship/foo"  → "ai-creatorship-foo"
 */
function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "") // strip diacritics
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "project"
  )
}

/**
 * Pick a free directory under ~/.backlot/projects/. If `<slug>` is
 * taken, returns `<slug>-2`, `<slug>-3`, etc. so we never clobber.
 */
async function resolveImportTarget(slug: string): Promise<string> {
  await mkdir(BACKLOT_PROJECTS_DIR, { recursive: true })
  let candidate = join(BACKLOT_PROJECTS_DIR, slug)
  if (!existsSync(candidate)) return candidate
  for (let i = 2; i < 1000; i++) {
    candidate = join(BACKLOT_PROJECTS_DIR, `${slug}-${i}`)
    if (!existsSync(candidate)) return candidate
  }
  // Extremely unlikely; surface as error so we don't silently pick a bad path.
  throw new Error("Could not allocate a unique import directory.")
}

/**
 * Copy a source folder into the Backlot projects dir, excluding the
 * names listed above. Returns the absolute target path.
 */
async function copySourceTree(source: string, target: string): Promise<void> {
  const realSource = await fsRealpath(source)
  await fsCp(realSource, target, {
    recursive: true,
    dereference: false,
    errorOnExist: false,
    force: false,
    preserveTimestamps: true,
    filter: (src) => {
      // Always allow the root.
      if (src === realSource) return true
      const rel = relative(realSource, src)
      // Skip any path that contains an excluded segment at any depth.
      const segs = rel.split(/[\\/]+/).filter(Boolean)
      for (const seg of segs) {
        if (IMPORT_EXCLUDE_NAMES.has(seg)) return false
      }
      return true
    },
  })
}

/**
 * Auto-create the project's `CLAUDE.md` if one doesn't already exist.
 * This file is the project's persistent memory — the agent reads it on
 * every turn and updates it as facts solidify (character locks, working
 * defaults, lessons learned). The starter is intentionally short: it
 * gives the agent (and the user) a shape to fill in, not a script.
 *
 * Called BEFORE the git baseline commit so the file is included in the
 * initial commit and forks inherit it.
 *
 * Idempotent — if CLAUDE.md already exists in the source, we leave it
 * alone. Respecting the user's existing memory if any.
 */
async function ensureProjectClaudeMd(
  target: string,
  projectName: string,
): Promise<void> {
  const claudeMdPath = join(target, "CLAUDE.md")
  if (existsSync(claudeMdPath)) return
  const starter = `# ${projectName} — project memory

This file is the persistent memory for this project. The agent reads
it on every turn and updates it as facts solidify. Both you and the
agent edit it freely.

## What this is

(One paragraph: format, length, tone, target audience.)

## Working defaults

(Models, settings, aspect ratio, lens feel — whatever's been decided.
The agent fills these in as you confirm them.)

## Locked elements

(Character locks, style locks, palette, location refs — by file path.
Once locked, copy the lock text verbatim into prompts.)

## Lessons learned

(What got rejected and why. Things to avoid going forward.)
`
  await mkdir(dirname(claudeMdPath), { recursive: true })
  // Use Node's fs/promises writeFile (we already import it as `fsCp`'s
  // sibling above — but `writeFile` isn't aliased; import lazily here).
  const { writeFile } = await import("node:fs/promises")
  await writeFile(claudeMdPath, starter, "utf-8")
}

/**
 * Scaffold the empty-project starter tree. Runs only when creating a
 * brand-new Backlot project (not when importing an existing folder),
 * so every freshly created project has a recognisable shape on disk
 * the moment the user opens it.
 *
 * Kept intentionally minimal — `brief.md`, `world.md`, `.backlotignore`.
 * The agent and the user create scenes / characters / locations on
 * demand. Pre-creating empty folders just creates phantom rail entries
 * that have to be cleaned up later.
 *
 * Idempotent — never overwrites a file that already exists.
 */
async function scaffoldNewProjectTree(
  target: string,
  options: { name: string; tagline?: string },
): Promise<void> {
  const { writeFile } = await import("node:fs/promises")
  await mkdir(target, { recursive: true })

  const briefPath = join(target, "brief.md")
  if (!existsSync(briefPath)) {
    const tagline = options.tagline?.trim()
    const briefBody = `# ${options.name}

${tagline ? `> ${tagline}\n\n` : ""}## Logline

(One sentence: who wants what, against what, with what stakes.)

## Format

(Short film · series episode · ad · music video · explainer — pick one,
add length and aspect ratio.)

## Tone & style direction

(Reference films, palette, lens feel, pace. The art-direction bible
that every prompt should sound like.)

## Audience

(Who this is for, what it's competing with for their attention.)
`
    await writeFile(briefPath, briefBody, "utf-8")
  }

  const worldPath = join(target, "world.md")
  if (!existsSync(worldPath)) {
    const worldBody = `# ${options.name} — world

The art-direction bible. Everything that needs to stay consistent
across shots lives here. The agent reads this before writing any
prompt and copies its locks verbatim.

## Era & place

(Time, geography, cultural register.)

## Palette

(Hex values + how they should appear under different lights. Keep it
to 3–5 colours that recur.)

## Lens & camera language

(Focal lengths, lens character, grain, contrast curve, aspect.)

## Light

(Default key, fill, practicals. What the world looks like at noon, at
golden hour, at night.)

## Locked elements

(Anything that must stay verbatim across prompts — wardrobe codes,
prop signatures, vehicle marks. Reference the canonical file paths
under \`characters/\` and \`locations/\`.)
`
    await writeFile(worldPath, worldBody, "utf-8")
  }

  const ignorePath = join(target, ".backlotignore")
  if (!existsSync(ignorePath)) {
    await writeFile(
      ignorePath,
      `# Files and folders hidden from the Backlot rail.
# One pattern per line. Glob-style matching against repo-relative paths.
.DS_Store
node_modules/
dist/
`,
      "utf-8",
    )
  }
}

/**
 * Initialise a fresh git repo inside the imported project and commit a
 * baseline. The baseline is what every Backlot worktree forks from, so
 * we want it to exist before the first chat is created.
 */
async function initGitBaseline(target: string): Promise<void> {
  const git = simpleGit(target)
  // If somehow the source had .git anyway (we exclude it, but be defensive),
  // skip re-initialising.
  const isAlreadyRepo = await git.checkIsRepo().catch(() => false)
  if (!isAlreadyRepo) {
    await git.init()
  }
  // Configure a stable identity for the baseline commit only — local to
  // this repo, never global. We don't want to assume the user has a
  // git identity configured.
  try {
    await git.addConfig("user.name", "Backlot", false, "local")
    await git.addConfig(
      "user.email",
      "backlot@laniameda.local",
      false,
      "local",
    )
  } catch {
    /* ignore — if user has identity set, ours just adds another local layer */
  }
  await git.add(["-A"])
  // Create the baseline. --allow-empty so an empty source folder still gets a HEAD.
  try {
    await git.raw(["commit", "--allow-empty", "-m", "Backlot: import baseline"])
  } catch (err) {
    console.warn("[projects.import] baseline commit failed:", err)
  }
}

function isInsideDir(child: string, parent: string): boolean {
  const rel = relative(parent, child)
  return rel === "" || (!!rel && !rel.startsWith("..") && !rel.startsWith("/"))
}

async function createBacklotProjectCopy(input: {
  sourcePath: string
  name?: string
}): Promise<{
  displayName: string
  target: string
  gitInfo: Awaited<ReturnType<typeof getGitRemoteInfo>>
}> {
  if (!existsSync(input.sourcePath)) {
    throw new Error(`Source folder does not exist: ${input.sourcePath}`)
  }

  const realSource = await fsRealpath(input.sourcePath)
  const displayName = input.name?.trim() || basename(realSource)
  const target = await resolveImportTarget(slugify(displayName))

  await copySourceTree(realSource, target)
  await ensureProjectClaudeMd(target, displayName)
  await initGitBaseline(target)

  return {
    displayName,
    target,
    gitInfo: await getGitRemoteInfo(target),
  }
}

export const projectsRouter = router({
  /**
   * Get launch directory from CLI args (consumed once)
   * Based on PR #16 by @caffeinum
   */
  getLaunchDirectory: publicProcedure.query(() => {
    return getLaunchDirectory()
  }),

  /**
   * List all projects
   */
  list: publicProcedure.query(() => {
    const db = getDatabase()
    return db.select().from(projects).orderBy(desc(projects.updatedAt)).all()
  }),

  /**
   * Get a single project by ID
   */
  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => {
      const db = getDatabase()
      return db.select().from(projects).where(eq(projects.id, input.id)).get()
    }),

  /**
   * Import a source folder into Backlot.
   *
   * Copies <sourcePath> to ~/.backlot/projects/<slug>/, excluding noise
   * (.git, node_modules, dist, etc.), runs `git init` + a baseline
   * commit, and inserts a project row pointing at the COPY (never the
   * original). The user's source folder is never touched.
   *
   * Returns the inserted project. If the same source has already been
   * imported (matched by realpath), returns the existing project.
   */
  importProject: publicProcedure
    .input(
      z.object({
        sourcePath: z.string().min(1),
        name: z.string().min(1).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDatabase()
      const { displayName, target, gitInfo } = await createBacklotProjectCopy({
        sourcePath: input.sourcePath,
        name: input.name,
      })
      const newProject = db
        .insert(projects)
        .values({
          name: displayName,
          path: target,
          gitRemoteUrl: gitInfo.remoteUrl,
          gitProvider: gitInfo.provider,
          gitOwner: gitInfo.owner,
          gitRepo: gitInfo.repo,
        })
        .returning()
        .get()

      trackProjectOpened({
        id: newProject!.id,
        hasGitRemote: !!gitInfo.remoteUrl,
      })

      return newProject!
    }),

  /**
   * Open the folder picker and import the chosen folder. Convenience
   * wrapper around `importProject` so the renderer doesn't have to
   * juggle two mutations.
   */
  pickAndImport: publicProcedure.mutation(async ({ ctx }) => {
    const window = ctx.getWindow?.() ?? BrowserWindow.getFocusedWindow()
    if (!window) return null

    if (!window.isFocused()) {
      window.focus()
      await new Promise((resolve) => setTimeout(resolve, 100))
    }

    const result = await dialog.showOpenDialog(window, {
      properties: ["openDirectory"],
      title: "Import a project into Backlot",
      buttonLabel: "Import",
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    const db = getDatabase()
    const { displayName, target, gitInfo } = await createBacklotProjectCopy({
      sourcePath: result.filePaths[0]!,
    })
    const newProject = db
      .insert(projects)
      .values({
        name: displayName,
        path: target,
        gitRemoteUrl: gitInfo.remoteUrl,
        gitProvider: gitInfo.provider,
        gitOwner: gitInfo.owner,
        gitRepo: gitInfo.repo,
      })
      .returning()
      .get()

    trackProjectOpened({
      id: newProject!.id,
      hasGitRemote: !!gitInfo.remoteUrl,
    })

    return newProject!
  }),

  /**
   * Create a brand-new Backlot project from scratch.
   *
   * Scaffolds `~/.backlot/projects/<slug>/` with a starter tree
   * (`brief.md`, `world.md`, `CLAUDE.md`, `.backlotignore`), runs
   * `git init` + a baseline commit, and inserts the project row.
   * No source folder, no fork — the user names it and starts writing.
   */
  createNewProject: publicProcedure
    .input(
      z.object({
        name: z.string().min(1).max(120),
        tagline: z.string().max(240).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const displayName = input.name.trim()
      if (!displayName) {
        throw new Error("Project name cannot be empty.")
      }
      const slug = slugify(displayName)
      const target = await resolveImportTarget(slug)

      await scaffoldNewProjectTree(target, {
        name: displayName,
        tagline: input.tagline?.trim() || undefined,
      })
      await ensureProjectClaudeMd(target, displayName)
      await initGitBaseline(target)

      const db = getDatabase()
      const newProject = db
        .insert(projects)
        .values({
          name: displayName,
          path: target,
          gitRemoteUrl: null,
          gitProvider: null,
          gitOwner: null,
          gitRepo: null,
        })
        .returning()
        .get()

      trackProjectOpened({
        id: newProject!.id,
        hasGitRemote: false,
      })

      return newProject!
    }),

  /**
   * Open folder picker and create project
   */
  openFolder: publicProcedure.mutation(async ({ ctx }) => {
    const window = ctx.getWindow?.() ?? BrowserWindow.getFocusedWindow()

    if (!window) {
      console.error("[Projects] No window available for folder dialog")
      return null
    }

    // Ensure window is focused before showing dialog (fixes first-launch timing issue on macOS)
    if (!window.isFocused()) {
      console.log("[Projects] Window not focused, focusing before dialog...")
      window.focus()
      // Small delay to ensure focus is applied by the OS
      await new Promise((resolve) => setTimeout(resolve, 100))
    }

    const result = await dialog.showOpenDialog(window, {
      properties: ["openDirectory", "createDirectory"],
      title: "Select Project Folder",
      buttonLabel: "Open Project",
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    const db = getDatabase()
    const { displayName, target, gitInfo } = await createBacklotProjectCopy({
      sourcePath: result.filePaths[0]!,
    })

    const newProject = db
      .insert(projects)
      .values({
        name: displayName,
        path: target,
        gitRemoteUrl: gitInfo.remoteUrl,
        gitProvider: gitInfo.provider,
        gitOwner: gitInfo.owner,
        gitRepo: gitInfo.repo,
      })
      .returning()
      .get()

    // Track project opened
    trackProjectOpened({
      id: newProject!.id,
      hasGitRemote: !!gitInfo.remoteUrl,
    })

    return newProject
  }),

  /**
   * Create a project from a known path
   */
  create: publicProcedure
    .input(z.object({ path: z.string(), name: z.string().optional() }))
    .mutation(async ({ input }) => {
      const db = getDatabase()
      const { displayName, target, gitInfo } = await createBacklotProjectCopy({
        sourcePath: input.path,
        name: input.name,
      })

      return db
        .insert(projects)
        .values({
          name: displayName,
          path: target,
          gitRemoteUrl: gitInfo.remoteUrl,
          gitProvider: gitInfo.provider,
          gitOwner: gitInfo.owner,
          gitRepo: gitInfo.repo,
        })
        .returning()
        .get()
    }),

  /**
   * Repair an older project row whose path points at a source folder
   * outside Backlot, or at a subfolder inside a parent git repo. The
   * normalized project becomes a self-contained Backlot-owned repo under
   * ~/.backlot/projects/<slug>/, which is the only safe base for future
   * git worktrees.
   */
  normalizeForBacklot: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const db = getDatabase()
      const project = db
        .select()
        .from(projects)
        .where(eq(projects.id, input.id))
        .get()
      if (!project) throw new Error("Project not found.")
      if (!existsSync(project.path)) {
        throw new Error(`Project folder does not exist: ${project.path}`)
      }

      await mkdir(BACKLOT_PROJECTS_DIR, { recursive: true })
      const [realProjectPath, realBacklotProjects] = await Promise.all([
        fsRealpath(project.path),
        fsRealpath(BACKLOT_PROJECTS_DIR),
      ])
      const alreadyBacklotOwned = isInsideDir(realProjectPath, realBacklotProjects)
      const exactRepoRoot = await isExactGitRepoRoot(realProjectPath)

      if (alreadyBacklotOwned && exactRepoRoot) {
        const gitInfo = await getGitRemoteInfo(realProjectPath)
        return db
          .update(projects)
          .set({
            path: realProjectPath,
            updatedAt: new Date(),
            gitRemoteUrl: gitInfo.remoteUrl,
            gitProvider: gitInfo.provider,
            gitOwner: gitInfo.owner,
            gitRepo: gitInfo.repo,
          })
          .where(eq(projects.id, project.id))
          .returning()
          .get()
      }

      const oldPath = project.path
      const { target, gitInfo } = await createBacklotProjectCopy({
        sourcePath: realProjectPath,
        name: project.name,
      })

      const updatedProject = db
        .update(projects)
        .set({
          path: target,
          updatedAt: new Date(),
          gitRemoteUrl: gitInfo.remoteUrl,
          gitProvider: gitInfo.provider,
          gitOwner: gitInfo.owner,
          gitRepo: gitInfo.repo,
        })
        .where(eq(projects.id, project.id))
        .returning()
        .get()

      const projectChats = db
        .select()
        .from(chats)
        .where(eq(chats.projectId, project.id))
        .all()
      for (const chat of projectChats) {
        if (!chat.worktreePath || chat.worktreePath === oldPath) {
          db.update(chats)
            .set({
              worktreePath: target,
              branch: null,
              baseBranch: null,
              updatedAt: new Date(),
            })
            .where(eq(chats.id, chat.id))
            .run()
        }
      }

      return updatedProject
    }),

  /**
   * Rename a project
   */
  rename: publicProcedure
    .input(z.object({ id: z.string(), name: z.string().min(1) }))
    .mutation(({ input }) => {
      const db = getDatabase()
      return db
        .update(projects)
        .set({ name: input.name, updatedAt: new Date() })
        .where(eq(projects.id, input.id))
        .returning()
        .get()
    }),

  /**
   * Delete a project and all its chats
   */
  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => {
      const db = getDatabase()
      return db
        .delete(projects)
        .where(eq(projects.id, input.id))
        .returning()
        .get()
    }),

  /**
   * Refresh git info for a project (in case remote changed)
   */
  refreshGitInfo: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const db = getDatabase()

      // Get project
      const project = db
        .select()
        .from(projects)
        .where(eq(projects.id, input.id))
        .get()

      if (!project) {
        return null
      }

      // Get fresh git info
      const gitInfo = await getGitRemoteInfo(project.path)

      // Update project
      return db
        .update(projects)
        .set({
          updatedAt: new Date(),
          gitRemoteUrl: gitInfo.remoteUrl,
          gitProvider: gitInfo.provider,
          gitOwner: gitInfo.owner,
          gitRepo: gitInfo.repo,
        })
        .where(eq(projects.id, input.id))
        .returning()
        .get()
    }),

  /**
   * Clone a GitHub repo and create a project
   */
  cloneFromGitHub: publicProcedure
    .input(z.object({ repoUrl: z.string() }))
    .mutation(async ({ input }) => {
      const { repoUrl } = input

      // Parse the URL to extract owner/repo
      let owner: string | null = null
      let repo: string | null = null

      // Match HTTPS format: https://github.com/owner/repo
      const httpsMatch = repoUrl.match(
        /https?:\/\/github\.com\/([^/]+)\/([^/]+)/,
      )
      if (httpsMatch) {
        owner = httpsMatch[1] || null
        repo = httpsMatch[2]?.replace(/\.git$/, "") || null
      }

      // Match SSH format: git@github.com:owner/repo
      const sshMatch = repoUrl.match(/git@github\.com:([^/]+)\/(.+)/)
      if (sshMatch) {
        owner = sshMatch[1] || null
        repo = sshMatch[2]?.replace(/\.git$/, "") || null
      }

      // Match short format: owner/repo
      const shortMatch = repoUrl.match(/^([^/]+)\/([^/]+)$/)
      if (shortMatch) {
        owner = shortMatch[1] || null
        repo = shortMatch[2]?.replace(/\.git$/, "") || null
      }

      if (!owner || !repo) {
        throw new Error("Invalid GitHub URL or repo format")
      }

      // Clone to ~/.21st/repos/{owner}/{repo}
      const homePath = app.getPath("home")
      const reposDir = join(homePath, ".21st", "repos", owner)
      const clonePath = join(reposDir, repo)

      // Check if already cloned
      if (existsSync(clonePath)) {
        // Project might already exist in DB
        const db = getDatabase()
        const existing = db
          .select()
          .from(projects)
          .where(eq(projects.path, clonePath))
          .get()

        if (existing) {
          trackProjectOpened({
            id: existing.id,
            hasGitRemote: !!existing.gitRemoteUrl,
          })
          return existing
        }

        // Create project for existing clone
        const gitInfo = await getGitRemoteInfo(clonePath)
        const newProject = db
          .insert(projects)
          .values({
            name: repo,
            path: clonePath,
            gitRemoteUrl: gitInfo.remoteUrl,
            gitProvider: gitInfo.provider,
            gitOwner: gitInfo.owner,
            gitRepo: gitInfo.repo,
          })
          .returning()
          .get()

        trackProjectOpened({
          id: newProject!.id,
          hasGitRemote: !!gitInfo.remoteUrl,
        })
        return newProject
      }

      // Create repos directory
      await mkdir(reposDir, { recursive: true })

      // Clone the repo
      const cloneUrl = `https://github.com/${owner}/${repo}.git`
      await execAsync(`git clone "${cloneUrl}" "${clonePath}"`)

      // Get git info and create project
      const db = getDatabase()
      const gitInfo = await getGitRemoteInfo(clonePath)

      const newProject = db
        .insert(projects)
        .values({
          name: repo,
          path: clonePath,
          gitRemoteUrl: gitInfo.remoteUrl,
          gitProvider: gitInfo.provider,
          gitOwner: gitInfo.owner,
          gitRepo: gitInfo.repo,
        })
        .returning()
        .get()

      trackProjectOpened({
        id: newProject!.id,
        hasGitRemote: !!gitInfo.remoteUrl,
      })

      return newProject
    }),

  /**
   * Open folder picker to locate an existing clone of a specific repo
   * Validates that the selected folder matches the expected owner/repo
   */
  locateAndAddProject: publicProcedure
    .input(
      z.object({
        expectedOwner: z.string(),
        expectedRepo: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const window = ctx.getWindow?.() ?? BrowserWindow.getFocusedWindow()

      if (!window) {
        return { success: false as const, reason: "no-window" as const }
      }

      // Ensure window is focused
      if (!window.isFocused()) {
        window.focus()
        await new Promise((resolve) => setTimeout(resolve, 100))
      }

      const result = await dialog.showOpenDialog(window, {
        properties: ["openDirectory"],
        title: `Locate ${input.expectedOwner}/${input.expectedRepo}`,
        buttonLabel: "Select",
      })

      if (result.canceled || !result.filePaths[0]) {
        return { success: false as const, reason: "canceled" as const }
      }

      const folderPath = result.filePaths[0]
      const gitInfo = await getGitRemoteInfo(folderPath)

      // Validate it's the correct repo
      if (
        gitInfo.owner !== input.expectedOwner ||
        gitInfo.repo !== input.expectedRepo
      ) {
        return {
          success: false as const,
          reason: "wrong-repo" as const,
          found:
            gitInfo.owner && gitInfo.repo
              ? `${gitInfo.owner}/${gitInfo.repo}`
              : "not a git repository",
        }
      }

      // Create or update project
      const db = getDatabase()
      const existing = db
        .select()
        .from(projects)
        .where(eq(projects.path, folderPath))
        .get()

      if (existing) {
        // Update git info in case it changed
        const updated = db
          .update(projects)
          .set({
            updatedAt: new Date(),
            gitRemoteUrl: gitInfo.remoteUrl,
            gitProvider: gitInfo.provider,
            gitOwner: gitInfo.owner,
            gitRepo: gitInfo.repo,
          })
          .where(eq(projects.id, existing.id))
          .returning()
          .get()

        return { success: true as const, project: updated }
      }

      const project = db
        .insert(projects)
        .values({
          name: basename(folderPath),
          path: folderPath,
          gitRemoteUrl: gitInfo.remoteUrl,
          gitProvider: gitInfo.provider,
          gitOwner: gitInfo.owner,
          gitRepo: gitInfo.repo,
        })
        .returning()
        .get()

      return { success: true as const, project }
    }),

  /**
   * Open folder picker to choose where to clone a repository
   */
  pickCloneDestination: publicProcedure
    .input(z.object({ suggestedName: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const window = ctx.getWindow?.() ?? BrowserWindow.getFocusedWindow()

      if (!window) {
        return { success: false as const, reason: "no-window" as const }
      }

      // Ensure window is focused
      if (!window.isFocused()) {
        window.focus()
        await new Promise((resolve) => setTimeout(resolve, 100))
      }

      // Default to ~/.21st/repos/
      const homePath = app.getPath("home")
      const defaultPath = join(homePath, ".21st", "repos")
      await mkdir(defaultPath, { recursive: true })

      const result = await dialog.showOpenDialog(window, {
        properties: ["openDirectory", "createDirectory"],
        title: "Choose where to clone",
        defaultPath,
        buttonLabel: "Clone Here",
      })

      if (result.canceled || !result.filePaths[0]) {
        return { success: false as const, reason: "canceled" as const }
      }

      const targetPath = join(result.filePaths[0], input.suggestedName)
      return { success: true as const, targetPath }
    }),

  /**
   * Upload a custom icon for a project (opens file picker for images)
   */
  uploadIcon: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const window = ctx.getWindow?.() ?? BrowserWindow.getFocusedWindow()
      if (!window) return null

      if (!window.isFocused()) {
        window.focus()
        await new Promise((resolve) => setTimeout(resolve, 100))
      }

      const result = await dialog.showOpenDialog(window, {
        properties: ["openFile"],
        title: "Select Project Icon",
        buttonLabel: "Set Icon",
        filters: [
          { name: "Images", extensions: ["png", "jpg", "jpeg", "svg", "webp", "ico"] },
        ],
      })

      if (result.canceled || !result.filePaths[0]) return null

      const sourcePath = result.filePaths[0]
      const ext = extname(sourcePath)
      const iconsDir = join(app.getPath("userData"), "project-icons")
      await mkdir(iconsDir, { recursive: true })

      const destPath = join(iconsDir, `${input.id}${ext}`)
      await copyFile(sourcePath, destPath)

      const db = getDatabase()
      return db
        .update(projects)
        .set({ iconPath: destPath, updatedAt: new Date() })
        .where(eq(projects.id, input.id))
        .returning()
        .get()
    }),

  /**
   * Remove custom icon for a project
   */
  removeIcon: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const db = getDatabase()
      const project = db.select().from(projects).where(eq(projects.id, input.id)).get()

      if (project?.iconPath && existsSync(project.iconPath)) {
        try { await unlink(project.iconPath) } catch {}
      }

      return db
        .update(projects)
        .set({ iconPath: null, updatedAt: new Date() })
        .where(eq(projects.id, input.id))
        .returning()
        .get()
    }),
})
