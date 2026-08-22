import { describe, it, expect } from 'vitest'
import { shouldRetain, selectForDeletion, deleteSessions, partialRepair, type SessionMetadata, type RetentionPolicy } from '../src/index.ts'

const now = new Date('2026-08-22T00:00:00Z')
const policy: RetentionPolicy = { maxAge: 30 * 86400000, maxSessions: 100, keepStarred: true }

describe('P6-07 Session Lifecycle', () => {
  describe('retention', () => {
    it('retains recent sessions', () => {
      const session: SessionMetadata = {
        id: 's1', createdAt: '2026-08-20T00:00:00Z', updatedAt: '2026-08-21T00:00:00Z', starred: false, size: 100,
      }
      expect(shouldRetain(session, policy, now)).toBe(true)
    })

    it('deletes old non-starred sessions', () => {
      const session: SessionMetadata = {
        id: 's1', createdAt: '2026-06-01T00:00:00Z', updatedAt: '2026-06-02T00:00:00Z', starred: false, size: 100,
      }
      expect(shouldRetain(session, policy, now)).toBe(false)
    })

    it('retains old starred sessions', () => {
      const session: SessionMetadata = {
        id: 's1', createdAt: '2026-06-01T00:00:00Z', updatedAt: '2026-06-02T00:00:00Z', starred: true, size: 100,
      }
      expect(shouldRetain(session, policy, now)).toBe(true)
    })
  })

  describe('selectForDeletion', () => {
    it('selects old sessions for deletion', () => {
      const sessions: SessionMetadata[] = [
        { id: 'old', createdAt: '2026-06-01T00:00:00Z', updatedAt: '2026-06-01T00:00:00Z', starred: false, size: 100 },
        { id: 'new', createdAt: '2026-08-20T00:00:00Z', updatedAt: '2026-08-21T00:00:00Z', starred: false, size: 100 },
      ]
      const toDelete = selectForDeletion(sessions, policy, now)
      expect(toDelete.some(s => s.id === 'old')).toBe(true)
      expect(toDelete.some(s => s.id === 'new')).toBe(false)
    })
  })

  describe('deleteSessions', () => {
    it('deletes sessions and reports results', () => {
      const result = deleteSessions(['s1', 's2', 's3'], id => id !== 's2')
      expect(result.deleted).toContain('s1')
      expect(result.deleted).toContain('s3')
      expect(result.failed).toContain('s2')
    })
  })

  describe('partialRepair', () => {
    it('repairs valid records and drops invalid ones', () => {
      const records = [1, 2, 3, 0, 4]
      const result = partialRepair(records, n => n > 0 ? n * 10 : null)
      expect(result.repaired).toEqual([10, 20, 30, 40])
      expect(result.dropped).toBe(1)
    })
  })
})
