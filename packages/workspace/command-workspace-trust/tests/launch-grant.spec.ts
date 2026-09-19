/**
 * `--trust-workspace`: what the flag accepts, what it refuses, and which
 * launchers may carry it (P1-07, BLOCKED-260/261).
 *
 * The argv cases run against the parser directly rather than through a booted
 * profile. That is deliberate and it is also the only honest option here: the
 * dangerous shape is one the APPS have already consumed by the time any
 * process exists, so a case that booted one would be observing commander's
 * result, not this rule. What the apps do with the same argv is measured in
 * their own startup specs; what this file pins is that a mode is only ever
 * written with `=`.
 */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { applyLaunchTrustRequest, parseLaunchTrustRequest } from '../src/launch-grant.ts'

/**
 * A context carrying the launcher facts this plugin reads.
 * @param args - the inner arguments the launcher provides.
 * @param ready - whether this launcher publishes a startup signal.
 * @returns the context, and the listeners `appReady` collected.
 */
function launcher(args: readonly string[], ready: boolean): { ctx: Context; listeners: (() => void)[] } {
  const ctx = new Context()
  const listeners: (() => void)[] = []
  ctx.provide('cmdlineArgs', { get: () => args } as never)
  if (ready) ctx.provide('appReady', { onReady: (listener: () => void) => { listeners.push(listener); return () => {} } } as never)
  return { ctx, listeners }
}

describe('P1-07: --trust-workspace takes its mode only from `=`', () => {
  it('reads an inline mode', () => {
    expect(parseLaunchTrustRequest(['--trust-workspace=read'])).toEqual({ kind: 'grant', target: 'trusted-read' })
    expect(parseLaunchTrustRequest(['--trust-workspace=execute'])).toEqual({ kind: 'grant', target: 'trusted-execute' })
    expect(parseLaunchTrustRequest(['--trust-workspace=none'])).toEqual({ kind: 'revoke' })
  })

  it('treats a bare flag as read, the lower of the two grants', () => {
    expect(parseLaunchTrustRequest(['--trust-workspace'])).toEqual({ kind: 'grant', target: 'trusted-read' })
  })

  it('leaves a bare flag bare when the next argument is another option', () => {
    expect(parseLaunchTrustRequest(['--trust-workspace', '--output-format', 'stream-json']))
      .toEqual({ kind: 'grant', target: 'trusted-read' })
  })

  it('refuses a space-separated word that IS a legal mode, which is the shape that granted trust nobody asked for', () => {
    // `--profile headless --trust-workspace read the tests` used to grant read
    // trust AND take "read" out of the task. Both halves were silent.
    expect(() => parseLaunchTrustRequest(['--trust-workspace', 'read', 'the', 'tests']))
      .toThrow(/must be written --trust-workspace=<mode>/u)
  })

  it('refuses a space-separated word that is not a mode, rather than reading it as one', () => {
    expect(() => parseLaunchTrustRequest(['--trust-workspace', 'run', 'the', 'tests']))
      .toThrow(/must be written --trust-workspace=<mode>/u)
  })

  it('refuses the same shape when the flag comes after the task text', () => {
    expect(() => parseLaunchTrustRequest(['run', 'the', 'tests', '--trust-workspace', 'read']))
      .toThrow(/must be written --trust-workspace=<mode>/u)
  })

  it('names the `=` form in the refusal, because a message that only says "invalid" leaves the operator guessing', () => {
    expect(() => parseLaunchTrustRequest(['--trust-workspace', 'read']))
      .toThrow(/Got --trust-workspace followed by "read"/u)
  })

  it('refuses an inline value outside the closed set', () => {
    expect(() => parseLaunchTrustRequest(['--trust-workspace=bogus']))
      .toThrow(/expected 'read', 'execute' or 'none', got "bogus"/u)
  })

  it('is absent when the flag is not there at all, including when a task word merely contains it', () => {
    expect(parseLaunchTrustRequest(['run', 'the', 'tests'])).toBeUndefined()
    expect(parseLaunchTrustRequest(['--trust-workspace-mode=read'])).toBeUndefined()
  })
})

describe('P1-07 / BLOCKED-261: which launcher may carry the flag', () => {
  it('refuses at the parse site when a request arrives on a launcher with no readiness signal', async () => {
    // A host that cannot say "startup finished" cannot tell "the provider has
    // not published yet" from "it never will", so registering the grant there
    // would mean recording nothing and reporting nothing. Measured: the
    // webworker host passes caller-supplied argv and no `ready`.
    const { ctx } = launcher(['--trust-workspace=read'], false)
    expect(() => { applyLaunchTrustRequest(ctx) }).toThrow(/provides no appReady signal/u)
    await ctx.fiber.dispose()
  })

  it('does nothing at all on that same launcher when no request was made', async () => {
    // The positive control for the refusal above: absence of a flag is not a
    // composition defect, and `apps/desktop-host` passes `args: []`.
    const { ctx } = launcher([], false)
    expect(() => { applyLaunchTrustRequest(ctx) }).not.toThrow()
    await ctx.fiber.dispose()
  })

  it('leaves NO unhandled rejection when the write fails, and still says so at readiness', async () => {
    // BLOCKED-290. The rethrow inside the injected body rejects the fiber
    // `inject` returns, and that fiber used to be discarded. Node terminates a
    // process on an unhandled rejection by default, so the one case this code
    // exists to report -- a failed trust write -- killed the harness instead of
    // printing its message. Every `#17` since carried two `Unhandled Rejection`
    // entries against zero failed tests, which is why a whole suite could be
    // green and the step still red.
    //
    // Reverting the `void writing.then(undefined, () => {})` reddens this case:
    // the listener below registers before the rejection settles, and the
    // process-level event fires with nothing else attached.
    const { ctx, listeners } = launcher(['--trust-workspace=read'], true)
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => { unhandled.push(reason) }
    process.on('unhandledRejection', onUnhandled)
    try {
      const failure = new Error('disk is read-only')
      ctx.provide('workspaceTrust', {
        grantTrust: () => Promise.reject(failure),
        revokeTrust: () => Promise.reject(failure),
        stateFor: () => Promise.resolve('untrusted'),
      } as never)
      applyLaunchTrustRequest(ctx)
      // Two turns of the macrotask queue: `unhandledRejection` fires after the
      // microtask queue drains, so a single `setImmediate` can precede it.
      await new Promise(resolve => setImmediate(resolve))
      await new Promise(resolve => setImmediate(resolve))

      expect(unhandled, 'the injected fiber must be held, or a real process dies here').toEqual([])
      // And the failure is still REPORTED -- holding the rejection must not
      // turn a loud failure into a silent one.
      expect(() => { listeners[0]?.() }).toThrow(/writing the record failed/u)
    } finally {
      process.off('unhandledRejection', onUnhandled)
      await ctx.fiber.dispose()
    }
  })

  it('fails loudly when the write itself failed, not only when nothing ran', async () => {
    // The flag this replaces was set when the callback STARTED, so a provider
    // that published and then threw looked identical to a successful grant.
    const { ctx, listeners } = launcher(['--trust-workspace=read'], true)
    const failure = new Error('disk is read-only')
    ctx.provide('workspaceTrust', {
      grantTrust: () => Promise.reject(failure),
      revokeTrust: () => Promise.reject(failure),
      stateFor: () => Promise.resolve('untrusted'),
    } as never)
    applyLaunchTrustRequest(ctx)
    await new Promise(resolve => setImmediate(resolve))
    expect(() => { listeners[0]?.() }).toThrow(/writing the record failed/u)
    await ctx.fiber.dispose()
  })

  it('writes the record through the provider once it publishes, and orders nothing itself', async () => {
    // Ordering belongs to the provider, which holds its own `stateFor` while a
    // launch write may be pending. This registration only has to reach it: an
    // earlier version returned a promise and claimed the Loader would wait for
    // it, which a probe disproved — boot resolves with an entry's apply still
    // pending.
    const { ctx } = launcher(['--trust-workspace=read'], true)
    const granted: string[] = []
    ctx.provide('workspaceTrust', {
      grantTrust: (cwd: string) => { granted.push(cwd); return Promise.resolve({ upgraded: true }) },
      revokeTrust: () => Promise.resolve({}),
      stateFor: () => Promise.resolve('untrusted'),
    } as never)
    // Nothing is awaited here: the registration returns nothing, and the write
    // lands one microtask after the provider publishes.
    applyLaunchTrustRequest(ctx)
    await new Promise(resolve => setImmediate(resolve))
    expect(granted).toEqual([process.cwd()])
    await ctx.fiber.dispose()
  })

  it('lets startup finish while the write is still in flight, because the provider holds its own readers', async () => {
    // This used to fail the boot, and that is the defect a real run caught:
    // the shipped profile publishes the provider AFTER this plugin applies, so
    // "still writing at readiness" is the NORMAL case, not a broken one. What
    // orders readers is the provider's own barrier over `stateFor`, released
    // in a `finally` here; startup has nothing left to refuse.
    const { ctx, listeners } = launcher(['--trust-workspace=read'], true)
    let release = (): void => {}
    const held = new Promise<void>((resolve) => { release = resolve })
    ctx.provide('workspaceTrust', {
      grantTrust: () => held.then(() => ({ upgraded: true })),
      revokeTrust: () => Promise.resolve({}),
      stateFor: () => Promise.resolve('untrusted'),
    } as never)
    applyLaunchTrustRequest(ctx)
    await new Promise(resolve => setImmediate(resolve))
    expect(() => { listeners[0]?.() }, 'a write in flight is not a startup failure').not.toThrow()
    release()
    await new Promise(resolve => setImmediate(resolve))
  })

  it('fails loudly at readiness when no provider ever published', async () => {
    const { ctx, listeners } = launcher(['--trust-workspace=read'], true)
    applyLaunchTrustRequest(ctx)
    expect(listeners).toHaveLength(1)
    // What the launcher's own `commit()` runs. Nothing mounted a provider, so
    // the request reached no record, and saying so is the whole point: the
    // host user asked for a durable decision.
    expect(() => { listeners[0]?.() }).toThrow(/no workspaceTrust provider published/u)
    await ctx.fiber.dispose()
  })
})
