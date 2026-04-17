import { tryParseJson } from "./format"

// Walk nested structures and return every string value at a given key path.
function collectNames(value: unknown, out: Set<string>): void {
  if (!value || typeof value !== "object") return

  if (Array.isArray(value)) {
    for (const item of value) collectNames(item, out)
    return
  }

  const obj = value as Record<string, unknown>

  // Anthropic content_block tool_use: { type: "tool_use", name: "..." }
  if (obj.type === "tool_use" && typeof obj.name === "string") {
    out.add(obj.name)
  }

  // OpenAI chat completions: tool_calls[] with function.name
  if (Array.isArray(obj.tool_calls)) {
    for (const tc of obj.tool_calls as Array<Record<string, unknown>>) {
      const fn = tc?.function as Record<string, unknown> | undefined
      if (fn && typeof fn.name === "string" && fn.name) out.add(fn.name)
      else if (typeof tc?.name === "string" && tc.name) out.add(tc.name)
    }
  }

  // Legacy OpenAI function_call: { function_call: { name: "..." } }
  const fc = obj.function_call as Record<string, unknown> | undefined
  if (fc && typeof fc.name === "string" && fc.name) out.add(fc.name)

  // Vercel AI SDK data-stream protocol:
  //   { type: "tool-input-start"|"tool-input-delta"|"tool-input-available"
  //         |"tool-call"|"tool-result"|"tool-input-error",
  //     toolName: "...", toolCallId: "..." }
  if (typeof obj.toolName === "string" && obj.toolName) {
    out.add(obj.toolName)
  }

  // Recurse into all values.
  for (const k in obj) collectNames(obj[k], out)
}

function containsAnyName(value: unknown, names: Set<string>): boolean {
  if (!value || typeof value !== "object") return false
  if (Array.isArray(value)) {
    for (const item of value) if (containsAnyName(item, names)) return true
    return false
  }
  const obj = value as Record<string, unknown>

  if (obj.type === "tool_use" && typeof obj.name === "string" && names.has(obj.name)) return true

  if (Array.isArray(obj.tool_calls)) {
    for (const tc of obj.tool_calls as Array<Record<string, unknown>>) {
      const fn = tc?.function as Record<string, unknown> | undefined
      if (fn && typeof fn.name === "string" && names.has(fn.name)) return true
      if (typeof tc?.name === "string" && names.has(tc.name)) return true
    }
  }

  const fc = obj.function_call as Record<string, unknown> | undefined
  if (fc && typeof fc.name === "string" && names.has(fc.name)) return true

  // Vercel AI SDK: { toolName: "..." }
  if (typeof obj.toolName === "string" && names.has(obj.toolName)) return true

  for (const k in obj) if (containsAnyName(obj[k], names)) return true
  return false
}

function hasAnyToolCall(value: unknown): boolean {
  if (!value || typeof value !== "object") return false
  if (Array.isArray(value)) {
    for (const item of value) if (hasAnyToolCall(item)) return true
    return false
  }
  const obj = value as Record<string, unknown>
  if (obj.type === "tool_use") return true
  if (Array.isArray(obj.tool_calls) && obj.tool_calls.length > 0) return true
  if (obj.function_call && typeof obj.function_call === "object") return true
  // Vercel AI SDK: { type: "tool-input-start" | "tool-call" | "tool-result" | ... }
  if (typeof obj.type === "string" && /^tool[-_]/.test(obj.type)) return true
  if (typeof obj.toolName === "string" && obj.toolName) return true
  for (const k in obj) if (hasAnyToolCall(obj[k])) return true
  return false
}

const cache = new WeakMap<object, unknown>()
function parseCached(data: string, key: object): unknown {
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  const parsed = tryParseJson(data) ?? null
  cache.set(key, parsed)
  return parsed
}

export function getToolNames(
  event: { data: string } & object
): string[] {
  const parsed = parseCached(event.data, event)
  if (parsed === null) return []
  const set = new Set<string>()
  collectNames(parsed, set)
  return Array.from(set)
}

export function eventMatchesTools(
  event: { data: string } & object,
  selected: Set<string>
): boolean {
  if (selected.size === 0) return true
  const parsed = parseCached(event.data, event)
  if (parsed === null) return false
  return containsAnyName(parsed, selected)
}

export function eventHasToolCall(event: { data: string } & object): boolean {
  const parsed = parseCached(event.data, event)
  if (parsed === null) return false
  return hasAnyToolCall(parsed)
}
