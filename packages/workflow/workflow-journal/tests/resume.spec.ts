import { describe, it, expect } from 'vitest'
import { createJournal, addStep, updateStep, getResumePoint, shouldSkipOnResume, needsReconciliation, computeJournalDigest, type JournalStep } from '../src/index.ts'

const step1: JournalStep = { stepId: 's1', phase: 'init', state: 'completed', inputRef: 'in1', outputRef: 'out1', sideEffectReceipts: [], childAgentReceipts: [] }
const step2: JournalStep = { stepId: 's2', phase: 'process', state: 'pending', inputRef: 'in2', sideEffectReceipts: [], childAgentReceipts: [] }

describe('P4-08 Workflow Journal', () => {
  it('creates a journal', () => {
    const j = createJournal('run-1', 'script-hash')
    expect(j.runId).toBe('run-1')
    expect(j.steps).toHaveLength(0)
  })

  it('adds and updates steps', () => {
    const j = createJournal('run-1', 'hash')
    const j1 = addStep(j, step1)
    expect(j1.steps).toHaveLength(1)
    const j2 = updateStep(j1, 's1', { state: 'failed' })
    expect(j2.steps[0]!.state).toBe('failed')
  })

  it('getResumePoint finds first non-completed step', () => {
    const j = addStep(addStep(createJournal('r', 'h'), step1), step2)
    const resume = getResumePoint(j)
    expect(resume?.stepId).toBe('s2')
  })

  it('shouldSkipOnResume for completed with side effects', () => {
    const step: JournalStep = { ...step1, sideEffectReceipts: ['receipt-1'] }
    expect(shouldSkipOnResume(step)).toBe(true)
  })

  it('needsReconciliation for running step', () => {
    const step: JournalStep = { ...step1, state: 'running' }
    expect(needsReconciliation(step)).toBe(true)
  })

  it('computeJournalDigest is deterministic', () => {
    const j = addStep(createJournal('r', 'h'), step1)
    const d1 = computeJournalDigest(j)
    const d2 = computeJournalDigest(j)
    expect(d1).toBe(d2)
    expect(d1).toMatch(/^[0-9a-f]{64}$/)
  })
})
