import type { StreamEventMessage } from "@/lib/types"
import { tryParseJson } from "../format"
import type { AssembledToolCall, Transcript } from "./index"

// OpenAI Chat Completions streaming format:
//   data: {"choices":[{"delta":{"content":"hi"}}]}
//   data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"..","function":{"name":"..","arguments":".."}}]}}]}
//   data: [DONE]
export function assembleOpenAI(events: StreamEventMessage[]): Transcript {
  let text = ""
  const rawConcat: string[] = []
  const toolsByIndex = new Map<number, AssembledToolCall>()

  for (const ev of events) {
    const data = ev.data
    rawConcat.push(data)
    if (data.trim() === "[DONE]") continue
    const parsed = tryParseJson(data) as
      | {
          choices?: Array<{
            delta?: {
              content?: string
              tool_calls?: Array<{
                index?: number
                id?: string
                function?: { name?: string; arguments?: string }
              }>
            }
            message?: {
              content?: string
              tool_calls?: Array<{
                id?: string
                function?: { name?: string; arguments?: string }
              }>
            }
          }>
        }
      | undefined
    if (!parsed?.choices) continue
    for (const choice of parsed.choices) {
      const contentPiece = choice.delta?.content ?? choice.message?.content
      if (typeof contentPiece === "string") text += contentPiece

      const tcDeltas = choice.delta?.tool_calls
      if (tcDeltas) {
        for (const tc of tcDeltas) {
          const idx = tc.index ?? 0
          const current =
            toolsByIndex.get(idx) ??
            ({ id: undefined, index: idx, name: "", arguments: "" } as AssembledToolCall)
          if (tc.id) current.id = tc.id
          if (tc.function?.name) current.name = tc.function.name
          if (typeof tc.function?.arguments === "string") {
            current.arguments += tc.function.arguments
          }
          toolsByIndex.set(idx, current)
        }
      }

      // Non-streamed message.tool_calls (rare but possible)
      const msgTcs = choice.message?.tool_calls
      if (msgTcs) {
        msgTcs.forEach((tc, i) => {
          const current =
            toolsByIndex.get(i) ??
            ({
              id: tc.id,
              index: i,
              name: tc.function?.name ?? "",
              arguments: tc.function?.arguments ?? "",
            } as AssembledToolCall)
          toolsByIndex.set(i, current)
        })
      }
    }
  }

  const toolCalls = Array.from(toolsByIndex.values())
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((tc) => ({
      ...tc,
      argumentsParsed: tryParseJson(tc.arguments),
    }))

  return {
    kind: "openai",
    text,
    toolCalls,
    rawConcat: rawConcat.join("\n"),
  }
}
