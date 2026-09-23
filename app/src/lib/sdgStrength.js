// Contribution-strength scale for SDGs, same 0–3 scale as the PO/PSO mapping.
export const STRENGTHS = [
  { value: 0, label: 'None', desc: 'Claimed but not shown. The SDG label does not match what the solution actually does.' },
  { value: 1, label: 'Low', desc: 'Indirect or enabling. The solution helps something else that in turn helps the goal, such as general awareness.' },
  { value: 2, label: 'Medium', desc: 'Meaningfully supports the goal. The goal is clearly served, but the impact is described qualitatively or the target is only broadly named.' },
  { value: 3, label: 'High', desc: 'Directly advances a named SDG target (e.g. 6.1), with a measurable indicator and a working solution that plausibly moves it.' },
]
export const strengthLabel = (v) => STRENGTHS.find((s) => s.value === Number(v))?.label ?? ''
export const fmtStrength = (v) => (v === null || v === undefined ? '—' : Number(v).toFixed(2))

// Claimed SDGs of a team, primary first, without duplicates.
export const claimedSdgs = (t) =>
  [t.primary_sdg, t.secondary_sdg].filter((v, i, a) => v && a.indexOf(v) === i)
