// Build a searchable string for an event payload.
//
// SSE payloads frequently carry JSON with non-ASCII characters escaped as
// `\uXXXX` sequences (e.g. Python's json.dumps default). A user who types
// the actual character "你" would never match the literal string `\u4f60`.
// To make search work intuitively, we include both the raw payload AND
// a normalized JSON re-serialization (which decodes the escapes) in the
// searchable text.

const cache = new WeakMap<object, string>()

export function getSearchableText(event: { data: string } & object): string {
  const hit = cache.get(event)
  if (hit !== undefined) return hit

  const raw = event.data
  let combined = raw
  try {
    const parsed = JSON.parse(raw)
    const normalized = JSON.stringify(parsed)
    if (normalized !== raw) combined = raw + "\n" + normalized
  } catch {
    // not JSON; raw is fine
  }
  cache.set(event, combined)
  return combined
}
