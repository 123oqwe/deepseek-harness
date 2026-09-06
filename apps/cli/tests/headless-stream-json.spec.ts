import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS } from '@deepseek-ai/dsh-loader-smoke'

import { REPOSITORY_ROOT, runDsh } from './fixtures/headless-smoke.ts'

/**
 * P9-06 Usage — `--output-format stream-json` on the real product path.
 *
 * The recorded format at `apps/cli/tests/profiles/headless/tests/expected/*​/
 * stream-json.expected.jsonl` had no shipped producer: only a test driver wrote
 * those lines, so the format was a description of test output rather than of
 * anything a user could run. These cases check the product against the RECORDED
 * FILE rather than against a shape restated in the test, so the fixture stays
 * the authority and a drift in either direction is visible here.
 */
describe('P9-06 Usage — stream-json is emitted by the product, in the recorded format', () => {
  it('must[1]: every line parses, events precede exactly one final result line', async () => {
    const result = await runDsh('p9-06-stream', [
      '--profile', 'headless', '--model', 'p9-mock-a:model-one',
      '--output-format', 'stream-json', 'name your route',
    ])
    const lines = result.stdout.trimEnd().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)
    expect(lines.length).toBeGreaterThan(1)
    // The result line is LAST and unique: a consumer reads until it, and a
    // second one would mean a run reported its outcome twice.
    expect(lines.filter(line => line['type'] === 'result')).toHaveLength(1)
    expect(lines.at(-1)?.['type']).toBe('result')
    expect(lines.slice(0, -1).every(line => line['type'] === 'session_event')).toBe(true)
    // Event order is the log's own order, which is what makes the stream
    // replayable rather than merely complete.
    const seqs = lines.slice(0, -1).map(line => ((line['event'] as { seq: number }).seq))
    expect(seqs).toStrictEqual([...seqs].sort((a, b) => a - b))
    expect(lines.at(-1)?.['output']).toContain('ROUTE=p9-mock-a')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('must[1]: the emitted envelopes carry the same keys as the recorded SDK fixture', async () => {
    const recorded = readFileSync(
      join(REPOSITORY_ROOT, 'apps/cli/tests/profiles/headless/tests/expected/goal-tools/stream-json.expected.jsonl'),
      'utf8',
    ).trimEnd().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)
    const recordedEvent = recorded.find(line => line['type'] === 'session_event')
    const recordedResult = recorded.at(-1)
    const result = await runDsh('p9-06-format', [
      '--profile', 'headless', '--model', 'p9-mock-a:model-one',
      '--output-format', 'stream-json', 'name your route',
    ])
    const emitted = result.stdout.trimEnd().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)
    const emittedEvent = emitted.find(line => line['type'] === 'session_event')
    // Key sets, not values: the values differ per run by construction, while a
    // renamed or dropped key is exactly the drift a consumer would break on.
    expect(Object.keys(emittedEvent ?? {}).sort()).toStrictEqual(Object.keys(recordedEvent ?? {}).sort())
    expect(Object.keys(emitted.at(-1) ?? {}).sort()).toStrictEqual(Object.keys(recordedResult ?? {}).sort())
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('an unknown --output-format is refused with the accepted list, not silently treated as text', async () => {
    const result = await runDsh('p9-06-bad-format', [
      '--profile', 'headless', '--output-format', 'yaml', 'name your route',
    ], 1)
    expect(result.stderr).toContain('--output-format must be one of text, stream-json, json')
    expect(result.stdout).not.toContain('ROUTE=')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
