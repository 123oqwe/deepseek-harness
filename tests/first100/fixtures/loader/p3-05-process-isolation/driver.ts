/**
 * Driver for A-476's P3-05 case under acceptance[0]: on the SHIPPED headless
 * profile at its default preset, one bash command, run under the shipped local
 * sandbox, probes whether it can see or signal the host process and whether it
 * can connect to the Docker daemon's socket.
 *
 * It boots headless through `bootProductionProfile` with the originator cases'
 * overlay, leaves `DSH_PERMISSION_MODE` unset so the base layer's default
 * preset applies, pins the Trust Kernel the way `apps/cli/src/profile-boot.ts`
 * pins it, and answers every approval request `allowed-once`. The probe names
 * this process's pid, which is the host the command runs under. It prints one
 * `P3-05-ISOLATION <json>` line: the bash result's text and its whole
 * `tool/result` event.
 * @module tests/first100/fixtures/loader/p3-05-process-isolation/driver
 */

import { randomUUID } from 'node:crypto'
import { HOST_USER_IDENTITY_KEY, type HostUserIdentityFactory } from '@deepseek-ai/dsh-agent-loop'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import { endorseComposedDecision } from '@deepseek-ai/dsh-policy-enforcement'
import { createTrustKernel, pinTrustKernel } from '@deepseek-ai/dsh-trust-kernel'
import type {} from '@deepseek-ai/dsh-user-approval'
import { MockAdapter, textResponse, toolCallResponse } from '../../../../../packages/core/agent-loop/tests/mock-adapter.ts'
import { createFixtureRootAgent } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/fixture-root-agent.ts'
import { bootProductionProfile } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/production-profile.ts'

const PROVIDER = 'p3-05-process-isolation-mock'
const PROBE_CALL = 'a476-isolation-probe'

/** The probe: can this command signal or see the host process, and connect to the Docker socket. */
const PROBE = [
  `host=${String(process.pid)}`,
  'if kill -0 "$host" 2>/dev/null; then signal=yes; else signal=no; fi',
  'if ps -A -o pid= 2>/dev/null | tr -d " " | grep -qx "$host"; then seen=yes; else seen=no; fi',
  'if [ -S /var/run/docker.sock ]; then',
  '  if curl -s --max-time 3 --unix-socket /var/run/docker.sock http://localhost/_ping >/dev/null 2>&1; then docker=connected; else docker=refused; fi',
  'else docker=absent; fi',
  'echo "A476-PROBE signal=$signal seen=$seen docker=$docker"',
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
  return opensTurn ? toolCallResponse(PROBE_CALL, 'bash', { command: PROBE, description: 'Probe process and socket isolation' }) : textResponse('done')
}

const [configPath] = process.argv.slice(2)
if (configPath === undefined) throw new Error('p3-05 process-isolation driver requires the overlay path')

const ctx = await bootProductionProfile({
  binName: 'p3-05-process-isolation',
  profile: 'headless',
  overlayPaths: [resolveConfigPath(configPath, undefined)],
  prepare: (prepared) => {
    pinTrustKernel(prepared, createTrustKernel({ policyDecider: endorseComposedDecision }))
  },
})

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
  if (root === undefined) throw new Error('p3-05 process-isolation driver: no root agent after creation')
  await runFixtureTurn(ctx, { task: 'A476: run the isolation probe once.' })

  const events = root.session.snapshotEvents().filter(event => event.type === 'tool/result'
    && event.data.message.content.some(block => block.type === 'tool-result' && block.toolCallId === PROBE_CALL))
  const text = events.flatMap(event => event.type !== 'tool/result' ? [] : event.data.message.content.flatMap(block =>
    block.type !== 'tool-result' ? [] : block.content.flatMap(part => part.type === 'text' ? [part.text] : []))).join('\n')
  process.stdout.write(`P3-05-ISOLATION ${JSON.stringify({ hostPid: process.pid, text, resultEvents: events.map(event => JSON.stringify(event)) })}\n`)
} finally {
  await ctx.fiber.dispose()
}
