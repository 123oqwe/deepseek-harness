/**
 * Epic P3-03 C: the typed outcome of an execution that did not succeed, the
 * mappings to it from control-channel facts, and the retry class each kind
 * implies. The mappings read a structured name and code and nothing else, so
 * these cases are the table itself, row by row.
 */
import { describe, expect, it } from 'vitest'
import {
  outcomeOfModelFailure,
  outcomeOfToolError,
  retryClassOf,
  type ExecutionOutcome,
  type ModelFailureFacts,
  type RetryClass,
  type ToolErrorFacts,
} from '../src/index.ts'

const BEFORE_DISPATCH = 'ABORTED_BEFORE_DISPATCH'

describe('P3-03 must[1]: a tool error\'s structured facts decide its outcome', () => {
  it('maps every row of the tool table', () => {
    const rows: [ToolErrorFacts, ExecutionOutcome][] = [
      [{ name: 'AbortError', code: 'ABORTED' }, { kind: 'cancelled', by: 'abort' }],
      [{ name: 'AbortError', code: BEFORE_DISPATCH }, { kind: 'cancelled', by: 'abort' }],
      [{ code: 'ABORTED' }, { kind: 'cancelled', by: 'abort' }],
      [{ name: 'FencedError', code: BEFORE_DISPATCH }, { kind: 'cancelled', by: 'fenced' }],
      [{ name: 'LeaseRefusedError', code: BEFORE_DISPATCH }, { kind: 'world_lost', reason: 'lease-refused' }],
      [{ name: 'PolicyRefusedError', code: BEFORE_DISPATCH }, { kind: 'policy_denied', source: 'policy', name: 'PolicyRefusedError' }],
      [{ name: 'RiskRefusedError', code: BEFORE_DISPATCH }, { kind: 'policy_denied', source: 'risk', name: 'RiskRefusedError' }],
      [{ name: 'ApprovalNoLongerValidError', code: BEFORE_DISPATCH }, { kind: 'policy_denied', source: 'approval', name: 'ApprovalNoLongerValidError' }],
      [{ name: 'ApprovalConsumedError', code: BEFORE_DISPATCH }, { kind: 'policy_denied', source: 'approval', name: 'ApprovalConsumedError' }],
      [{ name: 'LedgerRefusedError', code: BEFORE_DISPATCH }, { kind: 'policy_denied', source: 'ledger', name: 'LedgerRefusedError' }],
      [{ name: 'DispatchRefusedError', code: BEFORE_DISPATCH }, { kind: 'policy_denied', source: 'dispatch', name: 'DispatchRefusedError' }],
      [{ name: 'UnrecordedCallRefusedError', code: BEFORE_DISPATCH }, { kind: 'policy_denied', source: 'dispatch', name: 'UnrecordedCallRefusedError' }],
      [{ name: 'ToolTimeoutError', code: 'TOOL_TIMEOUT' }, { kind: 'timeout', by: 'tool-guard' }],
      [{ name: 'ToolCapabilityTokenError', code: 'TOOL_TOKEN_DENIED' }, { kind: 'policy_denied', source: 'policy', name: 'ToolCapabilityTokenError' }],
      [{ code: 'TOOL_TOKEN_DENIED' }, { kind: 'policy_denied', source: 'policy', name: 'TOOL_TOKEN_DENIED' }],
      [{ name: 'SandboxLostError', code: 'WORLD_LOST' }, { kind: 'world_lost', reason: 'lost-contact' }],
      [{ name: 'HarnessError', code: 'FS_SANDBOX_DENIED' }, { kind: 'policy_denied', source: 'sandbox', name: 'HarnessError' }],
      [{ code: 'SANDBOX_UNAVAILABLE' }, { kind: 'policy_denied', source: 'sandbox', name: 'SANDBOX_UNAVAILABLE' }],
      [{ name: 'SubprocessLimitsRefusedError' }, { kind: 'resource_exhausted', limit: 'ceiling' }],
      [{ name: 'WorldCeilingsRefusedError' }, { kind: 'resource_exhausted', limit: 'ceiling' }],
      [{ name: 'HarnessError', code: 'ENOENT' }, { kind: 'tool_failed', code: 'ENOENT' }],
      [{}, { kind: 'tool_failed' }],
    ]
    for (const [facts, outcome] of rows) expect([facts, outcomeOfToolError(facts)]).toEqual([facts, outcome])
  })

  it('reads a refusal name as a refusal only with the pre-dispatch code, and an unknown name never as one', () => {
    // A tool that names its own error like a gate's refusal ran, and failed;
    // nothing refused it. An unknown or missing name with the pre-dispatch
    // code, including a prototype key, is a fact this table has never seen.
    const rows: [ToolErrorFacts, ExecutionOutcome][] = [
      [{ name: 'PolicyRefusedError', code: 'TOOL_FAILED' }, { kind: 'tool_failed', code: 'TOOL_FAILED' }],
      [{ name: 'PolicyRefusedError' }, { kind: 'tool_failed' }],
      [{ name: 'SomeNewRefusalError', code: BEFORE_DISPATCH }, { kind: 'tool_failed', code: BEFORE_DISPATCH }],
      [{ name: 'constructor', code: BEFORE_DISPATCH }, { kind: 'tool_failed', code: BEFORE_DISPATCH }],
      [{ code: BEFORE_DISPATCH }, { kind: 'tool_failed', code: BEFORE_DISPATCH }],
    ]
    for (const [facts, outcome] of rows) expect([facts, outcomeOfToolError(facts)]).toEqual([facts, outcome])
  })
})

describe('P3-03 must[1]: a model failure\'s code decides its outcome', () => {
  it('maps every row of the model table', () => {
    const rows: [ModelFailureFacts, ExecutionOutcome][] = [
      [{ code: 'ABORTED' }, { kind: 'cancelled', by: 'abort' }],
      [{ code: 'TIMEOUT' }, { kind: 'timeout', by: 'provider' }],
      [{ code: 'QUOTA' }, { kind: 'resource_exhausted', limit: 'budget' }],
      [{ code: 'CONTEXT_WINDOW_EXCEEDED' }, { kind: 'resource_exhausted', limit: 'budget' }],
      [{ code: 'RATE_LIMIT' }, { kind: 'tool_failed', code: 'RATE_LIMIT' }],
    ]
    for (const [failure, outcome] of rows) expect([failure, outcomeOfModelFailure(failure)]).toEqual([failure, outcome])
  })
})

describe('P3-03 acceptance[2]: each outcome kind implies its retry class', () => {
  it('names a refusal, an exhausted budget and a cancellation permanent, a deadline and a lost world transient, a tool failure the tool\'s', () => {
    const rows: [ExecutionOutcome, RetryClass][] = [
      [{ kind: 'policy_denied', source: 'policy', name: 'PolicyRefusedError' }, 'permanent'],
      [{ kind: 'resource_exhausted', limit: 'budget' }, 'permanent'],
      [{ kind: 'cancelled', by: 'fenced' }, 'permanent'],
      [{ kind: 'timeout', by: 'executor', deadlineMs: 1000 }, 'transient'],
      [{ kind: 'world_lost', reason: 'lease-refused' }, 'transient'],
      [{ kind: 'tool_failed', exitCode: 1 }, 'by-tool'],
    ]
    for (const [outcome, retryClass] of rows) expect([outcome.kind, retryClassOf(outcome)]).toEqual([outcome.kind, retryClass])
  })
})
