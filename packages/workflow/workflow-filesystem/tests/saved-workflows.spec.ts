/**
 * Saved workflow definitions loaded from disk (Epic P4-09 must[0],
 * acceptance[0]; §12.48-A(2)).
 *
 * These cases run the loader against a REAL directory and a real engine, not
 * a stub sink, because the property under test is that a file on disk ends up
 * registered through the registry's admission — a stub would prove only that
 * the loader calls a method.
 *
 * The digest is deliberately never taken from the file. It is computed from
 * the bytes read, so "the file changed" and "the definition changed" cannot
 * come apart, and a definition claiming a digest it does not hash to is not
 * expressible through this path at all.
 */
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { computeDefinitionDigest, DefinitionRegistry } from '@deepseek-ai/dsh-workflow-registry'
import type { RegisteredDefinition } from '@deepseek-ai/dsh-workflow-registry'
import SavedWorkflowLoader from '../src/index.ts'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { DefinitionName, SignerIdentity } from '@deepseek-ai/dsh-workflow-registry'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import * as spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import InMemoryLeaseStorePlugin from '@deepseek-ai/dsh-lease'
import MessageBusPlugin from '@deepseek-ai/dsh-message-bus'
import WorkerThreadWorkflowEngine from '@deepseek-ai/dsh-workflow-worker-thread'

const roots: string[] = []
let previousHome: string | undefined

beforeEach(() => { previousHome = process.env.DSH_HOME })
afterEach(() => {
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** A harness home with a `workflows` directory holding the given files. */
function home(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-saved-workflows-'))
  roots.push(root)
  mkdirSync(join(root, 'workflows'), { recursive: true })
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(root, 'workflows', name), body, 'utf8')
  }
  process.env.DSH_HOME = root
  return root
}

/**
 * A minimal engine over the REAL `DefinitionRegistry`.
 *
 * It records what was admitted; it does not re-implement the admission. A
 * hand-written copy of the digest and self-recursion checks would pass while
 * the real ones changed underneath it, which is the failure mode these cases
 * exist to catch.
 */
class RecordingEngine {
  readonly registered: RegisteredDefinition[] = []
  private readonly registry = new DefinitionRegistry()

  registerDefinition(definition: RegisteredDefinition): void {
    const outcome = this.registry.register(definition)
    if (!outcome.registered) throw new Error(`${outcome.reason}: ${outcome.detail}`)
    this.registered.push(definition)
  }
}

async function mounted(engine: unknown): Promise<Context> {
  const ctx = new Context()
  ctx.provide('workflowEngine', engine)
  await ctx.plugin(SavedWorkflowLoader)
  return ctx
}

describe('P4-09 must[0]: a saved definition is a file, registered at boot', () => {
  it('registers every definition file under the harness home, naming it by FILE name', async () => {
    home({ 'report.js': 'return 1', 'digest.mjs': 'return 2', 'notes.md': 'not a definition' })
    const engine = new RecordingEngine()

    const ctx = await mounted(engine)

    expect(ctx.savedWorkflows.loaded.sort()).toEqual(['digest', 'report'])
    // The name is the file's, never a field inside the body: a body that named
    // itself would be a definition asserting its own identity, and the registry
    // keys version history by name.
    expect(engine.registered.map(entry => entry.name).sort()).toEqual(['digest', 'report'])
    // A file that is not a definition is skipped rather than read as one.
    expect(ctx.savedWorkflows.loaded).not.toContain('notes')
  })

  it('computes each digest from the bytes it read, so a definition cannot claim one it does not hash to', async () => {
    const body = 'return 42'
    home({ 'answer.js': body })
    const engine = new RecordingEngine()

    await mounted(engine)

    expect(engine.registered[0]?.digest).toBe(computeDefinitionDigest(body))
  })

  it('starts with NO saved workflows when the directory does not exist, rather than failing the boot', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-saved-workflows-empty-'))
    roots.push(root)
    process.env.DSH_HOME = root

    const ctx = await mounted(new RecordingEngine())

    expect(ctx.savedWorkflows.loaded).toEqual([])
  })
})

describe('P4-09 acceptance[0]: loading does not execute, and a refused definition does not stop the boot', () => {
  it('reads a body that would throw if it were ever evaluated, and registers it unharmed', async () => {
    // The clause is that loading executes nothing. A body that would abort the
    // process on evaluation makes that testable rather than asserted: if any
    // part of this path evaluated it, this case could not pass at all.
    home({ 'hostile.js': 'process.exit(1)' })
    const engine = new RecordingEngine()

    const ctx = await mounted(engine)

    expect(ctx.savedWorkflows.loaded).toEqual(['hostile'])
    expect(engine.registered[0]?.body).toBe('process.exit(1)')
  })

  it('RECORDS a refused definition and keeps loading the rest', async () => {
    // One malformed file must not stop a harness starting, and an operator
    // needs to know which file was refused and why.
    home({ 'self.js': "return await workflow('self')", 'fine.js': 'return 1' })
    const engine = new RecordingEngine()

    const ctx = await mounted(engine)

    expect(ctx.savedWorkflows.loaded).toEqual(['fine'])
    // Fields checked individually rather than through `expect.stringContaining`
    // inside a literal: that matcher is typed `any`, so the literal it sits in
    // becomes an unsafe assignment and the assertion stops being type-checked.
    expect(ctx.savedWorkflows.refused).toHaveLength(1)
    expect(ctx.savedWorkflows.refused[0]?.name).toBe('self')
    expect(ctx.savedWorkflows.refused[0]?.reason).toContain('self-recursive-definition')
  })

  it('REFUSES to mount over an engine that cannot register definitions, rather than loading into nothing', async () => {
    home({ 'report.js': 'return 1' })

    await expect(mounted({ start() { /* an engine with no registration surface */ } }))
      .rejects.toThrow(/does not accept definition registrations/u)
  })
})

describe('P4-09 must[0]: the REAL engine registers what the loader read', () => {
  it('loads a file into the mounted worker-thread engine, which then resolves it for a nested run', async () => {
    // The cases above use a recording engine, which can only show that the
    // loader calls a method. This one mounts the real engine, so what is shown
    // is that a FILE on disk becomes a definition the engine will resolve —
    // through the registry's own admission, not a fixture's.
    home({ 'saved.js': 'return "from a saved file"' })
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(MessageBusPlugin)
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(spawn, { providerName: 'spawn' })
    await ctx.plugin(InMemoryLeaseStorePlugin)
    await ctx.plugin(WorkerThreadWorkflowEngine, {})
    await ctx.plugin(SavedWorkflowLoader)

    expect(ctx.savedWorkflows.loaded).toEqual(['saved'])

    // Resolution through the engine's own registry: a digest it never saw is
    // refused, and the one the loader computed is not.
    const engine = ctx.workflowEngine as unknown as {
      registerDefinition: (definition: RegisteredDefinition) => void
    }
    expect(() => {
      engine.registerDefinition({
        digest: computeDefinitionDigest('return "from a saved file"'),
        name: brandString<DefinitionName>('saved'),
        version: 2,
        body: 'return "from a saved file"',
        signer: brandString<SignerIdentity>('test'),
      })
    }).toThrow(/already-registered/u)
  })
})
