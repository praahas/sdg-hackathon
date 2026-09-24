import React, { useState } from 'react'
import { supabase } from '../../lib/supabase'
import PoweredBy from '../../components/PoweredBy'

export default function PendingApproval({ profile, onRecheck }) {
  const [busy, setBusy] = useState(false)
  const declined = profile.role === 'rejected'
  return (
    <div className="landing">
      <div className="center-card pending-card">
        <span className="brand-mark big" aria-hidden="true" />
        <h1>{declined ? 'Evaluator access declined' : 'Waiting for approval'}</h1>
        {declined ? (
          <p>The coordinator hasn't approved <b>{profile.email}</b> as an evaluator. If you think this is a mistake, contact the hackathon coordinator. If you're registering a team, use the team portal with a different email.</p>
        ) : (
          <>
            <p>Thanks, <b>{profile.full_name || profile.email}</b>. Your evaluator account has been created and is waiting for the coordinator to approve it.</p>
            <p className="muted">Once approved, you'll see the rounds you've been assigned to judge. There's no need to sign up again; just check back here.</p>
          </>
        )}
        <div className="row-gap">
          {!declined && (
            <button className="btn btn-primary" disabled={busy} onClick={async () => { setBusy(true); await onRecheck(); setBusy(false) }}>
              {busy ? 'Checking…' : 'Check again'}
            </button>
          )}
          <button className="btn" onClick={() => { sessionStorage.setItem('sdg-after-signout', 'evaluator'); supabase.auth.signOut() }}>Sign out</button>
        </div>
        <PoweredBy />
      </div>
    </div>
  )
}
