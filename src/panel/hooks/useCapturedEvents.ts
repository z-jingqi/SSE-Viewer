import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type {
  CaptureMessage,
  StreamCloseMessage,
  StreamEventMessage,
  StreamOpenMessage,
} from "@/lib/types"
import { connectToBackground, sendToBackground } from "@/panel/lib/bridge"

export interface StreamSummary {
  streamId: string
  url: string
  source: "EventSource" | "fetch"
  method: string
  openedAt: number
  closedAt?: number
  closeReason?: StreamCloseMessage["reason"]
  closeError?: string
  eventCount: number
  requestHeaders?: Record<string, string>
  requestBody?: string
  requestBodyOmittedReason?: string
  responseStatus?: number
  responseStatusText?: string
  responseHeaders?: Record<string, string>
}

export interface StreamsState {
  order: string[]
  map: Map<string, StreamSummary>
  eventsByStream: Map<string, StreamEventMessage[]>
}

function initial(): StreamsState {
  return { order: [], map: new Map(), eventsByStream: new Map() }
}

function isEmptyState(state: StreamsState): boolean {
  return state.order.length === 0 && state.map.size === 0
}

function applyMessages(prev: StreamsState, messages: CaptureMessage[]): StreamsState {
  let next = prev
  for (const msg of messages) next = applyMessage(next, msg)
  return next
}

function applyMessage(prev: StreamsState, msg: CaptureMessage): StreamsState {
  if (msg.kind === "stream-open") {
    if (prev.map.has(msg.streamId)) return prev
    const map = new Map(prev.map)
    const eventsByStream = new Map(prev.eventsByStream)
    const open = msg as StreamOpenMessage
    map.set(open.streamId, {
      streamId: open.streamId,
      url: open.url,
      source: open.source,
      method: open.method,
      openedAt: open.ts,
      eventCount: 0,
      requestHeaders: open.requestHeaders,
      requestBody: open.requestBody,
      requestBodyOmittedReason: open.requestBodyOmittedReason,
      responseStatus: open.responseStatus,
      responseStatusText: open.responseStatusText,
      responseHeaders: open.responseHeaders,
    })
    eventsByStream.set(open.streamId, [])
    return { order: [...prev.order, open.streamId], map, eventsByStream }
  }

  if (msg.kind === "stream-event") {
    const ev = msg as StreamEventMessage
    const existing = prev.map.get(ev.streamId)
    const eventsByStream = new Map(prev.eventsByStream)
    const arr = eventsByStream.get(ev.streamId) ?? []
    if (arr.some((item) => item.eventId === ev.eventId)) {
      return prev
    }
    eventsByStream.set(ev.streamId, [...arr, ev])
    const map = new Map(prev.map)
    if (existing) {
      map.set(ev.streamId, { ...existing, eventCount: existing.eventCount + 1 })
    }
    return { ...prev, map, eventsByStream }
  }

  if (msg.kind === "stream-close") {
    const close = msg as StreamCloseMessage
    const existing = prev.map.get(close.streamId)
    if (!existing) return prev
    const map = new Map(prev.map)
    map.set(close.streamId, {
      ...existing,
      closedAt: close.ts,
      closeReason: close.reason,
      closeError: close.error,
    })
    return { ...prev, map }
  }

  return prev
}

export function useCapturedEvents() {
  const [state, setState] = useState<StreamsState>(initial)
  const [paused, setPaused] = useState(false)
  const pausedRef = useRef(paused)
  pausedRef.current = paused
  const portRef = useRef<chrome.runtime.Port | null>(null)
  const reconnectTimerRef = useRef<number | null>(null)

  useEffect(() => {
    const tabId = chrome.devtools.inspectedWindow.tabId
    let disposed = false

    const clearReconnectTimer = () => {
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
    }

    const connect = () => {
      if (disposed) return

      const port = connectToBackground(tabId)
      portRef.current = port

      const onMessage = (inbound: unknown) => {
        if (!inbound || typeof inbound !== "object") return
        const kind = (inbound as { kind?: string }).kind
        if (kind === "backlog") {
          const { messages } = inbound as { messages: CaptureMessage[] }
          setState((prev) => {
            if (messages.length === 0) {
              return prev
            }
            if (isEmptyState(prev)) {
              return applyMessages(initial(), messages)
            }
            return applyMessages(prev, messages)
          })
          return
        }
        if (pausedRef.current) return
        if (
          kind === "stream-open" ||
          kind === "stream-event" ||
          kind === "stream-close"
        ) {
          setState((prev) => applyMessage(prev, inbound as CaptureMessage))
        }
      }

      const onDisconnect = () => {
        if (portRef.current === port) {
          portRef.current = null
        }
        if (disposed) return
        clearReconnectTimer()
        reconnectTimerRef.current = window.setTimeout(() => {
          reconnectTimerRef.current = null
          connect()
        }, 250)
      }

      port.onMessage.addListener(onMessage)
      port.onDisconnect.addListener(onDisconnect)
      sendToBackground(port, { kind: "panel-ready" })
    }

    connect()

    const reloadHandler = () => {
      setState(initial())
    }
    chrome.devtools.network.onNavigated.addListener(reloadHandler)

    return () => {
      disposed = true
      clearReconnectTimer()
      chrome.devtools.network.onNavigated.removeListener(reloadHandler)
      try {
        portRef.current?.disconnect()
      } catch {
        // ignore
      }
      portRef.current = null
    }
  }, [])

  const clear = useCallback(() => {
    setState(initial())
    const port = portRef.current
    if (port) sendToBackground(port, { kind: "clear" })
  }, [])

  const deleteStream = useCallback((streamId: string) => {
    setState((prev) => {
      if (!prev.map.has(streamId)) return prev
      const map = new Map(prev.map)
      map.delete(streamId)
      const eventsByStream = new Map(prev.eventsByStream)
      eventsByStream.delete(streamId)
      const order = prev.order.filter((id) => id !== streamId)
      return { order, map, eventsByStream }
    })
    const port = portRef.current
    if (port) sendToBackground(port, { kind: "delete-stream", streamId })
  }, [])

  const streams = useMemo(
    () =>
      state.order
        .map((id) => state.map.get(id)!)
        .filter(Boolean),
    [state]
  )

  return {
    streams,
    eventsByStream: state.eventsByStream,
    paused,
    setPaused,
    clear,
    deleteStream,
  }
}
