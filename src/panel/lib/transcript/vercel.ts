import type { StreamEventMessage } from "@/lib/types"
import { tryParseJson } from "../format"
import type { AssembledToolCall, Transcript } from "./index"

// Vercel AI SDK Data Stream Protocol (v2+):
//
// Text parts:
//   {"type":"text-start","id":"..."}
//   {"type":"text-delta","id":"...","delta":"hi"}       (or "textDelta")
//   {"type":"text-end","id":"..."}
//
// Tool input (streaming the arguments):
//   {"type":"tool-input-start","toolCallId":"...","toolName":"..."}
//   {"type":"tool-input-delta","toolCallId":"...","inputTextDelta":"{"}
//   {"type":"tool-input-available","toolCallId":"...","toolName":"...","input":{...}}
//   {"type":"tool-input-error","toolCallId":"...","errorText":"..."}
//
// Tool call (non-streamed): {"type":"tool-call","toolCallId":"...","toolName":"...","args":{...}}
//
// Tool output:
//   {"type":"tool-output-available","toolCallId":"...","output":{...}}
//   {"type":"tool-result","toolCallId":"...","result":...}
//
// Reasoning (ignored for transcript text for now):
//   {"type":"reasoning-start"/"reasoning-delta"/"reasoning-end"}
//
// Finish: {"type":"finish"} / {"type":"done"}

type ToolEntry = AssembledToolCall & { toolCallId?: string }

export function assembleVercel(events: StreamEventMessage[]): Transcript {
  const rawConcat: string[] = []
  let text = ""
  const toolsByCallId = new Map<string, ToolEntry>()
  const toolOrder: string[] = []

  const getOrCreate = (toolCallId: string): ToolEntry => {
    let entry = toolsByCallId.get(toolCallId)
    if (!entry) {
      entry = {
        id: toolCallId,
        toolCallId,
        name: "",
        arguments: "",
      }
      toolsByCallId.set(toolCallId, entry)
      toolOrder.push(toolCallId)
    }
    return entry
  }

  for (const ev of events) {
    rawConcat.push(ev.data)
    const parsed = tryParseJson(ev.data) as
      | (Record<string, unknown> & {
          type?: string
          delta?: unknown
          textDelta?: unknown
          text?: unknown
          toolCallId?: string
          toolName?: string
          input?: unknown
          args?: unknown
          inputTextDelta?: unknown
          output?: unknown
          result?: unknown
          errorText?: unknown
        })
      | undefined
    if (!parsed || typeof parsed !== "object") continue

    const type = typeof parsed.type === "string" ? parsed.type : ""

    // --- Text parts ---
    if (type === "text-delta" || type === "text_delta") {
      const piece =
        typeof parsed.delta === "string"
          ? parsed.delta
          : typeof parsed.textDelta === "string"
            ? parsed.textDelta
            : typeof parsed.text === "string"
              ? parsed.text
              : undefined
      if (typeof piece === "string") text += piece
      continue
    }

    // --- Tool parts ---
    const tcid = typeof parsed.toolCallId === "string" ? parsed.toolCallId : undefined
    if (!tcid) continue

    const entry = getOrCreate(tcid)
    if (typeof parsed.toolName === "string" && parsed.toolName) {
      entry.name = parsed.toolName
    }

    if (type === "tool-input-delta" || type === "tool_input_delta") {
      const piece =
        typeof parsed.inputTextDelta === "string"
          ? parsed.inputTextDelta
          : typeof parsed.delta === "string"
            ? parsed.delta
            : undefined
      if (typeof piece === "string") entry.arguments += piece
    } else if (
      type === "tool-input-available" ||
      type === "tool_input_available" ||
      type === "tool-call" ||
      type === "tool_call"
    ) {
      // Final input object provided as structured data.
      const finalInput = parsed.input ?? parsed.args
      if (finalInput !== undefined) {
        entry.argumentsParsed = finalInput
        try {
          entry.arguments = JSON.stringify(finalInput)
        } catch {
          // keep whatever we had from deltas
        }
      }
    } else if (
      type === "tool-output-available" ||
      type === "tool_output_available" ||
      type === "tool-result" ||
      type === "tool_result"
    ) {
      const out = parsed.output ?? parsed.result
      if (out !== undefined) {
        entry.resultParsed = out
        try {
          entry.result =
            typeof out === "string" ? out : JSON.stringify(out)
        } catch {
          entry.result = String(out)
        }
      }
    } else if (type === "tool-input-error" || type === "tool_input_error") {
      if (typeof parsed.errorText === "string") {
        entry.result = `error: ${parsed.errorText}`
      }
    }
  }

  // Parse any accumulated delta-only arguments into argumentsParsed.
  for (const entry of toolsByCallId.values()) {
    if (entry.argumentsParsed === undefined && entry.arguments) {
      const parsed = tryParseJson(entry.arguments)
      if (parsed !== undefined) entry.argumentsParsed = parsed
    }
  }

  const toolCalls: AssembledToolCall[] = toolOrder
    .map((id) => toolsByCallId.get(id))
    .filter((e): e is ToolEntry => !!e)
    .map((e, i) => ({
      id: e.toolCallId,
      index: i,
      name: e.name,
      arguments: e.arguments,
      argumentsParsed: e.argumentsParsed,
      result: e.result,
      resultParsed: e.resultParsed,
    }))

  return {
    kind: "vercel",
    text,
    toolCalls,
    rawConcat: rawConcat.join("\n"),
  }
}
