// How many projects address each SDG.
// A finalist is the same project as its section-round team, so across rounds each
// project is counted once (following origin links back to the section round).
// A project counts as "primary" for an SDG if it was primary in any round it took part in.
export function sdgCoverage(teams, sdgs, eventId = null) {
  const byId = Object.fromEntries(teams.map((t) => [t.id, t]))
  const rootOf = (t) => {
    let r = t
    for (let i = 0; r?.origin_team_id && byId[r.origin_team_id] && i < 5; i++) r = byId[r.origin_team_id]
    return r.id
  }
  const scope = eventId ? teams.filter((t) => t.event_id === eventId) : teams
  const roles = new Map() // project -> Map(sdg -> 'primary' | 'secondary')
  for (const t of scope) {
    const key = eventId ? t.id : rootOf(t)
    if (!roles.has(key)) roles.set(key, new Map())
    const m = roles.get(key)
    if (t.primary_sdg) m.set(t.primary_sdg, 'primary')
    if (t.secondary_sdg && t.secondary_sdg !== t.primary_sdg && m.get(t.secondary_sdg) !== 'primary') m.set(t.secondary_sdg, 'secondary')
  }
  const rows = sdgs.map((g) => ({ sdg_id: g.id, name: g.name, color: g.color, primary: 0, secondary: 0 }))
  const rowById = Object.fromEntries(rows.map((r) => [r.sdg_id, r]))
  for (const m of roles.values()) for (const [sdg, role] of m) if (rowById[sdg]) rowById[sdg][role] += 1
  rows.forEach((r) => { r.total = r.primary + r.secondary })
  const projects = [...roles.values()].filter((m) => m.size > 0).length
  const addressed = rows.filter((r) => r.total > 0)
  const max = Math.max(0, ...rows.map((r) => r.total))
  return {
    rows, projects,
    addressedCount: addressed.length,
    notAddressed: rows.filter((r) => r.total === 0),
    least: addressed.length ? rows.filter((r) => r.total > 0 && r.total === Math.min(...addressed.map((x) => x.total))) : [],
    most: max > 0 ? rows.filter((r) => r.total === max) : [],
  }
}
