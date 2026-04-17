export function formatTime(ts: number): string {
  const d = new Date(ts)
  const hh = String(d.getHours()).padStart(2, "0")
  const mm = String(d.getMinutes()).padStart(2, "0")
  const ss = String(d.getSeconds()).padStart(2, "0")
  const ms = String(d.getMilliseconds()).padStart(3, "0")
  return `${hh}:${mm}:${ss}.${ms}`
}

export function tryParseJson(s: string): unknown | undefined {
  const trimmed = s.trim()
  if (!trimmed) return undefined
  const first = trimmed[0]
  if (first !== "{" && first !== "[" && first !== "\"" && !/^-?\d/.test(trimmed) && first !== "t" && first !== "f" && first !== "n") {
    return undefined
  }
  try {
    return JSON.parse(trimmed)
  } catch {
    return undefined
  }
}

export function shortUrl(url: string): string {
  try {
    const u = new URL(url)
    const path = u.pathname.length > 40 ? "…" + u.pathname.slice(-40) : u.pathname
    return `${u.host}${path}${u.search ? "?…" : ""}`
  } catch {
    return url.length > 60 ? url.slice(0, 60) + "…" : url
  }
}

export function previewData(data: string, max = 120): string {
  // If the payload is JSON with escaped non-ASCII (e.g. \u4f60\u597d),
  // normalize so the preview shows the actual characters.
  let source = data
  try {
    const parsed = JSON.parse(data)
    source = typeof parsed === "string" ? parsed : JSON.stringify(parsed)
  } catch {
    // not JSON; use raw
  }
  const singleLine = source.replace(/\s+/g, " ").trim()
  return singleLine.length > max ? singleLine.slice(0, max) + "…" : singleLine
}
