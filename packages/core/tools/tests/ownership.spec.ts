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
import type { OwnershipToken } from '@deepseek-ai/dsh-plugin-ownership'
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
function mountPlugin(ctx: Context, identity: string, names: readonly string[]): Fiber {
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
async function refusalOf(mounting: Fiber): Promise<unknown> {
  try {
    await mounting
  } catch (error) {
    return error
  }
  throw new Error('expected the registration to be refused')
}

describe('P1-09 U: the real tool registry adjudicates namespace and ownership', () => {
  it('must[0]: an admitted registration carries plugin identity, namespace, capability id, and a minted ownership token', async () => {
    const ctx = await setup()
    await mountPlugin(ctx, 'plugin-a', ['alpha_tool'])

    const registration = ctx.tools.ownershipOf('alpha_tool')
    expect(registration).toBeDefined()
    expect(registration?.pluginIdentity).toBe('plugin-a')
    expect(registration?.capabilityId).toBe('alpha_tool')
    expect(registration?.kind).toBe('tool')
    expect(registration?.namespace).toBeDefined()
    expect(registration?.ownershipToken).toEqual(expect.stringContaining('plugin-a:'))
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

  it('must[3]: revoking with an ownership token removes exactly that token\'s tools and nothing else', async () => {
    const ctx = await setup()
    await mountPlugin(ctx, 'plugin-a', ['a_one', 'a_two'])
    await mountPlugin(ctx, 'plugin-b', ['b_one'])

    const tokenA = ctx.tools.ownershipOf('a_one')?.ownershipToken
    expect(tokenA).toBeDefined()
    const result = ctx.tools.revokeOwned(tokenA as OwnershipToken)
    expect(result.revoked).toBe(true)

    expect(ctx.tools.get('a_one')).toBeUndefined()
    // Two registrations by the same plugin are two separately minted tokens:
    // one token revokes exactly its own effect, never the plugin's whole set.
    expect(ctx.tools.get('a_two')).toBeDefined()
    expect(ctx.tools.get('b_one')).toBeDefined()
  })

  it('acceptance[0]: cross-plugin revocation fails closed — another plugin\'s real token revokes nothing of this one\'s', async () => {
    const ctx = await setup()
    await mountPlugin(ctx, 'plugin-a', ['a_one'])
    await mountPlugin(ctx, 'plugin-b', ['b_one'])

    const tokenB = ctx.tools.ownershipOf('b_one')?.ownershipToken as OwnershipToken
    // Plugin B presenting its own real token cannot reach plugin A's tool:
    // the revoke path takes only a token, so there is no name or identity to
    // substitute. This exercises the token path introduced by this stage —
    // before it, cross-plugin revocation was not expressible at all.
    ctx.tools.revokeOwned(tokenB)
    expect(ctx.tools.get('a_one')).toBeDefined()

    const fabricated = 'plugin-a:00000000-0000-0000-0000-000000000000' as OwnershipToken
    expect(ctx.tools.revokeOwned(fabricated).revoked).toBe(false)
    expect(ctx.tools.get('a_one')).toBeDefined()
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

  it('validation[1]: 1000 randomized load/unload orders leave the registry consistent with the live set', async () => {
    const ctx = await setup()
    // A fixed seed so a failure is reproducible; the point is order variety,
    // not entropy.
    let seed = 0x1f2e3d4c
    const next = (bound: number): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed % bound
    }
    const live = new Map<string, Fiber>()

    for (let step = 0; step < 1000; step += 1) {
      const identity = `plugin-${next(8)}`
      if (live.has(identity) && next(2) === 0) {
        await live.get(identity)?.dispose()
        live.delete(identity)
        continue
      }
      if (live.has(identity)) continue
      live.set(identity, await mountPlugin(ctx, identity, [`${identity.replace('-', '_')}_tool`]))
    }

    const expected = [...live.keys()].map(identity => `${identity.replace('-', '_')}_tool`).sort()
    expect(ctx.tools.schemas().map(schema => schema.name).sort()).toEqual(expected)
    expect(ctx.tools.ownershipHistory().map(entry => entry.capabilityId).sort()).toEqual(expected)

    for (const fiber of live.values()) await fiber.dispose()
    expect(ctx.tools.schemas()).toEqual([])
    expect(ctx.tools.ownershipHistory()).toEqual([])
  })

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
