import { useCallback, useEffect, useState } from 'react'

export function useLoad(fn, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fn, deps)
  const reload = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }))
    try {
      const data = await run()
      setState({ data, error: null, loading: false })
    } catch (e) {
      setState({ data: null, error: e.message || String(e), loading: false })
    }
  }, [run])
  useEffect(() => { reload() }, [reload])
  return { ...state, reload }
}
