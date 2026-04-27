import { tryParseJson } from "./format"

// Recognize "this event represents an error" across the protocols we know:
//   - Top-level    { error: string }              (Supio V2 LlmStream)
//   - Top-level    { error: { ... } }             (OpenAI, Supio agent runtime)
//   - Type-tagged  { type: "error", ... }         (Anthropic Messages stream)
//   - Type-tagged  { type: "error-text" | "tool-input-error" | ... } (Vercel)
//   - Top-level    { errorText: string }          (Vercel error parts)
//   - Supio legacy { tool: { isError: true } }
//   - Supio V2     { complete: { success: false } }
//   - Supio legacy { completed: { success: false } }

function detectError(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const obj = value as Record<string, unknown>

  if (typeof obj.error === "string" && obj.error) return true
  if (obj.error && typeof obj.error === "object") return true

  if (typeof obj.type === "string") {
    if (obj.type === "error" || /^error[-_]/.test(obj.type)) return true
    if (/^tool[-_]input[-_]error$/.test(obj.type)) return true
  }

  if (typeof obj.errorText === "string" && obj.errorText) return true

  const tool = obj.tool as Record<string, unknown> | undefined
  if (tool && typeof tool === "object" && tool.isError === true) return true

  const completeV2 = obj.complete as Record<string, unknown> | undefined
  if (
    completeV2 &&
    typeof completeV2 === "object" &&
    completeV2.success === false
  ) {
    return true
  }

  const completedLegacy = obj.completed as Record<string, unknown> | undefined
  if (
    completedLegacy &&
    typeof completedLegacy === "object" &&
    completedLegacy.success === false
  ) {
    return true
  }

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

export function eventIsError(event: { data: string } & object): boolean {
  const parsed = parseCached(event.data, event)
  if (parsed === null) return false
  return detectError(parsed)
}
