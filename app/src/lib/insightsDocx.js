// Word (.docx) version of an insights report: the write-up (if any) followed by the findings.
import { Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType, AlignmentType } from 'docx'

const n1 = (x) => (x == null ? '—' : (Math.round(x * 100) / 100).toFixed(2))
const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`)

// Minimal Markdown → paragraphs: ## headings, numbered and bulleted lists, **bold**.
function runs(text) {
  return text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean)
    .map((part) => (part.startsWith('**') && part.endsWith('**') ? new TextRun({ text: part.slice(2, -2), bold: true }) : new TextRun(part)))
}
function markdown(md) {
  const out = []
  for (const raw of md.split('\n')) {
    const line = raw.trimEnd()
    if (!line.trim()) continue
    let m
    if ((m = /^#{1,3}\s+(.*)$/.exec(line))) out.push(new Paragraph({ text: m[1].replace(/\*\*/g, ''), heading: HeadingLevel.HEADING_2 }))
    else if ((m = /^\s*(\d+)[.)]\s+(.*)$/.exec(line))) out.push(new Paragraph({ children: [new TextRun(`${m[1]}. `), ...runs(m[2])], indent: { left: 360, hanging: 360 }, spacing: { after: 80 } }))
    else if ((m = /^\s*[-*•]\s+(.*)$/.exec(line))) out.push(new Paragraph({ children: runs(m[1]), bullet: { level: 0 }, spacing: { after: 60 } }))
    else out.push(new Paragraph({ children: runs(line.trim()), spacing: { after: 120 } }))
  }
  return out
}

const cell = (text, opts = {}) => new TableCell({
  children: [new Paragraph({ children: [new TextRun({ text: String(text ?? ''), bold: !!opts.bold, size: 19 })] })],
  width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
  shading: opts.shade ? { fill: 'E8F1EE' } : undefined,
})
const table = (head, rows, widths) => new Table({
  width: { size: 100, type: WidthType.PERCENTAGE },
  rows: [new TableRow({ tableHeader: true, children: head.map((h, i) => cell(h, { bold: true, shade: true, width: widths?.[i] })) }),
    ...rows.map((r) => new TableRow({ children: r.map((v, i) => cell(v, { width: widths?.[i] })) }))],
})

export async function downloadInsightsDocx({ findings: f, narrative, settings = {}, model, createdAt }) {
  const when = new Date(createdAt || Date.now()).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  const x = f.figures
  const children = [
    new Paragraph({ text: settings.title || 'Hackathon', heading: HeadingLevel.TITLE }),
    new Paragraph({ children: [new TextRun({ text: `Review and recommendations for the next hackathon — ${f.scope}`, bold: true, size: 26 })] }),
    new Paragraph({ children: [new TextRun({ text: `${settings.department ? `Department of ${settings.department}, ` : ''}${settings.institution || ''}${settings.academic_year ? `, ${settings.academic_year}` : ''}. Prepared ${when}.`, color: '5E6F75' })], spacing: { after: 240 } }),
    table(['Teams (presented / registered)', 'Feedback responses', 'Overall rating', 'SDGs addressed', 'Outcomes at level 3'],
      [[`${x.present} / ${x.teams}`, `${x.responses} of ${x.members}`, x.overall == null ? '—' : `${n1(x.overall)} / 5`, `${x.sdgs_covered} of 17${x.sdgs_presented != null && x.sdgs_presented !== x.sdgs_covered ? ` (${x.sdgs_presented} presented)` : ''}`, `${x.outcomes_l3} of ${x.outcomes}`]]),
  ]
  if (narrative?.trim()) {
    children.push(new Paragraph({ text: 'Report', heading: HeadingLevel.HEADING_1, spacing: { before: 300 } }))
    children.push(...markdown(narrative))
    if (model) children.push(new Paragraph({ children: [new TextRun({ text: `Drafted on this computer with ${model} from the findings below, and reviewed by the department.`, italics: true, color: '5E6F75', size: 18 })] }))
  }
  children.push(new Paragraph({ text: 'Findings and recommendations', heading: HeadingLevel.HEADING_1, spacing: { before: 300 } }))
  if (f.notes.length) children.push(new Paragraph({ children: [new TextRun({ text: f.notes.join(' '), italics: true })] }))
  children.push(table(['Priority', 'Area', 'Recommendation', 'Evidence'],
    f.recommendations.map((r) => [r.priority, r.area, `${r.title}. ${r.detail}`, r.evidence.join(' ')]), [10, 16, 40, 34]))
  if (f.strengths.length) {
    children.push(new Paragraph({ text: 'Keep doing', heading: HeadingLevel.HEADING_2, spacing: { before: 240 } }))
    f.strengths.forEach((s) => children.push(new Paragraph({ children: [new TextRun({ text: `${s.title}. `, bold: true }), new TextRun(s.evidence.join(' '))], bullet: { level: 0 } })))
  }
  if (f.themes.themes.length) {
    children.push(new Paragraph({ text: 'What students said', heading: HeadingLevel.HEADING_2, spacing: { before: 240 } }))
    children.push(table(['Theme', 'Asked to improve', 'Praised', 'Example'],
      f.themes.themes.map((t) => { const e = t.q?.improve?.[0] || t.q?.like?.[0] || t.quotes[0]; return [t.label, t.improve, t.like, e ? `"${e}"` : ''] }), [26, 14, 12, 48]))
  }
  children.push(new Paragraph({ text: 'SDG coverage', heading: HeadingLevel.HEADING_2, spacing: { before: 240 } }))
  children.push(new Paragraph(`Addressed (${f.sdg.covered.length}): ${f.sdg.covered.map((g) => `SDG ${g.id}`).join(', ') || 'none'}.`))
  if (f.sdg.missing.length) children.push(new Paragraph(`Not chosen by any team (${f.sdg.missing.length}): ${f.sdg.missing.map((g) => `SDG ${g.id} ${g.name}`).join('; ')}.`))
  if (f.sdg.absentOnly?.length) children.push(new Paragraph(`Chosen only by teams that did not present (${f.sdg.absentOnly.length}): ${f.sdg.absentOnly.map((g) => `SDG ${g.id} ${g.name}`).join('; ')}.`))
  if (f.outcomes.length) {
    children.push(new Paragraph({ text: 'PO/PSO attainment', heading: HeadingLevel.HEADING_2, spacing: { before: 240 } }))
    children.push(table(['Outcome', 'Teams', 'Average', '% at target', 'Level'],
      f.outcomes.map((o) => [`${o.code} ${o.name}`, o.n_teams, pct(o.avg), pct(o.pct_at_target), o.level]), [46, 12, 14, 16, 12]))
  }
  children.push(new Paragraph({ children: [new TextRun({ text: 'All figures are computed by the evaluation app from marks, SDG ratings and student feedback.', italics: true, color: '5E6F75', size: 18 })], spacing: { before: 240 }, alignment: AlignmentType.LEFT }))

  const doc = new Document({
    creator: 'SDG Hackathon evaluation',
    title: `${settings.title || 'Hackathon'} — recommendations`,
    styles: { default: { document: { run: { font: 'Calibri', size: 21 } } } },
    sections: [{ properties: { page: { margin: { top: 1000, bottom: 1000, left: 1000, right: 1000 } } }, children }],
  })
  const blob = await Packer.toBlob(doc)
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `Hackathon_recommendations_${f.scope.replace(/[^\w]+/g, '_')}.docx`
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}
