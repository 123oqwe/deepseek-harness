export interface RetentionPolicy {
  readonly maxAge: number
  readonly maxSessions: number
  readonly keepStarred: boolean
}

export interface SessionMetadata {
  readonly id: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly starred: boolean
  readonly size: number
}

export function shouldRetain(session: SessionMetadata, policy: RetentionPolicy, now: Date = new Date()): boolean {
  if (policy.keepStarred && session.starred) return true
  const age = now.getTime() - new Date(session.createdAt).getTime()
  if (age > policy.maxAge) return false
  return true
}

export function selectForDeletion(sessions: SessionMetadata[], policy: RetentionPolicy, now: Date = new Date()): SessionMetadata[] {
  const sorted = [...sessions].sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime())
  const toDelete: SessionMetadata[] = []
  const toKeep: SessionMetadata[] = []

  for (const s of sorted) {
    if (shouldRetain(s, policy, now)) {
      toKeep.push(s)
    } else {
      toDelete.push(s)
    }
  }

  if (toKeep.length > policy.maxSessions) {
    const excess = toKeep.slice(0, toKeep.length - policy.maxSessions)
    const deletableExcess = excess.filter(s => !(policy.keepStarred && s.starred))
    toDelete.push(...deletableExcess)
    return [...toDelete, ...excess.filter(s => policy.keepStarred && s.starred)]
  }

  return toDelete
}
