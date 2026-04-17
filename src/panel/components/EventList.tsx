import { useCallback, useEffect, useRef, useState } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import type { StreamEventMessage } from "@/lib/types"
import { cn } from "@/panel/lib/utils"
import { formatTime, previewData } from "@/panel/lib/format"

interface EventListProps {
  events: StreamEventMessage[]
  selectedEventId: number | null
  onSelect: (eventId: number) => void
  search: string
}

interface ColumnWidths {
  time: number
  type: number
  id: number
}

const DEFAULT_WIDTHS: ColumnWidths = { time: 110, type: 100, id: 70 }
const MIN_WIDTHS: ColumnWidths = { time: 60, type: 50, id: 40 }
const STORAGE_KEY = "sse-viewer:column-widths"

function loadWidths(): ColumnWidths {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_WIDTHS
    const parsed = JSON.parse(raw) as Partial<ColumnWidths>
    return {
      time: Math.max(MIN_WIDTHS.time, parsed.time ?? DEFAULT_WIDTHS.time),
      type: Math.max(MIN_WIDTHS.type, parsed.type ?? DEFAULT_WIDTHS.type),
      id: Math.max(MIN_WIDTHS.id, parsed.id ?? DEFAULT_WIDTHS.id),
    }
  } catch {
    return DEFAULT_WIDTHS
  }
}

function highlight(text: string, query: string): React.ReactNode {
  if (!query) return text
  const lower = text.toLowerCase()
  const q = query.toLowerCase()
  const idx = lower.indexOf(q)
  if (idx === -1) return text
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-primary/30 text-foreground rounded-sm px-0.5">
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  )
}

interface ResizerProps {
  onResize: (deltaX: number) => void
}

function Resizer({ onResize }: ResizerProps) {
  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.stopPropagation()
      const startX = e.clientX
      let lastX = startX

      const onMove = (ev: PointerEvent) => {
        const dx = ev.clientX - lastX
        lastX = ev.clientX
        onResize(dx)
      }
      const onUp = () => {
        window.removeEventListener("pointermove", onMove)
        window.removeEventListener("pointerup", onUp)
        document.body.style.cursor = ""
        document.body.style.userSelect = ""
      }

      document.body.style.cursor = "col-resize"
      document.body.style.userSelect = "none"
      window.addEventListener("pointermove", onMove)
      window.addEventListener("pointerup", onUp)
    },
    [onResize]
  )

  return (
    <div
      onPointerDown={onPointerDown}
      className="absolute top-0 right-0 h-full w-1.5 -mr-0.5 cursor-col-resize hover:bg-primary/40 active:bg-primary/60 z-20"
      role="separator"
      aria-orientation="vertical"
    />
  )
}

export function EventList({
  events,
  selectedEventId,
  onSelect,
  search,
}: EventListProps) {
  const parentRef = useRef<HTMLDivElement>(null)
  const [widths, setWidths] = useState<ColumnWidths>(loadWidths)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(widths))
    } catch {
      // ignore
    }
  }, [widths])

  const resize = useCallback(
    (col: keyof ColumnWidths) => (delta: number) => {
      setWidths((prev) => ({
        ...prev,
        [col]: Math.max(MIN_WIDTHS[col], prev[col] + delta),
      }))
    },
    []
  )

  const virtualizer = useVirtualizer({
    count: events.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 28,
    overscan: 16,
  })

  const gridTemplate = `${widths.time}px ${widths.type}px ${widths.id}px minmax(0, 1fr)`

  if (events.length === 0) {
    return (
      <div className="p-3 text-xs text-muted-foreground">No events yet.</div>
    )
  }

  return (
    <div ref={parentRef} className="h-full overflow-auto">
      <div
        style={{ gridTemplateColumns: gridTemplate }}
        className="sticky top-0 z-10 grid gap-0 border-b border-border bg-card text-[10px] uppercase tracking-wide text-muted-foreground font-medium"
      >
        <div className="relative px-2 py-1 truncate">
          Time
          <Resizer onResize={resize("time")} />
        </div>
        <div className="relative px-2 py-1 truncate">
          Type
          <Resizer onResize={resize("type")} />
        </div>
        <div className="relative px-2 py-1 truncate">
          ID
          <Resizer onResize={resize("id")} />
        </div>
        <div className="px-2 py-1 truncate">Data</div>
      </div>
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((item) => {
          const ev = events[item.index]
          const active = ev.eventId === selectedEventId
          const preview = previewData(ev.data)
          return (
            <button
              key={ev.eventId}
              onClick={() => onSelect(ev.eventId)}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: item.size,
                transform: `translateY(${item.start}px)`,
                gridTemplateColumns: gridTemplate,
              }}
              className={cn(
                "grid gap-0 items-center text-left font-mono text-[11px] border-l-2 border-transparent hover:bg-accent focus:outline-none transition-colors",
                active &&
                  "bg-primary/15 border-l-primary hover:bg-primary/20",
                item.index % 2 === 1 && !active && "bg-muted/40"
              )}
            >
              <span className="px-2 text-muted-foreground tabular-nums truncate">
                {formatTime(ev.ts)}
              </span>
              <span className="px-2 truncate">{ev.type}</span>
              <span className="px-2 truncate text-muted-foreground">
                {ev.lastEventId || "—"}
              </span>
              <span className="px-2 truncate">
                {highlight(preview, search)}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
