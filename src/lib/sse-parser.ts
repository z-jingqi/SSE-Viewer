export interface ParsedSSEEvent {
  type: string
  data: string
  lastEventId: string
}

export class SSEStreamParser {
  private buffer = ""
  private eventType = ""
  private dataLines: string[] = []
  private lastEventId = ""

  feed(chunk: string): ParsedSSEEvent[] {
    this.buffer += chunk
    const events: ParsedSSEEvent[] = []

    let newlineIdx: number
    while ((newlineIdx = this.indexOfLineEnd(this.buffer)) !== -1) {
      const line = this.buffer.slice(0, newlineIdx.valueOf())
      this.buffer = this.buffer.slice(this.advanceBy(newlineIdx))

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
        case "retry":
          break
        default:
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
