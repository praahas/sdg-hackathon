import React from 'react'

export function Loading({ label = 'Loading…' }) {
  return <div className="state" role="status">{label}</div>
}

export function ErrorBox({ error, onRetry }) {
  if (!error) return null
  return (
    <div className="alert alert-error" role="alert">
      <span>{error}</span>
      {onRetry && <button className="btn btn-quiet" onClick={onRetry}>Try again</button>}
    </div>
  )
}

export function Notice({ kind = 'info', children }) {
  return <div className={`alert alert-${kind}`}>{children}</div>
}

export function SdgChip({ sdg, compact = false }) {
  if (!sdg) return <span className="muted">—</span>
  return (
    <span className="sdg-chip" style={{ '--sdg': sdg.color }} title={`SDG ${sdg.id}: ${sdg.name}`}>
      <b>{sdg.id}</b>{!compact && <span>{sdg.name}</span>}
    </span>
  )
}

export function LevelChip({ level }) {
  if (level === null || level === undefined) return <span className="muted">—</span>
  return <span className={`level level-${level}`}>L{level}</span>
}

export function SdgSelect({ sdgs, value, onChange, allowEmpty = true, id }) {
  return (
    <select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
      {allowEmpty && <option value="">None</option>}
      {sdgs.map((s) => <option key={s.id} value={s.id}>SDG {s.id}: {s.name}</option>)}
    </select>
  )
}

// "Shortlisted", "Not shortlisted", or a place such as "1st place" in ranked rounds.
export function StatusTag({ status }) {
  if (!status) return <span className="muted">—</span>
  if (status === 'Shortlisted') return <span className="tag tag-open">Shortlisted</span>
  const m = /^(\d+)(st|nd|rd|th) place$/.exec(status)
  if (m) return <span className={`tag tag-place ${Number(m[1]) <= 3 ? `podium podium-${m[1]}` : ''}`}>{status}</span>
  return <span className="muted">{status}</span>
}
