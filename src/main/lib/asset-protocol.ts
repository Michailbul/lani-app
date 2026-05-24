/**
 * lani-asset:// — a local streaming protocol for previewing media.
 *
 * The renderer can't load `file://` URLs (webSecurity is on), and piping
 * a 40 MB video through tRPC as base64 would buffer the whole clip in
 * memory. This privileged scheme streams a file straight off disk with
 * HTTP range support, so video scrubbing seeks instead of re-loading.
 *
 * URL shape: `lani-asset://asset/?p=<encodeURIComponent(absolutePath)>`
 */

import { createReadStream, existsSync } from "node:fs"
import { stat } from "node:fs/promises"
import { extname } from "node:path"
import { Readable } from "node:stream"
import { protocol } from "electron"

type AssetProtocolRegistry = Pick<
  typeof protocol,
  "handle" | "isProtocolHandled"
>

export const ASSET_SCHEME = "lani-asset"

const MIME_BY_EXT: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".m4v": "video/x-m4v",
  ".ogv": "video/ogg",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
}

/** Must run before the app `ready` event (module scope is fine). */
export function registerAssetScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: ASSET_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
      },
    },
  ])
  console.log("[asset-protocol] scheme registered as privileged")
}

async function handleAssetRequest(request: Request): Promise<Response> {
  try {
    const target = new URL(request.url).searchParams.get("p")
    if (!target) {
      return new Response("Missing asset path", { status: 400 })
    }
    if (!existsSync(target)) {
      console.warn("[asset-protocol] not found on disk:", target)
      return new Response("Asset not found", { status: 404 })
    }

    const { size } = await stat(target)
    const mime =
      MIME_BY_EXT[extname(target).toLowerCase()] ?? "application/octet-stream"
    const rangeHeader = request.headers.get("range")

    // Ranged request — the <video> element scrubbing. Serve the slice.
    const match = rangeHeader ? /bytes=(\d+)-(\d*)/.exec(rangeHeader) : null
    if (match) {
      const start = Number(match[1])
      const end = match[2] ? Number(match[2]) : size - 1
      if (start >= size || end >= size || start > end) {
        return new Response("Range not satisfiable", {
          status: 416,
          headers: { "Content-Range": `bytes */${size}` },
        })
      }
      const stream = createReadStream(target, { start, end })
      return new Response(Readable.toWeb(stream) as ReadableStream, {
        status: 206,
        headers: {
          "Content-Type": mime,
          "Content-Length": String(end - start + 1),
          "Content-Range": `bytes ${start}-${end}/${size}`,
          "Accept-Ranges": "bytes",
          // Lets the canvas read these pixels back via toDataURL without
          // tainting. Image nodes on the canvas are composited into stitched
          // PNGs, which a tainted canvas would forbid.
          "Access-Control-Allow-Origin": "*",
        },
      })
    }

    // Full request — image, or the initial video load.
    const stream = createReadStream(target)
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 200,
      headers: {
        "Content-Type": mime,
        "Content-Length": String(size),
        "Accept-Ranges": "bytes",
        "Access-Control-Allow-Origin": "*",
      },
    })
  } catch (err) {
    console.error("[asset-protocol] failed to serve:", err)
    return new Response("Asset error", { status: 500 })
  }
}

/** Must run after the app is ready. */
export function registerAssetProtocolHandler(
  registry: AssetProtocolRegistry = protocol,
  scope = "default",
): void {
  if (registry.isProtocolHandled(ASSET_SCHEME)) {
    console.log(
      `[asset-protocol] handler already registered for ${ASSET_SCHEME} (${scope})`,
    )
    return
  }

  console.log(
    `[asset-protocol] registering handler for ${ASSET_SCHEME} (${scope})`,
  )
  registry.handle(ASSET_SCHEME, handleAssetRequest)
}
