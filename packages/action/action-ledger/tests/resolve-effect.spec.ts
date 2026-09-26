/**
 * P4-12 acceptance[1] (BLOCKED-311): an ambiguous entry enters reconciliation
 * and leaves it resolved. The store half: a resolve moves only an `ambiguous`
 * entry and writes the resolution with the move. The command half:
 * `/resolve-effect` asks the host user through the approval surface and never
 * returns an entry to `prepared`.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ArgumentsHash, IdempotencyKey } from '@deepseek-ai/dsh-action-manifest'
import type { PrincipalId } from '@deepseek-ai/dsh-principal'
import ActionLedgerPlugin from '../src/plugin.ts'
import { openLedgerStore } from '../src/store.ts'
import type { LedgerStore } from '../src/store.ts'
import type { LedgerEpoch, LedgerResolution, ReceiptDigest } from '../src/types.ts'

const roots: string[] = []
const mounted: Context[] = []
afterEach(async () => {
  for (const ctx of mounted.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** @returns a fresh directory for one ledger. */
function directory(): string {
  const dir = mkdtempSync(join(tmpdir(), 'action-ledger-resolve-'))
  roots.push(dir)
  return dir
}

const HOST = brandString<PrincipalId>('host-user')
const OTHER = brandString<PrincipalId>('other-user')
const KEY = brandString<IdempotencyKey>('effect-1')
const ARGS = brandString<ArgumentsHash>('sha256-aaa')
const EPOCH = 3 as LedgerEpoch
const RESOLVED_AT = 1_790_000_000_000

/**
 * A resolution by the host user.
 * @param outcome - what the host user says happened.
 * @returns the resolution.
 */
function resolution(outcome: LedgerResolution['outcome']): LedgerResolution {
  return { outcome, resolvedBy: HOST, resolvedAt: RESOLVED_AT }
}

/**
 * Drive one key of `scope` to `ambiguous`.
 * @param store - the ledger.
 * @param key - the key.
 * @param scope - its principal.
 */
function ambiguous(store: Pick<LedgerStore, 'reserve' | 'markSent' | 'markAmbiguous'>, key: IdempotencyKey = KEY, scope: PrincipalId = HOST): void {
  store.reserve({ scope, key, argumentsHash: ARGS, epoch: EPOCH })
  store.markSent(scope, key, EPOCH)
  store.markAmbiguous(scope, key, EPOCH)
}

describe('the store: a resolve moves only an ambiguous entry, and writes the resolution with the move', () => {
  it('records a compensated resolution that entry() returns, and the entry is no longer waiting', () => {
    const store = openLedgerStore(directory())
    ambiguous(store)
    expect(store.listAmbiguous(HOST).map(entry => entry.key)).toEqual([KEY])

    store.markCompensated(HOST, KEY, EPOCH, resolution('compensated'))

    expect(store.entry(HOST, KEY)).toMatchObject({ state: 'compensated', resolution: resolution('compensated') })
    expect(store.listAmbiguous(HOST)).toEqual([])
  })

  it('records a confirmed resolution with its receipt, and a later reserve is a duplicate rather than a refusal', () => {
    const store = openLedgerStore(directory())
    ambiguous(store)

    store.confirm(HOST, KEY, EPOCH, brandString<ReceiptDigest>('digest'), resolution('confirmed'))

    expect(store.entry(HOST, KEY)).toMatchObject({ state: 'confirmed', receiptDigest: 'digest', resolution: resolution('confirmed') })
    expect(store.reserve({ scope: HOST, key: KEY, argumentsHash: ARGS, epoch: EPOCH })).toEqual({ action: 'duplicate', state: 'confirmed' })
  })

  it('refuses to resolve an entry that is not ambiguous, and writes no resolution', () => {
    const store = openLedgerStore(directory())
    store.reserve({ scope: HOST, key: KEY, argumentsHash: ARGS, epoch: EPOCH })
    store.markSent(HOST, KEY, EPOCH)

    expect(() => { store.markCompensated(HOST, KEY, EPOCH, resolution('compensated')) })
      .toThrow('action ledger: effect-1 is sent, not ambiguous, so it cannot be resolved')
    expect(store.entry(HOST, KEY)).toEqual({ scope: HOST, key: KEY, argumentsHash: ARGS, state: 'sent', epoch: EPOCH })
  })

  it('refuses a resolve at another generation, and writes no resolution', () => {
    const store = openLedgerStore(directory())
    ambiguous(store)

    expect(() => { store.markCompensated(HOST, KEY, 4 as LedgerEpoch, resolution('compensated')) })
      .toThrow('action ledger: effect-1 is held by epoch 3, not 4')
    expect(store.entry(HOST, KEY)?.resolution).toBeUndefined()
  })

  it('lists the waiting entries of one scope only, by key', () => {
    const store = openLedgerStore(directory())
    ambiguous(store, brandString<IdempotencyKey>('effect-b'))
    ambiguous(store, brandString<IdempotencyKey>('effect-a'))
    ambiguous(store, KEY, OTHER)

    expect(store.listAmbiguous(HOST).map(entry => entry.key)).toEqual(['effect-a', 'effect-b'])
  })

  it('lists the waiting entries of every scope, by scope and then key', () => {
    const store = openLedgerStore(directory())
    ambiguous(store, brandString<IdempotencyKey>('effect-b'))
    ambiguous(store, brandString<IdempotencyKey>('effect-a'), OTHER)
    ambiguous(store, KEY)

    expect(store.listAllAmbiguous().map(entry => [entry.scope, entry.key]))
      .toEqual([[HOST, 'effect-1'], [HOST, 'effect-b'], [OTHER, 'effect-a']])
  })
})

/** The command as this plugin registers it, captured from a stand-in registry. */
interface CapturedCommand {
  readonly name: string
  readonly description: string
  readonly input: { readonly hint: string }
  readonly handler: (invocation: { agent: unknown; rawInput: string; signal: AbortSignal }) => Promise<{ kind: string; text: string }>
}

/**
 * Mount the ledger with a stand-in command registry and, unless `answer` is
 * undefined, a stand-in approval service that gives `answer`.
 * @param answer - the approval outcome, or undefined to mount no approval service.
 * @returns the context, the captured command and the approval requests made.
 */
async function mount(answer: string | undefined): Promise<{ ctx: Context; command: CapturedCommand; requests: unknown[] }> {
  const ctx = new Context()
  mounted.push(ctx)
  let command: CapturedCommand | undefined
  ctx.provide('commands', { register: (definition: CapturedCommand) => { command = definition; return () => undefined } })
  const requests: unknown[] = []
  if (answer !== undefined) {
    ctx.provide('approval', { request: (request: unknown) => { requests.push(request); return Promise.resolve(answer) } })
  }
  await ctx.plugin(ActionLedgerPlugin, { directory: directory() })
  // The command child mounts once `commands` resolves.
  await new Promise(resolve => setImmediate(resolve))
  if (command === undefined) throw new Error('the ledger registered no command')
  return { ctx, command, requests }
}

/**
 * Run `/resolve-effect` for an agent.
 * @param command - the registered command.
 * @param rawInput - the text after the command name.
 * @param principal - the agent's principal, or null for an agent with no identity.
 * @returns the command's result.
 */
function run(
  command: CapturedCommand,
  rawInput: string,
  principal: { kind: string; id: PrincipalId } | null = { kind: 'user', id: HOST },
): Promise<{ kind: string; text: string }> {
  const agent = principal === null ? {} : { identity: { principal } }
  return command.handler({ agent, rawInput, signal: new AbortController().signal })
}

describe('/resolve-effect: the host user settles an ambiguous effect of their own', () => {
  it('is registered where a command registry is composed', async () => {
    const { command } = await mount('allowed-once')
    expect({ name: command.name, description: command.description, input: command.input }).toEqual({
      name: 'resolve-effect',
      description: 'Resolve an external effect whose outcome is unknown',
      input: { hint: '[<idempotencyKey> <confirmed|compensated>]' },
    })
  })

  it('moves an approved entry to confirmed, records who resolved it, and asks the host user what it decides', async () => {
    const { ctx, command, requests } = await mount('allowed-once')
    ambiguous(ctx.actionLedger)

    expect(await run(command, ' effect-1 confirmed')).toEqual({ kind: 'success', text: 'effect-1 is resolved as confirmed.' })

    const entry = ctx.actionLedger.entry(HOST, KEY)
    expect(entry).toMatchObject({ state: 'confirmed', resolution: { outcome: 'confirmed', resolvedBy: HOST } })
    expect(typeof entry?.resolution?.resolvedAt).toBe('number')
    expect(entry?.receiptDigest).toMatch(/^[0-9a-f]{64}$/u)
    expect(requests).toEqual([expect.objectContaining({ toolName: 'resolve-effect', subject: 'effect-1: confirmed' })])
  })

  it('moves an approved entry to compensated, never to prepared', async () => {
    const { ctx, command } = await mount('allowed-once')
    ambiguous(ctx.actionLedger)

    expect(await run(command, 'effect-1 compensated')).toEqual({ kind: 'success', text: 'effect-1 is resolved as compensated.' })
    expect(ctx.actionLedger.entry(HOST, KEY)).toMatchObject({ state: 'compensated', resolution: { outcome: 'compensated' } })
  })

  it('changes nothing when the host user does not approve', async () => {
    const { ctx, command } = await mount('rejected')
    ambiguous(ctx.actionLedger)

    expect(await run(command, 'effect-1 confirmed')).toEqual({ kind: 'error', text: 'The host user did not approve, so effect-1 stays ambiguous.' })
    expect(ctx.actionLedger.entry(HOST, KEY)).toMatchObject({ state: 'ambiguous' })
    expect(ctx.actionLedger.entry(HOST, KEY)?.resolution).toBeUndefined()
  })

  it('changes nothing when no approval service is mounted to ask the host user', async () => {
    const { ctx, command } = await mount(undefined)
    ambiguous(ctx.actionLedger)

    expect(await run(command, 'effect-1 confirmed'))
      .toEqual({ kind: 'error', text: 'No approval surface is mounted to ask the host user, so effect-1 stays ambiguous.' })
    expect(ctx.actionLedger.entry(HOST, KEY)?.state).toBe('ambiguous')
  })

  it('refuses an agent that is not the host user, before anything is asked', async () => {
    const { ctx, command, requests } = await mount('allowed-once')
    ambiguous(ctx.actionLedger)

    const refused = { kind: 'error', text: 'Only the host user can resolve an external effect.' }
    expect(await run(command, 'effect-1 confirmed', null)).toEqual(refused)
    expect(await run(command, 'effect-1 confirmed', { kind: 'service', id: HOST })).toEqual(refused)
    expect(ctx.actionLedger.entry(HOST, KEY)?.state).toBe('ambiguous')
    expect(requests).toEqual([])
  })

  it('lists what is waiting when it is given no arguments', async () => {
    const { ctx, command } = await mount('allowed-once')
    expect(await run(command, '')).toEqual({ kind: 'success', text: 'No external effect is waiting for reconciliation.' })

    ambiguous(ctx.actionLedger)
    expect(await run(command, '  ')).toEqual({ kind: 'success', text: 'Waiting for reconciliation: effect-1.' })
  })

  it('refuses an outcome other than confirmed or compensated, and extra arguments', async () => {
    const { command } = await mount('allowed-once')
    const usage = { kind: 'error', text: 'Usage: /resolve-effect <idempotencyKey> <confirmed|compensated>' }
    expect(await run(command, 'effect-1 prepared')).toEqual(usage)
    expect(await run(command, 'effect-1')).toEqual(usage)
    expect(await run(command, 'effect-1 confirmed now')).toEqual(usage)
  })

  it('refuses a key it has no entry for, and one that is not ambiguous', async () => {
    const { ctx, command } = await mount('allowed-once')
    expect(await run(command, 'effect-1 confirmed')).toEqual({ kind: 'error', text: 'No external effect is recorded under effect-1.' })

    ctx.actionLedger.reserve({ scope: HOST, key: KEY, argumentsHash: ARGS, epoch: EPOCH })
    expect(await run(command, 'effect-1 confirmed'))
      .toEqual({ kind: 'error', text: 'effect-1 is prepared, not ambiguous, so there is nothing to resolve.' })
  })
})

describe('/resolve-effect: the host user settles an ambiguous effect of any scope (B-515 v2, BLOCKED-311)', () => {
  it('resolves an entry that waits under another scope, and writes the resolution under that scope', async () => {
    const { ctx, command } = await mount('allowed-once')
    ambiguous(ctx.actionLedger, KEY, OTHER)
    expect(await run(command, '')).toEqual({ kind: 'success', text: 'Waiting for reconciliation: effect-1.' })

    expect(await run(command, 'effect-1 confirmed')).toEqual({ kind: 'success', text: 'effect-1 is resolved as confirmed.' })

    expect(ctx.actionLedger.entry(OTHER, KEY)).toMatchObject({ scope: OTHER, state: 'confirmed', resolution: { outcome: 'confirmed', resolvedBy: HOST } })
    expect(ctx.actionLedger.entry(HOST, KEY)).toBeUndefined()
  })

  it('refuses a key that waits under two scopes, naming both, and asks nothing', async () => {
    const { ctx, command, requests } = await mount('allowed-once')
    ambiguous(ctx.actionLedger, KEY, HOST)
    ambiguous(ctx.actionLedger, KEY, OTHER)

    expect(await run(command, 'effect-1 compensated'))
      .toEqual({ kind: 'error', text: 'effect-1 is waiting under 2 scopes (host-user, other-user), so the key alone does not name one.' })
    expect([ctx.actionLedger.entry(HOST, KEY)?.state, ctx.actionLedger.entry(OTHER, KEY)?.state]).toEqual(['ambiguous', 'ambiguous'])
    expect(requests).toEqual([])
  })
})
