/**
 * Driver for A-483's P3-05 case under acceptance[0]: on the SHIPPED headless
 * profile at its default preset, one bash command run under the shipped local
 * sandbox tries to connect to an SSH agent whose socket the spec started on the
 * host. The driver also reports the sandbox backend actually selected
 * (`bwrap`/`landlock`/`sandbox-exec`/`none`), which A-476's P3-05 could not read
 * from the tool result.
 *
 * The socket path arrives in `A483_SSH_AUTH_SOCK`; the driver bakes it into the
 * probe command inline, so the sandboxed command reads it whether or not the
 * environment reaches it. It prints one `P3-05-SSH <json>` line.
 * @module tests/first100/fixtures/loader/p3-05-ssh-agent/driver
 */

import { randomUUID } from 'node:crypto'
import { HOST_USER_IDENTITY_KEY, type HostUserIdentityFactory } from '@deepseek-ai/dsh-agent-loop'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import { endorseComposedDecision } from '@deepseek-ai/dsh-policy-enforcement'
import type {} from '@deepseek-ai/dsh-sandbox'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import { createTrustKernel, pinTrustKernel } from '@deepseek-ai/dsh-trust-kernel'
import type {} from '@deepseek-ai/dsh-user-approval'
import { MockAdapter, textResponse, toolCallResponse } from '../../../../../packages/core/agent-loop/tests/mock-adapter.ts'
import { createFixtureRootAgent } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/fixture-root-agent.ts'
import { bootProductionProfile } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/production-profile.ts'

const PROVIDER = 'p3-05-ssh-agent-mock'
const PROBE_CALL = 'a483-ssh-probe'

const sock = process.env.A483_SSH_AUTH_SOCK ?? ''
/** Connect to the agent and report the exit code: 0 has identities, 1 connected but none, 2 could not connect. */
const PROBE = [
  `if command -v ssh-add >/dev/null 2>&1; then`,
  `  SSH_AUTH_SOCK='${sock}' ssh-add -l >/dev/null 2>&1; echo "A483-SSH rc=$?"`,
  `else echo "A483-SSH rc=absent"; fi`,
].join('\n')

/**
 * One scripted model answer: a turn's opening request runs the probe; any
 * other request, a session title's among them, gets text.
 * @param options - the request the loop sent.
 * @returns the chunks to stream.
 */
function answer(options: GenerateOptions): StreamChunk[] {
  if (options.purpose !== undefined) return textResponse('ok')
  const last = options.messages.at(-1)
  const opensTurn = last?.role === 'user' && !last.content.some(block => block.type === 'tool-result')
  return opensTurn ? toolCallResponse(PROBE_CALL, 'bash', { command: PROBE, description: 'Probe SSH agent socket reachability' }) : textResponse('done')
}

const [configPath] = process.argv.slice(2)
if (configPath === undefined) throw new Error('p3-05 ssh-agent driver requires the overlay path')

const ctx = await bootProductionProfile({
  binName: 'p3-05-ssh-agent',
  profile: 'headless',
  overlayPaths: [resolveConfigPath(configPath, undefined)],
  prepare: (prepared) => {
    pinTrustKernel(prepared, createTrustKernel({ policyDecider: endorseComposedDecision }))
  },
})

/**
 * The sandbox backend the default preset selects, and its enforcement completeness.
 * @returns the backend name and enforcement, or `none` when nothing confines.
 */
function readBackend(): { readonly backend: string; readonly enforcement: string | null } {
  try {
    const policy = ctx.sandboxPolicy.resolve()
    if (policy.mode === 'danger-full-access') return { backend: 'none', enforcement: null }
    const confined = ctx.sandbox.confine(['true'], { ...policy, mode: policy.mode })
    // Read the backend from the seam's own `backend` field, not `argv[0]`: B-642
    // wraps bwrap in `/bin/sh` to hand it the seccomp program on fd 3, so
    // `argv[0]` is now `sh`, while `backend` names the real runner. The cast
    // reads a field this evidence branch's `ConfinedArgv` type predates B-642
    // adding; the case is dispatched onto the B-642 tree, where it is present.
    return { backend: (confined as { backend?: string }).backend ?? 'none', enforcement: confined.enforcement }
  } catch {
    // SandboxUnavailableError: no backend on this host.
    return { backend: 'none', enforcement: null }
  }
}

try {
  ctx.on('approval/request', () => Promise.resolve('allowed-once' as const))
  ctx.llm.registerAdapter([PROVIDER], new MockAdapter(Array.from({ length: 16 }, () => answer)))
  // Created after boot, as a shipped launcher creates its root agent, so its
  // session starts once the capability-token service is listening.
  await createFixtureRootAgent(ctx, {
    provider: PROVIDER,
    model: PROVIDER,
    cwd: process.cwd(),
    identity: (ctx.get(HOST_USER_IDENTITY_KEY) as HostUserIdentityFactory | undefined)?.(
      `run-${randomUUID()}` as Parameters<HostUserIdentityFactory>[0],
    ),
  })
  const root = ctx.agents.list()[0]
  if (root === undefined) throw new Error('p3-05 ssh-agent driver: no root agent after creation')
  await runFixtureTurn(ctx, { task: 'A483: run the SSH agent probe once.' })

  const text = root.session.snapshotEvents().flatMap(event => event.type !== 'tool/result' ? [] : event.data.message.content.flatMap(block =>
    block.type === 'tool-result' && block.toolCallId === PROBE_CALL ? block.content.flatMap(part => part.type === 'text' ? [part.text] : []) : [])).join('\n')
  process.stdout.write(`P3-05-SSH ${JSON.stringify({ sock, text, ...readBackend() })}\n`)
} finally {
  await ctx.fiber.dispose()
}
