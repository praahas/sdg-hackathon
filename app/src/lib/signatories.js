export const MAX_SIGNATURES = 4

// Does this signatory sign the given round's certificates? An empty list means every round.
export const signsRound = (s, eventId) => !s.event_ids?.length || s.event_ids.includes(eventId)

// Ticked signatories for a round in the admin's order (all of them, before the print limit).
export const roundSignatories = (signatories, eventId) => signatories
  .filter((s) => s.active && signsRound(s, eventId))
  .sort((a, b) => a.sort - b.sort || a.id - b.id)

// The signatures printed on a round's certificates.
export const signatoriesFor = (signatories, eventId) => roundSignatories(signatories, eventId).slice(0, MAX_SIGNATURES)
