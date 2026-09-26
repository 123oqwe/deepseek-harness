/**
 * The recall is a snapshot: a later step or turn that recalls the same record
 * appends no second recall, and no shadow, so a turn's steps do not each add an
 * event (P6-03 acceptance[1], the idempotent half). This is the one behaviour
 * `A-525` adds; it lives here rather than in the freeze-pinned
 * `memory-context.spec.ts` so that slice changes only the consumer's `src`.
 *
 * The driver boots the shipped headless profile, seeds one record, and runs the
 * SAME turn twice. Every assertion reads the durable JSONL session log the run
 * left behind, so what is proven is what a later reader of that log sees.
 */

import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const driver = fileURLToPath(new URL('./fixtures/idempotent-recall-driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL('./fixtures/memory-context.patch.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))

async function jsonlFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const paths = await Promise.all(entries.map(async (entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return jsonlFiles(path)
    return entry.isFile() && entry.name.endsWith('.jsonl') ? [path] : []
  }))
  return paths.flat()
}

let events: SessionEvent[] = []

describe('memory-context recall is a snapshot: the same recall is not appended twice', () => {
  beforeAll(async () => {
    await runLoaderSmoke({
      label: 'memory-context idempotent recall',
      tempDirPrefix: 'memory-context-idempotent-',
      binScript: driver,
      libBinScript: driver,
      configPath,
      tsconfigPath: repoTsconfig,
      inspect: async (cwd) => {
        const logs = await jsonlFiles(join(cwd, '.sessions'))
        expect(logs).toHaveLength(1)
        const lines = (await readFile(logs[0] as string, 'utf8')).trimEnd().split('\n')
        events = lines.slice(1).map(line => JSON.parse(line) as SessionEvent)
      },
    })
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('two turns recalling the same record leave exactly one recall and no shadow', () => {
    const recalls = events.filter(
      (event): event is SessionEvent<'user/message'> => event.type === 'user/message'
        && event.data.source.kind === 'plugin'
        && event.data.source.plugin === 'memory-context')
    // Shadows this consumer emits are `system/message` nodes carrying its plugin
    // source; the idempotent second turn emits none because the recall never
    // changed. Both reads still happen, so the record was found both turns.
    const shadows = events.filter(
      (event): event is SessionEvent<'system/message'> => event.type === 'system/message'
        && event.data.message.source.kind === 'plugin'
        && event.data.message.source.plugin === 'memory-context')
    const reads = events.filter(event => event.type === 'memory/access')
    expect(
      { recalls: recalls.length, shadows: shadows.length, reads: reads.length },
      JSON.stringify(events.map(event => event.type)),
    ).toEqual({ recalls: 1, shadows: 0, reads: 2 })
  })
})
