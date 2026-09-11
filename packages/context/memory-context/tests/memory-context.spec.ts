/**
 * Real-composition regression for the Memory seam's Usage stage (first100
 * registry P6-01): the shipped headless profile is booted through the Loader
 * with the base bundle's `memory` and `memory-context` rows enabled, one
 * record is seeded through the composed `ctx.memory`, and one turn is driven.
 * Every assertion below reads the durable JSONL session log the run left
 * behind — never an in-process spy — so what is proven is what a later reader
 * of that log can reconstruct.
 */

import { realpathSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { KNOWN_SESSION_EVENT_TYPES } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const driver = fileURLToPath(new URL('./fixtures/driver.ts', import.meta.url))
const emptyDriver = fileURLToPath(new URL('./fixtures/empty-recall-driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL('./fixtures/memory-context.patch.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))

/** The content the driver seeds into memory before the turn runs. */
const SEEDED = 'oxidized-kingfisher'

/**
 * The content the driver seeds under a DIFFERENT workspace of the same tenant.
 *
 * It answers the turn's query exactly as well as {@link SEEDED} does, so its
 * absence from the recall is the workspace boundary and not the search.
 */
const OTHER_WORKSPACE = 'tarnished-marmoset'

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
let replayedTypes: string[] = []
let stderr = ''

describe('memory-context through the production headless profile', () => {
  beforeAll(async () => {
    const result = await runLoaderSmoke({
      label: 'memory-context headless smoke',
      tempDirPrefix: 'memory-context-smoke-',
      binScript: driver,
      libBinScript: driver,
      configPath,
      tsconfigPath: repoTsconfig,
      inspect: async (cwd) => {
        const logs = await jsonlFiles(join(cwd, '.sessions'))
        expect(logs).toHaveLength(1)
        const lines = (await readFile(logs[0] as string, 'utf8')).trimEnd().split('\n')
        events = lines.slice(1).map(line => JSON.parse(line) as SessionEvent)
        const replay = JSON.parse(await readFile(join(cwd, 'replay.json'), 'utf8')) as { types: string[] }
        replayedTypes = replay.types
      },
    })
    stderr = result.stderr
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('boots the shipped profile with the base bundle memory rows enabled and no unhandled failure', () => {
    expect(stderr).not.toContain('UNHANDLED')
    expect(stderr).not.toContain('MEMORY_PROVIDER_UNAVAILABLE')
    expect(events.filter(event => event.type === 'turn/end')).toHaveLength(1)
  })

  it('memory/access is a known session event type, so a real log carrying it replays', () => {
    // Registration must precede emission: a log holding an unregistered,
    // non-ignorable type is refused wholesale by the persistence read path.
    expect(KNOWN_SESSION_EVENT_TYPES.has('memory/access')).toBe(true)
  })

  it('a log written with memory/access is read back by replay, not refused', () => {
    // The round trip, not merely the registration: the driver reloaded the
    // session it had just written through `sessionPersistence.load`, the path
    // that throws SessionFormatUnsupportedError on an event type this build
    // does not know. Reaching this assertion at all means the load succeeded,
    // and the event survives the trip rather than being silently dropped.
    expect(replayedTypes).toContain('memory/access')
    expect(replayedTypes.filter(type => type === 'memory/access')).toHaveLength(1)
  })

  it('recalled memory reaches the model as a durable, source-attributed user message', () => {
    const injected = events.filter(
      (event): event is SessionEvent<'user/message'> => event.type === 'user/message'
        && event.data.source.kind === 'plugin'
        && event.data.source.plugin === 'memory-context')
    expect(injected).toHaveLength(1)
    expect(injected[0]!.surfaceOp).toBe('append')
    expect(injected[0]!.data.source).toMatchObject({
      kind: 'plugin',
      plugin: 'memory-context',
      form: 'snapshot',
      sections: [{ name: 'memory-context' }],
    })
    const text = injected[0]!.data.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
    expect(text).toContain(SEEDED)
  })

  it('the same run records a memory/access read event carrying the complete access context', () => {
    const reads = events.filter(
      (event): event is SessionEvent<'memory/access'> => event.type === 'memory/access'
        && event.data.operation === 'query')
    expect(reads).toHaveLength(1)
    const data = reads[0]!.data
    expect(data.operation).toBe('query')
    if (data.operation !== 'query') throw new Error('unreachable: filtered to query above')
    // must[3]: all four read-scoping dimensions are on the record, not merely
    // checked in memory and then discarded.
    expect(data.accessContext.principal).toMatchObject({ tenantId: 'local' })
    expect(data.accessContext.purpose).toBe('recall')
    expect(data.accessContext.scope).toMatchObject({ tenantId: 'local' })
    expect(data.accessContext.contextBudget).toMatchObject({ maxRecords: 5 })
    expect(data.resultCount).toBe(1)
  })

  it('model-visible memory is logged: every recalled record the model saw is reconstructable from the log alone', () => {
    // registry P6-01 validation[3], asserted as a property over one durable
    // log rather than by observing the emitter: the injection and its read
    // event must both be present, and the read event must precede the text
    // the model read.
    const injected = events.find(event => event.type === 'user/message'
      && event.data.source.kind === 'plugin'
      && event.data.source.plugin === 'memory-context')
    const read = events.find(event => event.type === 'memory/access')
    expect(injected).toBeDefined()
    expect(read).toBeDefined()
    expect(read!.seq).toBeLessThan(injected!.seq)
  })

  it('recalls only the workspace this session runs in, on a launched profile', () => {
    // §12.79's second invariant, narrowed by the delegate's ruling (OQ15) to
    // the workspace dimension the scope actually has. The P stage proves the
    // seam filters by workspace; this proves a real boot, through the shipped
    // consumer, reaches that filter with the workspace it is actually running
    // in — which no case in the P file can show, because none of them boots.
    //
    // Both records are the same tenant's and both match the query. The
    // difference between them is the workspace alone.
    const injected = events.filter(
      (event): event is SessionEvent<'user/message'> => event.type === 'user/message'
        && event.data.source.kind === 'plugin'
        && event.data.source.plugin === 'memory-context')
    const text = injected.flatMap(event => event.data.content)
      .filter(block => block.type === 'text').map(block => block.text).join('\n')
    expect(text).toContain(SEEDED)
    expect(text).not.toContain(OTHER_WORKSPACE)

    // The read event agrees: one record was returned, not two. Asserting only
    // the injected text would pass a build that recalled both and rendered one.
    const reads = events.filter(
      (event): event is SessionEvent<'memory/access'> => event.type === 'memory/access'
        && event.data.operation === 'query')
    const data = reads.at(-1)?.data
    if (data?.operation !== 'query') throw new Error('unreachable: filtered to query above')
    expect(data.resultCount).toBe(1)

    // NOT PROVEN here, and the freeze entry says so: an UNTRUSTED workspace.
    // Nothing in `memory-context` or `dsh-memory` reads a workspace's trust
    // state to decide a recall — the only mention is a comment — so a case
    // naming "untrusted" would assert something nothing decides. That half of
    // the invariant has no subject and rides with BLOCKED-185's slice.
  })

  it('memory content never reaches the model outside a logged injection', () => {
    // acceptance[1]'s read-side counterpart: the seeded content appears in the
    // request only through the attributed user message above.
    const headers = events.filter(event => event.type === 'request/header')
    expect(JSON.stringify(headers)).not.toContain(SEEDED)
    // The other workspace's record is not in the request by any route at all,
    // attributed or otherwise.
    expect(JSON.stringify(events)).not.toContain(OTHER_WORKSPACE)
  })
})

/**
 * §12.79's first invariant, which the switch to memory-on-by-default rests on:
 * with nothing to recall, the model reads exactly what it reads with the
 * feature off.
 *
 * The two assertions below are one invariant and neither half states it alone.
 * A byte comparison on its own would still pass a build that stopped recording
 * reads; an event assertion on its own says nothing about what the model saw.
 * `memory-context` appends the `memory/access` event whether or not anything
 * was recalled — deliberately, because a read that returned nothing is still a
 * read — so "nothing happened" is the wrong thing to assert and "no
 * memory/access event" asserts the opposite of the design.
 */
describe('an empty recall costs the model nothing', () => {
  let withMemory = ''
  let withoutMemory = ''
  let emptyRunEvents: SessionEvent[] = []

  beforeAll(async () => {
    const run = async (config: string) => {
      let request = ''
      let logged: SessionEvent[] = []
      await runLoaderSmoke({
        label: `memory-context empty recall (${config})`,
        tempDirPrefix: 'memory-context-empty-',
        binScript: emptyDriver,
        libBinScript: emptyDriver,
        configPath: fileURLToPath(new URL(`./fixtures/${config}`, import.meta.url)),
        tsconfigPath: repoTsconfig,
        inspect: async (cwd) => {
          // Each smoke run gets its own temporary directory, and the system
          // prompt states the agent's working directory. That path is what
          // the harness chose, not what the memory switch decided, so both
          // spellings of it are folded to one token before the comparison.
          const raw = await readFile(join(cwd, 'request.json'), 'utf8')
          request = raw.replaceAll(realpathSync(cwd), '<cwd>').replaceAll(cwd, '<cwd>')
          const logs = await jsonlFiles(join(cwd, '.sessions'))
          expect(logs).toHaveLength(1)
          const lines = (await readFile(logs[0] as string, 'utf8')).trimEnd().split('\n')
          logged = lines.slice(1).map(line => JSON.parse(line) as SessionEvent)
        },
      })
      return { request, logged }
    }
    const on = await run('memory-context.patch.yml')
    const off = await run('no-memory.patch.yml')
    withMemory = on.request
    withoutMemory = off.request
    emptyRunEvents = on.logged
  }, LOADER_SMOKE_TEST_TIMEOUT_MS * 2)

  it('P6-01 acceptance[1]: a real boot exposes NO tool that writes durable memory', () => {
    // The absent subject, measured on a booted profile rather than argued from
    // the seam's shape. `conformance.spec.ts` proves `revise()` rejects an
    // unminted id and that every read carries a full access context — true and
    // insufficient: both are properties of the API, and the clause is about
    // whether anything the MODEL can call reaches it. This reads the assembled
    // tool list the adapter actually received.
    const { tools } = JSON.parse(withMemory) as { tools: { name: string; description?: string; parameters?: unknown }[] }

    // Non-vacuity first: "no memory-writing tool" is satisfied by "no tools",
    // and this profile ships several. Without this the case would pass on a
    // composition that assembled nothing at all.
    expect(tools.length).toBeGreaterThan(0)

    // Named verbs, not a substring sweep for "memory": the seam's mutation
    // entry points are `propose`, `revise` and `forget` (`docs/subsystems/memory.md`),
    // and a tool reaching any of them is the bypass the clause forbids. The
    // whole schema is searched, because a tool could expose the verb as an
    // argument value rather than in its name.
    const serialized = JSON.stringify(tools)
    for (const verb of ['propose', 'revise', 'forget']) {
      expect(serialized, `no model-facing tool may expose the memory seam's ${verb}()`)
        .not.toMatch(new RegExp(`memory[^"]*${verb}|${verb}[^"]*memory`, 'iu'))
    }
    // And no tool is named for the seam at all, which is the cheaper half of
    // the same claim and catches a differently-spelled write verb.
    expect(tools.map(tool => tool.name).filter(name => /memory/iu.test(name))).toEqual([])
  })

  it('hands the model bytes identical to a boot with the memory rows disabled', () => {
    // Not "no snapshot was injected" — that is a property of the renderer.
    // This is the request itself, captured by the adapter in both runs.
    expect(withMemory).toBe(withoutMemory)
  })

  it('still records the read that returned nothing, so silence is not an unlogged read', () => {
    const reads = emptyRunEvents.filter(
      (event): event is SessionEvent<'memory/access'> => event.type === 'memory/access'
        && event.data.operation === 'query')
    expect(reads).toHaveLength(1)
    const data = reads[0]!.data
    if (data.operation !== 'query') throw new Error('unreachable: filtered to query above')
    expect(data.resultCount).toBe(0)
  })
})
