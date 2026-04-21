import { useMemo, useState } from "react"
import { JsonView, defaultStyles, darkStyles } from "react-json-view-lite"
import "react-json-view-lite/dist/index.css"
import type { StreamEventMessage } from "@/lib/types"
import type { StreamSummary } from "@/panel/hooks/useCapturedEvents"
import { Button } from "./ui/button"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./ui/tabs"
import { Check, Copy, Link as LinkIcon, Terminal } from "lucide-react"
import { formatTime, shortUrl, tryParseJson } from "@/panel/lib/format"
import { cn } from "@/panel/lib/utils"
import { buildCurl } from "@/panel/lib/curl"
import { assembleTranscript, type AssembledToolCall } from "@/panel/lib/transcript"

interface EventDetailProps {
  stream: StreamSummary | undefined
  event: StreamEventMessage | undefined
  events: StreamEventMessage[]
}

function useIsDark() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  )
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

function stringifyForCopy(value: unknown, fallback = "") {
  if (value === undefined) return fallback
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function formatAssembledForCopy(
  transcript: ReturnType<typeof assembleTranscript>
): string {
  const parts: string[] = []

  if (transcript.text) {
    parts.push(transcript.text)
  }

  if (transcript.toolCalls.length > 0) {
    if (parts.length > 0) parts.push("")
    parts.push("Tool calls:")
    transcript.toolCalls.forEach((tc, idx) => {
      parts.push(`- ${tc.name || `(unnamed #${idx + 1})`}`)
      if (tc.arguments || tc.argumentsParsed !== undefined) {
        parts.push(`  Arguments:`)
        parts.push(
          stringifyForCopy(tc.argumentsParsed ?? tc.arguments, "(no arguments yet)")
            .split("\n")
            .map((line) => `  ${line}`)
            .join("\n")
        )
      }
      if (tc.result !== undefined || tc.resultParsed !== undefined) {
        parts.push(`  Result:`)
        parts.push(
          stringifyForCopy(tc.resultParsed ?? tc.result)
            .split("\n")
            .map((line) => `  ${line}`)
            .join("\n")
        )
      }
    })
  }

  if (parts.length === 0) {
    return transcript.rawConcat || "(no events yet)"
  }

  return parts.join("\n")
}

function StatusBadge({ status }: { status?: number }) {
  if (typeof status !== "number") {
    return (
      <span className="text-[10px] font-mono text-muted-foreground">
        (status n/a)
      </span>
    )
  }
  const tone =
    status >= 200 && status < 300
      ? "bg-success/20 text-success"
      : status >= 400
        ? "bg-destructive/20 text-destructive"
        : "bg-muted text-muted-foreground"
  return (
    <span
      className={cn(
        "text-[10px] font-mono px-1.5 py-0.5 rounded tabular-nums",
        tone
      )}
    >
      {status}
    </span>
  )
}

function HeadersTable({
  label,
  headers,
}: {
  label: string
  headers?: Record<string, string>
}) {
  if (!headers || Object.keys(headers).length === 0) return null
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
        {label}
      </div>
      <div className="font-mono text-[11px] leading-relaxed">
        {Object.entries(headers).map(([k, v]) => (
          <div key={k} className="flex gap-2 break-all">
            <span className="text-muted-foreground shrink-0">{k}:</span>
            <span>{v}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function StreamSummaryBand({ stream }: { stream: StreamSummary }) {
  const [copiedCurl, setCopiedCurl] = useState(false)
  const [copiedUrl, setCopiedUrl] = useState(false)
  const canCurl = stream.source === "fetch"

  const onCopyCurl = async () => {
    const ok = await copyToClipboard(buildCurl(stream))
    if (ok) {
      setCopiedCurl(true)
      setTimeout(() => setCopiedCurl(false), 1200)
    }
  }
  const onCopyUrl = async () => {
    const ok = await copyToClipboard(stream.url)
    if (ok) {
      setCopiedUrl(true)
      setTimeout(() => setCopiedUrl(false), 1200)
    }
  }

  const hasAnyMeta =
    stream.requestHeaders ||
    stream.responseHeaders ||
    stream.requestBody ||
    stream.requestBodyOmittedReason

  return (
    <div className="px-3 py-2 border-b border-border bg-card space-y-2">
      <div className="flex items-center gap-2 text-xs">
        <span className="font-mono font-medium">{stream.method}</span>
        <span
          className="font-mono text-muted-foreground truncate flex-1"
          title={stream.url}
        >
          {shortUrl(stream.url)}
        </span>
        <StatusBadge status={stream.responseStatus} />
      </div>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          onClick={onCopyCurl}
          disabled={!canCurl}
          title={
            canCurl
              ? "Copy as cURL"
              : "cURL not available for EventSource (no header access)"
          }
        >
          {copiedCurl ? <Check /> : <Terminal />}
          {copiedCurl ? "Copied" : "cURL"}
        </Button>
        <Button variant="outline" size="sm" onClick={onCopyUrl}>
          {copiedUrl ? <Check /> : <LinkIcon />}
          {copiedUrl ? "Copied" : "URL"}
        </Button>
      </div>
      {hasAnyMeta ? (
        <details className="group">
          <summary className="text-[11px] text-muted-foreground cursor-pointer select-none list-none flex items-center gap-1">
            <span className="inline-block transition-transform group-open:rotate-90">
              ▸
            </span>
            Headers &amp; body
          </summary>
          <div className="mt-2 space-y-3 pl-3">
            <HeadersTable
              label="Request headers"
              headers={stream.requestHeaders}
            />
            <HeadersTable
              label="Response headers"
              headers={stream.responseHeaders}
            />
            {stream.requestBody !== undefined ? (
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                  Request body
                </div>
                <pre className="text-[11px] font-mono whitespace-pre-wrap break-words bg-muted rounded-md p-2 max-h-48 overflow-auto">
                  {stream.requestBody}
                </pre>
              </div>
            ) : stream.requestBodyOmittedReason ? (
              <div className="text-[11px] text-muted-foreground italic">
                {stream.requestBodyOmittedReason}
              </div>
            ) : null}
          </div>
        </details>
      ) : stream.source === "EventSource" ? (
        <div className="text-[11px] text-muted-foreground italic">
          (headers / status not available for EventSource)
        </div>
      ) : null}
    </div>
  )
}

function ToolCallCard({ tc }: { tc: AssembledToolCall }) {
  const isDark = useIsDark()
  const [copied, setCopied] = useState(false)
  const onCopy = async () => {
    const ok = await copyToClipboard(tc.arguments)
    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    }
  }
  const hasResult = tc.result !== undefined || tc.resultParsed !== undefined
  return (
    <div className="border border-border rounded-md overflow-hidden">
      <div className="flex items-center gap-2 px-2 py-1 bg-muted">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Tool call
        </span>
        <span className="font-mono text-xs font-medium">{tc.name || "(unnamed)"}</span>
        {tc.id && (
          <span className="font-mono text-[10px] text-muted-foreground truncate">
            {tc.id}
          </span>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          onClick={onCopy}
        >
          {copied ? <Check /> : <Copy />}
          {copied ? "Copied" : "args"}
        </Button>
      </div>
      <div className="p-2 text-xs font-mono">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
          Arguments
        </div>
        {tc.argumentsParsed !== undefined && tc.argumentsParsed !== null ? (
          <JsonView
            data={tc.argumentsParsed as object}
            shouldExpandNode={() => true}
            style={isDark ? darkStyles : defaultStyles}
          />
        ) : (
          <pre className="whitespace-pre-wrap break-words bg-muted/50 rounded p-1.5 text-[11px]">
            {tc.arguments || "(no arguments yet)"}
          </pre>
        )}
        {hasResult && (
          <>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mt-2 mb-1">
              Result
            </div>
            {tc.resultParsed !== undefined &&
            tc.resultParsed !== null &&
            typeof tc.resultParsed === "object" ? (
              <JsonView
                data={tc.resultParsed as object}
                shouldExpandNode={() => true}
                style={isDark ? darkStyles : defaultStyles}
              />
            ) : (
              <pre className="whitespace-pre-wrap break-words bg-muted/50 rounded p-1.5 text-[11px]">
                {tc.result ?? String(tc.resultParsed)}
              </pre>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function AssembledView({ events }: { events: StreamEventMessage[] }) {
  const transcript = useMemo(() => assembleTranscript(events), [events])
  const [copied, setCopied] = useState(false)
  const hasContent =
    transcript.text.length > 0 || transcript.toolCalls.length > 0
  const onCopy = async () => {
    const ok = await copyToClipboard(formatAssembledForCopy(transcript))
    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    }
  }

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        {transcript.kind !== "generic" ? (
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Detected shape: {transcript.kind}
          </div>
        ) : (
          <div />
        )}
        <Button size="sm" variant="ghost" onClick={onCopy}>
          {copied ? <Check /> : <Copy />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      {transcript.text && (
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
            Text
          </div>
          <pre className="text-xs whitespace-pre-wrap break-words bg-muted rounded-md p-2">
            {transcript.text}
          </pre>
        </div>
      )}
      {transcript.toolCalls.length > 0 && (
        <div className="space-y-2">
          {transcript.toolCalls.map((tc) => (
            <ToolCallCard key={`${tc.index ?? 0}-${tc.id ?? tc.name}`} tc={tc} />
          ))}
        </div>
      )}
      {!hasContent && (
        <div>
          <div className="text-[11px] text-muted-foreground italic mb-1">
            No recognized transcript shape — showing raw concatenation of all
            event payloads:
          </div>
          <pre className="text-xs whitespace-pre-wrap break-words bg-muted rounded-md p-2 max-h-[60vh] overflow-auto">
            {transcript.rawConcat || "(no events yet)"}
          </pre>
        </div>
      )}
    </div>
  )
}

function EventView({ event }: { event: StreamEventMessage }) {
  const isDark = useIsDark()
  const [copied, setCopied] = useState(false)
  const parsed = useMemo(() => tryParseJson(event.data), [event])
  const onCopy = async () => {
    const ok = await copyToClipboard(event.data)
    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    }
  }
  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center gap-2 text-xs">
        <span className="font-mono px-1.5 py-0.5 rounded bg-accent text-accent-foreground">
          {event.type}
        </span>
        {event.lastEventId && (
          <span className="font-mono text-muted-foreground">
            id: {event.lastEventId}
          </span>
        )}
        <span className="ml-auto text-muted-foreground tabular-nums">
          {formatTime(event.ts)}
        </span>
      </div>
      {parsed !== undefined ? (
        <div>
          <div className="flex items-center justify-between mb-1">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Payload (JSON)
            </div>
            <Button size="sm" variant="ghost" onClick={onCopy}>
              {copied ? <Check /> : <Copy />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <div className="text-xs font-mono">
            <JsonView
              data={parsed as object}
              shouldExpandNode={() => true}
              style={isDark ? darkStyles : defaultStyles}
            />
          </div>
        </div>
      ) : (
        <div>
          <div className="flex items-center justify-between mb-1">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Payload (raw)
            </div>
            <Button size="sm" variant="ghost" onClick={onCopy}>
              {copied ? <Check /> : <Copy />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <pre className="text-xs font-mono whitespace-pre-wrap break-words bg-muted rounded-md p-2">
            {event.data}
          </pre>
        </div>
      )}
    </div>
  )
}

export function EventDetail({ stream, event, events }: EventDetailProps) {
  if (!stream) {
    return (
      <div className="p-3 text-xs text-muted-foreground">
        Select a stream to see its summary and events.
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <StreamSummaryBand stream={stream} />
      <Tabs defaultValue="event" className="flex-1 min-h-0 flex flex-col">
        <div className="px-3 py-1.5 border-b border-border bg-card">
          <TabsList>
            <TabsTrigger value="event">Event</TabsTrigger>
            <TabsTrigger value="assembled">Assembled</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="event" className="flex-1 min-h-0 overflow-auto">
          {event ? (
            <EventView event={event} />
          ) : (
            <div className="p-3 text-xs text-muted-foreground">
              Select an event to see its payload.
            </div>
          )}
        </TabsContent>
        <TabsContent value="assembled" className="flex-1 min-h-0 overflow-auto">
          <AssembledView events={events} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
