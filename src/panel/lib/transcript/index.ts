import type { StreamEventMessage } from "@/lib/types"
import { tryParseJson } from "../format"
import { assembleOpenAI } from "./openai"
import { assembleAnthropic } from "./anthropic"
import { assembleVercel } from "./vercel"
import { assembleSupio } from "./supio"

export interface AssembledToolCall {
  id?: string
  index?: number
  name: string
  arguments: string
  argumentsParsed?: unknown
  result?: string
  resultParsed?: unknown
}

export type TranscriptKind =
  | "openai"
  | "anthropic"
  | "vercel"
  | "supio"
  | "generic"

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

    // Supio (equity-gateway) — recognized via several distinctive shapes.
    // V2 wire (LlmStreamEvent): {tool_call:{name,toolUseId,state}}
    //                           {complete:{success,reply_id?,message?}}
    // Legacy agent-runtime:    {init:{sessionId}}
    //                           {tool:{toolName,toolUseId,state}}
    //                           {completed:{response}}
    const toolCallV2 = obj.tool_call
    if (toolCallV2 && typeof toolCallV2 === "object") {
      const t = toolCallV2 as Record<string, unknown>
      if (
        typeof t.name === "string" &&
        (typeof t.toolUseId === "string" || typeof t.state === "string")
      ) {
        return "supio"
      }
    }
    const completeV2 = obj.complete
    if (
      completeV2 &&
      typeof completeV2 === "object" &&
      typeof (completeV2 as Record<string, unknown>).success === "boolean"
    ) {
      return "supio"
    }
    const init = obj.init
    if (
      init &&
      typeof init === "object" &&
      typeof (init as Record<string, unknown>).sessionId === "string"
    ) {
      return "supio"
    }
    const tool = obj.tool
    if (tool && typeof tool === "object") {
      const t = tool as Record<string, unknown>
      if (
        typeof t.toolName === "string" &&
        (typeof t.toolUseId === "string" || typeof t.state === "string")
      ) {
        return "supio"
      }
    }
    const completed = obj.completed
    if (
      completed &&
      typeof completed === "object" &&
      typeof (completed as Record<string, unknown>).response === "string"
    ) {
      return "supio"
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
  if (shape === "supio") return assembleSupio(events)
  return {
    kind: "generic",
    text: "",
    toolCalls: [],
    rawConcat: events.map((e) => e.data).join("\n"),
  }
}
