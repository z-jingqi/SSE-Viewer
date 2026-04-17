import type { StreamEventMessage } from "@/lib/types"
import { tryParseJson } from "../format"
import { assembleOpenAI } from "./openai"
import { assembleAnthropic } from "./anthropic"
import { assembleVercel } from "./vercel"

export interface AssembledToolCall {
  id?: string
  index?: number
  name: string
  arguments: string
  argumentsParsed?: unknown
  result?: string
  resultParsed?: unknown
}

export type TranscriptKind = "openai" | "anthropic" | "vercel" | "generic"

export interface Transcript {
  kind: TranscriptKind
  text: string
  toolCalls: AssembledToolCall[]
  rawConcat: string
}

function detectShape(events: StreamEventMessage[]): TranscriptKind {
  for (const ev of events) {
    const parsed = tryParseJson(ev.data)
    if (!parsed || typeof parsed !== "object") continue
    const obj = parsed as Record<string, unknown>

    if (Array.isArray(obj.choices)) return "openai"

    if (typeof obj.type === "string") {
      if (
        obj.type === "content_block_start" ||
        obj.type === "content_block_delta" ||
        obj.type === "message_start"
      ) {
        return "anthropic"
      }
      if (
        /^tool[-_]/.test(obj.type) ||
        /^text[-_](start|delta|end)$/.test(obj.type) ||
        /^reasoning[-_]/.test(obj.type) ||
        /^data[-_]/.test(obj.type)
      ) {
        return "vercel"
      }
    }

    if (typeof obj.toolName === "string") return "vercel"
  }
  return "generic"
}

export function assembleTranscript(events: StreamEventMessage[]): Transcript {
  if (events.length === 0) {
    return { kind: "generic", text: "", toolCalls: [], rawConcat: "" }
  }
  const shape = detectShape(events)
  if (shape === "openai") return assembleOpenAI(events)
  if (shape === "anthropic") return assembleAnthropic(events)
  if (shape === "vercel") return assembleVercel(events)
  return {
    kind: "generic",
    text: "",
    toolCalls: [],
    rawConcat: events.map((e) => e.data).join("\n"),
  }
}
