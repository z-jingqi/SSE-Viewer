// NOTE: kept free of runtime imports so crxjs bundles this as a single
// synchronous file. Any async dynamic-import wrapper would create a window
// where postMessages from the MAIN world are fired before our listener is
// attached, causing the first few events of fast SSE streams to be lost.
export {}

const BRIDGE_SOURCE = "sse-viewer"
const BRIDGE_FLAG = "__sseViewerBridge__"
const INJECT_FLAG = "__sseViewerInjected__"

type DocumentWithFlag = Document & Record<string, unknown>
const doc = document as DocumentWithFlag

// ────────────────────────────────────────────────────────────────────
// 1. Inject MAIN-world patch via a <script> tag.
//
// The manifest content_scripts entry with world:"MAIN" sometimes loses
// the race to page scripts on complex SPAs (ChatGPT, Claude.ai) — those
// page scripts capture window.fetch / window.EventSource references
// before our patch installs, making the patch invisible to them.
//
// Injecting a <script> element at document_start from the ISOLATED world
// executes SYNCHRONOUSLY during DOM parsing and wins the race. The MAIN-
// world patch itself has a Symbol.for() idempotency guard, so if both
// injection paths fire, only the first one actually installs.
// ────────────────────────────────────────────────────────────────────
if (!doc[INJECT_FLAG]) {
  doc[INJECT_FLAG] = true
  try {
    const manifest = chrome.runtime.getManifest()
    const entries = (manifest.content_scripts ?? []) as Array<{
      world?: string
      js?: string[]
    }>
    const resources = (manifest.web_accessible_resources ?? []) as Array<{
      resources?: string[]
    }>
    let mainWorldPath: string | undefined
    const mainEntry = entries.find((c) => c.world === "MAIN")
    if (mainEntry?.js?.length) {
      mainWorldPath = mainEntry.js[0]
    } else {
      // Fallback: search web_accessible_resources for a main-world file.
      for (const war of resources) {
        const hit = war.resources?.find(
          (r) => /main-world/.test(r) && r.endsWith(".js")
        )
        if (hit) {
          mainWorldPath = hit
          break
        }
      }
    }
    if (mainWorldPath) {
      const s = document.createElement("script")
      s.src = chrome.runtime.getURL(mainWorldPath)
      s.async = false
      const parent = document.documentElement || document.head || document.body
      if (parent) parent.prepend(s)
      s.onload = () => s.remove()
      s.onerror = () => s.remove()
    }
  } catch {
    // CSP or other error — manifest content_scripts will still try.
  }
}

// ────────────────────────────────────────────────────────────────────
// 2. Bridge postMessages from MAIN-world patch to the extension SW.
// ────────────────────────────────────────────────────────────────────
if (!doc[BRIDGE_FLAG]) {
  doc[BRIDGE_FLAG] = true
  attachBridge()
}

function attachBridge() {
  window.addEventListener("message", (event) => {
    const data = event.data
    if (!data || typeof data !== "object") return
    if ((data as { source?: unknown }).source !== BRIDGE_SOURCE) return
    const payload = (data as { payload?: unknown }).payload
    if (!payload || typeof payload !== "object") return

    try {
      const res = chrome.runtime.sendMessage(payload)
      if (res && typeof (res as Promise<unknown>).catch === "function") {
        ;(res as Promise<unknown>).catch(() => {})
      }
    } catch {
      // noop
    }
  })
}
