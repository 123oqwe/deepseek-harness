/**
 * P2-01 acceptance[0] on the `headless` profile: a real `dsh --profile
 * headless` launch, with no `--patch` and a temporary `$DSH_HOME`, acts as the
 * host user from its first action, and attaches that identity once.
 *
 * The launch is `apps/cli/src/bin.ts --profile headless <task>` through
 * `runLoaderSmoke`, which points `DSH_HOME` at `<cwd>/.dsh` and removes the
 * directory afterwards. The profile is the shipped template (dsh-base plus
 * dsh-headless), initialized in that home on first use. The runner creates its
 * one agent with `hostUserIdentity` (`packages/bundle/headless/src/index.ts:317-338`, `:331`).
 *
 * The stand-in model answers the loop's first request after the task with one
 * `bash` call, and every other request with text: the request that carries
 * the call's result, and the session-title request, which offers no tools.
 * This profile mounts `session-title-first-prompt-llm`, whose request races
 * the loop's, so the answer is chosen from each request's content rather than
 * from arrival order (`../../routing-stub-model.ts`).
 *
 * There is no resume half. The headless command line has no resume entry: its
 * program declares the task, `--model`, `--output-format` and
 * `--trust-workspace` and nothing else (`packages/bundle/headless/src/startup.ts:50-58`),
 * and the shipped runner row sets `task`, `model` and `outputFormat`
 * (`packages/bundle/headless/cordis.patch.yml:27-33`). `resumeSessionId`
 * (`packages/bundle/headless/src/index.ts:54`, `:92`, `:300-316`) is reached
 * only by a patch on that row.
 *
 * @module apps/cli/tests/profiles/headless/tests/host-user
 */

import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { isFirstStepAfterPrompt, startRoutingStubModelServer } from '../../routing-stub-model.ts'
import {
  attachedIdentity,
  attachedPrincipal,
  countRecords,
  DEFAULT_HOST_TENANT,
  persistedHostUserId,
  readSessionLog,
  type SessionLog,
} from '../../session-log.ts'

const BIN_SCRIPT = fileURLToPath(new URL('../../../../src/bin.ts', import.meta.url))
const TSCONFIG = fileURLToPath(new URL('../../../../../../tsconfig.json', import.meta.url))

/** Text only this case's task contains, so the stand-in can tell the loop's prompt step apart. */
const TASK = 'P2-01-HEADLESS-HOST-USER: print the proof string with bash, then stop.'

/** What the launch left under its harness home, read before the directory is removed. */
interface HeadlessObservation {
  readonly log: SessionLog
  readonly hostUserId: string
}

describe('dsh --profile headless, launched with no patch (no key required)', () => {
  it('P2-01 acceptance[0]: a launched headless run acts as the host user, attached once', async () => {
    const stub = await startRoutingStubModelServer(request => isFirstStepAfterPrompt(request, TASK)
      ? { name: 'bash', arguments: { command: 'printf P2-01-HEADLESS', description: 'Print the proof string' } }
      : undefined)
    const observed: { value?: HeadlessObservation } = {}
    try {
      await runLoaderSmoke({
        label: 'p2-01-headless-host-user',
        tempDirPrefix: 'dsh-p2-01-headless-',
        binScript: BIN_SCRIPT,
        configPath: '',
        binArgs: ['--profile', 'headless', TASK],
        tsconfigPath: TSCONFIG,
        processTimeoutMs: 90_000,
        env: {
          DEEPSEEK_API_KEY: 'sk-dummy-for-boot',
          DEEPSEEK_BASE_URL: stub.baseUrl,
          DSH_PERMISSION_MODE: 'danger-full-access',
          DSH_TELEMETRY_DISABLED: '1',
          // Empty, not absent: the launch pins its Trust Kernel as a shipped
          // launch does, whatever the parent environment says.
          DSH_TRUST_KERNEL_INSECURE: '',
        },
        inspect: async (cwd) => {
          const dshHome = join(cwd, '.dsh')
          observed.value = {
            log: await readSessionLog(join(dshHome, 'sessions')),
            hostUserId: await persistedHostUserId(dshHome),
          }
        },
      })
    } finally {
      await stub.close()
    }
    const { value } = observed
    if (value === undefined) throw new Error('the launch exited 0 and inspect recorded nothing')
    const { log, hostUserId } = value

    // The first manifest, not any of them: acceptance[0] is about what the
    // session was attributed to from its first action onward.
    const manifests = log.records.filter(record => record.type === 'action/manifest-appended')
    expect(manifests.length).toBeGreaterThan(0)
    expect(manifests[0]?.data?.actor).not.toMatch(/^anonymous:/)
    expect(manifests[0]?.data?.actor).toBe(attachedPrincipal(log))
    expect(countRecords(log, 'identity/attached')).toBe(1)

    // THE host user: the id the launcher persisted under its own home.
    expect(attachedPrincipal(log)).toBe(hostUserId)

    // The whole chain the attachment carries: one entry, the host user, in the
    // tenant `resolveTenantId` falls back to when nothing names another.
    const hostUser = { kind: 'user', id: hostUserId, tenantId: DEFAULT_HOST_TENANT }
    const identity = attachedIdentity(log)
    expect(identity.chain?.entries).toHaveLength(1)
    expect(identity.chain?.entries?.[0]?.principal).toEqual(hostUser)
    expect(identity.principal).toEqual(hostUser)
  }, 120_000)
})
