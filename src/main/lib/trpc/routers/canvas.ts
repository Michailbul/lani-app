import { z } from "zod"
import {
  connectCanvasNodes,
  createCanvasNode,
  deleteCanvasNode,
  disconnectCanvasEdge,
  ensureCanvasDocument,
  generateCanvasImage,
  importCanvasImage,
  readCanvasDocument,
  updateCanvasNode,
  type CanvasNodeType,
} from "../../canvas/service"
import { publicProcedure, router } from "../index"

const canvasNodeTypeSchema = z.enum(["prompt", "image", "imageGeneration"])

const jsonObjectSchema = z.record(z.unknown())
const worktreeScopeShape = {
  worktreeId: z.string().optional(),
  chatId: z.string().optional(),
}

const worktreeScopeSchema = z.object(worktreeScopeShape).refine((input) => Boolean(input.worktreeId || input.chatId), {
  message: "worktreeId is required.",
})

function scopedObject<T extends z.ZodRawShape>(shape: T) {
  return z.object({ ...worktreeScopeShape, ...shape }).refine((input) => Boolean(input.worktreeId || input.chatId), {
    message: "worktreeId is required.",
  })
}

function getWorktreeId(input: { worktreeId?: string; chatId?: string }): string {
  return input.worktreeId ?? input.chatId!
}

export const canvasRouter = router({
  read: publicProcedure
    .input(worktreeScopeSchema)
    .query(({ input }) => {
      return readCanvasDocument(getWorktreeId(input))
    }),

  ensure: publicProcedure
    .input(worktreeScopeSchema)
    .mutation(({ input }) => {
      return ensureCanvasDocument(getWorktreeId(input))
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
      }),
    )
    .mutation(({ input }) => {
      return createCanvasNode(getWorktreeId(input), {
        type: input.type as CanvasNodeType,
        x: input.x,
        y: input.y,
        width: input.width,
        height: input.height,
        data: input.data,
        locked: input.locked,
      })
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

  disconnect: publicProcedure
    .input(scopedObject({ edgeId: z.string() }))
    .mutation(({ input }) => {
      return disconnectCanvasEdge(getWorktreeId(input), input.edgeId)
    }),

  importImage: publicProcedure
    .input(
      scopedObject({
        sourcePath: z.string(),
        x: z.number().int().optional(),
        y: z.number().int().optional(),
        label: z.string().optional(),
        createNode: z.boolean().optional(),
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
