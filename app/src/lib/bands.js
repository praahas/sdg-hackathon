// Same mark bands as the Excel rubric: Excellent 90–100%, Good 70–89%,
// Satisfactory 50–69%, Needs improvement below 50% of the criterion maximum.
export function bandsFor(max) {
  const m = Number(max)
  const u9 = Math.ceil(0.9 * m), u7 = Math.ceil(0.7 * m), u5 = Math.ceil(0.5 * m)
  return [
    { key: 'needs_improvement', label: 'Needs improvement', short: 'Needs impr.', lo: 0, hi: u5 - 1, level: 0 },
    { key: 'satisfactory', label: 'Satisfactory', short: 'Sat.', lo: u5, hi: u7 - 1, level: 1 },
    { key: 'good', label: 'Good', short: 'Good', lo: u7, hi: u9 - 1, level: 2 },
    { key: 'excellent', label: 'Excellent', short: 'Exc.', lo: u9, hi: m, level: 3 },
  ].filter((b) => b.hi >= b.lo)
}

export function bandOf(bands, score) {
  if (score === '' || score === null || score === undefined || Number.isNaN(Number(score))) return null
  let found = bands[0]
  for (const b of bands) if (Number(score) >= b.lo) found = b
  return found
}

export const rangeText = (b) => (b.lo === b.hi ? `${b.lo}` : `${b.lo}–${b.hi}`)
