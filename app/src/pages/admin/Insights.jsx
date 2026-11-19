import React, { useEffect, useMemo, useRef, useState } from 'react'
import { supabase, q } from '../../lib/supabase'
import { useLoad } from '../../lib/useLoad'
import { ErrorBox, Loading } from '../../components/ui'
import { buildFindings, factsText } from '../../lib/insights'

const n1 = (x) => (x == null ? '—' : (Math.round(x * 100) / 100).toFixed(2))
const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`)
const when = (d) => new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const llm = () => import('../../lib/llm')
const MODEL_KEY = 'insights-model'

function Figures({ f }) {
  const x = f.figures
  const tiles = [
    ['Teams presented', `${x.present}`, `of ${x.teams} registered${x.absent ? `, ${x.absent} absent` : ''}`],
    ['Feedback responses', `${x.responses}`, x.members ? `of ${x.members} participants (${pct(x.responses / x.members)})` : 'no feedback collected'],
    ['Overall rating', x.overall == null ? '—' : n1(x.overall), x.overall == null ? 'no ratings yet' : 'out of 5'],
    ['SDGs addressed', `${x.sdgs_covered}`, x.sdgs_presented != null && x.sdgs_presented !== x.sdgs_covered ? `of 17 goals (${x.sdgs_presented} counting only teams that presented)` : 'of 17 goals'],
    ['Outcomes at level 3', `${x.outcomes_l3}`, `of ${x.outcomes} POs and PSOs`],
  ]
  return (
    <div className="ins-tiles">
      {tiles.map(([label, big, small]) => (
        <div key={label} className="ins-tile"><span className="muted small">{label}</span><b>{big}</b><small className="muted">{small}</small></div>
      ))}
    </div>
  )
}

function Recommendations({ f }) {
  if (!f.recommendations.length) return <p className="muted">Nothing stands out as needing improvement for this scope.</p>
  return (
    <ol className="ins-recs">
      {f.recommendations.map((r, i) => (
        <li key={i} className={`ins-rec pr-${r.priority.toLowerCase()}`}>
          <div className="ins-rec-head"><span className={`tag ins-pr pr-${r.priority.toLowerCase()}`}>{r.priority}</span><span className="muted small">{r.area}</span></div>
          <h3>{r.title}</h3>
          <p>{r.detail}</p>
          <ul className="ins-evidence">{r.evidence.map((e, k) => <li key={k}>{e}</li>)}</ul>
        </li>
      ))}
    </ol>
  )
}

function Themes({ f }) {
  const t = f.themes
  if (!t.total) return <p className="muted">No written comments yet.</p>
  return (
    <>
      <p className="muted small">{t.total} comments, grouped by the words they use. A comment can touch more than one theme.</p>
      <div className="scroll">
        <table className="table">
          <thead><tr><th>Theme</th><th className="r">Asked to improve</th><th className="r">Praised</th><th>Example</th></tr></thead>
          <tbody>
            {t.themes.map((x) => (
              <tr key={x.key}><td><b>{x.label}</b></td><td className="r">{x.improve || '—'}</td><td className="r">{x.like || '—'}</td>
                <td className="ins-quote">{(() => { const e = x.q.improve[0] || x.q.like[0] || x.q.other[0] || x.quotes[0]; return e ? `"${e}"` : '' })()}</td></tr>
            ))}
            {t.unmatched.length > 0 && <tr><td><b>Other</b></td><td colSpan={2} className="r">{t.unmatched.length}</td><td className="ins-quote">"{t.unmatched[0].slice(0, 200)}"</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}

function Sdgs({ f, sdgById }) {
  return (
    <>
      <div className="ins-sdgs">
        {Array.from({ length: 17 }, (_, i) => i + 1).map((id) => {
          const g = f.sdg.covered.find((x) => x.id === id)
          const weak = f.sdg.weak.some((x) => x.id === id)
          const absentOnly = (f.sdg.absentOnly || []).some((x) => x.id === id)
          const s = sdgById[id]
          return (
            <div key={id} className={`ins-sdg ${g ? 'on' : 'off'} ${weak ? 'weak' : ''} ${absentOnly ? 'absent-only' : ''}`} style={g ? { background: s?.color } : undefined}
              title={`SDG ${id} ${s?.name ?? ''}: ${g ? `${g.primary} primary, ${g.secondary} secondary${absentOnly ? ', chosen only by absent teams' : ''}${g.avg_strength != null ? `, strength ${n1(g.avg_strength)}/3` : ''}` : 'no team'}`}>
              <b>{id}</b><span>{g ? g.primary + g.secondary : 0}</span>
            </div>
          )
        })}
      </div>
      <p className="muted small">Projects per goal, counted as on the Dashboard (each project once across rounds). Grey: no project chose it. Faded: chosen only by teams marked absent. Dashed outline: average strength below the target of {f.sdg.target}/3.</p>
    </>
  )
}

function WriteUp({ facts, comments, narrative, setNarrative, model, setModel }) {
  const [gpu, setGpu] = useState(null)
  const [mods, setMods] = useState(null)
  const [installed, setInstalled] = useState(null)
  const [status, setStatus] = useState(null) // { text, progress }
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const engine = useRef(null)
  const engineId = useRef(null)
  const fileRef = useRef(null)

  useEffect(() => { (async () => { const m = await llm(); setMods(m.MODELS); setGpu(await m.checkGpu()) })() }, [])
  useEffect(() => { if (mods) (async () => { setInstalled(null); setInstalled(await (await llm()).isInstalled(model)) })() }, [model, mods])
  const m = mods?.find((x) => x.id === model)

  async function importFolder(e) {
    const files = e.target.files; if (!files?.length) return
    setErr(null); setBusy(true)
    try {
      const lib = await llm()
      setStatus({ text: 'Checking the folder…', progress: 0 })
      const res = await lib.importModelFolder(files, model, (p, name) => setStatus({ text: `Copying model files into this browser… ${name}`, progress: p }))
      setStatus({ text: `Model ready: ${res.files} files, ${(res.bytes / 1e9).toFixed(2)} GB stored in this browser.`, progress: 1 })
      setInstalled(await lib.isInstalled(model))
    } catch (x) { setErr(x.message); setStatus(null) } finally { setBusy(false); e.target.value = '' }
  }
  async function remove() {
    if (!window.confirm('Remove the model files from this browser? You can import them again later.')) return
    await (await llm()).removeModel(model); engine.current = null; setInstalled(false); setStatus(null)
  }
  async function write() {
    setErr(null); setBusy(true)
    try {
      const lib = await llm()
      if (!engine.current || engineId.current !== model) {
        setStatus({ text: 'Loading the model onto the graphics card (the first time takes a minute)…', progress: 0 })
        engine.current = await lib.loadEngine(model, (r) => setStatus({ text: r.text || 'Loading the model…', progress: r.progress ?? 0 }))
        engineId.current = model
      }
      setStatus({ text: 'Writing…', progress: null })
      const text = await lib.writeReport(engine.current, { facts, comments }, {
        onStage: (s) => setStatus({ text: s, progress: null }),
        onToken: (t) => setNarrative(t),
      })
      setNarrative(text)
      setStatus({ text: 'Draft ready. Read it, edit anything that is off, then save the report.', progress: 1 })
    } catch (x) { setErr(`The model could not finish: ${x.message}`); setStatus(null) } finally { setBusy(false) }
  }

  return (
    <section className="panel">
      <h2>Write-up (optional)</h2>
      <p>A language model running <b>on this computer</b> can turn the findings above into a readable report. Nothing is sent anywhere: the model runs in this browser on the graphics card, and it only rewrites the findings and comments shown on this page. Always read the draft before using it.</p>
      {gpu === null ? <p className="muted">Checking this computer…</p> : !gpu.ok ? (
        <div className="alert alert-warn"><span>{gpu.why} The findings above don't need the model.</span></div>
      ) : (
        <>
          <p className="muted small">Graphics: {gpu.name}{gpu.f16 === false ? ' (no 16-bit shader support: the model may not load on this device)' : ''}</p>
          <div className="ins-model">
            <label>Model<select value={model} onChange={(e) => setModel(e.target.value)} disabled={busy}>
              {mods?.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select></label>
            <div className="ins-model-state">
              {installed === null ? <span className="muted">Checking…</span> : installed
                ? <><span className="tag tag-open">Installed in this browser</span><button className="btn btn-small btn-quiet" onClick={remove} disabled={busy}>Remove</button></>
                : <span className="tag">Not installed in this browser</span>}
            </div>
          </div>
          {installed === false && m && (
            <div className="ins-setup">
              <p><b>One-time setup on this computer:</b></p>
              <ol className="small">
                <li>Download the model folder <code>{m.id}</code> (about {m.id.includes('3B') ? '2' : '1'} GB) once, from its publisher ({m.source}). For example, with Git installed: <code>git lfs install</code> then <code>git clone {m.source}</code>.</li>
                <li>Click <b>Import model folder</b> and choose that folder. Its files are copied into this browser's storage; nothing is uploaded.</li>
              </ol>
              <label className="btn btn-primary file-btn">Import model folder
                <input ref={fileRef} type="file" webkitdirectory="" directory="" multiple onChange={importFolder} disabled={busy} /></label>
            </div>
          )}
          {installed && (
            <div className="row-gap">
              <button className="btn btn-primary" onClick={write} disabled={busy}>{busy ? 'Working…' : narrative ? 'Write it again' : 'Write the report'}</button>
              <span className="muted small">Takes a few minutes. Keep this tab open.</span>
            </div>
          )}
        </>
      )}
      {status && (
        <div className="ins-status" role="status">
          <span>{status.text}</span>
          {status.progress != null && <div className="fb-bar-track"><div className="fb-bar-fill" style={{ width: `${Math.round(status.progress * 100)}%` }} /></div>}
        </div>
      )}
      {err && <div className="alert alert-error" role="alert"><span>{err}</span></div>}
      <label className="ins-narrative">Report text (Markdown; edit freely)
        <textarea rows={narrative ? 18 : 5} value={narrative} onChange={(e) => setNarrative(e.target.value)}
          placeholder="The model's draft appears here. You can also type or paste your own write-up." /></label>
    </section>
  )
}

export default function Insights() {
  const [scope, setScope] = useState(0)
  const [opened, setOpened] = useState(null) // a saved report being viewed
  const [narrative, setNarrative] = useState('')
  const [model, setModelState] = useState(() => { try { return localStorage.getItem(MODEL_KEY) || 'Qwen2.5-3B-Instruct-q4f16_1-MLC' } catch { return 'Qwen2.5-3B-Instruct-q4f16_1-MLC' } })
  const setModel = (id) => { setModelState(id); try { localStorage.setItem(MODEL_KEY, id) } catch { /* not essential */ } }
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)

  const base = useLoad(async () => {
    const [settings, events, sdgs, reports] = await Promise.all([
      q(supabase.from('settings').select('*').eq('id', 1).single()),
      q(supabase.from('events').select('id, name, sort').order('sort')),
      q(supabase.from('sdgs').select('*').order('id')),
      q(supabase.from('insight_reports').select('id, event_id, scope, model, created_at, narrative').order('created_at', { ascending: false })),
    ])
    return { settings, events, sdgs, reports }
  }, [])
  const live = useLoad(async () => (opened ? null : q(supabase.rpc('insight_data', { p_event: scope || null }))), [scope, opened])

  const findings = useMemo(() => (opened ? opened.findings : live.data ? buildFindings(live.data) : null), [opened, live.data])
  const comments = useMemo(() => {
    if (!live.data) return []
    const prompt = Object.fromEntries(live.data.feedback.questions.map((x) => [x.id, x.prompt]))
    return live.data.feedback.comments.map((c) => ({ prompt: prompt[c.qid] || 'Comment', text: c.text }))
  }, [live.data])

  if (base.loading && !base.data) return <Loading />
  if (base.error) return <ErrorBox error={base.error} onRetry={base.reload} />
  const { settings, events, sdgs, reports } = base.data
  const sdgById = Object.fromEntries(sdgs.map((s) => [s.id, s]))
  const facts = findings ? factsText(findings, settings) : ''

  async function save() {
    setBusy(true); setMsg(null)
    try {
      if (opened) {
        await q(supabase.from('insight_reports').update({ narrative }).eq('id', opened.id))
        setMsg({ kind: 'ok', text: 'Saved report updated.' })
      } else {
        const row = await q(supabase.from('insight_reports').insert({ event_id: scope || null, scope: findings.scope, findings, narrative: narrative.trim() || null,
          model: narrative.trim() ? model : null }).select().single())
        setOpened(row)
        setMsg({ kind: 'ok', text: 'Report saved. You can come back to it from Saved reports below.' })
      }
      await base.reload()
    } catch (x) { setMsg({ kind: 'error', text: x.message }) } finally { setBusy(false) }
  }
  async function openReport(id) {
    setMsg(null)
    try {
      const row = await q(supabase.from('insight_reports').select('*').eq('id', id).single())
      setOpened(row); setNarrative(row.narrative || ''); window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (x) { setMsg({ kind: 'error', text: x.message }) }
  }
  async function deleteReport(id) {
    if (!window.confirm('Delete this saved report?')) return
    try { await q(supabase.from('insight_reports').delete().eq('id', id)); if (opened?.id === id) { setOpened(null); setNarrative('') } await base.reload() }
    catch (x) { setMsg({ kind: 'error', text: x.message }) }
  }
  async function word() {
    setBusy(true)
    try {
      const { downloadInsightsDocx } = await import('../../lib/insightsDocx')
      await downloadInsightsDocx({ findings, narrative, settings, model: (opened ? opened.model : narrative.trim() ? model : null), createdAt: opened?.created_at })
    } catch (x) { setMsg({ kind: 'error', text: x.message }) } finally { setBusy(false) }
  }

  return (
    <>
      <div className="page-head dash-head">
        <div>
          <h1>Insights</h1>
          <p className="lede">Recommendations for the next hackathon, worked out from student feedback, SDG coverage, PO/PSO attainment, marks and attendance. Every figure is computed in the app's own database; nothing is sent to any outside service.</p>
        </div>
        <div className="dash-tools">
          {opened ? (
            <button className="btn" onClick={() => { setOpened(null); setNarrative(''); setMsg(null) }}>Back to live findings</button>
          ) : (
            <label>Scope<select value={scope} onChange={(e) => { setScope(Number(e.target.value)); setNarrative('') }}>
              <option value={0}>Whole event (all rounds)</option>
              {events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select></label>
          )}
          <button className="btn btn-primary" onClick={save} disabled={!findings || busy}>{opened ? 'Save changes' : 'Save report'}</button>
          <button className="btn" onClick={word} disabled={!findings || busy}>Download Word</button>
        </div>
      </div>
      {opened && <div className="alert alert-info"><span>Viewing the saved report for <b>{opened.scope}</b> from {when(opened.created_at)}. Its figures are as they were then.</span></div>}
      {msg && <div className={`alert alert-${msg.kind}`} role="status"><span>{msg.text}</span></div>}

      {!findings ? (live.error ? <ErrorBox error={live.error} onRetry={live.reload} /> : <Loading label="Working out the findings…" />) : (
        <>
          <Figures f={findings} />
          {findings.notes.map((n, i) => <div key={i} className="alert alert-warn"><span>{n}</span></div>)}

          <section className="panel">
            <h2>Recommendations for the next hackathon</h2>
            <p className="muted small">Most important first. Each comes with the figures behind it.</p>
            <Recommendations f={findings} />
          </section>

          <div className="dash-grid even">
            <section className="panel">
              <h2>Keep doing</h2>
              {findings.strengths.length
                ? <ul className="ins-strengths">{findings.strengths.map((s, i) => <li key={i}><b>{s.title}.</b> <span className="muted">{s.evidence.join(' ')}</span></li>)}</ul>
                : <p className="muted">Nothing stands out yet. Strengths appear here once feedback and marks are in.</p>}
            </section>
            <section className="panel">
              <h2>SDG coverage</h2>
              <Sdgs f={findings} sdgById={sdgById} />
            </section>
          </div>

          <section className="panel">
            <h2>What students said</h2>
            <Themes f={findings} />
          </section>

          <WriteUp facts={facts} comments={opened ? [] : comments} narrative={narrative} setNarrative={setNarrative} model={model} setModel={setModel} />
        </>
      )}

      <section className="panel">
        <h2>Saved reports</h2>
        {reports.length === 0 ? <p className="muted">None yet. Click <b>Save report</b> to keep a copy of the findings and write-up.</p> : (
          <table className="table">
            <thead><tr><th>Saved</th><th>Scope</th><th>Write-up</th><th /></tr></thead>
            <tbody>
              {reports.map((r) => (
                <tr key={r.id} className={opened?.id === r.id ? 'row-dirty' : ''}>
                  <td className="nowrap">{when(r.created_at)}</td><td>{r.scope}</td>
                  <td>{r.narrative ? (r.model ? <span className="small">Drafted with {r.model.split('-').slice(0, 3).join(' ')}</span> : <span className="small">Written by hand</span>) : <span className="muted small">Findings only</span>}</td>
                  <td className="actions"><button className="btn btn-small" onClick={() => openReport(r.id)}>Open</button>
                    <button className="btn btn-small btn-danger" onClick={() => deleteReport(r.id)}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  )
}
