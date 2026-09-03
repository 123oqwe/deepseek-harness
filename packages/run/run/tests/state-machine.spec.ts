/**
 * Contract-stage RED scaffold for Epic P4-01's first-class Run Service and
 * Run event log. One case per registry-declared must[]/acceptance[] clause —
 * must[0]'s closed Run-state set and acceptance[1]'s legal/illegal
 * transitions are covered together by an exhaustive 10x10 state-pair sweep
 * derived directly from `../src/state-machine.ts`'s real, exported
 * `LEGAL_RUN_TRANSITIONS` table, so every one of the table's 21 legal edges
 * has its own passing-direction case and every other pair (including every
 * self-transition and every transition attempted out of a terminal state)
 * has its own rejected-direction case — never only the rejection side.
 *
 * Every case below calls a real exported function against real branded
 * fixture data; every function under test currently throws
 * `'not implemented: ...'` (`../src/events.ts`, `../src/state-machine.ts`),
 * so every case fails for that reason today — the assertions themselves
 * describe the behavior a later fix-round must satisfy.
 */

import { brandString } from '@deepseek-ai/dsh-brand'
import { RunId } from '@deepseek-ai/dsh-principal/types'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { describe, expect, it } from 'vitest'
import { appendRunEvent, genesisRunEvent, referencesByKind } from '../src/events.ts'
import {
  LEGAL_RUN_TRANSITIONS,
  RUN_SERVICE_OWNER_ID,
  TERMINAL_RUN_STATES,
  attachSessionToRun,
  createRun,
  listNonTerminalRuns,
  resumeRun,
  transition,
} from '../src/state-machine.ts'
import { RunEventSeq } from '../src/types.ts'
import type {
  ActionRef,
  ApprovalRef,
  ArtifactRef,
  Run,
  RunEntityReference,
  RunEvent,
  RunState,
  VerificationRef,
  WorkflowRef,
} from '../src/types.ts'

/** Deterministic timestamp fixtures build with, so construction stays pure and comparable. */
const FIXED_TIME = 1_700_000_000_000

/** Build a fixture {@link RunEvent} without exercising the (stubbed) real `genesisRunEvent`. */
function fixtureGenesisEvent(runId: RunId, state: RunState): RunEvent {
  return { seq: RunEventSeq(0), runId, occurredAt: FIXED_TIME, fromState: null, toState: state, references: [] }
}

/** Build a fixture {@link Run} without exercising the (stubbed) real `createRun`. */
function fixtureRun(
  state: RunState,
  overrides: Partial<Pick<Run, 'id' | 'sessionIds' | 'events'>> = {},
): Run {
  const id = overrides.id ?? RunId('run-fixture')
  return {
    id,
    state,
    ownerId: RUN_SERVICE_OWNER_ID,
    sessionIds: overrides.sessionIds ?? [SessionId('session-fixture')],
    createdAt: FIXED_TIME,
    events: overrides.events ?? [fixtureGenesisEvent(id, state)],
  }
}

const ALL_RUN_STATES: readonly RunState[] = [
  'accepted', 'planning', 'waiting', 'running', 'paused', 'verifying', 'reconciling', 'succeeded', 'failed', 'cancelled',
]

/**
 * Every (from, to) pair the registry's must[0]/acceptance[1] clauses apply
 * to, with the expected outcome derived from the real `LEGAL_RUN_TRANSITIONS` table.
 */
const transitionMatrix: readonly (readonly [RunState, RunState, 'accepted' | 'rejected'])[] = ALL_RUN_STATES.flatMap(
  from => ALL_RUN_STATES.map(
    to => [from, to, LEGAL_RUN_TRANSITIONS[from].includes(to) ? 'accepted' as const : 'rejected' as const] as const,
  ),
)

describe('P4-01 Contract — must[0]/acceptance[1]: every Run state pair is exactly legal or illegal per the declared transition table', () => {
  it.each(transitionMatrix)('%s -> %s is %s', (from, to, expected) => {
    const run = fixtureRun(from)
    const decision = transition(run, to, [], FIXED_TIME)
    if (expected === 'accepted') {
      expect(decision.accepted).toBe(true)
      if (decision.accepted) {
        expect(decision.run.state).toBe(to)
        expect(decision.run.events).toHaveLength(run.events.length + 1)
        const lastEvent = decision.run.events[decision.run.events.length - 1]
        expect(lastEvent?.fromState).toBe(from)
        expect(lastEvent?.toState).toBe(to)
      }
    } else {
      expect(decision.accepted).toBe(false)
      if (!decision.accepted) {
        expect(decision.reason).toBe('illegal-transition')
        expect(decision.from).toBe(from)
        expect(decision.to).toBe(to)
      }
    }
  })
})

describe('P4-01 Contract — must[1]: the Run event log is append-only and references Session/Workflow/Action/Artifact/Approval/Verification', () => {
  it('genesisRunEvent mints the Run\'s first log entry with no prior state', () => {
    const id = RunId('run-genesis')
    const initialSessionRef: RunEntityReference = { kind: 'session', id: SessionId('session-genesis') }
    const event = genesisRunEvent(id, 'accepted', [initialSessionRef], FIXED_TIME)
    expect(event).toStrictEqual({
      seq: RunEventSeq(0),
      runId: id,
      occurredAt: FIXED_TIME,
      fromState: null,
      toState: 'accepted',
      references: [initialSessionRef],
    })
  })

  it('appendRunEvent appends exactly one new entry at the next seq, leaving every prior entry unchanged', () => {
    const id = RunId('run-append')
    const priorEvents: readonly [RunEvent, ...RunEvent[]] = [
      fixtureGenesisEvent(id, 'accepted'),
      { seq: RunEventSeq(1), runId: id, occurredAt: FIXED_TIME, fromState: 'accepted', toState: 'planning', references: [] },
    ]
    const run = fixtureRun('planning', { id, events: priorEvents })
    const newReferences: readonly RunEntityReference[] = [{ kind: 'workflow', id: brandString<WorkflowRef>('workflow-1') }]
    const nextOccurredAt = FIXED_TIME + 1000
    const events = appendRunEvent(run, 'running', newReferences, nextOccurredAt)

    expect(events).toHaveLength(priorEvents.length + 1)
    expect(events.slice(0, priorEvents.length)).toStrictEqual(priorEvents)
    expect(events[priorEvents.length]).toStrictEqual({
      seq: RunEventSeq(priorEvents.length),
      runId: id,
      occurredAt: nextOccurredAt,
      fromState: 'planning',
      toState: 'running',
      references: newReferences,
    })
  })

  it('a single event carries references to all six must[1] entity kinds at once, in exact order', () => {
    const id = RunId('run-refs')
    const run = fixtureRun('verifying', { id })
    const references: readonly RunEntityReference[] = [
      { kind: 'session', id: SessionId('session-a') },
      { kind: 'workflow', id: brandString<WorkflowRef>('workflow-a') },
      { kind: 'action', id: brandString<ActionRef>('action-a') },
      { kind: 'artifact', id: brandString<ArtifactRef>('artifact-a') },
      { kind: 'approval', id: brandString<ApprovalRef>('approval-a') },
      { kind: 'verification', id: brandString<VerificationRef>('verification-a') },
    ]
    const events = appendRunEvent(run, 'succeeded', references, FIXED_TIME)
    expect(events[events.length - 1]?.references).toStrictEqual(references)
  })

  it('referencesByKind extracts only the references of the requested kind, across the whole log, in log order', () => {
    const id = RunId('run-query')
    const artifactA: RunEntityReference = { kind: 'artifact', id: brandString<ArtifactRef>('artifact-a') }
    const artifactB: RunEntityReference = { kind: 'artifact', id: brandString<ArtifactRef>('artifact-b') }
    const approvalA: RunEntityReference = { kind: 'approval', id: brandString<ApprovalRef>('approval-a') }
    const events: readonly RunEvent[] = [
      { seq: RunEventSeq(0), runId: id, occurredAt: FIXED_TIME, fromState: null, toState: 'accepted', references: [artifactA] },
      { seq: RunEventSeq(1), runId: id, occurredAt: FIXED_TIME, fromState: 'accepted', toState: 'planning', references: [approvalA] },
      { seq: RunEventSeq(2), runId: id, occurredAt: FIXED_TIME, fromState: 'planning', toState: 'running', references: [artifactB] },
    ]
    const result = referencesByKind(events, 'artifact')
    expect(result).toStrictEqual([artifactA, artifactB])
    expect(result).not.toContainEqual(approvalA)
  })
})

describe('P4-01 Contract — must[2]: every Run is owned by the Run Service itself, never a UI session or turn holder', () => {
  it('createRun always stamps RUN_SERVICE_OWNER_ID regardless of which Session initiates it, and that id is distinct from any Session id', () => {
    const sessionA = SessionId('ui-session-a')
    const runA = createRun(RunId('run-a'), sessionA, FIXED_TIME)
    expect(runA.ownerId).toBe(RUN_SERVICE_OWNER_ID)
    expect(String(runA.ownerId)).not.toBe(String(sessionA))

    const sessionB = SessionId('ui-session-b')
    const runB = createRun(RunId('run-b'), sessionB, FIXED_TIME)
    expect(runB.ownerId).toBe(RUN_SERVICE_OWNER_ID)
  })
})

describe('P4-01 Contract — acceptance[0]: after a process restart, every non-terminal Run can be listed and resumed', () => {
  it('listNonTerminalRuns returns exactly the Runs in a non-terminal state, excluding every terminal Run', () => {
    const nonTerminalStates: readonly RunState[] = ['accepted', 'planning', 'waiting', 'running', 'paused', 'verifying', 'reconciling']
    const terminalStates: readonly RunState[] = ['succeeded', 'failed', 'cancelled']
    const allStates = [...nonTerminalStates, ...terminalStates]
    const runs = allStates.map((state, i) => fixtureRun(state, { id: RunId(`run-${String(i)}`) }))

    const result = listNonTerminalRuns(runs)

    expect(result.map(run => run.id)).toStrictEqual(nonTerminalStates.map((_, i) => RunId(`run-${String(i)}`)))
    for (const run of result) expect(TERMINAL_RUN_STATES.has(run.state)).toBe(false)
  })

  it('a non-terminal Run resumes with its state and service ownership intact', () => {
    const run = fixtureRun('running')
    const decision = resumeRun(run)
    expect(decision.resumed).toBe(true)
    if (decision.resumed) {
      expect(decision.run.state).toBe('running')
      expect(decision.run.ownerId).toBe(RUN_SERVICE_OWNER_ID)
    }
  })

  it('a terminal Run cannot be resumed', () => {
    const run = fixtureRun('succeeded')
    const decision = resumeRun(run)
    expect(decision.resumed).toBe(false)
    if (!decision.resumed) expect(decision.reason).toBe('already-terminal')
  })
})

describe('P4-01 Contract — acceptance[2]: one Session can associate with multiple Runs, and one Run can span multiple Sessions/Agents', () => {
  it('the same Session id seeds two independently created Runs', () => {
    const sharedSession = SessionId('shared-session')
    const runA = createRun(RunId('run-shared-a'), sharedSession, FIXED_TIME)
    expect(runA.sessionIds).toStrictEqual([sharedSession])

    const runB = createRun(RunId('run-shared-b'), sharedSession, FIXED_TIME)
    expect(runB.sessionIds).toStrictEqual([sharedSession])
    expect(runA.id).not.toBe(runB.id)
  })

  it('attachSessionToRun appends an additional Session/Agent, so one Run spans multiple Sessions', () => {
    const sessionA = SessionId('agent-session-a')
    const sessionB = SessionId('agent-session-b')
    const run = fixtureRun('running', { sessionIds: [sessionA] })
    const updated = attachSessionToRun(run, sessionB)
    expect(updated.sessionIds).toStrictEqual([sessionA, sessionB])
  })

  it('attachSessionToRun is idempotent: re-attaching an already-present Session does not duplicate it', () => {
    const sessionA = SessionId('agent-session-a')
    const run = fixtureRun('running', { sessionIds: [sessionA] })
    const updated = attachSessionToRun(run, sessionA)
    expect(updated.sessionIds).toStrictEqual([sessionA])
  })
})
