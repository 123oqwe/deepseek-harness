/**
 * B-726 (P4-12 acceptance[1]): the resume repair sends the external effects of
 * the calls it closes as interrupted to reconciliation. `settleInterruptedEffects`
 * picks the calls closed with TOOL_OUTCOME_UNKNOWN, finds their manifests
 * (a `run_code` call's include its code-mode sub-calls, `<callId>:ptc:<n>`), and
 * hands their scoped keys to the ledger in one call.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { LedgerEntry, LedgerScope } from '@deepseek-ai/dsh-action-ledger'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { TOOL_NOT_STARTED, TOOL_OUTCOME_UNKNOWN } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { settleInterruptedEffects } from '../src/external-effect.ts'

/** A context that resolves `actionLedger` to a recording fake, or to nothing. */
function contextWith(ledger: { calls: (readonly { readonly scope: LedgerScope; readonly key: string }[])[] } | undefined): Context {
  const service = ledger === undefined
    ? undefined
    : {
      markInterrupted: (keys: readonly { readonly scope: LedgerScope; readonly key: string }[]): readonly LedgerEntry[] => {
        ledger.calls.push([...keys])
        return keys.map(({ scope, key }) => ({ scope, key, state: 'ambiguous' }) as unknown as LedgerEntry)
      },
    }
  return { get: (name: string) => (name === 'actionLedger' ? service : undefined) } as unknown as Context
}

/** A manifest event for one action id under one actor. */
function manifest(actionId: string, actor: string, idempotencyKey: string): SessionEvent {
  return { type: 'action/manifest-appended', data: { actionId, actor, idempotencyKey } } as unknown as SessionEvent
}

/** A synthetic closer for one call, with the given error code. */
function closer(callId: string, code: string): SessionEvent {
  return {
    type: 'tool/result',
    data: { message: { source: { kind: 'tool', callId } }, error: { name: 'Closer', code } },
  } as unknown as SessionEvent
}

const persisted: readonly SessionEvent[] = [
  manifest('call-send', 'host-user', 'key-send'),
  manifest('call-code', 'host-user', 'key-code'),
  manifest('call-code:ptc:1', 'host-user', 'key-code-sub-1'),
  manifest('call-code:ptc:2', 'host-user', 'key-code-sub-2'),
  manifest('call-other', 'host-user', 'key-other'),
  { type: 'turn/start', data: {} } as unknown as SessionEvent,
]

describe('settleInterruptedEffects (B-726): the resume repair sends interrupted calls\' effects to reconciliation', () => {
  it('hands the ledger every manifest of each call closed as outcome-unknown, a run_code call\'s sub-calls included, in one call', () => {
    const ledger = { calls: [] as (readonly { readonly scope: LedgerScope; readonly key: string }[])[] }
    const moved = settleInterruptedEffects(contextWith(ledger), persisted, [
      closer('call-send', TOOL_OUTCOME_UNKNOWN),
      closer('call-code', TOOL_OUTCOME_UNKNOWN),
      closer('call-other', TOOL_NOT_STARTED),
      { type: 'turn/end', data: {} } as unknown as SessionEvent,
    ])
    expect(ledger.calls).toEqual([[
      { scope: 'host-user', key: 'key-send' },
      { scope: 'host-user', key: 'key-code' },
      { scope: 'host-user', key: 'key-code-sub-1' },
      { scope: 'host-user', key: 'key-code-sub-2' },
    ]])
    expect(moved.map(entry => entry.key)).toEqual(['key-send', 'key-code', 'key-code-sub-1', 'key-code-sub-2'])
  })

  it('asks nothing when no call was closed as outcome-unknown, or none of them has a manifest', () => {
    const ledger = { calls: [] as (readonly { readonly scope: LedgerScope; readonly key: string }[])[] }
    expect(settleInterruptedEffects(contextWith(ledger), persisted, [closer('call-other', TOOL_NOT_STARTED)])).toEqual([])
    expect(settleInterruptedEffects(contextWith(ledger), persisted, [closer('call-unmanifested', TOOL_OUTCOME_UNKNOWN)])).toEqual([])
    expect(ledger.calls).toEqual([])
  })

  it('does nothing in a composition with no ledger mounted', () => {
    expect(settleInterruptedEffects(contextWith(undefined), persisted, [closer('call-send', TOOL_OUTCOME_UNKNOWN)])).toEqual([])
  })
})
