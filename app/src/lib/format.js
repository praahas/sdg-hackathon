export const pct = (v, d = 1) =>
  v === null || v === undefined || Number.isNaN(Number(v)) ? '—' : `${(Number(v) * 100).toFixed(d)}%`
// Human-readable kind of round.
export const roundType = (e) =>
  e?.kind === 'intra' ? 'Intra-class' : e?.semester ? 'Inter-section' : 'Department final'

export const num = (v, d = 1) =>
  v === null || v === undefined ? '—' : String(Number(Number(v).toFixed(d)))
