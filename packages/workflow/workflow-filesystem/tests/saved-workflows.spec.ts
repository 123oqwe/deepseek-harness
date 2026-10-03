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
 *
 * A definition registers only when the signature file beside it verifies, so
 * `home()` signs every definition it writes with a test key, and `mounted()`
 * pins a Trust Kernel whose one offline-signed anchor holds that key.
 */
import { generateKeyPairSync, sign } from 'node:crypto'
import type { KeyObject } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createTrustKernel, pinTrustKernel } from '@deepseek-ai/dsh-trust-kernel'
import type { TrustKernelTrustAnchor } from '@deepseek-ai/dsh-trust-kernel/types'
import { computeDefinitionDigest, DefinitionRegistry } from '@deepseek-ai/dsh-workflow-registry'
import type { RegisteredDefinition } from '@deepseek-ai/dsh-workflow-registry'
import SavedWorkflowLoader from '../src/index.ts'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { DefinitionName, SignerIdentity } from '@deepseek-ai/dsh-workflow-registry'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
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

/** The key these cases sign saved definitions with. */
const signingKey = generateKeyPairSync('ed25519')

/** The offline-signed anchor that admits {@link signingKey}. */
const ANCHOR: TrustKernelTrustAnchor = {
  mode: 'offline-signed',
  publicKeyFingerprint: 'sha256:saved-workflow-test-key',
  owner: 'saved workflow test signer',
  publicKeyPem: signingKey.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
}

/**
 * The signature file a definition needs to load.
 * @param body - the definition's source.
 * @param key - the private key that signs its digest.
 * @param fingerprint - the fingerprint the file names.
 * @returns the file's text.
 */
function signatureFor(body: string, key: KeyObject = signingKey.privateKey, fingerprint = 'sha256:saved-workflow-test-key'): string {
  const digest = computeDefinitionDigest(body)
  return JSON.stringify({ digest, publicKeyFingerprint: fingerprint, signature: sign(null, Buffer.from(digest), key).toString('base64') })
}

/**
 * A harness home with a `workflows` directory holding the given files. Each
 * definition file is signed unless named in `unsigned`.
 * @param files - file names and their contents.
 * @param unsigned - definition files written without a signature file.
 * @returns the harness home.
 */
function home(files: Record<string, string>, unsigned: readonly string[] = []): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-saved-workflows-'))
  roots.push(root)
  mkdirSync(join(root, 'workflows'), { recursive: true })
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(root, 'workflows', name), body, 'utf8')
    if (['.js', '.mjs'].includes(extname(name)) && !unsigned.includes(name)) {
      writeFileSync(join(root, 'workflows', `${name}.sig.json`), signatureFor(body), 'utf8')
    }
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

async function mounted(engine: unknown, anchors: readonly TrustKernelTrustAnchor[] | 'no kernel' = [ANCHOR]): Promise<Context> {
  const ctx = new Context()
  if (anchors !== 'no kernel') pinTrustKernel(ctx, createTrustKernel({ trustAnchors: anchors }))
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
    pinTrustKernel(ctx, createTrustKernel({ trustAnchors: [ANCHOR] }))
    await mountAgentLoopTestDependencies(ctx)
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

describe('P4-09 acceptance[0]: a saved definition loads only when its signature verifies', () => {
  it('refuses an unsigned definition, naming the missing signature file, and loads the signed one beside it', async () => {
    home({ 'signed.js': 'return 1', 'unsigned.js': 'return 2' }, ['unsigned.js'])
    const engine = new RecordingEngine()

    const ctx = await mounted(engine)

    expect(ctx.savedWorkflows.loaded).toEqual(['signed'])
    expect(ctx.savedWorkflows.refused).toHaveLength(1)
    expect(ctx.savedWorkflows.refused[0]?.name).toBe('unsigned')
    expect(ctx.savedWorkflows.refused[0]?.reason).toContain('unsigned: unsigned.js.sig.json is missing')
    expect(ctx.savedWorkflows.refused[0]?.reason).toContain('README')
  })

  it('records the owner of the anchor whose key verified the signature as the signer', async () => {
    home({ 'report.js': 'return 1' })
    const engine = new RecordingEngine()

    await mounted(engine)

    expect(engine.registered[0]?.signer).toBe('saved workflow test signer')
  })

  it('refuses a definition whose body changed after it was signed', async () => {
    const root = home({ 'edited.js': 'return 1' })
    writeFileSync(join(root, 'workflows', 'edited.js'), 'return 2', 'utf8')
    const engine = new RecordingEngine()

    const ctx = await mounted(engine)

    expect(ctx.savedWorkflows.loaded).toEqual([])
    expect(ctx.savedWorkflows.refused[0]?.reason).toContain(`digest-mismatch: the file hashes to ${computeDefinitionDigest('return 2')}`)
    expect(engine.registered).toEqual([])
  })

  it('refuses a signature under a fingerprint no configured anchor has', async () => {
    const root = home({ 'stranger.js': 'return 1' }, ['stranger.js'])
    writeFileSync(join(root, 'workflows', 'stranger.js.sig.json'), signatureFor('return 1', signingKey.privateKey, 'sha256:unknown-key'), 'utf8')

    const ctx = await mounted(new RecordingEngine())

    expect(ctx.savedWorkflows.refused[0]?.reason).toContain('no-trust-anchor: no configured offline-signed trust anchor has the fingerprint sha256:unknown-key')
  })

  it('refuses a signature the anchor\'s key did not make', async () => {
    const root = home({ 'forged.js': 'return 1' }, ['forged.js'])
    const otherKey = generateKeyPairSync('ed25519').privateKey
    writeFileSync(join(root, 'workflows', 'forged.js.sig.json'), signatureFor('return 1', otherKey), 'utf8')

    const ctx = await mounted(new RecordingEngine())

    expect(ctx.savedWorkflows.refused[0]?.reason).toContain('signature-invalid: the signature in forged.js.sig.json does not verify')
  })

  it('refuses a signature file that does not hold a digest, a fingerprint and a signature', async () => {
    const root = home({ 'text.js': 'return 1', 'empty.js': 'return 2', 'partial.js': 'return 3' }, ['text.js', 'empty.js', 'partial.js'])
    writeFileSync(join(root, 'workflows', 'text.js.sig.json'), 'not a signature', 'utf8')
    writeFileSync(join(root, 'workflows', 'empty.js.sig.json'), 'null', 'utf8')
    writeFileSync(join(root, 'workflows', 'partial.js.sig.json'), JSON.stringify({ digest: computeDefinitionDigest('return 3') }), 'utf8')

    const ctx = await mounted(new RecordingEngine())

    expect(ctx.savedWorkflows.loaded).toEqual([])
    expect(ctx.savedWorkflows.refused.map(entry => entry.reason.split(':')[0]).sort())
      .toEqual(['signature-invalid', 'signature-invalid', 'signature-invalid'])
  })

  it('refuses every definition when no Trust Kernel is pinned', async () => {
    home({ 'report.js': 'return 1' })

    const ctx = await mounted(new RecordingEngine(), 'no kernel')

    expect(ctx.savedWorkflows.loaded).toEqual([])
    expect(ctx.savedWorkflows.refused[0]?.reason).toContain('no-trust-anchor: no Trust Kernel is pinned')
  })

  it('refuses every definition when the pinned kernel holds no anchor', async () => {
    home({ 'report.js': 'return 1' })

    const ctx = await mounted(new RecordingEngine(), [])

    expect(ctx.savedWorkflows.loaded).toEqual([])
    expect(ctx.savedWorkflows.refused[0]?.reason).toContain('no-trust-anchor')
  })
})
