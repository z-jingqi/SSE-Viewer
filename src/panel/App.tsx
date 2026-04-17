import { useEffect, useMemo, useState } from "react"
import type { Layout } from "react-resizable-panels"
import {
  eventHasToolCall,
  eventMatchesTools,
  getToolNames,
} from "./lib/tool-detect"
import { getSearchableText } from "./lib/search"
import { Toolbar } from "./components/Toolbar"
import { StreamList } from "./components/StreamList"
import { EventList } from "./components/EventList"
import { EventDetail } from "./components/EventDetail"
import { TooltipProvider } from "./components/ui/tooltip"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "./components/ui/resizable"
import { useCapturedEvents } from "./hooks/useCapturedEvents"
import { usePatchHealth } from "./hooks/usePatchHealth"
import { Button } from "./components/ui/button"
import { AlertTriangle, RefreshCw } from "lucide-react"

const LAYOUT_STORAGE_KEY = "sse-viewer:layout"

function loadLayout(): Layout | undefined {
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY)
    if (!raw) return undefined
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === "object") return parsed as Layout
  } catch {
    // ignore
  }
  return undefined
}

export function App() {
  const { streams, eventsByStream, paused, setPaused, clear, deleteStream } =
    useCapturedEvents()
  const [patchHealth, reprobe] = usePatchHealth()

  const [selectedStreamId, setSelectedStreamId] = useState<string | null>(null)
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null)
  const [urlFilter, setUrlFilter] = useState("")
  const [search, setSearch] = useState("")
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(
    () => new Set()
  )
  const [selectedTools, setSelectedTools] = useState<Set<string>>(
    () => new Set()
  )
  const [onlyWithTools, setOnlyWithTools] = useState(false)
  const [labels, setLabels] = useState<Map<string, string>>(() => new Map())

  const renameStream = (streamId: string, label: string) => {
    setLabels((prev) => {
      const next = new Map(prev)
      const trimmed = label.trim()
      if (trimmed) next.set(streamId, trimmed)
      else next.delete(streamId)
      return next
    })
  }
  const [savedLayout] = useState<Layout | undefined>(loadLayout)
  const [layout, setLayout] = useState<Layout | undefined>(savedLayout)

  useEffect(() => {
    if (!layout) return
    try {
      localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout))
    } catch {
      // ignore
    }
  }, [layout])

  const filteredStreams = useMemo(() => {
    if (!urlFilter) return streams
    const q = urlFilter.toLowerCase()
    return streams.filter((s) => s.url.toLowerCase().includes(q))
  }, [streams, urlFilter])

  const effectiveStreamId = useMemo(() => {
    if (selectedStreamId && filteredStreams.some((s) => s.streamId === selectedStreamId)) {
      return selectedStreamId
    }
    return filteredStreams[0]?.streamId ?? null
  }, [filteredStreams, selectedStreamId])

  const rawEvents = effectiveStreamId
    ? eventsByStream.get(effectiveStreamId) ?? []
    : []

  const availableTypes = useMemo(() => {
    const set = new Set<string>()
    for (const e of rawEvents) set.add(e.type)
    return Array.from(set).sort()
  }, [rawEvents])

  const availableTools = useMemo(() => {
    const set = new Set<string>()
    for (const e of rawEvents) {
      for (const name of getToolNames(e)) set.add(name)
    }
    return Array.from(set).sort()
  }, [rawEvents])

  const filteredEvents = useMemo(() => {
    const q = search.toLowerCase()
    return rawEvents.filter((e) => {
      if (selectedTypes.size > 0 && !selectedTypes.has(e.type)) return false
      if (onlyWithTools && !eventHasToolCall(e)) return false
      if (selectedTools.size > 0 && !eventMatchesTools(e, selectedTools))
        return false
      if (q && !getSearchableText(e).toLowerCase().includes(q)) return false
      return true
    })
  }, [rawEvents, search, selectedTypes, selectedTools, onlyWithTools])

  const toggleType = (t: string) => {
    setSelectedTypes((prev) => {
      const next = new Set(prev)
      if (next.has(t)) next.delete(t)
      else next.add(t)
      return next
    })
  }
  const clearTypes = () => setSelectedTypes(new Set())

  const toggleTool = (t: string) => {
    setSelectedTools((prev) => {
      const next = new Set(prev)
      if (next.has(t)) next.delete(t)
      else next.add(t)
      return next
    })
  }
  const clearTools = () => {
    setSelectedTools(new Set())
    setOnlyWithTools(false)
  }

  const effectiveEventId = useMemo(() => {
    if (
      selectedEventId !== null &&
      filteredEvents.some((e) => e.eventId === selectedEventId)
    ) {
      return selectedEventId
    }
    return filteredEvents[0]?.eventId ?? null
  }, [filteredEvents, selectedEventId])

  const selectedStream = effectiveStreamId
    ? streams.find((s) => s.streamId === effectiveStreamId)
    : undefined
  const selectedEvent =
    effectiveEventId !== null
      ? filteredEvents.find((e) => e.eventId === effectiveEventId)
      : undefined

  const totalEvents = streams.reduce((acc, s) => acc + s.eventCount, 0)

  const onExport = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      streams: streams.map((s) => ({
        ...s,
        label: labels.get(s.streamId),
        events: eventsByStream.get(s.streamId) ?? [],
      })),
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    })
    const href = URL.createObjectURL(blob)
    const ts = new Date().toISOString().replace(/[:.]/g, "-")
    const a = document.createElement("a")
    a.href = href
    a.download = `sse-${ts}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(href), 1000)
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div className="h-full flex flex-col">
        {patchHealth === "inactive" && (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-destructive/10 border-b border-destructive/30 text-[11px] text-destructive">
            <AlertTriangle className="size-3.5 shrink-0" />
            <span className="flex-1">
              Capture patch is not active on this page. Reload the tab to start
              capturing SSE.
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                try {
                  chrome.devtools.inspectedWindow.reload({
                    ignoreCache: false,
                  })
                } catch {
                  // fallback: just reprobe
                  reprobe()
                }
              }}
              className="h-6"
            >
              <RefreshCw />
              Reload page
            </Button>
          </div>
        )}
        <Toolbar
          paused={paused}
          onTogglePause={() => setPaused((p) => !p)}
          onClear={() => {
            clear()
            setSelectedStreamId(null)
            setSelectedEventId(null)
          }}
          onExport={onExport}
          urlFilter={urlFilter}
          onUrlFilterChange={setUrlFilter}
          search={search}
          onSearchChange={setSearch}
          availableTypes={availableTypes}
          selectedTypes={selectedTypes}
          onToggleType={toggleType}
          onClearTypes={clearTypes}
          availableTools={availableTools}
          selectedTools={selectedTools}
          onToggleTool={toggleTool}
          onClearTools={clearTools}
          onlyWithTools={onlyWithTools}
          onToggleOnlyWithTools={() => setOnlyWithTools((v) => !v)}
          streamCount={streams.length}
          eventCount={totalEvents}
        />
        <div className="flex-1 min-h-0">
          <ResizablePanelGroup
            orientation="horizontal"
            defaultLayout={savedLayout}
            onLayoutChanged={setLayout}
          >
            <ResizablePanel
              id="streams"
              defaultSize="22%"
              minSize="12%"
              collapsible
              collapsedSize="0%"
            >
              <div className="h-full overflow-auto">
                <StreamList
                  streams={filteredStreams}
                  selectedId={effectiveStreamId}
                  labels={labels}
                  onSelect={(id) => {
                    setSelectedStreamId(id)
                    setSelectedEventId(null)
                  }}
                  onDelete={(id) => {
                    deleteStream(id)
                    if (id === selectedStreamId) {
                      setSelectedStreamId(null)
                      setSelectedEventId(null)
                    }
                  }}
                  onRename={renameStream}
                />
              </div>
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel id="events" defaultSize="45%" minSize="20%">
              <div className="h-full min-h-0">
                <EventList
                  events={filteredEvents}
                  selectedEventId={effectiveEventId}
                  onSelect={setSelectedEventId}
                  search={search}
                />
              </div>
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel id="detail" defaultSize="33%" minSize="20%">
              <div className="h-full min-h-0 overflow-hidden">
                <EventDetail
                  stream={selectedStream}
                  event={selectedEvent}
                  events={rawEvents}
                />
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      </div>
    </TooltipProvider>
  )
}
