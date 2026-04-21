import {
  type CaptureMessage,
  MAX_BUFFER,
  PANEL_PORT_PREFIX,
  type PanelBacklog,
  type PanelOutbound,
} from "@/lib/types"

const buffers = new Map<number, CaptureMessage[]>()
const panelPorts = new Map<number, Set<chrome.runtime.Port>>()

// Back-fill content scripts into tabs that were already open when the
// extension was installed or updated. Without this, users must reload
// each tab to get capture working.
async function injectIntoAllOpenTabs() {
  const manifest = chrome.runtime.getManifest()
  const entries = (manifest.content_scripts ?? []) as Array<{
    world?: string
    js?: string[]
  }>
  const mainFiles = entries.find((e) => e.world === "MAIN")?.js ?? []
  const isolatedFiles =
    entries.find((e) => e.world !== "MAIN")?.js ?? []

  const tabs = await chrome.tabs.query({})
  await Promise.all(
    tabs.map(async (tab) => {
      if (!tab.id || !tab.url) return
      if (!/^(https?|file):/.test(tab.url)) return
      try {
        if (isolatedFiles.length > 0) {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id, allFrames: true },
            files: isolatedFiles,
            world: "ISOLATED",
            injectImmediately: true,
          })
        }
        if (mainFiles.length > 0) {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id, allFrames: true },
            files: mainFiles,
            world: "MAIN",
            injectImmediately: true,
          })
        }
      } catch {
        // Tab may be unreachable (chrome:// pages, discarded tabs, etc.)
      }
    })
  )
}

chrome.runtime.onInstalled.addListener(() => {
  void injectIntoAllOpenTabs()
})
chrome.runtime.onStartup.addListener(() => {
  void injectIntoAllOpenTabs()
})

function pushToBuffer(tabId: number, msg: CaptureMessage) {
  let buf = buffers.get(tabId)
  if (!buf) {
    buf = []
    buffers.set(tabId, buf)
  }
  buf.push(msg)
  if (buf.length > MAX_BUFFER) {
    buf.splice(0, buf.length - MAX_BUFFER)
  }
}

function fanOut(tabId: number, msg: CaptureMessage) {
  const ports = panelPorts.get(tabId)
  if (!ports) return
  for (const port of ports) {
    try {
      port.postMessage(msg)
    } catch {
      ports.delete(port)
    }
  }
}

function clearBuffer(tabId: number) {
  buffers.delete(tabId)
}

function sendBacklog(port: chrome.runtime.Port, tabId: number) {
  const backlog: PanelBacklog = {
    kind: "backlog",
    messages: buffers.get(tabId) ?? [],
  }
  try {
    port.postMessage(backlog)
  } catch {
    // port may already be gone
  }
}

chrome.runtime.onMessage.addListener((message, sender) => {
  const tabId = sender.tab?.id
  if (typeof tabId !== "number") return
  const msg = message as CaptureMessage
  if (!msg || typeof msg !== "object" || typeof msg.kind !== "string") return
  pushToBuffer(tabId, msg)
  fanOut(tabId, msg)
})

chrome.runtime.onConnect.addListener((port) => {
  if (!port.name.startsWith(PANEL_PORT_PREFIX)) return
  const tabId = Number(port.name.slice(PANEL_PORT_PREFIX.length))
  if (!Number.isFinite(tabId)) return

  let ports = panelPorts.get(tabId)
  if (!ports) {
    ports = new Set()
    panelPorts.set(tabId, ports)
  }
  ports.add(port)

  port.onMessage.addListener((outbound: PanelOutbound) => {
    if (!outbound || typeof outbound !== "object") return
    if (outbound.kind === "panel-ready") {
      sendBacklog(port, tabId)
    } else if (outbound.kind === "clear") {
      clearBuffer(tabId)
    } else if (outbound.kind === "delete-stream") {
      const buf = buffers.get(tabId)
      if (buf) {
        const next = buf.filter(
          (m) =>
            !(
              "streamId" in m &&
              (m as { streamId?: string }).streamId === outbound.streamId
            )
        )
        buffers.set(tabId, next)
      }
    }
  })

  port.onDisconnect.addListener(() => {
    const set = panelPorts.get(tabId)
    if (!set) return
    set.delete(port)
    if (set.size === 0) panelPorts.delete(tabId)
  })
})

chrome.tabs.onRemoved.addListener((tabId) => {
  clearBuffer(tabId)
  panelPorts.delete(tabId)
})
