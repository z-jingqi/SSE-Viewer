// NOTE: This file runs in the page's MAIN world. To avoid issues with
// dynamic imports resolving against the page origin, we intentionally
// do NOT import from other modules. Types and parser are duplicated inline.
export {}

const BRIDGE_SOURCE = "sse-viewer"
// Symbol.for uses a cross-realm global registry so the marker survives
// extension reloads and is visible regardless of which wrapper we land on.
const PATCH_MARKER = Symbol.for("sse-viewer.patched")

// Idempotency guard against:
//   - manifest content_scripts running twice per load edge cases
//   - on-install scripting.executeScript re-injection
//   - stale patches surviving an extension reload (check the marker on
//     the current EventSource ctor; if it's set, some earlier build
//     already wrapped it)
const currentES = window.EventSource as
  | (typeof EventSource & { [PATCH_MARKER]?: boolean })
  | undefined
const currentFetch = window.fetch as
  | (typeof window.fetch & { [PATCH_MARKER]?: boolean })
  | undefined
if (currentES?.[PATCH_MARKER] || currentFetch?.[PATCH_MARKER]) {
  // already installed — do nothing
} else {
  install()
}

function install() {

type StreamSource = "EventSource" | "fetch"

interface StreamOpenMessage {
  kind: "stream-open"
  streamId: string
  url: string
  source: StreamSource
  method: string
  withCredentials?: boolean
  ts: number
  requestHeaders?: Record<string, string>
  requestBody?: string
  requestBodyOmittedReason?: string
  responseStatus?: number
  responseStatusText?: string
  responseHeaders?: Record<string, string>
}

interface StreamEventMessage {
  kind: "stream-event"
  streamId: string
  eventId: number
  type: string
  data: string
  lastEventId: string
  ts: number
}

interface StreamCloseMessage {
  kind: "stream-close"
  streamId: string
  reason: "done" | "error" | "closed-by-client"
  error?: string
  ts: number
}

type CaptureMessage =
  | StreamOpenMessage
  | StreamEventMessage
  | StreamCloseMessage

interface ParsedSSEEvent {
  type: string
  data: string
  lastEventId: string
}

class SSEStreamParser {
  private buffer = ""
  private eventType = ""
  private dataLines: string[] = []
  private lastEventId = ""

  feed(chunk: string): ParsedSSEEvent[] {
    this.buffer += chunk
    const events: ParsedSSEEvent[] = []

    let idx: number
    while ((idx = this.indexOfLineEnd(this.buffer)) !== -1) {
      const line = this.buffer.slice(0, idx)
      this.buffer = this.buffer.slice(this.advanceBy(idx))

      if (line === "") {
        const ev = this.flush()
        if (ev) events.push(ev)
        continue
      }

      if (line.startsWith(":")) continue

      const colonIdx = line.indexOf(":")
      let field: string
      let value: string
      if (colonIdx === -1) {
        field = line
        value = ""
      } else {
        field = line.slice(0, colonIdx)
        value = line.slice(colonIdx + 1)
        if (value.startsWith(" ")) value = value.slice(1)
      }

      switch (field) {
        case "event":
          this.eventType = value
          break
        case "data":
          this.dataLines.push(value)
          break
        case "id":
          if (!value.includes("\u0000")) this.lastEventId = value
          break
      }
    }

    return events
  }

  private indexOfLineEnd(s: string): number {
    const crlf = s.indexOf("\r\n")
    const lf = s.indexOf("\n")
    const cr = s.indexOf("\r")
    const candidates = [crlf, lf, cr].filter((i) => i !== -1)
    if (candidates.length === 0) return -1
    return Math.min(...candidates)
  }

  private advanceBy(idx: number): number {
    if (this.buffer.startsWith("\r\n", idx)) return idx + 2
    return idx + 1
  }

  private flush(): ParsedSSEEvent | null {
    if (this.dataLines.length === 0 && this.eventType === "") return null
    const data = this.dataLines.join("\n")
    const ev: ParsedSSEEvent = {
      type: this.eventType || "message",
      data,
      lastEventId: this.lastEventId,
    }
    this.eventType = ""
    this.dataLines = []
    return ev
  }
}

const sessionPrefix = (() => {
  try {
    return crypto.randomUUID().slice(0, 8)
  } catch {
    return Math.random().toString(36).slice(2, 10)
  }
})()
let streamCounter = 0

function nextStreamId() {
  streamCounter += 1
  return `${sessionPrefix}-${streamCounter}`
}

function post(msg: CaptureMessage) {
  try {
    window.postMessage({ source: BRIDGE_SOURCE, payload: msg }, "*")
  } catch {
    // noop
  }
}

function now() {
  return Date.now()
}

// ---------- EventSource ----------
const NativeEventSource = window.EventSource
if (NativeEventSource) {
  const PatchedEventSource = function (
    this: EventSource,
    url: string | URL,
    init?: EventSourceInit
  ) {
    const es = new NativeEventSource(url, init) as EventSource
    const streamId = nextStreamId()
    const urlStr = typeof url === "string" ? url : url.toString()
    let eventCounter = 0
    let closed = false

    post({
      kind: "stream-open",
      streamId,
      url: urlStr,
      source: "EventSource",
      method: "GET",
      withCredentials: init?.withCredentials ?? false,
      ts: now(),
    })

    const reportEvent = (ev: MessageEvent) => {
      eventCounter += 1
      post({
        kind: "stream-event",
        streamId,
        eventId: eventCounter,
        type: ev.type || "message",
        data: typeof ev.data === "string" ? ev.data : String(ev.data),
        lastEventId: (ev as MessageEvent).lastEventId || "",
        ts: now(),
      })
    }

    es.addEventListener("message", reportEvent)

    const origAdd = es.addEventListener.bind(es)
    const tracked = new Set<string>(["message"])
    es.addEventListener = ((
      type: string,
      listener: EventListenerOrEventListenerObject,
      opts?: boolean | AddEventListenerOptions
    ) => {
      if (
        type !== "message" &&
        type !== "open" &&
        type !== "error" &&
        !tracked.has(type)
      ) {
        tracked.add(type)
        origAdd(type, reportEvent as EventListener)
      }
      return origAdd(type, listener, opts)
    }) as typeof es.addEventListener

    es.addEventListener("error", () => {
      if (closed) return
      if (es.readyState === 2 /* CLOSED */) {
        closed = true
        post({ kind: "stream-close", streamId, reason: "error", ts: now() })
      }
    })

    const origClose = es.close.bind(es)
    es.close = () => {
      if (!closed) {
        closed = true
        post({
          kind: "stream-close",
          streamId,
          reason: "closed-by-client",
          ts: now(),
        })
      }
      return origClose()
    }

    return es
  } as unknown as typeof EventSource

  ;(PatchedEventSource as unknown as { prototype: EventSource }).prototype =
    NativeEventSource.prototype
  Object.defineProperty(PatchedEventSource, "CONNECTING", {
    value: NativeEventSource.CONNECTING,
  })
  Object.defineProperty(PatchedEventSource, "OPEN", {
    value: NativeEventSource.OPEN,
  })
  Object.defineProperty(PatchedEventSource, "CLOSED", {
    value: NativeEventSource.CLOSED,
  })
  ;(PatchedEventSource as unknown as Record<symbol, boolean>)[PATCH_MARKER] =
    true
  window.EventSource = PatchedEventSource
}

// ---------- fetch (for text/event-stream responses) ----------
const originalFetch = window.fetch
if (originalFetch) {
  const patchedFetch = async function patchedFetch(
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
    const response = await originalFetch(input, init)
    try {
      const contentType = response.headers.get("content-type") || ""
      if (!contentType.toLowerCase().includes("text/event-stream")) {
        return response
      }
      if (!response.body) return response

      const streamId = nextStreamId()
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url
      const method =
        (init?.method ?? (input instanceof Request ? input.method : "GET")) ||
        "GET"

      // Collect request headers from both init.headers and a Request input.
      const reqHeaders: Record<string, string> = {}
      const collect = (h: HeadersInit | undefined | Headers) => {
        if (!h) return
        try {
          new Headers(h).forEach((v, k) => {
            reqHeaders[k] = v
          })
        } catch {
          // ignore malformed headers
        }
      }
      if (input instanceof Request) collect(input.headers)
      collect(init?.headers)

      // Capture a body if it's trivially serializable.
      let requestBody: string | undefined
      let requestBodyOmittedReason: string | undefined
      const rawBody =
        init?.body ??
        (input instanceof Request && input.bodyUsed === false
          ? input.clone().body
          : undefined)
      if (typeof init?.body === "string") {
        requestBody = init.body
      } else if (init?.body instanceof URLSearchParams) {
        requestBody = init.body.toString()
      } else if (
        init?.body instanceof Blob &&
        init.body.type.startsWith("text/")
      ) {
        try {
          requestBody = await init.body.text()
        } catch {
          requestBodyOmittedReason = "(failed to read Blob body)"
        }
      } else if (input instanceof Request) {
        try {
          requestBody = await input.clone().text()
          if (!requestBody) requestBody = undefined
        } catch {
          requestBodyOmittedReason = "(failed to read Request body)"
        }
      } else if (rawBody !== undefined && rawBody !== null) {
        requestBodyOmittedReason = "(non-text body not captured)"
      }

      // Response headers as plain object.
      const resHeaders: Record<string, string> = {}
      response.headers.forEach((v, k) => {
        resHeaders[k] = v
      })

      post({
        kind: "stream-open",
        streamId,
        url,
        source: "fetch",
        method: method.toUpperCase(),
        withCredentials: init?.credentials === "include",
        ts: now(),
        requestHeaders: Object.keys(reqHeaders).length ? reqHeaders : undefined,
        requestBody,
        requestBodyOmittedReason,
        responseStatus: response.status,
        responseStatusText: response.statusText,
        responseHeaders: resHeaders,
      })

      const [consumer, tap] = response.body.tee()
      const tappedResponse = new Response(consumer, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      })

      ;(async () => {
        const parser = new SSEStreamParser()
        const decoder = new TextDecoder()
        const reader = tap.getReader()
        let eventCounter = 0
        try {
          for (;;) {
            const { value, done } = await reader.read()
            if (done) break
            const text = decoder.decode(value, { stream: true })
            const events = parser.feed(text)
            for (const ev of events) {
              eventCounter += 1
              post({
                kind: "stream-event",
                streamId,
                eventId: eventCounter,
                type: ev.type,
                data: ev.data,
                lastEventId: ev.lastEventId,
                ts: now(),
              })
            }
          }
          post({ kind: "stream-close", streamId, reason: "done", ts: now() })
        } catch (err) {
          post({
            kind: "stream-close",
            streamId,
            reason: "error",
            error: err instanceof Error ? err.message : String(err),
            ts: now(),
          })
        }
      })()

      return tappedResponse
    } catch {
      return response
    }
  }
  ;(patchedFetch as unknown as Record<symbol, boolean>)[PATCH_MARKER] = true
  window.fetch = patchedFetch
}
}
