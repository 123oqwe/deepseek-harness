#!/usr/bin/env node
/**
 * Test driver for P4-12 reconciliation on the SHIPPED headless profile
 * (BLOCKED-311, red first for B-515). It boots the shipped profile once,
 * drives one idempotency key to `ambiguous` through the mounted
 * `ctx.actionLedger`, dispatches `/resolve-effect <key> <outcome>` through the
 * mounted command plane with a test approval answerer standing in for the host
 * user, and reads the entry back. Everything is observed from the live shipped
 * composition, so the spec reads one process's observation rather than this
 * file's conclusion.
 *
 * `P4_12_MODE`:
 * - `approve-confirmed`:  the host user approves `/resolve-effect K confirmed`.
 * - `approve-compensated`: the host user approves `/resolve-effect K compensated`.
 * - `refuse`:            the host user refuses `/resolve-effect K confirmed`.
 * - `non-host`:          a caller that is NOT the host user tries to resolve.
 * - `child-scope`:       a CHILD agent's key (a `delegateChildIdentity` scope,
 *   not the host user's) is driven to `ambiguous`; the host then lists and
 *   resolves it (B-515 v2, BLOCKED-311). Today `/resolve-effect` queries only
 *   the caller's own scope, so the host neither lists nor resolves it.
 *
 * Today `/resolve-effect` is not registered, so `commands.execute` returns
 * `undefined` and the entry stays `ambiguous`: the approve cases fail their
 * assertions without any build error, because this driver calls no new API.
 */
import type { ArgumentsHash, IdempotencyKey } from '@deepseek-ai/dsh-action-manifest'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { brandString } from '@deepseek-ai/dsh-brand'
import { hostUserIdentity } from '@deepseek-ai/dsh-host-user-id'
import { RunId } from '@deepseek-ai/dsh-principal/types'
import { SessionId } from '@deepseek-ai/dsh-session'
import { delegateChildIdentity } from '@deepseek-ai/dsh-subagent'
import { setApprovalPolicy, type ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-action-ledger'
import type {} from '@deepseek-ai/dsh-agent-loop'
import type {} from '@deepseek-ai/dsh-commands'
import { bootProductionProfile } from '../../../../packages/test-support/loader-smoke/tests/fixtures/production-profile.ts'

const configPath = process.argv[2]
const mode = process.env.P4_12_MODE
if (configPath === undefined || mode === undefined) throw new Error('p4-12 driver requires a config path and P4_12_MODE')

const ctx = await bootProductionProfile({
  binName: 'p4-12',
  profile: 'headless',
  overlayPaths: [resolveConfigPath(configPath, undefined)],
})

try {
  const ledger = ctx.get('actionLedger')
  if (ledger === undefined) throw new Error('p4-12: the shipped profile mounted no action ledger')
  const commands = ctx.get('commands')
  if (commands === undefined) throw new Error('p4-12: the shipped profile mounted no command runtime')
  const agentLoop = ctx.get('agentLoop')
  if (agentLoop === undefined) throw new Error('p4-12: the shipped profile mounted no agent loop')

  // The entry belongs to the host user; only the host user may resolve it.
  const hostIdentity = hostUserIdentity(RunId('p4-12-host-run'))
  const scope = hostIdentity.principal.id
  const key = brandString<IdempotencyKey>('p4-12-effect')
  const argumentsHash = brandString<ArgumentsHash>('p4-12-args')

  // The resolving agent is the host user, except in the non-host case, where it
  // carries no host-user identity and must therefore be refused.
  const agent = await agentLoop.create(
    SessionId(`p4-12-${mode}`),
    { provider: 'p4-12-mock', model: 'p4-12-mock', ...mode === 'non-host' ? {} : { identity: hostIdentity } },
    { cwd: process.cwd() },
  )
  setApprovalPolicy(agent.session, 'ask')

  // The test answerer stands in for the host user at the existing approval
  // surface: it approves every case but `refuse`.
  const answer: ApprovalOutcome = mode === 'refuse' ? 'rejected' : 'allowed-once'
  const disposeAnswerer = ctx.on('approval/request', () => Promise.resolve(answer))

  if (mode === 'child-scope') {
    // Condition 1 (B-515 v2, BLOCKED-311): the ambiguous entry belongs to a
    // CHILD agent's scope, not the host user's. The host must still list and
    // resolve it; today `/resolve-effect` queries only the caller's own scope,
    // so the host reaches neither.
    const childIdentity = delegateChildIdentity(agent, SessionId('p4-12-child'))
    if (childIdentity === undefined) throw new Error('p4-12: could not delegate a child identity from the host agent')
    const childScope = childIdentity.principal.id
    ledger.reserve({ scope: childScope, key, argumentsHash, epoch: 'unfenced' })
    ledger.markSent(childScope, key, 'unfenced')
    ledger.markAmbiguous(childScope, key, 'unfenced')
    const controller = new AbortController()
    // The host lists the entries waiting, then resolves the child's key.
    const listExec = await commands.execute(agent, '/resolve-effect', [], controller.signal)
    const resolveExec = await commands.execute(agent, `/resolve-effect ${key} confirmed`, [], controller.signal)
    const childAfter = ledger.entry(childScope, key)
    disposeAnswerer()
    const childResolution = childAfter === undefined ? null : (childAfter as { resolution?: unknown }).resolution ?? null
    process.stdout.write(`P4-12-OBSERVED ${JSON.stringify({
      mode,
      childScope,
      hostList: listExec?.result.text ?? null,
      resolveText: resolveExec?.result.text ?? null,
      childAfter: childAfter === undefined ? null : { state: childAfter.state, resolution: childResolution },
    })}\n`)
  } else {
    // Drive the key to `ambiguous` through the shipped ledger: reserved, sent,
    // then an outcome that retrying cannot settle.
    ledger.reserve({ scope, key, argumentsHash, epoch: 'unfenced' })
    ledger.markSent(scope, key, 'unfenced')
    ledger.markAmbiguous(scope, key, 'unfenced')
    const before = ledger.entry(scope, key)

    // Ask the host user to resolve it through the command plane.
    const outcome = mode === 'approve-compensated' ? 'compensated' : 'confirmed'
    const controller = new AbortController()
    const execution = await commands.execute(agent, `/resolve-effect ${key} ${outcome}`, [], controller.signal)

    const after = ledger.entry(scope, key)
    const reReserve = ledger.reserve({ scope, key, argumentsHash, epoch: 'unfenced' })
    disposeAnswerer()

    const resolution = after === undefined ? null : (after as { resolution?: unknown }).resolution ?? null
    process.stdout.write(`P4-12-OBSERVED ${JSON.stringify({
      mode,
      requested: outcome,
      dispatched: execution !== undefined,
      before: before?.state ?? null,
      after: after === undefined ? null : { state: after.state, resolution },
      reReserve: { action: reReserve.action, reason: 'reason' in reReserve ? reReserve.reason : null },
    })}\n`)
  }
} finally {
  await ctx.fiber.dispose()
}
