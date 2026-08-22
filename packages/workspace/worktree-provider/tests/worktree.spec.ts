import { describe, it, expect } from 'vitest'
import { WorktreeProvider } from '../src/index.ts'
import { mergeWorktree, detectMergeConflicts } from '../src/merge.ts'

describe('P5-12 Worktree Provider', () => {
  it('creates isolated worktree', () => {
    const wp = new WorktreeProvider()
    const wt = wp.create('agent-1', '/worktrees')
    expect(wt.isolated).toBe(true)
    expect(wt.branchName).toContain('agent-1')
  })

  it('detects path conflicts', () => {
    const wp = new WorktreeProvider()
    wp.create('a1', '/base')
    const result = wp.checkConflict('/base')
    expect(result.hasConflict).toBe(false)
  })

  it('detects merge conflicts', () => {
    const handles = [
      { id: '1', path: '/same', branchName: 'b1', agentId: 'a1', createdAt: 0, isolated: true },
      { id: '2', path: '/same', branchName: 'b2', agentId: 'a2', createdAt: 0, isolated: true },
    ]
    const conflicts = detectMergeConflicts(handles)
    expect(conflicts.length).toBe(1)
  })

  it('merge succeeds without conflicts', () => {
    const handles = [
      { id: '1', path: '/a', branchName: 'b1', agentId: 'a1', createdAt: 0, isolated: true },
    ]
    const result = mergeWorktree('/target', handles)
    expect(result.success).toBe(true)
  })
})
