/**
 * Human-facing `/trust-skills` command: raise this workspace to
 * `'trusted-execute'` so the project's own skills become available.
 *
 * A command rather than a prompt at the point of use, and that is the whole
 * design. Project skills are not listed at `'trusted-read'` — their names and
 * descriptions are text the project supplied, and putting them in front of the
 * model is what an untrusted repository would want — so there is no moment
 * where the agent reaches for one and can be asked about it. The request
 * therefore has to come from the host user, who is the only participant that
 * can want this without having been influenced by the repository.
 *
 * The command asks; `@deepseek-ai/dsh-workspace-trust`'s `requestTrustUpgrade`
 * decides, behind the provider. This package adds no trust rule of its own.
 * @module @deepseek-ai/dsh-command-workspace-trust
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { attachedIdentity } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-workspace-trust'

export const name = 'command-workspace-trust'
export const inject = ['commands']

/**
 * Raise this workspace to `'trusted-execute'` on the host user's confirmation.
 *
 * Every refusal path returns `'error'` with what stopped it, because a command
 * a user typed deserves an answer: silence would be indistinguishable from the
 * command not existing. None of them changes the trust state.
 * @param ctx - the plugin context, for the optional trust and approval services.
 * @param invocation - the invocation the dispatching surface produced.
 * @returns the result the surface renders.
 */
async function executeTrustCommand(ctx: Context, invocation: CommandInvocation): Promise<CommandResult> {
  const trust = ctx.get('workspaceTrust')
  if (trust === undefined) {
    return { kind: 'error', text: 'No workspace trust provider is mounted, so there is no boundary to raise.' }
  }
  const cwd = invocation.agent.session.header.cwd
  if (cwd === undefined) {
    return { kind: 'error', text: 'This session has no working directory, so there is no workspace to trust.' }
  }
  const state = await trust.stateFor(cwd)
  if (state === 'trusted-execute') {
    return { kind: 'success', text: `${cwd} is already trusted to execute what it supplies.` }
  }
  const principal = attachedIdentity(invocation.agent.session)?.principal
  if (principal === undefined) {
    return { kind: 'error', text: 'This session has no attached identity, so no host user can authorize the change.' }
  }
  const approval = ctx.get('approval')
  if (approval === undefined) {
    return { kind: 'error', text: 'No approval service is mounted, so this cannot be confirmed.' }
  }
  // Confirmed even though the user typed the command: the command says what
  // they want, and the approval pair is what records that they were told what
  // it means and agreed. A command alone leaves no `approval/asked`.
  const outcome = await approval.request({
    agent: invocation.agent,
    toolName: 'workspace-trust',
    subject: `${cwd}: trusted-execute`,
    reason: 'Run skills this project supplies? They are executable content from the directory you opened, '
      + 'and will be able to do anything you can.',
    signal: invocation.signal,
  })
  if (outcome !== 'allowed-once') {
    return { kind: 'error', text: `Not granted (${outcome}). ${cwd} still may not execute what it supplies.` }
  }
  const result = await trust.grantTrust(cwd, 'trusted-execute', principal)
  if (!result.upgraded) {
    return { kind: 'error', text: `Refused: ${result.reason}.` }
  }
  return { kind: 'success', text: `${cwd} may now run the skills it supplies.` }
}

/**
 * Register the command.
 * @param ctx - the context to register on; the registration disposes with it.
 * @returns Nothing.
 */
export function apply(ctx: Context): void {
  ctx.commands.register({
    name: 'trust-skills',
    description: "allow this project's own skills to run, after confirming",
    handler: invocation => executeTrustCommand(ctx, invocation),
  })
}
