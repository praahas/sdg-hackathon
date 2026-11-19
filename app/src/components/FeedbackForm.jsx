import React, { useState } from 'react'

export const RATING_LABELS = ['Poor', 'Fair', 'Good', 'Very good', 'Excellent']

// One member's feedback form. questions: active questions in order; initial: saved answers.
export default function FeedbackForm({ member, questions, initial, onSubmit, onCancel }) {
  const [a, setA] = useState(() => ({ ...(initial || {}) }))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const set = (id, v) => { setErr(null); setA((x) => ({ ...x, [id]: v })) }
  const missing = questions.filter((qn) => qn.required && (a[qn.id] === undefined || a[qn.id] === null || String(a[qn.id]).trim() === ''))

  async function submit(e) {
    e.preventDefault(); setErr(null)
    if (missing.length) return setErr(`Please answer: ${missing[0].prompt}`)
    setBusy(true)
    try { await onSubmit(a) } catch (x) { setErr(x.message); setBusy(false) }
  }

  return (
    <form className="fb-form" onSubmit={submit}>
      <p className="fb-who">Feedback from <b>{member.member_name}</b>{member.usn && <span className="muted"> {member.usn}</span>}</p>
      {questions.map((qn, i) => (
        <fieldset key={qn.id} className="fb-q">
          <legend><span className="fb-n">{i + 1}.</span> {qn.prompt}{!qn.required && <span className="muted small"> (optional)</span>}</legend>
          {qn.kind === 'rating' && (
            <div className="fb-scale" role="radiogroup" aria-label={qn.prompt}>
              {RATING_LABELS.map((label, k) => (
                <label key={k} className={`fb-opt ${a[qn.id] === k + 1 ? 'on' : ''}`}>
                  <input type="radio" name={`q${qn.id}`} checked={a[qn.id] === k + 1} onChange={() => set(qn.id, k + 1)} />
                  <b>{k + 1}</b><span>{label}</span>
                </label>
              ))}
            </div>
          )}
          {qn.kind === 'choice' && (
            <div className="fb-scale fb-choice" role="radiogroup" aria-label={qn.prompt}>
              {qn.options.map((o) => (
                <label key={o} className={`fb-opt ${a[qn.id] === o ? 'on' : ''}`}>
                  <input type="radio" name={`q${qn.id}`} checked={a[qn.id] === o} onChange={() => set(qn.id, o)} />
                  <span>{o}</span>
                </label>
              ))}
            </div>
          )}
          {qn.kind === 'text' && (
            <textarea rows={3} maxLength={2000} value={a[qn.id] || ''} onChange={(e) => set(qn.id, e.target.value)} aria-label={qn.prompt} />
          )}
        </fieldset>
      ))}
      {err && <div className="alert alert-error" role="alert">{err}</div>}
      <div className="row-gap">
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Submitting…' : initial ? 'Update feedback' : 'Submit feedback'}</button>
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </form>
  )
}
