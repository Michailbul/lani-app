import { BrowserWindow, dialog } from "electron"
import { z } from "zod"
import {
  applyCanvasSnapshot,
  connectCanvasNodes,
  createCanvasNode,
  createCanvasPage,
  deleteCanvasNode,
  deleteCanvasPage,
  disconnectCanvasEdge,
  ensureCanvasDocument,
  generateCanvasImage,
  groupCanvasNodes,
  importCanvasImage,
  listCanvasPages,
  readCanvasDocument,
  renameCanvasPage,
  replaceImageOnNode,
  saveStitchedImage,
  updateCanvasNode,
  type CanvasNodeType,
} from "../../canvas/service"
import { publicProcedure, router } from "../index"

const CANVAS_IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif"]

const canvasNodeTypeSchema = z.enum([
  "prompt",
  "image",
  "imageGeneration",
  "textBlock",
  "description",
  "group",
])

const jsonObjectSchema = z.record(z.string(), z.unknown())
const worktreeScopeShape = {
  worktreeId: z.string().optional(),
  chatId: z.string().optional(),
}

const worktreeScopeSchema = z.object(worktreeScopeShape).refine((input) => Boolean(input.worktreeId || input.chatId), {
  message: "worktreeId is required.",
})

function scopedObject<T extends z.ZodRawShape>(shape: T) {
  return z.object({ ...worktreeScopeShape, ...shape }).refine(
    (input) => {
      const scope = input as { worktreeId?: string; chatId?: string }
      return Boolean(scope.worktreeId || scope.chatId)
    },
    {
      message: "worktreeId is required.",
    },
  )
}

function getWorktreeId(input: { worktreeId?: string; chatId?: string }): string {
  return input.worktreeId ?? input.chatId!
}

export const canvasRouter = router({
  listPages: publicProcedure
    .input(worktreeScopeSchema)
    .query(({ input }) => {
      return listCanvasPages(getWorktreeId(input))
    }),

  createPage: publicProcedure
    .input(scopedObject({ name: z.string().min(1) }))
    .mutation(({ input }) => {
      return createCanvasPage(getWorktreeId(input), input.name)
    }),

  deletePage: publicProcedure
    .input(scopedObject({ name: z.string().min(1) }))
    .mutation(({ input }) => {
      return deleteCanvasPage(getWorktreeId(input), input.name)
    }),

  renamePage: publicProcedure
    .input(
      scopedObject({
        name: z.string().min(1),
        newName: z.string().min(1),
      }),
    )
    .mutation(({ input }) => {
      return renameCanvasPage(getWorktreeId(input), input.name, input.newName)
    }),

  read: publicProcedure
    .input(scopedObject({ page: z.string().optional() }))
    .query(({ input }) => {
      return readCanvasDocument(getWorktreeId(input), input.page)
    }),

  ensure: publicProcedure
    .input(scopedObject({ page: z.string().optional() }))
    .mutation(({ input }) => {
      return ensureCanvasDocument(getWorktreeId(input), input.page)
    }),

  createNode: publicProcedure
    .input(
      scopedObject({
        type: canvasNodeTypeSchema,
        x: z.number().int().optional(),
        y: z.number().int().optional(),
        width: z.number().int().positive().optional(),
        height: z.number().int().positive().optional(),
        data: jsonObjectSchema.optional(),
        locked: z.boolean().optional(),
        page: z.string().optional(),
      }),
    )
    .mutation(({ input }) => {
      return createCanvasNode(
        getWorktreeId(input),
        {
          type: input.type as CanvasNodeType,
          x: input.x,
          y: input.y,
          width: input.width,
          height: input.height,
          data: input.data,
          locked: input.locked,
        },
        input.page,
      )
    }),

  updateNode: publicProcedure
    .input(
      scopedObject({
        nodeId: z.string(),
        x: z.number().int().optional(),
        y: z.number().int().optional(),
        width: z.number().int().positive().optional(),
        height: z.number().int().positive().optional(),
        data: jsonObjectSchema.optional(),
        replaceData: z.boolean().optional(),
        locked: z.boolean().optional(),
      }),
    )
    .mutation(({ input }) => {
      return updateCanvasNode(getWorktreeId(input), input.nodeId, {
        x: input.x,
        y: input.y,
        width: input.width,
        height: input.height,
        data: input.data,
        replaceData: input.replaceData,
        locked: input.locked,
      })
    }),

  deleteNode: publicProcedure
    .input(scopedObject({ nodeId: z.string() }))
    .mutation(({ input }) => {
      return deleteCanvasNode(getWorktreeId(input), input.nodeId)
    }),

  connect: publicProcedure
    .input(
      scopedObject({
        sourceNodeId: z.string(),
        sourceHandle: z.string(),
        targetNodeId: z.string(),
        targetHandle: z.string(),
      }),
    )
    .mutation(({ input }) => {
      return connectCanvasNodes(getWorktreeId(input), {
        sourceNodeId: input.sourceNodeId,
        sourceHandle: input.sourceHandle,
        targetNodeId: input.targetNodeId,
        targetHandle: input.targetHandle,
      })
    }),

  groupNodes: publicProcedure
    .input(
      scopedObject({
        groupId: z.string().optional(),
        label: z.string().optional(),
        nodeIds: z.array(z.string()).default([]),
        x: z.number().int().optional(),
        y: z.number().int().optional(),
        width: z.number().int().positive().optional(),
        height: z.number().int().positive().optional(),
        padding: z.number().int().nonnegative().optional(),
        autoResize: z.boolean().optional(),
        data: jsonObjectSchema.optional(),
        page: z.string().optional(),
      }),
    )
    .mutation(({ input }) => {
      return groupCanvasNodes(
        getWorktreeId(input),
        {
          groupId: input.groupId,
          label: input.label,
          nodeIds: input.nodeIds,
          x: input.x,
          y: input.y,
          width: input.width,
          height: input.height,
          padding: input.padding,
          autoResize: input.autoResize,
          data: input.data,
        },
        input.page,
      )
    }),

  disconnect: publicProcedure
    .input(scopedObject({ edgeId: z.string() }))
    .mutation(({ input }) => {
      return disconnectCanvasEdge(getWorktreeId(input), input.edgeId)
    }),

  /**
   * Replace the canvas graph with a snapshot. Powers Cmd+Z / Cmd+Shift+Z
   * on the canvas — the renderer keeps the stack in memory and pushes
   * the prior state here when the user undoes or redoes a step.
   */
  applySnapshot: publicProcedure
    .input(
      scopedObject({
        page: z.string().optional(),
        snapshot: z.object({
          nodes: z.array(
            z.object({
              id: z.string(),
              type: canvasNodeTypeSchema,
              x: z.number().int(),
              y: z.number().int(),
              width: z.number().int().positive(),
              height: z.number().int().positive(),
              data: jsonObjectSchema,
              locked: z.boolean(),
            }),
          ),
          edges: z.array(
            z.object({
              id: z.string(),
              sourceNodeId: z.string(),
              sourceHandle: z.string(),
              targetNodeId: z.string(),
              targetHandle: z.string(),
            }),
          ),
        }),
      }),
    )
    .mutation(({ input }) => {
      return applyCanvasSnapshot(
        getWorktreeId(input),
        {
          nodes: input.snapshot.nodes.map((node) => ({
            ...node,
            type: node.type as CanvasNodeType,
          })),
          edges: input.snapshot.edges,
        },
        input.page,
      )
    }),

  importImage: publicProcedure
    .input(
      scopedObject({
        sourcePath: z.string(),
        x: z.number().int().optional(),
        y: z.number().int().optional(),
        label: z.string().optional(),
        createNode: z.boolean().optional(),
        page: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      return await importCanvasImage({
        worktreeId: getWorktreeId(input),
        sourcePath: input.sourcePath,
        x: input.x,
        y: input.y,
        label: input.label,
        createNode: input.createNode,
        page: input.page,
      })
    }),

  /**
   * Open a native picker and drop the chosen images onto the canvas as
   * image nodes, fanned out in a row from the requested origin.
   */
  pickImages: publicProcedure
    .input(
      scopedObject({
        x: z.number().int().optional(),
        y: z.number().int().optional(),
        page: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const window =
        ctx.getWindow?.() ?? BrowserWindow.getFocusedWindow()
      if (!window) return { nodeIds: [] as string[] }
      if (!window.isFocused()) {
        window.focus()
        await new Promise((resolve) => setTimeout(resolve, 100))
      }

      const picked = await dialog.showOpenDialog(window, {
        properties: ["openFile", "multiSelections"],
        title: "Add images to canvas",
        buttonLabel: "Add images",
        filters: [{ name: "Images", extensions: CANVAS_IMAGE_EXTENSIONS }],
      })
      if (picked.canceled || picked.filePaths.length === 0) {
        return { nodeIds: [] as string[] }
      }

      const worktreeId = getWorktreeId(input)
      const baseX = input.x ?? 0
      const baseY = input.y ?? 0
      const nodeIds: string[] = []
      let column = 0
      for (const sourcePath of picked.filePaths) {
        const result = await importCanvasImage({
          worktreeId,
          sourcePath,
          x: baseX + column * 300,
          y: baseY,
          createNode: true,
          page: input.page,
        })
        if (result.node) nodeIds.push(result.node.id)
        column += 1
      }
      return { nodeIds }
    }),

  /**
   * Replace an image node's bytes with a cropped version. The renderer
   * draws the chosen crop region of the node's current image and sends
   * the PNG; this persists the new asset and points the existing node
   * at it — the node's id and position stay, its size becomes the new
   * aspect.
   */
  replaceImage: publicProcedure
    .input(
      scopedObject({
        nodeId: z.string(),
        base64Png: z.string().min(1),
        label: z.string().optional(),
        // "crop" keeps the selection; "cutout" punches it out and
        // leaves the rest of the image at its original dimensions.
        mode: z.enum(["crop", "cutout"]).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      return await replaceImageOnNode({
        worktreeId: getWorktreeId(input),
        nodeId: input.nodeId,
        base64Png: input.base64Png,
        label: input.label,
        mode: input.mode,
      })
    }),

  /**
   * Save a stitched image. The renderer composites the selected image
   * nodes into one PNG and sends the base64 bytes; this persists the
   * file and adds a plain image node holding the result.
   */
  stitch: publicProcedure
    .input(
      scopedObject({
        base64Png: z.string().min(1),
        x: z.number().int().optional(),
        y: z.number().int().optional(),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        label: z.string().optional(),
        page: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      return await saveStitchedImage({
        worktreeId: getWorktreeId(input),
        base64Png: input.base64Png,
        x: input.x,
        y: input.y,
        width: input.width,
        height: input.height,
        label: input.label,
        page: input.page,
      })
    }),

  generateImage: publicProcedure
    .input(
      scopedObject({
        nodeId: z.string(),
        model: z.string().optional(),
        size: z.string().optional(),
        quality: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      return await generateCanvasImage({
        worktreeId: getWorktreeId(input),
        nodeId: input.nodeId,
        model: input.model,
        size: input.size,
        quality: input.quality,
      })
    }),
})
