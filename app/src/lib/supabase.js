import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

export const configured = Boolean(url && key)
export const supabase = configured ? createClient(url, key) : null

// Reads every row of a query, page by page. Supabase returns at most 1,000 rows per
// request (the project's "Max rows" setting), so anything that can grow past that
// (marks, ratings, per-team results) must be read this way or rows are silently lost.
// `make` returns a fresh query with a stable .order(); pages continue until one comes
// back empty, so this also works if the project's row limit is set lower than 1,000.
export async function qAll(make, pageSize = 1000) {
  const out = []
  for (let from = 0; ; ) {
    const { data, error } = await make().range(from, from + pageSize - 1)
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) return out
    out.push(...data)
    from += data.length
  }
}

// Unwraps a Supabase response and throws its error so pages can show it.
export async function q(promise) {
  const { data, error } = await promise
  if (error) throw new Error(error.message)
  return data
}
