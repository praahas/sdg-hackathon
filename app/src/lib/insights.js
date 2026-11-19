// Rule-based findings and recommendations for the next hackathon.
// Input: the object returned by the insight_data() database function. Every number here
// comes from the database; these rules only decide what is worth acting on and say why.

const PRIORITY = { High: 0, Medium: 1, Low: 2 }
const pct = (x) => `${Math.round(x * 100)}%`
const n1 = (x) => (Math.round(x * 100) / 100).toFixed(2)

// Feedback rating questions → area and what to do when it rates low.
const RATING_AREAS = [
  { match: /overall/i, area: 'Overall experience', fix: null },
  { match: /problem statement/i, area: 'Problem statements', fix: 'Write each problem statement around a real user, a constraint and an expected deliverable; map it to specific SDG targets; and brief teams when the statements are released.' },
  { match: /mentor|guidance|support/i, area: 'Mentoring', fix: 'Assign a named mentor to every team before the event, schedule at least two check-ins (idea stage and prototype stage), and publish when mentors are available.' },
  { match: /evaluat|fair|criteria|rubric|judg/i, area: 'Evaluation', fix: 'Share the rubric when problem statements are released, brief all evaluators together before scoring, and give every team a few lines of written feedback.' },
  { match: /sdg|sustainab/i, area: 'SDG awareness', fix: 'Open with a short session on the SDGs and their targets, and ask each team to name the target their solution addresses and how its impact would be measured.' },
  { match: /teamwork|communication skills|presentation/i, area: 'Teamwork & presentation', fix: 'Add a pitching workshop and a mock-presentation slot with feedback before the final round.' },
  { match: /technical|tools|build|working solution|learn/i, area: 'Technical learning', fix: 'Run a hands-on prototyping workshop before the event and give teams starter templates or kits.' },
  { match: /organi[sz]|schedule|venue|communicat/i, area: 'Organisation', fix: 'Publish the schedule, venue and round timeline at least a week ahead, use one official channel for updates, and keep a single point of contact on the day.' },
]

// Comment themes, found by keywords. Order matters only for display.
export const THEMES = [
  { key: 'mentoring', area: 'Mentoring', label: 'Mentoring and guidance', re: /\bmentor|\bguid(e|ance)|faculty (help|support)|\bhelp(ed|ful)?\b|\bsupport/i,
    fix: 'Give every team a named mentor and fixed check-in slots.' },
  { key: 'time', label: 'Time and schedule', re: /\btime\b|timing|schedule|duration|deadline|\blate\b|hours?\b|rushed|prototyp/i,
    fix: 'Review the timeline: allow more build time, avoid clashes with tests, and publish the schedule early.' },
  { key: 'facilities', label: 'Venue and facilities', re: /venue|\broom|seating|\bfan\b|\bac\b|power|socket|facilit|space/i,
    fix: 'Check the venue beforehand: seating, power points, ventilation and space for each team.' },
  { key: 'internet', label: 'Internet and equipment', re: /wi-?fi|internet|network|bandwidth|system|computer|laptop|hardware|equipment|projector/i,
    fix: 'Test Wi-Fi and equipment at full load before the event and keep a backup (hotspots, spare machines).' },
  { key: 'food', label: 'Food and refreshments', re: /food|lunch|snack|refreshment|\bwater\b|\btea\b|coffee/i,
    fix: 'Plan refreshments for long sessions and drinking water at the venue.' },
  { key: 'evaluation', area: 'Evaluation', label: 'Evaluation and rubric', re: /evaluat|judg|rubric|criteria|\bmarks?\b|fair|scor|jury|feedback from/i,
    fix: 'Share the rubric early, calibrate evaluators, and return short written feedback to teams.' },
  { key: 'problems', area: 'Problem statements', label: 'Problem statements and SDGs', re: /problem statement|\bsdg|topic|theme|domain|real[- ]world/i,
    fix: 'Refresh the problem statements with clearer scope and real stakeholders, spread across more SDGs.' },
  { key: 'communication', label: 'Information and communication', re: /inform|communicat|announce|update|whatsapp|notice|clarity|clear instruction|instruction|confus/i,
    fix: 'Use one official channel, send a briefing document, and confirm key details a day ahead.' },
  { key: 'learning', label: 'Learning and experience', re: /learn|skill|experience|exposure|team ?work|knowledge|enjoy|\bfun\b|interesting|useful/i,
    fix: null },
  { key: 'recognition', label: 'Prizes and recognition', re: /prize|certificate|reward|recogni|award/i,
    fix: 'Announce prizes and recognition up front and hand them out promptly.' },
]

// PO/PSO name → what tends to build it in a hackathon.
const OUTCOME_HINTS = [
  { re: /knowledge/i, hint: 'expect teams to justify the core concepts behind their solution, and probe this in the Q&A' },
  { re: /analysis/i, hint: 'add an idea-stage review where teams present their problem analysis and evidence' },
  { re: /design|development of solutions/i, hint: 'ask for a design document or architecture sketch at the mid-point check-in' },
  { re: /investigation|research/i, hint: 'require a short validation step (user interviews, data or testing) before the final pitch' },
  { re: /tool/i, hint: 'run a tools workshop and reward appropriate use of modern tools in the rubric' },
  { re: /society|world|engineer and/i, hint: 'ask teams to describe who benefits and any risks to society' },
  { re: /environment|sustainab/i, hint: 'make the SDG-impact explanation a required part of the pitch' },
  { re: /ethic/i, hint: 'add an ethics and data-privacy check to the rubric and the mentor checklist' },
  { re: /team/i, hint: 'ask each member to present part of the solution and record roles' },
  { re: /communication/i, hint: 'add a pitching workshop and a time-boxed presentation format' },
  { re: /management|finance/i, hint: 'ask teams for a simple plan with milestones and a cost estimate' },
  { re: /life-?long|learning/i, hint: 'ask teams to reflect on what they learned and what they would do next' },
]

// Rubric criterion name → targeted support.
const CRITERION_HINTS = [
  { re: /problem|identif/i, hint: 'a problem-framing session with examples of well-scoped problems' },
  { re: /innov|creativ|novel|idea/i, hint: 'an ideation workshop and examples of creative solutions from past events' },
  { re: /design|architect/i, hint: 'a design review at the mid-point check-in' },
  { re: /implement|prototype|technical|working|demo/i, hint: 'a hands-on prototyping workshop and a mid-event demo check' },
  { re: /present|pitch|communicat/i, hint: 'a pitching workshop and a mock presentation with feedback' },
  { re: /sdg|impact|sustain/i, hint: 'an SDG-impact briefing and a required impact statement in the pitch' },
  { re: /feasib|viab|scal/i, hint: 'guidance on feasibility, cost and scale-up in the mentor sessions' },
]
const hintFor = (list, name) => list.find((h) => h.re.test(name))?.hint

// Classify free-text comments into themes (a comment may touch several).
export function themeComments(comments, questions) {
  const promptOf = Object.fromEntries(questions.map((qn) => [qn.id, qn.prompt]))
  const side = (qid) => {
    const p = promptOf[qid] || ''
    if (/improve|better|change|suggest|didn.t|dislike|problem/i.test(p)) return 'improve'
    if (/like|best|enjoy|good|liked/i.test(p)) return 'like'
    return 'other'
  }
  const rows = THEMES.map((t) => ({ ...t, improve: 0, like: 0, other: 0, quotes: [], q: { improve: [], like: [], other: [] } }))
  const sides = { improve: 0, like: 0, other: 0 }
  const unmatched = []
  let total = 0
  for (const c of comments) {
    const text = String(c.text || '').trim()
    if (!text) continue
    total++
    const s = side(c.qid)
    sides[s]++
    let hit = false
    for (const r of rows) {
      if (r.re.test(text)) {
        hit = true; r[s]++
        if (text.length <= 220) {
          if (r.quotes.length < 3 && !r.quotes.includes(text)) r.quotes.push(text)
          if (r.q[s].length < 2 && !r.q[s].includes(text)) r.q[s].push(text)
        }
      }
    }
    if (!hit) unmatched.push(text)
  }
  return {
    total, sides,
    themes: rows.filter((r) => r.improve + r.like + r.other > 0)
      .sort((a, b) => (b.improve + b.like + b.other) - (a.improve + a.like + a.other)),
    unmatched,
  }
}

export function buildFindings(d) {
  const recs = []
  const strengths = []
  const notes = []
  const add = (priority, area, title, detail, evidence) => recs.push({ priority, area, title, detail, evidence })
  const s = d.settings || {}
  const fb = d.feedback || { questions: [], comments: [], responses: 0, members: 0 }
  const ratings = fb.questions.filter((qn) => qn.kind === 'rating' && qn.n > 0 && qn.avg != null)

  // 1. Feedback ratings
  for (const qn of ratings) {
    const a = RATING_AREAS.find((x) => x.match.test(qn.prompt)) || { area: 'Event', fix: null }
    const low = (qn.dist[0] + qn.dist[1]) / qn.n
    const high = (qn.dist[3] + qn.dist[4]) / qn.n
    const ev = `"${qn.prompt}" averaged ${n1(qn.avg)}/5 from ${qn.n} responses; ${pct(low)} rated it Poor or Fair.`
    if (a.fix && (qn.avg < 3 || low >= 0.4)) add('High', a.area, `Improve ${a.area.toLowerCase()}`, a.fix, [ev])
    else if (a.fix && (qn.avg < 3.5 || low >= 0.25)) add('Medium', a.area, `Improve ${a.area.toLowerCase()}`, a.fix, [ev])
    else if (qn.avg >= 4.2 && qn.n >= 5) strengths.push({ area: a.area, title: `${a.area} was rated highly`, evidence: [`"${qn.prompt}" averaged ${n1(qn.avg)}/5; ${pct(high)} rated it Very good or Excellent.`] })
  }
  const overall = ratings.find((qn) => /overall/i.test(qn.prompt))

  // 2. Would they come back?
  for (const qn of fb.questions.filter((x) => x.kind === 'choice' && x.options && x.n > 0)) {
    const no = Object.entries(qn.options).find(([k]) => /^no$/i.test(k))?.[1] ?? 0
    const yes = Object.entries(qn.options).find(([k]) => /^yes$/i.test(k))?.[1] ?? 0
    if (/again|similar|recommend|participate|take part/i.test(qn.prompt)) {
      if (no / qn.n >= 0.25) {
        const worst = [...ratings].filter((r) => !/overall/i.test(r.prompt)).sort((a, b) => a.avg - b.avg).slice(0, 2)
        add('High', 'Overall experience', 'Find out why some students would not return',
          `Address the lowest-rated areas first${worst.length ? ` (${worst.map((w) => `${w.prompt.replace(/\s*\(.*\)$/, '')}: ${n1(w.avg)}/5`).join('; ')})` : ''}, and ask a few of these students in person what would change their mind.`,
          [`${pct(no / qn.n)} answered "No" to "${qn.prompt}" (${no} of ${qn.n}).`])
      } else if (yes / qn.n >= 0.75) {
        strengths.push({ area: 'Overall experience', title: 'Most students would take part again', evidence: [`${pct(yes / qn.n)} answered "Yes" to "${qn.prompt}".`] })
      }
    }
  }

  // 3. Response rate
  if (fb.members > 0) {
    const rate = fb.responses / fb.members
    if (fb.responses === 0) notes.push('No feedback has been collected for this scope yet, so the recommendations below rest on marks and SDG data only.')
    else if (rate < 0.6) add('Medium', 'Feedback', 'Collect feedback from more participants',
      'Open feedback straight after each round, set aside five minutes for it in the closing session, and consider making it required before certificates.',
      [`${fb.responses} of ${fb.members} participants (${pct(rate)}) gave feedback.`])
    if (fb.responses > 0 && fb.responses < 20) notes.push(`Only ${fb.responses} feedback responses: treat the feedback-based findings as indicative.`)
  }

  // 4. Comment themes (merged into a matching recommendation where there is one)
  const themed = themeComments(fb.comments, fb.questions)
  const nImprove = themed.sides.improve || themed.total
  const big = Math.max(2, Math.ceil(nImprove * 0.15))
  for (const t of themed.themes) {
    const n = t.improve
    if (t.fix && n >= big) {
      const ev = `${n} of ${nImprove} improvement comments mention ${t.label.toLowerCase()}${t.q.improve[0] ? ` (e.g. "${t.q.improve[0]}")` : '.'}`
      const same = t.area && recs.find((r) => r.area === t.area)
      const pr = n >= 5 && n / nImprove >= 0.3 ? 'High' : 'Medium'
      if (same) {
        same.evidence.push(ev)
        if (PRIORITY[pr] < PRIORITY[same.priority]) same.priority = pr
      } else add(pr, t.label, `Act on comments about ${t.label.toLowerCase()}`, t.fix, [ev])
    }
    if (t.like >= Math.max(2, Math.ceil((themed.sides.like || themed.total) * 0.15))) {
      strengths.push({ area: t.label, title: `Students valued ${t.label.toLowerCase()}`,
        evidence: [`${t.like} comment${t.like === 1 ? '' : 's'} on what students liked mention it${t.q.like[0] ? ` (e.g. "${t.q.like[0]}")` : '.'}`] })
    }
  }

  // 5. SDG coverage and strength
  const goals = d.sdgs || []
  const covered = goals.filter((g) => g.primary + g.secondary > 0)
  const missing = goals.filter((g) => g.primary + g.secondary === 0)
  const teamsPresent = d.attendance?.present ?? 0
  if (covered.length && missing.length) {
    add(teamsPresent >= 17 ? 'Medium' : 'Low', 'SDG coverage', `Broaden SDG coverage (${covered.length} of 17 goals addressed)`,
      `Add problem statements for the goals no team chose, for example by inviting departments, NGOs or local bodies working on them to contribute challenges.`,
      [`No team chose ${missing.map((g) => `SDG ${g.id} (${g.name})`).join(', ')}.`])
  }
  const primaryTotal = goals.reduce((a, g) => a + g.primary, 0)
  const top = [...goals].sort((a, b) => b.primary - a.primary)[0]
  if (top && primaryTotal >= 8 && top.primary / primaryTotal > 0.3) {
    add('Low', 'SDG coverage', `Many teams chose SDG ${top.id}`,
      'Spread problem statements more evenly across the goals, or cap how many teams can pick one goal.',
      [`${top.primary} of ${primaryTotal} teams (${pct(top.primary / primaryTotal)}) chose SDG ${top.id} (${top.name}) as their primary goal.`])
  }
  const target = Number(s.sdg_strength_target ?? 2)
  const weak = goals.filter((g) => g.rated > 0 && g.avg_strength != null && g.avg_strength < target)
  if (weak.length) {
    const rated = goals.filter((g) => g.rated > 0).length
    const worst = [...weak].sort((a, b) => a.avg_strength - b.avg_strength)
    const list = worst.slice(0, 5).map((g) => `SDG ${g.id} (average ${n1(g.avg_strength)})`).join(', ') + (worst.length > 5 ? ` and ${worst.length - 5} more` : '')
    add(weak.length >= Math.max(3, rated / 2) ? 'High' : 'Medium', 'SDG relevance', 'Strengthen how solutions address their SDGs',
      'Ask teams to name the SDG target their solution addresses and how they would measure impact, and check this at the idea stage.',
      [`Evaluators rated the contribution below the target of ${target}/3 for ${weak.length} of ${rated} goals; lowest: ${list}.`])
  }
  const strongGoals = goals.filter((g) => g.rated >= 3 && g.avg_strength >= target + 0.5)
  if (strongGoals.length) strengths.push({ area: 'SDG relevance', title: 'Strong SDG contribution in some goals', evidence: [`Average strength of at least ${n1(target + 0.5)}/3 for ${strongGoals.map((g) => `SDG ${g.id}`).join(', ')}.`] })
  const unpicked = (d.problem_statements || []).filter((p) => p.teams === 0)
  if (unpicked.length) add('Low', 'Problem statements', 'Revise problem statements no team chose',
    'Rewrite or replace them: check whether the scope was unclear, too broad or lacked a real stakeholder.',
    [`No team chose ${unpicked.map((p) => `${p.code} "${p.title}" (${p.round})`).join('; ')}.`])

  // 6. PO/PSO attainment
  const outs = (d.outcomes || []).filter((o) => o.n_teams > 0 && o.level != null)
  for (const o of outs.filter((x) => x.level <= 1)) {
    const hint = hintFor(OUTCOME_HINTS, o.name)
    add(o.level === 0 ? 'High' : 'Medium', 'PO/PSO attainment', `Raise attainment of ${o.code} (${o.name})`,
      `Strengthen the activities that build this outcome${hint ? `: ${hint}` : ''}.`,
      [`${o.code} reached level ${o.level}: ${pct(o.pct_at_target ?? 0)} of teams met the ${pct(s.target ?? 0.6)} target (average ${pct(o.avg ?? 0)}).`])
  }
  const at3 = outs.filter((o) => o.level === 3)
  if (outs.length && at3.length === outs.length) strengths.push({ area: 'PO/PSO attainment', title: 'Every PO and PSO reached level 3', evidence: [`All ${outs.length} mapped outcomes reached level 3.`] })
  else if (at3.length >= Math.max(3, outs.length / 2)) strengths.push({ area: 'PO/PSO attainment', title: `${at3.length} of ${outs.length} outcomes reached level 3`, evidence: [at3.map((o) => o.code).join(', ')] })

  // 7. Rubric criteria: low scores and evaluator disagreement
  const crit = (d.criteria || []).filter((c) => c.n_teams > 0 && c.avg_pct != null)
  for (const c of crit.filter((x) => x.avg_pct < 0.55)) {
    const hint = hintFor(CRITERION_HINTS, c.name)
    add(c.avg_pct < 0.45 ? 'High' : 'Medium', 'Rubric performance', `Help teams with "${c.name}"`,
      `Teams scored lowest here. Offer ${hint || 'a focused workshop and share examples from the best teams'} before the next event.`,
      [`Average ${pct(c.avg_pct)} of the maximum across ${c.n_teams} team evaluations.`])
  }
  const disagree = crit.filter((c) => c.spread_n >= 5 && c.spread_pct != null && c.spread_pct > 0.15)
  if (disagree.length) {
    add('Medium', 'Evaluation', 'Calibrate evaluators before scoring',
      'Before the event, have all evaluators score two sample pitches together and agree on what each rubric level looks like.',
      [`Evaluators' marks for the same team differed by ${disagree.map((c) => `${pct(c.spread_pct)} of the maximum on "${c.short_name}"`).join(', ')} (typical spread).`])
  }

  // 8. Attendance
  const att = d.attendance || {}
  if (att.absent > 0 && att.registered > 0) {
    const r = att.absent / att.registered
    if (r >= 0.05 || att.absent >= 3) add(r >= 0.1 ? 'Medium' : 'Low', 'Attendance', 'Reduce no-shows',
      'Ask teams to confirm two days before, send a reminder on the morning, and keep a reserve list for open slots.',
      [`${att.absent} of ${att.registered} registered teams (${pct(r)}) were marked absent.`])
  }

  recs.sort((a, b) => PRIORITY[a.priority] - PRIORITY[b.priority])
  return {
    scope: d.scope,
    generated_at: d.generated_at,
    figures: {
      teams: att.registered ?? 0, present: att.present ?? 0, absent: att.absent ?? 0,
      responses: fb.responses, members: fb.members,
      overall: overall ? overall.avg : null,
      sdgs_covered: covered.length,
      outcomes_l3: at3.length, outcomes: outs.length,
    },
    recommendations: recs,
    strengths,
    themes: themed,
    sdg: { covered, missing, weak, target },
    outcomes: outs,
    criteria: crit,
    notes,
  }
}

// Plain-text facts handed to the writing model (and printed in the Word report).
export function factsText(f, settings = {}) {
  const L = []
  L.push(`Event: ${settings.title || 'Hackathon'} — ${settings.department ? `Department of ${settings.department}, ` : ''}${settings.institution || ''}${settings.academic_year ? ` (${settings.academic_year})` : ''}.`)
  L.push(`Scope of this report: ${f.scope}.`)
  const x = f.figures
  L.push(`Teams: ${x.teams} registered, ${x.present} presented, ${x.absent} absent. Feedback: ${x.responses} responses from ${x.members} participants.${x.overall != null ? ` Overall rating ${n1(x.overall)}/5.` : ''} SDGs addressed: ${x.sdgs_covered} of 17. Outcomes at level 3: ${x.outcomes_l3} of ${x.outcomes}.`)
  if (f.strengths.length) {
    L.push('\nWhat went well:')
    f.strengths.forEach((st) => L.push(`- ${st.title}. ${st.evidence.join(' ')}`))
  }
  if (f.recommendations.length) {
    L.push('\nAreas to improve (priority, area, finding, suggested action):')
    f.recommendations.forEach((r, i) => L.push(`${i + 1}. [${r.priority}] ${r.area}: ${r.evidence.join(' ')} Suggested: ${r.detail}`))
  }
  if (f.notes.length) L.push(`\nNotes: ${f.notes.join(' ')}`)
  return L.join('\n')
}
