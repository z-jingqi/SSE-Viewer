import type { StreamEventMessage } from "@/lib/types"
import { tryParseJson } from "../format"
import type { AssembledToolCall, Transcript } from "./index"

// Anthropic Messages streaming format:
//   event: content_block_start
//   data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}
//   event: content_block_delta
//   data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hi"}}
//   event: content_block_stop
//   data: {"type":"content_block_stop","index":0}
// Tool blocks: content_block.type === "tool_use"; deltas carry "input_json_delta".
type AnthropicBlock =
  | { kind: "text"; index: number; text: string }
  | {
      kind: "tool_use"
      index: number
      id?: string
      name: string
      arguments: string
    }

export function assembleAnthropic(events: StreamEventMessage[]): Transcript {
  const blocks = new Map<number, AnthropicBlock>()
  const rawConcat: string[] = []

  for (const ev of events) {
    rawConcat.push(ev.data)
    const parsed = tryParseJson(ev.data) as
      | {
          type?: string
          index?: number
          content_block?: {
            type?: string
            id?: string
            name?: string
          }
          delta?: {
            type?: string
            text?: string
            partial_json?: string
          }
        }
      | undefined
    if (!parsed?.type) continue
    const index = parsed.index ?? 0

    if (parsed.type === "content_block_start" && parsed.content_block) {
      const cb = parsed.content_block
      if (cb.type === "text") {
        blocks.set(index, { kind: "text", index, text: "" })
      } else if (cb.type === "tool_use") {
        blocks.set(index, {
          kind: "tool_use",
          index,
          id: cb.id,
          name: cb.name ?? "",
          arguments: "",
        })
      }
    } else if (parsed.type === "content_block_delta" && parsed.delta) {
      const block = blocks.get(index)
      if (!block) continue
      if (
        block.kind === "text" &&
        parsed.delta.type === "text_delta" &&
        typeof parsed.delta.text === "string"
      ) {
        block.text += parsed.delta.text
      } else if (
        block.kind === "tool_use" &&
        parsed.delta.type === "input_json_delta" &&
        typeof parsed.delta.partial_json === "string"
      ) {
        block.arguments += parsed.delta.partial_json
      }
    }
  }

  const ordered = Array.from(blocks.values()).sort(
    (a, b) => a.index - b.index
  )
  const text = ordered
    .filter((b): b is Extract<AnthropicBlock, { kind: "text" }> => b.kind === "text")
    .map((b) => b.text)
    .join("")
  const toolCalls: AssembledToolCall[] = ordered
    .filter(
      (b): b is Extract<AnthropicBlock, { kind: "tool_use" }> =>
        b.kind === "tool_use"
    )
    .map((b) => ({
      id: b.id,
      index: b.index,
      name: b.name,
      arguments: b.arguments,
      argumentsParsed: tryParseJson(b.arguments),
    }))

  return {
    kind: "anthropic",
    text,
    toolCalls,
    rawConcat: rawConcat.join("\n"),
  }
}
