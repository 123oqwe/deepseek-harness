/**
 * Epic P0-02 acceptance[1] read on a real launch: the model inputs of a
 * `dsh --profile headless` turn with the Trust Kernel pinned carry no prose
 * the kernel's runtime module holds.
 *
 * The route is `fixtures/recording-llm.ts`, which records every request the
 * model receives. Its turn makes one `read` call for a staged file and then
 * answers, so the recorded inputs include the tool-result channel, not only
 * the system prompt, the task and the tool schemas.
 *
 * The prose list is read from `src/index.ts` with the same walk that
 * `packages/kernel/trust-kernel/tests/runtime-surface.spec.ts` checks for
 * completeness: every string literal that contains whitespace. Today those are
 * the kernel's 3 distinct error messages (4 literals), and on the factory path
 * no one triggers them, so the last assertion never observes a kernel string
 * arriving; no mutation inside the kernel reddens it alone.
 *
 * What the case does not observe: the policy decision for the `read` call.
 * No session event carries it (`action/manifest-appended` has no decision
 * field, `packages/core/tools/src/manifest-log.ts:80-97`), and the kernel's
 * audit sink is not configurable from a launch. The case observes that the
 * kernel is pinned in the launched tree and that the call's result is the
 * file's contents; the per-call decision with a pinned kernel is in
 * `packages/core/agent-loop/src/tool-calls.ts:755`.
 */

import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS } from '@deepseek-ai/dsh-loader-smoke'
import { readRuntimeModuleSyntax } from '../../../packages/kernel/trust-kernel/tests/fixtures/runtime-surface.ts'
import { stageProfile } from './fixtures/headless-smoke.ts'
import { runKernelPinnedDsh } from './fixtures/kernel-pinned-headless.ts'
import {
  KERNEL_OBSERVATION_FILE,
  MODEL_INPUT_FILE,
  PROBE_CALL_ID,
  PROBE_FILE,
  PROBE_TEXT,
  RECORDING_ROUTE,
} from './fixtures/recording-llm.ts'

const RECORDING_PLUGIN = fileURLToPath(new URL('./fixtures/recording-llm.ts', import.meta.url))

/** One recorded request, as `recording-llm.ts` writes it. */
interface ModelInputRecord {
  readonly purpose: string | null
  readonly messages: readonly {
    readonly content: readonly { readonly type: string; readonly toolCallId?: string; readonly isError?: boolean }[]
  }[]
}

/**
 * Stage the P9-03 headless profile, add the recording route, and write the probe file.
 * @param cwd - the launch's isolated working directory.
 */
function stageRecordingProfile(cwd: string): void {
  stageProfile(cwd)
  appendFileSync(join(cwd, '.dsh', 'profiles', 'headless', 'cordis.patch.yml'), [
    '',
    '- insert:',
    '    - id: p0-02-recording-llm',
    `      name: '${RECORDING_PLUGIN}'`,
    '',
  ].join('\n'))
  writeFileSync(join(cwd, PROBE_FILE), `${PROBE_TEXT}\n`)
}

/** Read a file the launch should have written, or a marker naming its absence. */
function readWritten(path: string): string {
  try {
    return readFileSync(path, 'utf8')
  } catch (error) {
    // ENOENT and every other read failure alike: the assertions name the file.
    return `ABSENT: ${String(error)}`
  }
}

/** Every string anywhere inside a parsed JSON value. */
function stringLeaves(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(stringLeaves)
  if (typeof value === 'object' && value !== null) return Object.values(value).flatMap(stringLeaves)
  return []
}

/** The tool-result blocks for the probe call in one request. */
function probeResults(record: ModelInputRecord | undefined): readonly { readonly isError?: boolean }[] {
  return (record?.messages ?? []).flatMap(message =>
    message.content.filter(block => block.type === 'tool-result' && block.toolCallId === PROBE_CALL_ID))
}

describe('P0-02 acceptance[1] -- real dsh --profile headless launch', () => {
  it('sends the model none of the prose string literals of the Trust Kernel runtime module while the kernel is pinned, across a turn whose read tool call ran', async () => {
    let inputs = ''
    let observation = ''
    const result = await runKernelPinnedDsh(
      'p0-02-model-input',
      ['--profile', 'headless', '--model', `${RECORDING_ROUTE}:model-one`, `read ${PROBE_FILE}`],
      stageRecordingProfile,
      (cwd) => {
        inputs = readWritten(join(cwd, MODEL_INPUT_FILE))
        observation = readWritten(join(cwd, KERNEL_OBSERVATION_FILE))
      },
    )

    // The kernel is pinned in the tree that served the turn, and the posture check stayed silent.
    expect(observation, `stderr tail: ${result.stderr.slice(-800)}`).not.toMatch(/^ABSENT: /u)
    expect(JSON.parse(observation)).toEqual({ trustKernelPinned: true })
    expect(result.stderr).not.toContain('booting with no Trust Kernel')

    // The tool-result channel was recorded: the first request has no result
    // for the probe call, and the last one carries the file's contents.
    expect(inputs, `stderr tail: ${result.stderr.slice(-800)}`).not.toMatch(/^ABSENT: /u)
    const records = inputs.trimEnd().split('\n').map(line => JSON.parse(line) as ModelInputRecord)
    const turnRequests = records.filter(record => record.purpose === null)
    expect(turnRequests.length).toBeGreaterThanOrEqual(2)
    expect(probeResults(turnRequests[0])).toEqual([])
    const results = probeResults(turnRequests.at(-1))
    expect(results).toHaveLength(1)
    expect(results[0]?.isError).not.toBe(true)
    expect(JSON.stringify(results)).toContain(PROBE_TEXT)

    // No request, auxiliary ones included, contains any kernel prose.
    const prose = [...new Set(readRuntimeModuleSyntax().literals.filter(literal => /\s/u.test(literal)))]
    expect(prose.length).toBeGreaterThan(0)
    const strings = records.flatMap(stringLeaves)
    for (const literal of prose) {
      expect(strings.filter(text => text.includes(literal)), literal).toEqual([])
    }
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
