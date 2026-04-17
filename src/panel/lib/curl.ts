import type { StreamSummary } from "@/panel/hooks/useCapturedEvents"

// Single-quote wrap + escape embedded single quotes as '\''
function shq(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'"
}

// Headers that would break a paste-to-terminal rerun or leak cookies.
const SKIP_HEADERS = new Set([
  "host",
  "cookie",
  "content-length",
  // HTTP/2 pseudo headers (lowercased)
  ":authority",
  ":method",
  ":path",
  ":scheme",
])

export function buildCurl(stream: StreamSummary): string {
  const parts: string[] = ["curl"]
  const method = (stream.method || "GET").toUpperCase()
  if (method !== "GET") parts.push("-X", method)
  parts.push(shq(stream.url))

  const headers = stream.requestHeaders ?? {}
  for (const [k, v] of Object.entries(headers)) {
    const key = k.toLowerCase()
    if (SKIP_HEADERS.has(key) || key.startsWith(":")) continue
    parts.push("-H", shq(`${k}: ${v}`))
  }

  if (stream.requestBody !== undefined && stream.requestBody.length > 0) {
    parts.push("--data-raw", shq(stream.requestBody))
  }

  return parts.join(" ")
}
