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
 * Accepts `--trust-workspace=<value>` and `--trust-workspace <value>`; a bare
 * flag means `read`, which is the lower of the two grants deliberately — the
 * scope that lets a project's own instructions load without letting anything it
 * supplies run. `execute` must be asked for by name.
 * @param args - the launcher's leftover arguments, in argv order.
 * @returns the request, or `undefined` when the flag is absent.
 * @throws when the flag carries a value outside the closed set.
 */
export function parseLaunchTrustRequest(args: readonly string[]): LaunchTrustRequest | undefined {
  const index = args.findIndex(arg => arg === FLAG || arg.startsWith(`${FLAG}=`))
  if (index < 0) return undefined
  // `findIndex` returning a hit proves this element exists.
  const flag = args[index] as string
  const inline = flag.startsWith(`${FLAG}=`) ? flag.slice(FLAG.length + 1) : args[index + 1]
  // A bare flag, or one followed by the next flag rather than a value.
  const value = inline === undefined || inline.startsWith('-') ? 'read' : inline
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
 * Apply the launch-time request, if one was made.
 *
 * Fails LOUD when the flag is present and no provider is mounted: the host user
 * asked for a durable decision and silently not recording one would leave them
 * believing a workspace is trusted when nothing enforces or remembers it.
 * @param ctx - the plugin context, for the optional cmdline and trust services.
 * @returns Nothing; the record is persisted before this resolves.
 * @throws when the flag is present but no `workspaceTrust` provider is mounted.
 */
export async function applyLaunchTrustRequest(ctx: Context): Promise<void> {
  const request = parseLaunchTrustRequest(ctx.get('cmdlineArgs')?.get() ?? [])
  if (request === undefined) return
  const trust = ctx.get('workspaceTrust')
  if (trust === undefined) {
    throw new Error(
      `${FLAG} was given, but this composition mounts no workspaceTrust provider, `
      + 'so there is no record to write and nothing would enforce it.',
    )
  }
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
