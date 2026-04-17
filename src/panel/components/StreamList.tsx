import { useEffect, useRef, useState } from "react"
import { cn } from "@/panel/lib/utils"
import type { StreamSummary } from "@/panel/hooks/useCapturedEvents"
import { formatTime, shortUrl } from "@/panel/lib/format"
import { Pencil, X } from "lucide-react"

interface StreamListProps {
  streams: StreamSummary[]
  selectedId: string | null
  labels: Map<string, string>
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  onRename: (id: string, label: string) => void
}

export function StreamList({
  streams,
  selectedId,
  labels,
  onSelect,
  onDelete,
  onRename,
}: StreamListProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editingId])

  const startRename = (id: string) => {
    setEditingId(id)
    setDraft(labels.get(id) ?? "")
  }
  const commitRename = () => {
    if (!editingId) return
    onRename(editingId, draft)
    setEditingId(null)
  }
  const cancelRename = () => {
    setEditingId(null)
  }

  if (streams.length === 0) {
    return (
      <div className="p-3 text-xs text-muted-foreground">
        Waiting for SSE streams…
        <div className="mt-2 text-[11px] leading-relaxed">
          Open a page that uses <code>EventSource</code> or a{" "}
          <code>fetch()</code> with <code>text/event-stream</code> response.
          Streams appear here.
        </div>
      </div>
    )
  }

  return (
    <ul className="divide-y divide-border">
      {streams.map((s) => {
        const active = s.streamId === selectedId
        const status = !s.closedAt ? "open" : s.closeReason ?? "closed"
        const label = labels.get(s.streamId)
        const isEditing = editingId === s.streamId
        return (
          <li key={s.streamId} className="group relative">
            <button
              onClick={() => !isEditing && onSelect(s.streamId)}
              onDoubleClick={(e) => {
                e.preventDefault()
                startRename(s.streamId)
              }}
              className={cn(
                "w-full text-left px-3 py-2 pr-14 border-l-2 border-transparent hover:bg-accent focus:outline-none transition-colors",
                active && "bg-primary/15 border-l-primary hover:bg-primary/20"
              )}
            >
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "inline-block w-1.5 h-1.5 rounded-full shrink-0",
                    !s.closedAt
                      ? "bg-success animate-pulse"
                      : s.closeReason === "error"
                        ? "bg-destructive"
                        : "bg-muted-foreground"
                  )}
                  title={status}
                />
                <span className="text-[10px] font-mono uppercase text-muted-foreground">
                  {s.source === "fetch" ? "fetch" : "ES"}
                </span>
                <span className="text-[11px] tabular-nums text-muted-foreground">
                  {s.eventCount}
                </span>
              </div>

              {isEditing ? (
                <div className="mt-1" onClick={(e) => e.stopPropagation()}>
                  <input
                    ref={inputRef}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault()
                        commitRename()
                      } else if (e.key === "Escape") {
                        e.preventDefault()
                        cancelRename()
                      }
                    }}
                    onBlur={commitRename}
                    placeholder="Label (empty to clear)"
                    className="w-full h-6 px-2 rounded border border-input bg-background text-xs font-mono focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              ) : (
                <>
                  <div
                    className={cn(
                      "mt-1 text-xs truncate",
                      label ? "font-medium" : "font-mono"
                    )}
                    title={label ? `${label}\n${s.url}` : s.url}
                  >
                    {label ?? shortUrl(s.url)}
                  </div>
                  {label && (
                    <div
                      className="text-[10px] truncate text-muted-foreground font-mono"
                      title={s.url}
                    >
                      {shortUrl(s.url)}
                    </div>
                  )}
                </>
              )}

              <div className="mt-0.5 text-[10px] text-muted-foreground tabular-nums">
                {formatTime(s.openedAt)}
                {s.closedAt && ` → ${formatTime(s.closedAt)}`}
              </div>
            </button>
            {!isEditing && (
              <div className="absolute top-1.5 right-1.5 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    startRename(s.streamId)
                  }}
                  className={cn(
                    "w-5 h-5 inline-flex items-center justify-center rounded",
                    "text-muted-foreground hover:text-foreground hover:bg-accent",
                    "focus:outline-none"
                  )}
                  title="Rename (or double-click the row)"
                  aria-label="Rename stream"
                >
                  <Pencil className="size-3" />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onDelete(s.streamId)
                  }}
                  className={cn(
                    "w-5 h-5 inline-flex items-center justify-center rounded",
                    "text-muted-foreground hover:text-foreground hover:bg-destructive/20",
                    "focus:outline-none"
                  )}
                  title="Delete this stream"
                  aria-label="Delete stream"
                >
                  <X className="size-3" />
                </button>
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
