import {
  PANEL_PORT_PREFIX,
  type PanelInbound,
  type PanelOutbound,
} from "@/lib/types"

export function connectToBackground(tabId: number): chrome.runtime.Port {
  return chrome.runtime.connect({ name: `${PANEL_PORT_PREFIX}${tabId}` })
}

export function sendToBackground(port: chrome.runtime.Port, msg: PanelOutbound) {
  try {
    port.postMessage(msg)
  } catch {
    // port closed; caller should reconnect
  }
}

export type { PanelInbound }
