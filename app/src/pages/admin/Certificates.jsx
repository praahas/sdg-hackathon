import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, q, qAll } from '../../lib/supabase'
import { useLoad } from '../../lib/useLoad'
import { loadReference } from '../../lib/reference'
import { roundType } from '../../lib/format'
import { ErrorBox, Loading } from '../../components/ui'
import { MAX_SIGNATURES, roundSignatories } from '../../lib/signatories'

const longDate = (d) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '')

async function pdf() { return import('../../lib/certificates') }

// "Signs for": every round, or only the rounds ticked.
function RoundPicker({ events, value, onChange, idPrefix }) {
  const all = !value.length
  const toggle = (id) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id].sort((a, b) => a - b))
  return (
    <fieldset className="sig-rounds">
      <legend>Signs certificates for</legend>
      <div className="sig-rounds-mode" role="radiogroup">
        <label className="check"><input type="radio" name={`${idPrefix}-mode`} checked={all} onChange={() => onChange([])} /><span>All rounds</span></label>
        <label className="check"><input type="radio" name={`${idPrefix}-mode`} checked={!all} onChange={() => { if (all) onChange([events[0].id]) }} /><span>Only some rounds</span></label>
      </div>
      {!all && (
        <div className="sig-round-list">
          {events.map((e) => (
            <label key={e.id} className={`chip ${value.includes(e.id) ? 'on' : ''}`}>
              <input type="checkbox" checked={value.includes(e.id)} onChange={() => toggle(e.id)} />{e.name}
            </label>
          ))}
        </div>
      )}
    </fieldset>
  )
}

const sameIds = (a = [], b = []) => a.length === b.length && a.every((x, i) => x === b[i])

function SignatoryCard({ s, events, first, last, onMove, onChanged, setMsg }) {
  const [f, setF] = useState(s)
  const [busy, setBusy] = useState(false)
  useEffect(() => setF(s), [s])
  const dirty = f.name !== s.name || f.designation !== s.designation || f.signature !== s.signature || !sameIds(f.event_ids, s.event_ids)
  async function upload(e) {
    const file = e.target.files?.[0]; e.target.value = ''
    if (!file) return
    try { const { readSignature } = await pdf(); const signature = await readSignature(file); setF((x) => ({ ...x, signature })) } catch (err) { setMsg({ kind: 'error', text: err.message }) }
  }
  async function save(patch = {}) {
    setBusy(true)
    try {
      await q(supabase.from('signatories').update({ name: f.name.trim(), designation: f.designation.trim(), signature: f.signature, event_ids: f.event_ids || [], ...patch }).eq('id', s.id))
      onChanged()
    } catch (err) { setMsg({ kind: 'error', text: err.message }) } finally { setBusy(false) }
  }
  async function remove() {
    if (!window.confirm(`Remove ${s.name} as a signatory? Certificates you download afterwards won't carry this signature.`)) return
    try { await q(supabase.from('signatories').delete().eq('id', s.id)); onChanged() } catch (err) { setMsg({ kind: 'error', text: err.message }) }
  }
  return (
    <div className={`sig-card ${s.active ? '' : 'sig-off'} ${dirty ? 'row-dirty' : ''}`}>
      <div className="sig-preview">
        {f.signature ? <img src={f.signature} alt={`Signature of ${f.name}`} /> : <span className="muted small">No signature uploaded</span>}
      </div>
      <label>Name<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
      <label>Designation<input value={f.designation} onChange={(e) => setF({ ...f, designation: e.target.value })} placeholder="e.g. Head of Department" /></label>
      <RoundPicker events={events} value={f.event_ids || []} onChange={(ids) => setF({ ...f, event_ids: ids })} idPrefix={`sig${s.id}`} />
      <div className="sig-actions">
        <label className="btn btn-small file-btn">{f.signature ? 'Replace signature' : 'Upload signature'}
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={upload} /></label>
        <button className="btn btn-small btn-primary" disabled={!dirty || busy || !f.name.trim()} onClick={() => save()}>Save</button>
      </div>
      <div className="sig-actions">
        <label className="check"><input type="checkbox" checked={s.active} onChange={() => save({ active: !s.active })} /><span>Print on certificates</span></label>
        <span className="spacer" />
        <button className="btn btn-small btn-quiet" disabled={first} onClick={() => onMove(-1)} aria-label={`Move ${s.name} left`}>‹</button>
        <button className="btn btn-small btn-quiet" disabled={last} onClick={() => onMove(1)} aria-label={`Move ${s.name} right`}>›</button>
        <button className="btn btn-small btn-danger" onClick={remove}>Remove</button>
      </div>
    </div>
  )
}

function Signatories({ sigs, events, reload, setMsg }) {
  const [n, setN] = useState({ name: '', designation: '', signature: null, event_ids: [] })
  const ordered = [...sigs].sort((a, b) => a.sort - b.sort || a.id - b.id)
  const active = ordered.filter((s) => s.active)
  async function upload(e) {
    const file = e.target.files?.[0]; e.target.value = ''
    if (!file) return
    try { const { readSignature } = await pdf(); const signature = await readSignature(file); setN((x) => ({ ...x, signature })) } catch (err) { setMsg({ kind: 'error', text: err.message }) }
  }
  async function add() {
    try {
      await q(supabase.from('signatories').insert({ name: n.name.trim(), designation: n.designation.trim(), signature: n.signature, event_ids: n.event_ids, sort: ordered.length + 1, active: true }))
      setN({ name: '', designation: '', signature: null, event_ids: [] }); reload()
    } catch (err) { setMsg({ kind: 'error', text: err.message }) }
  }
  async function move(i, d) {
    const a = ordered[i], b = ordered[i + d]
    try {
      await Promise.all([q(supabase.from('signatories').update({ sort: i + d + 1 }).eq('id', a.id)), q(supabase.from('signatories').update({ sort: i + 1 }).eq('id', b.id))])
      reload()
    } catch (err) { setMsg({ kind: 'error', text: err.message }) }
  }
  return (
    <section className="panel">
      <h2>Signatories</h2>
      <p>Signatures print along the bottom of the certificate, left to right in this order. Choose which rounds each person signs for: for example, a section coordinator signs only that section's round, while the HoD and Principal sign all rounds. Up to {MAX_SIGNATURES} signatures fit on one certificate; the Rounds table above shows who signs each round.
        Upload a scan or photo of each signature on white paper; the white background is removed automatically.</p>
      <div className="sig-grid">
        {ordered.map((s, i) => (
          <SignatoryCard key={s.id} s={s} events={events} first={i === 0} last={i === ordered.length - 1} onMove={(d) => move(i, d)} onChanged={reload} setMsg={setMsg} />
        ))}
        <div className="sig-card sig-new">
          <div className="sig-preview">{n.signature ? <img src={n.signature} alt="New signature" /> : <span className="muted small">Signature preview</span>}</div>
          <label>Name<input value={n.name} onChange={(e) => setN({ ...n, name: e.target.value })} placeholder="e.g. Dr. A. Kumar" /></label>
          <label>Designation<input value={n.designation} onChange={(e) => setN({ ...n, designation: e.target.value })} placeholder="e.g. Principal" /></label>
          <RoundPicker events={events} value={n.event_ids} onChange={(ids) => setN({ ...n, event_ids: ids })} idPrefix="signew" />
          <div className="sig-actions">
            <label className="btn btn-small file-btn">Upload signature<input type="file" accept="image/png,image/jpeg,image/webp" onChange={upload} /></label>
            <button className="btn btn-small btn-primary" disabled={!n.name.trim()} onClick={add}>Add signatory</button>
          </div>
        </div>
      </div>
    </section>
  )
}

function LogoSlot({ side, label, value, onUpload, onRemove }) {
  return (
    <div className="logo-slot">
      <span className="small"><b>{label}</b></span>
      <div className="logo-preview">{value ? <img src={value} alt={`${label} logo`} /> : <span className="muted small">No logo: this spot stays blank</span>}</div>
      <div className="sig-actions">
        <label className="btn btn-small file-btn">{value ? 'Replace' : 'Upload logo'}
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onUpload(side, f) }} /></label>
        {value && <button className="btn btn-small btn-danger" onClick={() => onRemove(side)}>Remove</button>}
      </div>
    </div>
  )
}

function Logos({ branding, reload, setMsg }) {
  async function save(side, value) {
    try {
      await q(supabase.from('branding').upsert({ id: 1, [`logo_${side}`]: value, updated_at: new Date().toISOString() }))
      reload()
    } catch (err) { setMsg({ kind: 'error', text: err.message }) }
  }
  async function upload(side, file) {
    try { const { readLogo } = await pdf(); await save(side, await readLogo(file)) } catch (err) { setMsg({ kind: 'error', text: err.message }) }
  }
  return (
    <section className="panel">
      <h2>Logos</h2>
      <p>Up to six logos: a main logo in each top corner, and up to two smaller ones stacked under each, for example the institution, the founder's emblem, IIC, IQAC or a sponsor. A PNG with a transparent background looks best. Leave any slot empty to keep it blank.</p>
      <div className="logo-columns">
        {[['left', 'Left'], ['right', 'Right']].map(([side, name]) => (
          <div key={side} className="logo-column">
            <h3>{name} side</h3>
            <LogoSlot side={side} label={`Top ${side} (main)`} value={branding[`logo_${side}`]} onUpload={upload} onRemove={(s) => save(s, null)} />
            <LogoSlot side={`${side}2`} label={`${name}, below the main logo`} value={branding[`logo_${side}2`]} onUpload={upload} onRemove={(s) => save(s, null)} />
            <LogoSlot side={`${side}3`} label={`${name}, lowest`} value={branding[`logo_${side}3`]} onUpload={upload} onRemove={(s) => save(s, null)} />
          </div>
        ))}
      </div>
    </section>
  )
}

const GAP_TEXT = { missing: 'no certificate yet', changed: 'name or USN changed', removed: 'no longer on the team', absent: 'team marked absent, certificate will be withdrawn', not_evaluated: 'team no longer has marks, certificate will be withdrawn' }

// Members whose certificates don't match the team as it is now.
function OutOfDate({ gaps }) {
  return (
    <details className="cert-gaps">
      <summary className="field-error">{gaps.length} member{gaps.length === 1 ? '' : 's'} changed since issuing: click Re-issue</summary>
      <ul>{gaps.map((g, i) => <li key={i}><b>{g.member_name}</b> <span className="muted">{g.team_code}</span>: {GAP_TEXT[g.issue]}</li>)}</ul>
    </details>
  )
}

function RoundRow({ e, scored, certs, ctx, act, setMsg, gaps }) {
  const [teamSel, setTeamSel] = useState('')
  const [busy, setBusy] = useState(null)
  const mine = certs.filter((c) => c.event_id === e.id)
  const winners = mine.filter((c) => c.kind === 'winner')
  const teams = [...new Map(mine.map((c) => [c.team_id, c])).values()]
    .sort((a, b) => String(a.team_code).localeCompare(String(b.team_code), undefined, { numeric: true }))
  const parts = mine.filter((c) => c.kind === 'participation')
  const signers = roundSignatories(ctx.signatories, e.id)
  // Issued before the current rules (winners outside the final, or winners without a participation certificate).
  const stale = (e.winners_count === 0 && winners.length > 0)
    || winners.some((w) => !parts.some((p) => p.team_id === w.team_id && p.member_index === w.member_index))

  async function download(rows, name) {
    setBusy(name)
    try { const { downloadCertificates } = await pdf(); await downloadCertificates(rows, ctx, name) }
    catch (err) { setMsg({ kind: 'error', text: err.message }) } finally { setBusy(null) }
  }
  const issue = () => act(async () => {
    const res = await q(supabase.rpc('issue_certificates', { p_event: e.id }))
    const missing = res.teams_without_members || []
    return ({
      kind: missing.length ? 'warn' : 'ok',
      text: `${e.name}: ${res.participation} participation${res.winner ? ` and ${res.winner} winner` : ''} certificates issued.${missing.length
        ? ` ${missing.length} evaluated team${missing.length === 1 ? ' has' : 's have'} no readable member names and got none: ${missing.join(', ')}. Add their members on the round page (e.g. "Asha (4CB23AI001), Bala (4CB23AI002)") and issue again.`
        : ''}`,
    })
  })
  const release = () => act(async () => {
    await q(supabase.from('events').update({ certificates_released: !e.certificates_released }).eq('id', e.id))
    return { kind: 'ok', text: e.certificates_released ? `${e.name}: certificates hidden from teams.` : `${e.name}: teams can now download their certificates.` }
  })

  return (
    <tr>
      <td><Link to={`/admin/rounds/${e.id}`}><b>{e.name}</b></Link><small className="muted block">{roundType(e)}</small></td>
      <td className="nowrap">{e.event_date ? longDate(e.event_date) : <Link to={`/admin/rounds/${e.id}`} className="field-error">Set date</Link>}</td>
      <td className="sig-who">{signers.length
        ? <>{signers.slice(0, MAX_SIGNATURES).map((sg) => <span key={sg.id} className="block" title={sg.designation}>{sg.name}</span>)}
            {signers.length > MAX_SIGNATURES && <small className="field-error block">Only {MAX_SIGNATURES} fit: {signers.slice(MAX_SIGNATURES).map((x) => x.name).join(', ')} left off. Untick or reorder below.</small>}</>
        : <small className="field-error">No signatures</small>}</td>
      <td className="r">{scored}</td>
      <td>{e.winners_count > 0 ? <span className="tag tag-place podium podium-1">Top {e.winners_count} teams</span> : <span className="muted small">None</span>}</td>
      <td>{mine.length
        ? <><b>{parts.length}</b> <small className="muted">participation</small>{winners.length > 0 && <><br /><b>{winners.length}</b> <small className="muted">winner</small></>}
            {stale && <small className="field-error block">Issued under the old rules: click Re-issue</small>}
            {gaps.length > 0 && <OutOfDate gaps={gaps} />}</>
        : <span className="muted">Not issued</span>}</td>
      <td>{mine.length ? (
        <button className={`btn btn-small ${e.certificates_released ? 'btn-danger' : ''}`} onClick={release}>{e.certificates_released ? 'Hide from teams' : 'Release to teams'}</button>
      ) : <span className="muted small">—</span>}
        {e.certificates_released && mine.length > 0 && <small className="tag tag-open block-tag">Released</small>}
        {e.feedback_required && <small className="muted block"><Link to="/admin/feedback">Feedback required</Link> first</small>}</td>
      <td><div className="cert-actions">
        <button className="btn btn-small btn-primary" disabled={!e.event_date || !scored} onClick={issue}>{mine.length ? 'Re-issue' : 'Issue'}</button>
        {mine.length > 0 && (
          <>
            <button className="btn btn-small" disabled={!!busy} onClick={() => download(mine, `${e.code}_certificates.pdf`)}>{busy === `${e.code}_certificates.pdf` ? 'Preparing…' : 'Download all'}</button>
            {winners.length > 0 && <button className="btn btn-small" disabled={!!busy} onClick={() => download(winners, `${e.code}_winner_certificates.pdf`)}>Winners only</button>}
            <select value={teamSel} aria-label={`Download one team's certificates in ${e.name}`}
              onChange={(ev) => { const id = Number(ev.target.value); setTeamSel(''); if (id) { const t = teams.find((x) => x.team_id === id); download(mine.filter((c) => c.team_id === id), `${e.code}_${t.team_code || id}_certificates.pdf`) } }}>
              <option value="">One team…</option>
              {teams.map((t) => <option key={t.team_id} value={t.team_id}>{t.team_code} {t.team_name}</option>)}
            </select>
          </>
        )}
      </div></td>
    </tr>
  )
}

export default function Certificates() {
  const { data, error, loading, reload } = useLoad(async () => {
    const [ref, events, sigs, branding, certs, results, gaps] = await Promise.all([
      loadReference(),
      q(supabase.from('events').select('*').order('sort')),
      q(supabase.from('signatories').select('*').order('sort').order('id')),
      q(supabase.from('branding').select('*').eq('id', 1).maybeSingle()),
      qAll(() => supabase.from('certificates').select('*').order('id')),
      qAll(() => supabase.from('v_team_result').select('team_id, event_id, n_criteria_scored').order('team_id')),
      q(supabase.rpc('certificate_gaps')),
    ])
    return { ref, events, sigs, branding: branding || {}, certs, results, gaps }
  }, [])
  const [msg, setMsg] = useState(null)
  if (loading && !data) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  const { ref, events, sigs, branding, certs, results, gaps } = data
  const ctx = { settings: ref.settings, events, sdgById: ref.sdgById, signatories: sigs, branding }
  // fn may return a message; it is shown once the page has the refreshed data.
  const act = async (fn) => { setMsg(null); try { const m = await fn(); await reload(); if (m) setMsg(m) } catch (err) { setMsg({ kind: 'error', text: err.message }) } }
  const noSigs = !sigs.some((s) => s.active)

  return (
    <>
      <div className="page-head">
        <h1>Certificates</h1>
        <p className="lede">Every member of every evaluated team gets a participation certificate for each round they were evaluated in. The members of the top 3 teams in the department-level final also get a winner certificate with their place. Each shows the member's name and USN, team, problem statement and SDGs, the hackathon, round, department, institution and date, the logos, the signatures and a certificate ID.</p>
      </div>
      {msg && <div className={`alert alert-${msg.kind}`} role="status"><span>{msg.text}</span></div>}
      {noSigs && <div className="alert alert-warn"><span>Add at least one signatory below before downloading certificates.</span></div>}

      <section className="panel">
        <h2>Rounds</h2>
        <ol className="steps small">
          <li>Set each round's <b>date</b> on its round page; it's printed on the certificates.</li>
          <li>Click <b>Issue</b> once the round is fully scored, and check the PDF with <b>Download all</b>.</li>
          <li>Click <b>Release to teams</b> so teams can download their members' certificates from the team portal.</li>
        </ol>
        <p className="muted small">If marks or team details change later, click <b>Re-issue</b>. Each member keeps their certificate ID, so certificates already shared still verify.</p>
        <div className="scroll">
          <table className="table cert-table">
            <thead><tr><th>Round</th><th>Date</th><th>Signed by</th><th className="r">Teams evaluated</th><th>Winner certificates</th><th>Issued</th><th>Teams</th><th /></tr></thead>
            <tbody>
              {events.map((e) => (
                <RoundRow key={e.id} e={e} certs={certs} ctx={ctx} act={act} setMsg={setMsg} gaps={gaps.filter((g) => g.event_id === e.id)}
                  scored={results.filter((r) => r.event_id === e.id && r.n_criteria_scored > 0).length} />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <Logos branding={branding} reload={reload} setMsg={setMsg} />
      <Signatories sigs={sigs} events={events} reload={reload} setMsg={setMsg} />
    </>
  )
}
