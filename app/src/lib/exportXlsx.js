import * as XLSX from 'xlsx'

const r3 = (v) => (v === null || v === undefined ? '' : Math.round(Number(v) * 1000) / 1000)
const p1 = (v) => (v === null || v === undefined ? '' : Math.round(Number(v) * 1000) / 10)

// Everything an accreditation file needs, one sheet per table.
export function exportWorkbook({ ref, events, evOut, overall, results, teamOut, teamCrit, sdgEvent, sdgOverall, evSdg, allSdg, teamSdg, rawScores, rawRatings, teams, profiles }) {
  const wb = XLSX.utils.book_new()
  const evName = (id) => events.find((e) => e.id === id)?.name ?? ''
  const s = ref.settings
  const add = (name, rows) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{ Note: 'No data yet' }]), name)

  add('About', [
    { Item: 'Hackathon', Value: s.title }, { Item: 'Institution', Value: s.institution },
    { Item: 'Department', Value: s.department }, { Item: 'Academic year', Value: s.academic_year },
    { Item: 'Target per team (%)', Value: p1(s.target) },
    { Item: 'Level 3 when % of teams at target ≥', Value: p1(s.level3) },
    { Item: 'Level 2 when % of teams at target ≥', Value: p1(s.level2) },
    { Item: 'Level 1 when % of teams at target ≥', Value: p1(s.level1) },
    { Item: 'SDG contribution counted as reached at strength ≥', Value: s.sdg_strength_target },
    { Item: 'PO/PSO method', Value: 'Team attainment = Σ(criterion % × correlation) ÷ Σ correlation; level from % of teams at or above target.' },
    { Item: 'SDG method', Value: 'Evaluators rate each claimed SDG 0–3 (None, Low, Medium, High). Solution strength = average across evaluators; goal attainment = average over solutions addressing the goal.' },
    { Item: 'Exported', Value: new Date().toLocaleString() },
  ])

  const outRows = (rows, extra = {}) => ref.outcomes.map((o) => {
    const x = rows.find((r) => r.outcome_code === o.code) || {}
    return { ...extra, Outcome: o.code, Description: o.name, 'Teams': x.n_teams ?? 0,
      'Average attainment (%)': p1(x.avg_attainment), '% teams at target': p1(x.pct_at_target), Level: x.level ?? '' }
  })
  add('Overall attainment', outRows(overall))
  add('Attainment by round', events.flatMap((e) => outRows(evOut.filter((r) => r.event_id === e.id), { Round: e.name })))

  const levelMatrix = events.map((e) => ({ Round: e.name, ...Object.fromEntries(ref.outcomes.map((o) => [o.code, evOut.find((r) => r.event_id === e.id && r.outcome_code === o.code)?.level ?? ''])) }))
  levelMatrix.push({ Round: 'Overall', ...Object.fromEntries(ref.outcomes.map((o) => [o.code, overall.find((r) => r.outcome_code === o.code)?.level ?? ''])) })
  add('Level matrix', levelMatrix)

  add('Team results', [...results].sort((a, b) => (events.find((e) => e.id === a.event_id)?.sort ?? 0) - (events.find((e) => e.id === b.event_id)?.sort ?? 0) || (a.rank ?? 999) - (b.rank ?? 999)).map((r) => {
    const t = teams.find((x) => x.id === r.team_id) || {}
    const row = { Round: evName(r.event_id), 'Team ID': r.team_code, Team: r.team_name, Members: t.members ?? '',
      Registration: t.owner_id ? 'Self-registered' : 'Added by admin', 'Contact email': t.contact_email ?? '', 'Contact phone': t.contact_phone ?? '',
      'SDG targets': t.sdg_targets ?? '',
      'Primary SDG': r.primary_sdg ?? '', 'Secondary SDG': r.secondary_sdg ?? '', 'Problem statement': t.problem ?? '' }
    ref.criteria.forEach((c) => { row[`${c.short_name} (/${Number(c.max_marks)})`] = r3(teamCrit.find((x) => x.team_id === r.team_id && x.criterion_id === c.id)?.avg_score) })
    Object.assign(row, { [`Total (/${ref.maxTotal})`]: r3(r.total), 'Score %': p1(r.pct), Rank: r.rank ?? '', Status: r.status ?? '' })
    const st = (id) => r3(teamSdg.find((x) => x.team_id === r.team_id && x.sdg_id === id)?.avg_strength)
    row['Primary SDG strength (0–3)'] = r.primary_sdg ? st(r.primary_sdg) : ''
    row['Secondary SDG strength (0–3)'] = r.secondary_sdg && r.secondary_sdg !== r.primary_sdg ? st(r.secondary_sdg) : ''
    ref.outcomes.forEach((o) => { row[`${o.code} %`] = p1(teamOut.find((x) => x.team_id === r.team_id && x.outcome_code === o.code)?.attainment) })
    return row
  }))

  const sdgRow = (g, extra = {}) => ({ ...extra, SDG: `SDG ${g.sdg_id}`, Goal: g.name, Solutions: g.solutions, Rated: g.rated,
    'Avg strength (0–3)': r3(g.avg_strength), [`% rated ≥ ${s.sdg_strength_target}`]: p1(g.pct_at_target) })
  const sumRow = (x, label) => ({ Scope: label, Solutions: x?.solutions ?? 0, Rated: x?.rated ?? 0,
    'Avg strength (0–3)': r3(x?.avg_strength), [`% rated ≥ ${s.sdg_strength_target}`]: p1(x?.pct_at_target) })
  add('SDG attainment', [...events.map((e) => sumRow(evSdg.find((x) => x.event_id === e.id), e.name)), sumRow(allSdg[0], 'All rounds')])
  add('SDG by goal', sdgOverall.map((g) => sdgRow(g)))
  add('SDG by goal and round', events.flatMap((e) => sdgEvent.filter((g) => g.event_id === e.id && g.solutions > 0).map((g) => sdgRow(g, { Round: e.name }))))

  const who = (id) => { const p = profiles.find((x) => x.id === id); return p ? (p.full_name || p.email) : id }
  add('Raw scores', rawScores.map((sc) => {
    const t = teams.find((x) => x.id === sc.team_id) || {}
    return { Round: evName(t.event_id), 'Team ID': t.team_code, Team: t.name, Evaluator: who(sc.evaluator_id),
      Criterion: ref.criteria.find((c) => c.id === sc.criterion_id)?.short_name, Score: Number(sc.score), 'Saved at': sc.updated_at }
  }))

  add('Raw SDG ratings', rawRatings.map((r) => {
    const t = teams.find((x) => x.id === r.team_id) || {}
    return { Round: evName(t.event_id), 'Team ID': t.team_code, Team: t.name, Evaluator: who(r.evaluator_id),
      SDG: `SDG ${r.sdg_id}`, Claim: r.sdg_id === t.primary_sdg ? 'Primary' : 'Secondary', 'Strength (0–3)': r.strength, 'Saved at': r.updated_at }
  }))

  XLSX.writeFile(wb, `${(s.title || 'SDG Hackathon').replace(/[^\w-]+/g, '_')}_results.xlsx`)
}
