export type StreamSource = "EventSource" | "fetch"

export interface StreamOpenMessage {
  kind: "stream-open"
  streamId: string
  url: string
  source: StreamSource
  method: string
  withCredentials?: boolean
  ts: number
  // Only populated for fetch-based streams. EventSource doesn't expose these.
  requestHeaders?: Record<string, string>
  requestBody?: string
  requestBodyOmittedReason?: string
  responseStatus?: number
  responseStatusText?: string
  responseHeaders?: Record<string, string>
}

export interface StreamEventMessage {
  kind: "stream-event"
  streamId: string
  eventId: number
  type: string
  data: string
  lastEventId: string
  ts: number
}

export interface StreamCloseMessage {
  kind: "stream-close"
  streamId: string
  reason: "done" | "error" | "closed-by-client"
  error?: string
  ts: number
}

export type CaptureMessage =
  | StreamOpenMessage
  | StreamEventMessage
  | StreamCloseMessage

export interface PanelBacklog {
  kind: "backlog"
  messages: CaptureMessage[]
}

export interface PanelClear {
  kind: "clear"
}

export interface PanelDeleteStream {
  kind: "delete-stream"
  streamId: string
}

export type PanelOutbound = PanelClear | PanelDeleteStream
export type PanelInbound = PanelBacklog | CaptureMessage

export const BRIDGE_SOURCE = "sse-viewer"
export const PANEL_PORT_PREFIX = "sse-panel:"
export const MAX_BUFFER = 5000
