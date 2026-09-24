import React, { useState } from 'react'
import { SdgSelect } from './ui'

const blankMember = { name: '', usn: '' }

export default function TeamForm({ sdgs, settings, rounds, initial, fixedRound, onSubmit, onCancel, submitLabel }) {
  const min = settings.team_min_members ?? 2
  const max = settings.team_max_members ?? 4
  const [f, setF] = useState(() => ({
    event_id: initial?.event_id ?? (rounds?.length === 1 ? rounds[0].id : ''),
    name: initial?.name ?? '',
    members: initial?.member_list?.length ? initial.member_list.map((m) => ({ name: m.name ?? '', usn: m.usn ?? '' }))
      : Array.from({ length: min }, () => ({ ...blankMember })),
    phone: initial?.contact_phone ?? '',
    primary: initial?.primary_sdg ?? null,
    secondary: initial?.secondary_sdg ?? null,
    targets: initial?.sdg_targets ?? '',
    problem: initial?.problem ?? '',
  }))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }))
  const setMember = (i, k, v) => setF((x) => ({ ...x, members: x.members.map((m, j) => (j === i ? { ...m, [k]: v } : m)) }))

  async function submit(e) {
    e.preventDefault(); setErr(null)
    if (!fixedRound && !f.event_id) return setErr('Choose the round your team is registering for.')
    if (!f.primary) return setErr('Choose the primary SDG your solution addresses.')
    if (f.secondary && f.secondary === f.primary) return setErr('The secondary SDG must differ from the primary SDG.')
    setBusy(true)
    try {
      await onSubmit({
        ...f,
        event_id: Number(fixedRound?.id ?? f.event_id),
        members: f.members.map((m) => ({ name: m.name.trim(), usn: m.usn.trim().toUpperCase() })),
      })
    } catch (e2) { setErr(e2.message) } finally { setBusy(false) }
  }

  return (
    <form className="panel team-form" onSubmit={submit}>
      {fixedRound
        ? <p className="muted">Round: <b>{fixedRound.name}</b></p>
        : (
          <label>Round
            <select required value={f.event_id} onChange={(e) => set('event_id')(e.target.value)}>
              <option value="">Choose your section's round</option>
              {rounds.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>
        )}
      <label>Team name<input required maxLength={60} value={f.name} onChange={(e) => set('name')(e.target.value)} /></label>

      <fieldset className="members">
        <legend>Team members ({min} to {max})</legend>
        {f.members.map((m, i) => (
          <div key={i} className="member-row">
            <span className="member-no">{i + 1}</span>
            <input required placeholder="Full name" aria-label={`Member ${i + 1} name`} value={m.name} onChange={(e) => setMember(i, 'name', e.target.value)} />
            <input required placeholder="USN" aria-label={`Member ${i + 1} USN`} value={m.usn} onChange={(e) => setMember(i, 'usn', e.target.value)} className="usn" />
            {f.members.length > min && (
              <button type="button" className="btn btn-small btn-quiet" aria-label={`Remove member ${i + 1}`}
                onClick={() => setF((x) => ({ ...x, members: x.members.filter((_, j) => j !== i) }))}>Remove</button>
            )}
          </div>
        ))}
        {f.members.length < max && (
          <button type="button" className="btn btn-small" onClick={() => setF((x) => ({ ...x, members: [...x.members, { ...blankMember }] }))}>Add member</button>
        )}
        <small className="muted">Put the member whose email you signed up with first; they are the team's contact.</small>
      </fieldset>

      <label>Contact phone<input type="tel" inputMode="tel" maxLength={20} value={f.phone} onChange={(e) => set('phone')(e.target.value)} placeholder="Optional" /></label>

      <div className="form-grid">
        <label>Primary SDG your solution addresses<SdgSelect sdgs={sdgs} value={f.primary} onChange={set('primary')} allowEmpty={false} /></label>
        <label>Secondary SDG (optional)<SdgSelect sdgs={sdgs.filter((s) => s.id !== f.primary)} value={f.secondary} onChange={set('secondary')} /></label>
      </div>
      <label>SDG targets addressed
        <input value={f.targets} maxLength={120} onChange={(e) => set('targets')(e.target.value)} placeholder="e.g. 6.1, 6.3" />
        <small className="muted">Naming the specific target helps evaluators judge how strongly your solution advances the goal.</small>
      </label>
      <label>Problem statement and proposed solution
        <textarea required rows={5} maxLength={1500} value={f.problem} onChange={(e) => set('problem')(e.target.value)}
          placeholder="What problem are you solving, for whom, and how does your solution work?" />
      </label>
      {err && <div className="alert alert-error" role="alert">{err}</div>}
      <div className="row-gap">
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : submitLabel}</button>
        {onCancel && <button type="button" className="btn" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  )
}
