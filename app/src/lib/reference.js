import { supabase, q } from './supabase'

// Rubric, outcomes, SDGs, mapping and settings: small tables every page needs.
export async function loadReference() {
  const [settings, criteria, outcomes, sdgs, mapping] = await Promise.all([
    q(supabase.from('settings').select('*').eq('id', 1).single()),
    q(supabase.from('criteria').select('*').order('sort')),
    q(supabase.from('outcomes').select('*').order('sort')),
    q(supabase.from('sdgs').select('*').order('id')),
    q(supabase.from('mapping').select('*')),
  ])
  const sdgById = Object.fromEntries(sdgs.map((s) => [s.id, s]))
  const maxTotal = criteria.reduce((a, c) => a + Number(c.max_marks), 0)
  return { settings, criteria, outcomes, sdgs, sdgById, mapping, maxTotal }
}
