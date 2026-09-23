import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

export const configured = Boolean(url && key)
export const supabase = configured ? createClient(url, key) : null

// Unwraps a Supabase response and throws its error so pages can show it.
export async function q(promise) {
  const { data, error } = await promise
  if (error) throw new Error(error.message)
  return data
}
