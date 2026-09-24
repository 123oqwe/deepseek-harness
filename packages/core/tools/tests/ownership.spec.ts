/**
 * Epic P1-09 Usage stage over the REAL tool registry: `ToolRuntime.register`
 * adjudicating a namespace claim and an ownership conflict at the moment a
 * plugin registers a tool, rather than `@deepseek-ai/dsh-plugin-ownership`'s
 * pure decision functions being called with hand-built data.
 *
 * Two properties this file is deliberately built around, because the obvious
 * versions of these cases pass without any of this epic's code:
 *
 * - `ToolLayer`'s `NamedEntries` already throws `tool "<name>" is already
 *   registered` on ANY duplicate. A case that registers one name twice is
 *   green today and stays green with the ownership gate deleted, so every
 *   collision case here asserts the CROSS-PLUGIN denial specifically, and
 *   pins that the same-plugin duplicate still takes the legacy path. The two
 *   outcomes must stay distinguishable; that difference is what only the new
 *   gate can produce.
 * - No tool name anywhere in this repository contains a `.`, so nothing claims
 *   a conflicting reserved namespace today. The reserved-namespace cases are
 *   synthetic registrants: they are non-vacuous (deleting the predicate turns
 *   them red) but they caught no pre-existing conflict, and this file does not
 *   pretend otherwise.
 *
 * Every assertion is on registry state, never on a filesystem or process
 * behavior, so each property is evaluated identically on every platform.
 */
import { Context, type Fiber } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'
import type { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool, ToolOwnershipError, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { CapabilityRecord } from '@deepseek-ai/dsh-plugin-ownership'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

/** A registrable tool under `name`; the body is irrelevant to every ownership rule. */
function tool(name: string): ToolDefinition {
  return defineTool({
    name,
    description: `fixture tool ${name}`,
    parameters: {},
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute() {
      return name
    },
  })
}

/** Ownership policy composed onto the real registry, as a deployment supplies it from cordis.yml. */
interface OwnershipConfig {
  officialPluginIdentities?: string[]
  allowReplace?: boolean
}

/** A real tree with the real `ToolRuntime` mounted under an explicit ownership policy. */
async function setup(ownership: OwnershipConfig = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime, { ownership })
  return ctx
}

/**
 * Mount one named plugin that registers `names`, and hand back its fiber so a
 * case can dispose it. The plugin's `name` is what the registry resolves its
 * `PluginIdentity` from in a Loader-free tree.
 */
/**
 * Mount one plugin that registers `names`.
 *
 * The return type is `ctx.plugin`'s own — `Fiber & PromiseLike<Fiber>` — and
 * NOT plain `Fiber`. Annotating it as `Fiber` discarded the thenable half, so
 * every `await mountPlugin(...)` read as awaiting a non-promise and the
 * type-aware linter reported nineteen of them. The awaits were right the whole
 * time; the helper's signature was throwing away what made them right.
 */
function mountPlugin(ctx: Context, identity: string, names: readonly string[]): Fiber & PromiseLike<Fiber> {
  return ctx.plugin({
    name: identity,
    inject: ['tools'],
    apply(pluginCtx: Context) {
      for (const name of names) pluginCtx.tools.register(tool(name))
    },
  })
}

/**
 * Await a mount that must be refused and hand back the refusal. `ctx.plugin`
 * returns a thenable Fiber rather than a Promise, so a rejection is caught
 * here rather than through `.catch`.
 */
async function refusalOf(mounting: PromiseLike<Fiber>): Promise<unknown> {
  try {
    await mounting
  } catch (error) {
    return error
  }
  throw new Error('expected the registration to be refused')
}

describe('P1-09 U: the real tool registry adjudicates namespace and ownership', () => {
  it('must[0]: an admitted registration\'s record carries plugin identity, namespace, capability id and kind, and no ownership token', async () => {
    const ctx = await setup()
    await mountPlugin(ctx, 'plugin-a', ['alpha_tool'])

    // The token must[0] requires is minted with the admission and stays in the
    // registry (BLOCKED-308): any plugin can read this record, so a token in it
    // would let the reader act as plugin-a. `@deepseek-ai/dsh-plugin-ownership`'s
    // own suite observes the minting.
    const record = ctx.tools.ownershipOf('alpha_tool')
    expect(record).toEqual({
      pluginIdentity: 'plugin-a',
      namespace: 'plugin-a',
      capabilityId: 'alpha_tool',
      kind: 'tool',
      origin: 'static',
    })
    expect(ctx.tools.ownershipHistory()).toEqual([record])
  })

  it('must[1]/validation[2]: an unofficial plugin cannot register a tool in the reserved dsh.* namespace', async () => {
    const ctx = await setup({ officialPluginIdentities: ['plugin-official'] })

    const denial = await refusalOf(mountPlugin(ctx, 'plugin-third-party', ['dsh.core.read_file']))
    expect(denial).toBeInstanceOf(ToolOwnershipError)
    expect((denial as ToolOwnershipError).reason).toBe('namespace-reserved')
    expect(ctx.tools.get('dsh.core.read_file')).toBeUndefined()
    expect(ctx.tools.ownershipOf('dsh.core.read_file')).toBeUndefined()
  })

  it('must[1]: an official plugin named by policy may register in the reserved dsh.* namespace', async () => {
    const ctx = await setup({ officialPluginIdentities: ['plugin-official'] })
    await mountPlugin(ctx, 'plugin-official', ['dsh.core.read_file'])

    expect(ctx.tools.get('dsh.core.read_file')).toBeDefined()
    expect(ctx.tools.ownershipOf('dsh.core.read_file')?.pluginIdentity).toBe('plugin-official')
  })

  it('acceptance[0]: a SECOND plugin claiming an owned tool name is denied for ownership, not by the legacy duplicate check', async () => {
    const ctx = await setup()
    await mountPlugin(ctx, 'plugin-a', ['shared_name'])

    const denial = await refusalOf(mountPlugin(ctx, 'plugin-b', ['shared_name']))
    expect(denial).toBeInstanceOf(ToolOwnershipError)
    expect((denial as ToolOwnershipError).reason).toBe('capability-collision')
    // The pre-existing per-layer duplicate check would have produced this text;
    // a case that accepted it would stay green with the ownership gate deleted.
    expect((denial as Error).message).not.toContain('is already registered')
    // The first owner is untouched by the refused claim.
    expect(ctx.tools.ownershipOf('shared_name')?.pluginIdentity).toBe('plugin-a')
  })

  // Control case: green before this stage and required to stay green after
  // it. The cross-plugin denial above is only meaningful if the same-plugin
  // duplicate keeps taking the pre-existing path, so this pins that the new
  // gate did not swallow the old one.
  it('control: the SAME plugin registering one name twice still takes the legacy duplicate path, so the two denials stay distinguishable', async () => {
    const ctx = await setup()

    const denial = await refusalOf(mountPlugin(ctx, 'plugin-a', ['twice', 'twice']))
    expect(denial).toBeInstanceOf(Error)
    expect(denial).not.toBeInstanceOf(ToolOwnershipError)
    expect((denial as Error).message).toContain('is already registered')
  })

  it('acceptance[0]: a load-order attack — claiming a reserved name BEFORE the official plugin loads — still fails closed', async () => {
    const ctx = await setup({ officialPluginIdentities: ['plugin-official'] })

    const denial = await refusalOf(mountPlugin(ctx, 'plugin-attacker', ['dsh.core.bash']))
    expect(denial).toBeInstanceOf(ToolOwnershipError)
    expect((denial as ToolOwnershipError).reason).toBe('namespace-reserved')
    // Registering first bought the attacker nothing: the official plugin still gets the name.
    await mountPlugin(ctx, 'plugin-official', ['dsh.core.bash'])
    expect(ctx.tools.ownershipOf('dsh.core.bash')?.pluginIdentity).toBe('plugin-official')
  })

  // Added at GREEN, not in the RED freeze: implementing must[1] revealed that
  // the reserved-namespace rule has to hold in an agent scope too, or `dsh.*`
  // would be claimable from any `agent.ctx`. The neighbouring behaviour — a
  // scoped tool deliberately SHADOWING a global name — must survive, and is
  // pinned by this package's own `scoped.spec.ts`, which caught a first draft
  // of this gate that wrongly refused it as a collision.
  it('must[1]: an agent scope is not a way around the reserved namespace, though it still shadows a global name', async () => {
    const ctx = await setup({ officialPluginIdentities: ['plugin-official'] })
    await mountPlugin(ctx, 'plugin-a', ['shadowed'])
    const agent = { id: 'agent-1' as SessionId } as Agent
    let scope!: Scope
    await ctx.plugin(Object.assign(
      (inner: Context) => { scope = createScope(inner, agent) },
      { inject: ['tools', 'systemPrompt'] },
    ))

    // Shadowing a global name from an agent scope stays legal.
    scope.ctx.tools.register(tool('shadowed'))
    expect(scope.ctx.tools.get('shadowed', agent)).toBeDefined()

    // Claiming the reserved namespace from that same scope does not.
    let denial: unknown
    try {
      scope.ctx.tools.register(tool('dsh.core.scoped_claim'))
    } catch (error) {
      denial = error
    }
    expect(denial).toBeInstanceOf(ToolOwnershipError)
    expect((denial as ToolOwnershipError).reason).toBe('namespace-reserved')
  })

  it('must[2]: replacing an owned tool fails closed when policy does not authorize replacement', async () => {
    const ctx = await setup({ allowReplace: false })
    await mountPlugin(ctx, 'plugin-a', ['replaceable'])

    const denial = await refusalOf(ctx.plugin({
      name: 'plugin-b',
      inject: ['tools'],
      apply(pluginCtx: Context) {
        pluginCtx.tools.replace(tool('replaceable'))
      },
    }))
    expect(denial).toBeInstanceOf(ToolOwnershipError)
    expect((denial as ToolOwnershipError).reason).toBe('replace-not-authorized')
    expect(ctx.tools.ownershipOf('replaceable')?.pluginIdentity).toBe('plugin-a')
  })

  it('must[2]: an implicit re-registration is never an override — replacing requires the explicit replace entry point even when policy allows it', async () => {
    const ctx = await setup({ allowReplace: true })
    await mountPlugin(ctx, 'plugin-a', ['replaceable'])

    // `allowReplace: true` authorizes `replace()`; it does not turn a plain
    // `register()` of an owned name into a silent override.
    const denial = await refusalOf(mountPlugin(ctx, 'plugin-b', ['replaceable']))
    expect(denial).toBeInstanceOf(ToolOwnershipError)
    expect((denial as ToolOwnershipError).reason).toBe('capability-collision')
    expect(ctx.tools.ownershipOf('replaceable')?.pluginIdentity).toBe('plugin-a')
  })

  it('acceptance[1]: an authorized replacement succeeds and the registry records the replaced/replacing chain', async () => {
    const ctx = await setup({ allowReplace: true })
    await mountPlugin(ctx, 'plugin-a', ['replaceable'])
    await ctx.plugin({
      name: 'plugin-b',
      inject: ['tools'],
      apply(pluginCtx: Context) {
        pluginCtx.tools.replace(tool('replaceable'))
      },
    })

    expect(ctx.tools.ownershipOf('replaceable')?.pluginIdentity).toBe('plugin-b')
    const chain = ctx.tools.ownershipHistory().filter(entry => entry.capabilityId === 'replaceable')
    expect(chain.map(entry => entry.pluginIdentity)).toEqual(['plugin-a', 'plugin-b'])
  })

  it('must[3]: disposing one registration removes exactly that registration\'s tool and record, not the plugin\'s other tools', async () => {
    const ctx = await setup()
    const disposers = new Map<string, () => void>()
    await ctx.plugin({
      name: 'plugin-a',
      inject: ['tools'],
      apply(pluginCtx: Context) {
        for (const name of ['a_one', 'a_two']) disposers.set(name, pluginCtx.tools.register(tool(name)))
      },
    })
    await mountPlugin(ctx, 'plugin-b', ['b_one'])

    disposers.get('a_one')?.()

    expect(ctx.tools.get('a_one')).toBeUndefined()
    expect(ctx.tools.ownershipOf('a_one')).toBeUndefined()
    // Two registrations by one plugin are two effects, each undoing only its
    // own record: disposing one never reaches the plugin's other tool.
    expect(ctx.tools.get('a_two')).toBeDefined()
    expect(ctx.tools.get('b_one')).toBeDefined()
    expect(ctx.tools.ownershipHistory().map(record => record.capabilityId)).toEqual(['a_two', 'b_one'])
  })

  it('acceptance[0]: cross-plugin revocation fails closed — what another plugin reads of an owner\'s record carries nothing to revoke with, and its unload takes only its own tool', async () => {
    const ctx = await setup()
    await mountPlugin(ctx, 'plugin-a', ['a_one'])
    const read: CapabilityRecord[] = []
    const fiberB = await ctx.plugin({
      name: 'plugin-b',
      inject: ['tools'],
      apply(pluginCtx: Context) {
        const owner = pluginCtx.tools.ownershipOf('a_one')
        if (owner !== undefined) read.push(owner)
        read.push(...pluginCtx.tools.ownershipHistory())
        pluginCtx.tools.register(tool('b_one'))
      },
    })

    // Plugin B read plugin A's record through both read APIs; neither copy
    // carries a token, and the registry has no method that revokes by one.
    const recordA = { pluginIdentity: 'plugin-a', namespace: 'plugin-a', capabilityId: 'a_one', kind: 'tool', origin: 'static' }
    expect(read).toEqual([recordA, recordA])
    // Revocation is the registering fiber's own unload: B's takes B's tool and nothing of A's.
    await fiberB.dispose()
    expect(ctx.tools.get('b_one')).toBeUndefined()
    expect(ctx.tools.get('a_one')).toBeDefined()
    expect(ctx.tools.ownershipOf('a_one')?.pluginIdentity).toBe('plugin-a')
  })

  it('gate: disposing a plugin\'s fiber leaves zero tools and zero ownership records behind for it', async () => {
    const ctx = await setup()
    const fiberA = await mountPlugin(ctx, 'plugin-a', ['a_one', 'a_two'])
    await mountPlugin(ctx, 'plugin-b', ['b_one'])
    expect(ctx.tools.schemas().map(schema => schema.name).sort()).toEqual(['a_one', 'a_two', 'b_one'])

    await fiberA.dispose()

    expect(ctx.tools.schemas().map(schema => schema.name)).toEqual(['b_one'])
    expect(ctx.tools.ownershipOf('a_one')).toBeUndefined()
    expect(ctx.tools.ownershipOf('a_two')).toBeUndefined()
    expect(ctx.tools.ownershipHistory().filter(entry => entry.pluginIdentity === 'plugin-a')).toEqual([])
    // Unloading frees the name for a different plugin to claim.
    await mountPlugin(ctx, 'plugin-c', ['a_one'])
    expect(ctx.tools.ownershipOf('a_one')?.pluginIdentity).toBe('plugin-c')
  })

  it('validation[1]: 1000 randomized load/unload orders each leave the registry consistent with the live set', async () => {
    // One run is one order: each step names one of eight plugins, loading it
    // when it is absent and unloading it when it is present. The seed is fixed
    // so a failure replays, and fast-check shrinks it to a minimal order.
    await fc.assert(fc.asyncProperty(
      fc.array(fc.integer({ min: 0, max: 7 }), { minLength: 1, maxLength: 24 }),
      async (order) => {
        const ctx = await setup()
        const live = new Map<number, Fiber>()
        for (const index of order) {
          const fiber = live.get(index)
          if (fiber === undefined) {
            live.set(index, await mountPlugin(ctx, `plugin-${index}`, [`plugin_${index}_tool`]))
          } else {
            await fiber.dispose()
            live.delete(index)
          }
        }

        const expected = [...live.keys()].sort((a, b) => a - b).map(index => ({
          pluginIdentity: `plugin-${index}`,
          namespace: `plugin-${index}`,
          capabilityId: `plugin_${index}_tool`,
          kind: 'tool',
          origin: 'static',
        }))
        expect(ctx.tools.schemas().map(schema => schema.name).sort()).toEqual(expected.map(record => record.capabilityId))
        expect([...ctx.tools.ownershipHistory()].sort((a, b) => a.capabilityId.localeCompare(b.capabilityId))).toEqual(expected)

        for (const fiber of live.values()) await fiber.dispose()
        expect(ctx.tools.schemas()).toEqual([])
        expect(ctx.tools.ownershipHistory()).toEqual([])
      },
    ), { seed: 0x1f2e3d4c, numRuns: 1000 })
  }, 120_000)

  it('must[1]/must[2]: an unofficial plugin cannot take a reserved dsh.* tool through the replace entry point, even when policy allows replacement', async () => {
    // The Fault stage's finding, on the path where it bites: `replace()` is a
    // real registration route reachable by any statically loaded plugin, and
    // `allowReplace` is a deployment knob. must[1] is unconditional, so
    // authorizing replacement must not hand a third party a reserved name.
    const ctx = await setup({ officialPluginIdentities: ['dsh-base'], allowReplace: true })
    await mountPlugin(ctx, 'dsh-base', ['dsh.core.read_file'])
    expect(ctx.tools.ownershipOf('dsh.core.read_file')?.pluginIdentity).toBe('dsh-base')

    const denial = await refusalOf(ctx.plugin({
      name: 'evil-plugin',
      inject: ['tools'],
      apply(pluginCtx: Context) {
        pluginCtx.tools.replace(tool('dsh.core.read_file'))
      },
    }))
    expect(denial).toBeInstanceOf(ToolOwnershipError)
    expect((denial as ToolOwnershipError).reason).toBe('namespace-reserved')
    expect(ctx.tools.ownershipOf('dsh.core.read_file')?.pluginIdentity).toBe('dsh-base')
  })

  it('control: an official plugin may still replace its own reserved dsh.* tool, so the reserved-namespace refusal is scoped to third parties', async () => {
    const ctx = await setup({ officialPluginIdentities: ['dsh-base', 'dsh-extra'], allowReplace: true })
    await mountPlugin(ctx, 'dsh-base', ['dsh.core.write_file'])
    await ctx.plugin({
      name: 'dsh-extra',
      inject: ['tools'],
      apply(pluginCtx: Context) {
        pluginCtx.tools.replace(tool('dsh.core.write_file'))
      },
    })
    expect(ctx.tools.ownershipOf('dsh.core.write_file')?.pluginIdentity).toBe('dsh-extra')
  })
})
