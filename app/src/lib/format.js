export const pct = (v, d = 1) =>
  v === null || v === undefined || Number.isNaN(Number(v)) ? '—' : `${(Number(v) * 100).toFixed(d)}%`
export const num = (v, d = 1) =>
  v === null || v === undefined ? '—' : String(Number(Number(v).toFixed(d)))
