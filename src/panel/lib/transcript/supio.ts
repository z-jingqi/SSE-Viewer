import type { StreamEventMessage } from "@/lib/types"
import { tryParseJson } from "../format"
import type { AssembledToolCall, Transcript } from "./index"

// Equity-gateway "Supio" agent SSE format. Two flavors are emitted depending
// on the route:
//
// Assistant V2 wire (LlmStreamEvent — most common in the chat UI):
//   data: {"text":"hello"}
//   data: {"tool_call":{"state":"start","toolUseId":"toolu_...",
//                       "name":"rag_search","description":"...",
//                       "subagentType":"search","toolsetName":"case-tools",
//                       "caseId":170496}}
//   data: {"tool_call":{"state":"complete","toolUseId":"toolu_...",
//                       "name":"rag_search","result":...}}    // result only on a
//                                                              // small allowlist
//                                                              // of tools
//   data: {"complete":{"success":true,"reply_id":42,"message":"..."}}
//   data: {"error":"...","statusCode":500}
//
// Agent runtime wire (AgentMessage — legacy /api/v1/agent/query route):
//   data: {"init":{"sessionId":"..."}}
//   data: {"text":"hello","source":{...}}
//   data: {"tool":{"state":"start","toolName":"rag_search","toolUseId":"...",
//                  "args":{...}}}
//   data: {"tool":{"state":"complete","toolName":"rag_search","toolUseId":"...",
//                  "result":...,"summary":"...","isError":false}}
//   data: {"completed":{"success":true,"response":"...","agentId":...}}
//   data: {"error":{"message":"..."}}
//
// Both flavors are handled below.

type ToolEntry = AssembledToolCall & { toolUseId?: string }

const TOOL_CALL_META_FIELDS = new Set([
  "state",
  "toolUseId",
  "name",
  "result",
])

export function assembleSupio(events: StreamEventMessage[]): Transcript {
  const rawConcat: string[] = []
  let text = ""
  let completionMessage: string | undefined
  const toolsById = new Map<string, ToolEntry>()
  const toolOrder: string[] = []

  const ensureEntry = (toolUseId: string, name: string): ToolEntry => {
    let entry = toolsById.get(toolUseId)
    if (!entry) {
      entry = { id: toolUseId, toolUseId, name, arguments: "" }
      toolsById.set(toolUseId, entry)
      toolOrder.push(toolUseId)
    } else if (!entry.name && name) {
      entry.name = name
    }
    return entry
  }

  const setResult = (entry: ToolEntry, out: unknown, isError = false) => {
    entry.resultParsed = out
    try {
      entry.result = typeof out === "string" ? out : JSON.stringify(out)
    } catch {
      entry.result = String(out)
    }
    if (isError && entry.result !== undefined) {
      entry.result = `error: ${entry.result}`
    }
  }

  for (const ev of events) {
    rawConcat.push(ev.data)
    if (ev.data.trim() === "[DONE]") continue
    const parsed = tryParseJson(ev.data)
    if (!parsed || typeof parsed !== "object") continue
    const obj = parsed as Record<string, unknown>

    // --- Streamed assistant text ---
    if (typeof obj.text === "string") {
      text += obj.text
      continue
    }

    // --- V2: tool_call ---
    const tc = obj.tool_call
    if (tc && typeof tc === "object") {
      const t = tc as Record<string, unknown>
      const toolUseId = typeof t.toolUseId === "string" ? t.toolUseId : undefined
      if (!toolUseId) continue
      const name = typeof t.name === "string" ? t.name : ""
      const entry = ensureEntry(toolUseId, name)

      // V2 doesn't stream raw args — it streams the description plus a few
      // labels (subagentType, toolsetName, caseId, …). On the "start" event,
      // pack everything except the meta fields into the args view so the JSON
      // tree shows the call's full context.
      if (t.state === "start") {
        const argsObj: Record<string, unknown> = {}
        for (const k in t) {
          if (!TOOL_CALL_META_FIELDS.has(k)) argsObj[k] = t[k]
        }
        if (Object.keys(argsObj).length > 0) {
          entry.argumentsParsed = argsObj
          try {
            entry.arguments = JSON.stringify(argsObj)
          } catch {
            // keep prior
          }
        }
      } else if (t.state === "complete") {
        if (t.result !== undefined) setResult(entry, t.result)
      }
      continue
    }

    // --- Legacy agent-runtime: tool ---
    const tool = obj.tool
    if (tool && typeof tool === "object") {
      const t = tool as Record<string, unknown>
      const toolUseId = typeof t.toolUseId === "string" ? t.toolUseId : undefined
      if (!toolUseId) continue
      const name = typeof t.toolName === "string" ? t.toolName : ""
      const entry = ensureEntry(toolUseId, name)

      if (t.state === "start") {
        const args = t.args
        if (args !== undefined) {
          entry.argumentsParsed = args
          try {
            entry.arguments = JSON.stringify(args)
          } catch {
            // keep prior
          }
        }
      } else if (t.state === "complete") {
        const isError = t.isError === true
        const out =
          t.result !== undefined
            ? t.result
            : typeof t.summary === "string"
              ? t.summary
              : typeof t.rawText === "string"
                ? t.rawText
                : undefined
        if (out !== undefined) setResult(entry, out, isError)
      }
      continue
    }

    // --- V2 completion: { complete: { success, reply_id?, message? } } ---
    const completeV2 = obj.complete
    if (completeV2 && typeof completeV2 === "object") {
      const message = (completeV2 as Record<string, unknown>).message
      if (typeof message === "string" && message) completionMessage = message
      continue
    }

    // --- Legacy completion: { completed: { success, response } } ---
    const completedLegacy = obj.completed
    if (completedLegacy && typeof completedLegacy === "object") {
      const response = (completedLegacy as Record<string, unknown>).response
      if (typeof response === "string" && response) completionMessage = response
      continue
    }

    // --- Errors ---
    // V2 wire: { error: string, statusCode: number }
    if (typeof obj.error === "string" && obj.error) {
      text += (text ? "\n" : "") + `[error] ${obj.error}`
      continue
    }
    // Legacy: { error: { message: string } }
    if (obj.error && typeof obj.error === "object") {
      const message = (obj.error as Record<string, unknown>).message
      if (typeof message === "string" && message) {
        text += (text ? "\n" : "") + `[error] ${message}`
      }
    }
  }

  // If no text was streamed, fall back to the completion message.
  if (!text && completionMessage) text = completionMessage

  const toolCalls: AssembledToolCall[] = toolOrder
    .map((id) => toolsById.get(id))
    .filter((e): e is ToolEntry => !!e)
    .map((e, i) => ({
      id: e.toolUseId,
      index: i,
      name: e.name,
      arguments: e.arguments,
      argumentsParsed: e.argumentsParsed,
      result: e.result,
      resultParsed: e.resultParsed,
    }))

  return {
    kind: "supio",
    text,
    toolCalls,
    rawConcat: rawConcat.join("\n"),
  }
}
