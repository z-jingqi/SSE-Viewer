import { useEffect, useState } from "react"

export type PatchHealth = "checking" | "active" | "inactive" | "unknown"

const PROBE_EXPR = `
  (() => {
    try {
      const m = Symbol.for("sse-viewer.patched");
      return !!((window.EventSource && window.EventSource[m]) ||
                (window.fetch && window.fetch[m]));
    } catch { return false }
  })()
`

export function usePatchHealth(): [PatchHealth, () => void] {
  const [health, setHealth] = useState<PatchHealth>("checking")

  const probe = () => {
    setHealth("checking")
    try {
      chrome.devtools.inspectedWindow.eval(
        PROBE_EXPR,
        (result, isException) => {
          if (isException) {
            setHealth("unknown")
            return
          }
          setHealth(result ? "active" : "inactive")
        }
      )
    } catch {
      setHealth("unknown")
    }
  }

  useEffect(() => {
    probe()
    const onNavigated = () => {
      // Small delay so the fresh page's scripts have had a moment to run.
      setTimeout(probe, 300)
    }
    chrome.devtools.network.onNavigated.addListener(onNavigated)
    return () => {
      chrome.devtools.network.onNavigated.removeListener(onNavigated)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return [health, probe]
}
