/**
 * `--trust-workspace`: the host user's unattended entry point for writing a
 * workspace trust record (Epic P1-07, BLOCKED-214's second half).
 *
 * **It writes the record; it does not bypass the check.** The flag's whole
 * effect is one `grantTrust` call, after which every Consumer resolves trust
 * the ordinary way — through `stateFor`, against a fresh identity observation.
 * A workspace trusted this way is reconciled exactly like one trusted by
 * `/trust-skills`: replace the directory, retarget the symlink, or move it, and
 * the record no longer matches what stands there. That is the difference
 * between an entry point and a switch, and it is why this plugin holds no trust
 * rule of its own.
 *
 * **Why a launch argument exists at all.** `askForReadTrustOnce` puts its one
 * question through `approval.request()`, which settles `'unavailable'` where no
 * answerer is registered — and `headless`, `sdk-app` and `sdk-minimal` register
 * none. Without a way to record a decision BEFORE a session exists, the
 * boundary on those profiles could only ever refuse. This is that way, and it
 * is the reason the `headless` bundle can now enable the provider row.
 *
 * @module @deepseek-ai/dsh-command-workspace-trust/launch-grant
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { hostUserIdentity } from '@deepseek-ai/dsh-host-user-id'
import { RunId } from '@deepseek-ai/dsh-principal/types'
import type { TrustState } from '@deepseek-ai/dsh-workspace-trust/types'
import type {} from '@deepseek-ai/dsh-workspace-trust'
import type {} from '@deepseek-ai/dsh-cmdline'

/** The flag this plugin owns. */
const FLAG = '--trust-workspace'

/**
 * What the host user asked for on the command line.
 *
 * `revoke` is a first-class answer rather than an absent flag: a grant that
 * cannot be taken back from the same place it was given is not one the host
 * user controls, and the persisted record outlives the process that wrote it.
 */
export type LaunchTrustRequest =
  | { readonly kind: 'grant'; readonly target: TrustState }
  | { readonly kind: 'revoke' }

/**
 * Read `--trust-workspace` from the launcher's leftover arguments.
 *
 * **A mode is only ever written with `=`.** `--trust-workspace=<mode>` carries
 * one; a bare flag means `read`, the lower of the two grants deliberately — the
 * scope that lets a project's own instructions load without letting anything it
 * supplies run, so `execute` must be asked for by name.
 *
 * A space-separated word after the flag is REFUSED, loudly, and never read as a
 * mode. This shape used to be accepted, and it produced an authorization nobody
 * asked for: the apps parse the same command line, and commander's optional
 * value takes the next word — so `dsh --profile headless --trust-workspace read
 * the tests` both truncated the task to "the tests" and granted read trust.
 * Leaving that word as task text cannot be done from here (the app has already
 * consumed it), so the refusal is the honest answer and it names the `=` form.
 * @param args - the launcher's leftover arguments, in argv order.
 * @returns the request, or `undefined` when the flag is absent.
 * @throws when the flag carries a value outside the closed set, or is followed by a space-separated word.
 */
export function parseLaunchTrustRequest(args: readonly string[]): LaunchTrustRequest | undefined {
  const index = args.findIndex(arg => arg === FLAG || arg.startsWith(`${FLAG}=`))
  if (index < 0) return undefined
  // `findIndex` returning a hit proves this element exists.
  const flag = args[index] as string
  if (!flag.startsWith(`${FLAG}=`)) {
    const next = args[index + 1]
    // Only a following OPTION leaves the bare flag alone; anything else is a
    // word the apps have already eaten as this flag's value.
    if (next !== undefined && !next.startsWith('-')) {
      throw new Error(
        `${FLAG}: a mode must be written ${FLAG}=<mode>, not separated by a space. `
        + `Got ${FLAG} followed by ${JSON.stringify(next)}, which is refused rather than read as a mode `
        + 'or silently taken out of the task text.',
      )
    }
    return { kind: 'grant', target: 'trusted-read' }
  }
  const value = flag.slice(FLAG.length + 1)
  switch (value) {
    case 'read': return { kind: 'grant', target: 'trusted-read' }
    case 'execute': return { kind: 'grant', target: 'trusted-execute' }
    case 'none': return { kind: 'revoke' }
    default:
      throw new Error(
        `${FLAG}: expected 'read', 'execute' or 'none', got ${JSON.stringify(value)}. `
        + 'A bare --trust-workspace means read.',
      )
  }
}

/**
 * Write the request against a provider that has published.
 * @param ctx - a context where `workspaceTrust` resolves.
 * @param request - what the host user asked for on the command line.
 * @returns Nothing; the record is persisted before this resolves.
 */
async function writeLaunchTrust(ctx: Context, request: LaunchTrustRequest): Promise<void> {
  const trust = ctx.workspaceTrust
  const cwd = process.cwd()
  if (request.kind === 'revoke') {
    await trust.revokeTrust(cwd, 'untrusted')
    return
  }
  // The host user this harness home belongs to — the same principal
  // `/trust-skills` authorizes with, minted here because no session exists yet.
  const principal = hostUserIdentity(RunId(`run-${randomUUID()}`)).principal
  await trust.grantTrust(cwd, request.target, principal, 'launch-argument')
}

/**
 * Apply the launch-time request, if one was made.
 *
 * **Registered against the provider rather than read at apply time.** This
 * plugin's own mount and the trust provider's are ordered by service
 * availability, not by row order, so reading `ctx.get('workspaceTrust')` here
 * found nothing whenever the provider published later — the flag arrived, the
 * plugin threw, and no record was written (BLOCKED-261). `ctx.inject` runs the
 * body when the service is there and re-runs it if the provider is replaced,
 * which is what "whoever is the live provider holds this startup's grant"
 * means.
 *
 * **The write is ordered before boot finishes when it can be.** A registration
 * alone would let the first turn read `stateFor` while the grant was still in
 * flight: `assertEntriesActivated` audits the Loader's ENTRY fibers, and a
 * fiber created by `inject` is not one of them. So when the provider has
 * already published — the shipped case, where `dsh-base` mounts
 * `workspace-trust-local` above this row — the returned fiber is awaited, which
 * keeps THIS entry loading until the record is durable. Where the provider
 * publishes later there is nothing to await without waiting forever for a
 * composition that may mount none, and the readiness check below is what
 * reports that.
 *
 * **Three loud failures, and none of them is a silent pass.** A launcher with
 * no `appReady` signal cannot tell "the provider has not published yet" from
 * "it never will", so a request on such a host is refused HERE, at the parse
 * site. On a launcher that has one, a request whose write never ran by the
 * time startup is committed fails there — and so does one whose write RAN AND
 * FAILED, which is the case a flag that only recorded "the callback started"
 * would have passed.
 *
 * No request means no obligation: nothing is registered and no host is judged.
 * @param ctx - the plugin context, for the optional cmdline, readiness and trust services.
 * @returns the write, when the provider is already published; otherwise nothing.
 * @throws when a request is present and this launcher provides no `appReady` signal.
 */
export function applyLaunchTrustRequest(ctx: Context): Promise<void> | void {
  const request = parseLaunchTrustRequest(ctx.get('cmdlineArgs')?.get() ?? [])
  if (request === undefined) return
  const ready = ctx.get('appReady')
  if (ready === undefined) {
    throw new Error(
      `${FLAG} was given, but this launcher provides no appReady signal, so a grant that never `
      + 'reached a provider could not be reported. Refusing rather than recording nothing.',
    )
  }
  // Four states, because three of them fail for different reasons and an
  // operator reading one message should not have to guess which: nothing ever
  // reached a provider, a write began and never settled, or a write failed.
  let outcome: 'pending' | 'writing' | 'written' | { readonly error: unknown } = 'pending'
  const fiber = ctx.inject(['workspaceTrust'], async (scope: Context) => {
    outcome = 'writing'
    try {
      await writeLaunchTrust(scope, request)
      outcome = 'written'
    } catch (error) {
      outcome = { error }
      // Rethrown so the fiber fails too; the readiness check below is what
      // makes it visible on a launcher whose boot does not audit this fiber.
      throw error
    }
  })
  ctx.effect(() => ready.onReady(() => {
    if (outcome === 'written') return
    if (outcome === 'pending') {
      throw new Error(
        `${FLAG} was given, but no workspaceTrust provider published before startup completed, `
        + 'so there is no record to write and nothing would enforce it.',
      )
    }
    if (outcome === 'writing') {
      // A provider published and the write began, so the composition is not
      // the problem — the record simply is not durable yet, and a turn that
      // read `stateFor` now would read the state from before the grant.
      throw new Error(
        `${FLAG} was given and a workspaceTrust provider published, but the record was still being `
        + 'written when startup completed, so a first turn could read this workspace as untrusted.',
      )
    }
    throw new Error(
      `${FLAG} was given, but writing the record failed, so this workspace is not trusted: `
      + String(outcome.error),
    )
  }))
  // Present already: keep this entry loading until the record is durable, so
  // the first turn cannot read `stateFor` ahead of the grant.
  if (ctx.get('workspaceTrust') === undefined) return
  return Promise.resolve(fiber).then(() => undefined)
}
