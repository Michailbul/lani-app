import { existsSync } from "node:fs"
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { randomUUID } from "node:crypto"
import { z } from "zod"

export const HARNESS_FOCUS_REQUEST_PATH =
  process.env.LANI_HARNESS_REQUEST_PATH ||
  join(homedir(), ".lani", "harness-open-request.json")

export const harnessFocusRequestSchema = z.object({
  id: z.string().min(1),
  createdAt: z.number(),
  reason: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
  proposedContent: z.string().nullable().optional(),
})

export type HarnessFocusRequest = z.infer<typeof harnessFocusRequestSchema>

function cleanString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

export async function writeHarnessFocusRequest(input: {
  reason?: string | null
  summary?: string | null
  proposedContent?: string | null
}): Promise<HarnessFocusRequest> {
  const request: HarnessFocusRequest = {
    id: randomUUID(),
    createdAt: Date.now(),
    reason: cleanString(input.reason),
    summary: cleanString(input.summary),
    proposedContent: cleanString(input.proposedContent),
  }

  await mkdir(dirname(HARNESS_FOCUS_REQUEST_PATH), { recursive: true })
  const tempPath = `${HARNESS_FOCUS_REQUEST_PATH}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tempPath, JSON.stringify(request, null, 2), "utf-8")
  await rename(tempPath, HARNESS_FOCUS_REQUEST_PATH)
  return request
}

export async function consumeHarnessFocusRequest(): Promise<HarnessFocusRequest | null> {
  if (!existsSync(HARNESS_FOCUS_REQUEST_PATH)) return null

  try {
    const raw = await readFile(HARNESS_FOCUS_REQUEST_PATH, "utf-8")
    await unlink(HARNESS_FOCUS_REQUEST_PATH).catch(() => {})
    const parsed = JSON.parse(raw)
    return harnessFocusRequestSchema.parse(parsed)
  } catch (error) {
    await unlink(HARNESS_FOCUS_REQUEST_PATH).catch(() => {})
    console.warn("[harness.focus] failed to consume focus request:", error)
    return null
  }
}
