import React, { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, PolarAngleAxis, PolarGrid, PolarRadiusAxis,
  Radar, RadarChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { supabase, q } from '../../lib/supabase'
import { useLoad } from '../../lib/useLoad'
import { loadReference } from '../../lib/reference'
import { num, pct } from '../../lib/format'
import { ErrorBox, LevelChip, Loading, SdgChip } from '../../components/ui'
import { fmtStrength, strengthLabel } from '../../lib/sdgStrength'

const INK = '#16323F', TEAL = '#0F7A6E', SAND = '#C89B3C'
const ROUND_COLORS = ['#0F7A6E', '#3E8FB0', '#16323F', '#C89B3C', '#B5563A', '#6E5A9E']
const LEVEL_COLORS = ['#B3432F', '#C7852A', '#6E9A3A', '#1E7A5F']
const pctTick = (v) => `${Math.round(v * 100)}%`
const tipPct = (v) => (typeof v === 'number' ? pct(v) : v)

async function fetchAll() {
  const [ref, events, evOut, overall, results, teamOut, teamCrit, sdgEvent, sdgOverall, evSdg, allSdg, teamSdg, pendingEvals] = await Promise.all([
    loadReference(),
    q(supabase.from('events').select('*').order('sort')),
    q(supabase.from('v_event_outcome').select('*')),
    q(supabase.from('v_overall_outcome').select('*')),
    q(supabase.from('v_team_result').select('*')),
    q(supabase.from('v_team_outcome').select('*')),
    q(supabase.from('v_team_criterion').select('team_id, criterion_id, avg_score')),
    q(supabase.from('v_sdg_goal_event').select('*').order('sdg_id')),
    q(supabase.from('v_sdg_goal_overall').select('*').order('sdg_id')),
    q(supabase.from('v_event_sdg').select('*')),
    q(supabase.from('v_overall_sdg').select('*')),
    q(supabase.from('v_team_sdg_strength').select('*')),
    q(supabase.from('profiles').select('id').eq('role', 'pending')),
  ])
  return { ref, events, evOut, overall, results, teamOut, teamCrit, sdgEvent, sdgOverall, evSdg, allSdg, teamSdg, pendingEvals }
}

export default function Dashboard() {
  const { data, error, loading, reload } = useLoad(fetchAll, [])
  const [sel, setSel] = useState('all')
  const [exporting, setExporting] = useState(false)
  const [exportErr, setExportErr] = useState(null)
  const [reportNote, setReportNote] = useState(null)
  const [building, setBuilding] = useState(false)

  const view = useMemo(() => {
    if (!data) return null
    const { ref, events, evOut, overall, results, sdgEvent, sdgOverall } = data
    const eid = sel === 'all' ? null : Number(sel)
    const summary = eid ? evOut.filter((r) => r.event_id === eid) : overall
    const outcomeRows = ref.outcomes.map((o) => ({ ...o, ...(summary.find((r) => r.outcome_code === o.code) || {}) }))
    const teamRows = results
      .filter((r) => (eid ? r.event_id === eid : true) && r.total !== null)
      .sort((a, b) => (events.find((e) => e.id === a.event_id).sort - events.find((e) => e.id === b.event_id).sort) || a.rank - b.rank)
    const goals = eid ? sdgEvent.filter((g) => g.event_id === eid) : sdgOverall
    const sdgSummary = (eid ? data.evSdg.find((r) => r.event_id === eid) : data.allSdg[0]) || {}
    const radar = ref.outcomes.map((o) => {
      const row = { code: o.code }
      events.forEach((e) => { const x = evOut.find((r) => r.event_id === e.id && r.outcome_code === o.code); row[e.code] = x ? Number(x.avg_attainment) : null })
      return row
    })
    const scoredEvents = events.filter((e) => evOut.some((r) => r.event_id === e.id && r.n_teams > 0))
    return { eid, outcomeRows, teamRows, goals, radar, scoredEvents, sdgSummary }
  }, [data, sel])

  if (loading && !data) return <Loading label="Calculating attainment…" />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  const { ref, events, evOut, teamOut, teamCrit, evSdg, teamSdg } = data
  const { eid, outcomeRows, teamRows, goals, radar, scoredEvents, sdgSummary } = view
  const s = ref.settings
  const evName = (id) => events.find((e) => e.id === id)?.name
  const nTeams = teamRows.length

  async function doExport() {
    setExporting(true); setExportErr(null)
    try {
      const [rawScores, rawRatings, teams, profiles] = await Promise.all([
        q(supabase.from('scores').select('*')),
        q(supabase.from('sdg_ratings').select('*')),
        q(supabase.from('teams').select('*')),
        q(supabase.from('profiles').select('id, full_name, email')),
      ])
      const { exportWorkbook } = await import('../../lib/exportXlsx')
      exportWorkbook({ ...data, rawScores, rawRatings, teams, profiles })
    } catch (e) { setExportErr(e.message) } finally { setExporting(false) }
  }

  async function doWorkbook() {
    setBuilding(true); setExportErr(null); setReportNote(null)
    try {
      const { downloadWorkbookReport } = await import('../../lib/workbookReport')
      const warnings = await downloadWorkbookReport()
      setReportNote(warnings)
    } catch (e) { setExportErr(e.message) } finally { setBuilding(false) }
  }

  const chartData = outcomeRows.map((o) => ({ code: o.code, avg: o.avg_attainment == null ? null : Number(o.avg_attainment), at: o.pct_at_target == null ? null : Number(o.pct_at_target), level: o.level }))

  return (
    <>
      <div className="page-head dash-head">
        <div>
          <h1>{s.title}</h1>
          <p className="lede">{s.institution}, Department of {s.department}, {s.academic_year}. PO/PSO target {pct(s.target, 0)} per team; Level 3 at {pct(s.level3, 0)} of teams, Level 2 at {pct(s.level2, 0)}, Level 1 at {pct(s.level1, 0)}. SDG contribution counts as reached at {strengthLabel(s.sdg_strength_target)} ({s.sdg_strength_target}) or stronger.</p>
        </div>
        <div className="dash-tools">
          <label>Show
            <select value={sel} onChange={(e) => setSel(e.target.value)}>
              <option value="all">All rounds together</option>
              {events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </label>
          <button className="btn" onClick={reload}>Refresh</button>
          <button className="btn" onClick={doExport} disabled={exporting} title="Plain tables of every result and raw mark">{exporting ? 'Preparing…' : 'Download data export'}</button>
          <button className="btn btn-primary" onClick={doWorkbook} disabled={building} title="The department's formatted evaluation workbook, filled in, with all sheets and charts">{building ? 'Building workbook…' : 'Download formatted workbook'}</button>
        </div>
      </div>
      {data.pendingEvals?.length > 0 && (
        <div className="alert alert-warn" role="status">
          <span><b>{data.pendingEvals.length} evaluator account{data.pendingEvals.length === 1 ? ' is' : 's are'} waiting for approval.</b> They can't score until you approve them.</span>
          <Link className="btn btn-small" to="/admin/people">Review</Link>
        </div>
      )}
      {exportErr && <ErrorBox error={exportErr} />}
      {reportNote && (
        <div className={`alert ${reportNote.length ? 'alert-warn' : 'alert-ok'}`} role="status">
          <div>
            <b>Formatted workbook downloaded.</b> Open it in Excel (or LibreOffice / Google Sheets); totals, attainment and charts calculate when it opens.
            {reportNote.length > 0 && <ul className="warn-list">{reportNote.map((w) => <li key={w}>{w}</li>)}</ul>}
          </div>
        </div>
      )}

      {nTeams === 0 ? (
        <div className="empty">
          <h2>No marks yet{eid ? ' in this round' : ''}</h2>
          <p>Attainment appears here as soon as evaluators save their first marks. Set up teams and evaluators under Rounds and teams.</p>
        </div>
      ) : (
        <>
          <section className="panel">
            <h2>PO and PSO attainment <span className="muted">{eid ? evName(eid) : 'all rounds'}, {nTeams} teams scored</span></h2>
            <div className="dash-grid">
              <table className="table outcome-table">
                <thead><tr><th>Outcome</th><th className="r">Average</th><th className="r">Teams at target</th><th className="c">Level</th></tr></thead>
                <tbody>
                  {outcomeRows.map((o) => (
                    <tr key={o.code} title={o.name}>
                      <td><b>{o.code}</b> <span className="muted clip">{o.name}</span></td>
                      <td className="r">{o.n_teams ? pct(o.avg_attainment) : <span className="muted">Not mapped</span>}</td>
                      <td className="r">{o.n_teams ? pct(o.pct_at_target) : ''}</td>
                      <td className="c"><LevelChip level={o.level} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="charts">
                <figure>
                  <figcaption>Average attainment and share of teams at target</figcaption>
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={chartData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                      <CartesianGrid vertical={false} stroke="#E1E7E5" />
                      <XAxis dataKey="code" tick={{ fontSize: 11 }} interval={0} />
                      <YAxis domain={[0, 1]} tickFormatter={pctTick} tick={{ fontSize: 11 }} />
                      <Tooltip formatter={tipPct} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar isAnimationActive={false} dataKey="avg" name="Average attainment" fill={TEAL} radius={[2, 2, 0, 0]} />
                      <Bar isAnimationActive={false} dataKey="at" name="Teams at target" fill={SAND} radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </figure>
                <figure>
                  <figcaption>Attainment level</figcaption>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={chartData} margin={{ top: 16, right: 8, left: -24, bottom: 0 }}>
                      <CartesianGrid vertical={false} stroke="#E1E7E5" />
                      <XAxis dataKey="code" tick={{ fontSize: 11 }} interval={0} />
                      <YAxis domain={[0, 3]} ticks={[0, 1, 2, 3]} tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar isAnimationActive={false} dataKey="level" name="Level" label={{ position: 'top', fontSize: 11 }}>
                        {chartData.map((d) => <Cell key={d.code} fill={d.level == null ? '#ccc' : LEVEL_COLORS[d.level]} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </figure>
              </div>
            </div>
          </section>

          {!eid && scoredEvents.length > 0 && (
            <section className="panel">
              <h2>Rounds compared</h2>
              <div className="dash-stack">
                <div className="scroll">
                  <table className="table level-matrix">
                    <thead><tr><th>Round</th>{ref.outcomes.map((o) => <th key={o.code} className="c">{o.code}</th>)}<th className="c" title="Average SDG contribution strength, 0 to 3">SDG strength</th></tr></thead>
                    <tbody>
                      {scoredEvents.map((e) => (
                        <tr key={e.id}>
                          <td>{e.name}</td>
                          {ref.outcomes.map((o) => <td key={o.code} className="c"><LevelChip level={evOut.find((r) => r.event_id === e.id && r.outcome_code === o.code)?.level} /></td>)}
                          <td className="c"><b>{fmtStrength(evSdg.find((r) => r.event_id === e.id)?.avg_strength)}</b></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <figure>
                  <figcaption>Average attainment by round</figcaption>
                  <ResponsiveContainer width="100%" height={320}>
                    <RadarChart data={radar} outerRadius="72%">
                      <PolarGrid stroke="#D5DDDB" />
                      <PolarAngleAxis dataKey="code" tick={{ fontSize: 11, fill: INK }} />
                      <PolarRadiusAxis domain={[0, 1]} tickFormatter={pctTick} tick={{ fontSize: 9 }} angle={90} />
                      {scoredEvents.map((e) => (
                        <Radar isAnimationActive={false} key={e.id} name={e.name} dataKey={e.code} stroke={ROUND_COLORS[events.indexOf(e) % 6]} fill={ROUND_COLORS[events.indexOf(e) % 6]} fillOpacity={0.06} />
                      ))}
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Tooltip formatter={tipPct} />
                    </RadarChart>
                  </ResponsiveContainer>
                </figure>
              </div>
            </section>
          )}

          <section className="panel">
            <h2>Teams</h2>
            {eid && (
              <figure>
                <figcaption>Total score out of {ref.maxTotal}</figcaption>
                <ResponsiveContainer width="100%" height={Math.max(160, nTeams * 26)}>
                  <BarChart data={teamRows.map((r) => ({ name: r.team_name, total: Number(r.total), status: r.status }))} layout="vertical" margin={{ left: 24, right: 32 }}>
                    <CartesianGrid horizontal={false} stroke="#E1E7E5" />
                    <XAxis type="number" domain={[0, ref.maxTotal]} tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v) => num(v)} />
                    <Bar isAnimationActive={false} dataKey="total" name="Total" label={{ position: 'right', fontSize: 11, formatter: (v) => num(v) }}>
                      {teamRows.map((r) => <Cell key={r.team_id} fill={r.status === 'Shortlisted' ? TEAL : '#9DB3B0'} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </figure>
            )}
            <div className="scroll">
              <table className="table">
                <thead>
                  <tr>
                    {!eid && <th>Round</th>}<th className="r">Rank</th><th>Team</th><th title="Claimed SDGs with average contribution strength (0 to 3)">SDG strength</th>
                    {eid && ref.criteria.map((c) => <th key={c.id} className="r" title={c.name}>{c.short_name}<small>/{num(c.max_marks)}</small></th>)}
                    <th className="r">Total</th><th className="r">%</th><th>Status</th>
                    {eid && ref.outcomes.map((o) => <th key={o.code} className="r">{o.code}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {teamRows.map((r) => (
                    <tr key={r.team_id}>
                      {!eid && <td>{evName(r.event_id)}</td>}
                      <td className="r">{r.rank}</td>
                      <td className="nowrap"><b>{r.team_code}</b> {r.team_name}</td>
                      <td className="nowrap">
                        {[r.primary_sdg, r.secondary_sdg].filter((v, i, a) => v && a.indexOf(v) === i).map((id) => {
                          const st = teamSdg.find((x) => x.team_id === r.team_id && x.sdg_id === id)?.avg_strength
                          return <span key={id} className="sdg-with-strength"><SdgChip sdg={ref.sdgById[id]} compact /><small title="Average contribution strength, 0 to 3">{fmtStrength(st)}</small></span>
                        })}
                      </td>
                      {eid && ref.criteria.map((c) => <td key={c.id} className="r">{num(teamCrit.find((x) => x.team_id === r.team_id && x.criterion_id === c.id)?.avg_score)}</td>)}
                      <td className="r"><b>{num(r.total)}</b></td>
                      <td className="r">{pct(r.pct)}</td>
                      <td>{r.status === 'Shortlisted' ? <span className="tag tag-open">Shortlisted</span> : <span className="muted">{r.status}</span>}</td>
                      {eid && ref.outcomes.map((o) => <td key={o.code} className="r">{pct(teamOut.find((x) => x.team_id === r.team_id && x.outcome_code === o.code)?.attainment, 0)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel">
            <h2>SDG attainment <span className="muted">from evaluators' contribution-strength ratings</span></h2>
            <div className="sdg-summary">
              <div className="big-stat">
                <b>{fmtStrength(sdgSummary.avg_strength)}</b><span>/ 3</span>
                <small>{sdgSummary.avg_strength != null ? `Average strength, about ${strengthLabel(Math.round(sdgSummary.avg_strength))}` : 'No SDG ratings yet'}</small>
              </div>
              <div className="big-stat">
                <b>{pct(sdgSummary.pct_at_target, 0)}</b>
                <small>of rated solutions at {strengthLabel(s.sdg_strength_target)} ({s.sdg_strength_target}) or stronger</small>
              </div>
              <div className="big-stat">
                <b>{sdgSummary.rated ?? 0}</b><span>/ {sdgSummary.solutions ?? 0}</span>
                <small>team–SDG pairs rated</small>
              </div>
            </div>
            <div className="dash-grid even">
              <div className="scroll">
                <table className="table">
                  <thead><tr><th>Goal</th><th className="r">Solutions</th><th className="r">Avg strength</th><th className="r" title={`Share of rated solutions at ${strengthLabel(s.sdg_strength_target)} (${s.sdg_strength_target}) or stronger`}>At target</th></tr></thead>
                  <tbody>
                    {goals.filter((g) => g.solutions > 0).map((g) => (
                      <tr key={g.sdg_id}>
                        <td><SdgChip sdg={ref.sdgById[g.sdg_id]} /></td>
                        <td className="r">{g.solutions}{g.rated < g.solutions && <small className="muted"> ({g.rated} rated)</small>}</td>
                        <td className="r"><b>{fmtStrength(g.avg_strength)}</b></td>
                        <td className="r">{pct(g.pct_at_target, 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <figure>
                <figcaption>Average contribution strength by goal (0 None, 1 Low, 2 Medium, 3 High)</figcaption>
                <ResponsiveContainer width="100%" height={Math.max(180, goals.filter((g) => g.solutions > 0).length * 34 + 40)}>
                  <BarChart data={goals.filter((g) => g.solutions > 0).map((g) => ({ goal: `SDG ${g.sdg_id}`, strength: g.avg_strength == null ? null : Number(g.avg_strength), name: g.name, solutions: g.solutions }))}
                    layout="vertical" margin={{ left: 0, right: 36 }}>
                    <CartesianGrid horizontal={false} stroke="#E1E7E5" />
                    <XAxis type="number" domain={[0, 3]} ticks={[0, 1, 2, 3]} tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="goal" width={62} tick={{ fontSize: 11 }} interval={0} />
                    <Tooltip formatter={(v) => fmtStrength(v)} labelFormatter={(l, p) => (p?.[0] ? `${l}: ${p[0].payload.name} (${p[0].payload.solutions} solutions)` : l)} />
                    <Bar isAnimationActive={false} dataKey="strength" name="Average strength" label={{ position: 'right', fontSize: 11, formatter: (v) => fmtStrength(v) }}>
                      {goals.filter((g) => g.solutions > 0).map((g) => <Cell key={g.sdg_id} fill={g.color} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </figure>
            </div>
            <p className="muted small">Each evaluator rates how strongly a solution advances each SDG the team claims: 3 High, 2 Medium, 1 Low, 0 None. A solution's strength is the average across evaluators; a goal's attainment is the average over all solutions addressing it. These ratings do not change team totals or ranks.</p>
          </section>
        </>
      )}
    </>
  )
}
