import { createHash } from 'node:crypto'
import type { WorkflowJournal, JournalStep, StepState } from './types.ts'

export function createJournal(runId: string, scriptDigest: string): WorkflowJournal {
  return { runId, scriptDigest, steps: [], createdAt: new Date().toISOString() }
}

export function addStep(journal: WorkflowJournal, step: JournalStep): WorkflowJournal {
  return { ...journal, steps: [...journal.steps, step] }
}

export function updateStep(journal: WorkflowJournal, stepId: string, updates: Partial<JournalStep>): WorkflowJournal {
  return {
    ...journal,
    steps: journal.steps.map(s => s.stepId === stepId ? { ...s, ...updates } : s),
  }
}

export function getCompletedSteps(journal: WorkflowJournal): JournalStep[] {
  return journal.steps.filter(s => s.state === 'completed')
}

export function getResumePoint(journal: WorkflowJournal): JournalStep | undefined {
  // Skip completed pure steps; find first non-completed step
  // For steps with side effects, return the first non-confirmed one
  return journal.steps.find(s => s.state !== 'completed' && s.state !== 'skipped')
}

export function shouldSkipOnResume(step: JournalStep): boolean {
  // Skip completed steps that have no unconfirmed side effects
  return step.state === 'completed' && step.sideEffectReceipts.length > 0
}

export function needsReconciliation(step: JournalStep): boolean {
  return step.state === 'running' || (step.state === 'completed' && step.sideEffectReceipts.length === 0)
}

export function computeJournalDigest(journal: WorkflowJournal): string {
  const canonical = JSON.stringify({ runId: journal.runId, scriptDigest: journal.scriptDigest, steps: journal.steps })
  return createHash('sha256').update(canonical).digest('hex')
}
