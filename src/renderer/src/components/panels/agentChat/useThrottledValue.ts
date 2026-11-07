import { useEffect, useRef, useState } from 'react'

/**
 * `value`, following it at most once per `intervalMs` (the latest value lands
 * on the trailing edge), and not at all while `following` is false. Turned
 * back on, it catches up at once, as it does whenever `atOnce` says what is
 * shown cannot wait (nothing read yet).
 */
export function useThrottledValue<T>(
  value: T,
  intervalMs: number,
  following: boolean,
  atOnce: (shown: T) => boolean,
): T {
  const [shown, setShown] = useState(value)
  const shownAt = useRef(0)
  useEffect(() => {
    if (!following || Object.is(value, shown)) return undefined
    const show = () => {
      shownAt.current = Date.now()
      setShown(() => value)
    }
    const wait = atOnce(shown) ? 0 : shownAt.current + intervalMs - Date.now()
    if (wait <= 0) {
      show()
      return undefined
    }
    const timer = setTimeout(show, wait)
    return () => clearTimeout(timer)
  }, [value, shown, intervalMs, following, atOnce])
  return shown
}
