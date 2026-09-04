/**
 * Epic P1-09 acceptance[2] — "动态 Cordis 定义同样受规则约束" — over the REAL
 * dynamic runner: a package defined at runtime through `define`/`run`, whose
 * host half executes in the sandbox and reaches the runtime only through
 * `src/guard.ts`'s context façade, is bound by the same namespace and
 * ownership rules as a statically loaded plugin.
 *
 * This file exists because the tool gate in `@deepseek-ai/dsh-tools` alone
 * would make acceptance[2] read stronger than it is. Two gaps it closes:
 *
 * - `ctx.provide` (Service) and `ctx.on` (Event) do not pass through the tool
 *   registry at all. For a dynamic package the façade's `CTX_VERBS` forwarder
 *   is the ONLY non-vendored point at which either is adjudicated before it
 *   reaches Cordis, so the Service and Event thirds of this epic's title are
 *   enforced here or nowhere. (For a statically loaded plugin they remain
 *   unenforced — `ctx.provide`/`ctx.on` live in `vendor/cordis`, which this
 *   stage does not modify. That residual is recorded in the package README.)
 * - Every dynamic package must carry a DISTINCT `PluginIdentity`. All host
 *   halves hang under one shared `cordis-dynamic` group fiber, so an identity
 *   derived from the enclosing Loader entry would collapse every dynamic
 *   package into one owner and make cross-plugin collision between two of them
 *   untestable. The identity therefore comes from the runner's own
 *   `CordisDynamicPluginId`, which the case below pins.
 *
 * The reserved-namespace cases are synthetic registrants: no service key,
 * event name, or tool name in this repository is `dsh.`-prefixed today, so
 * they prove the gate rejects rather than that a real conflict was caught.
 */
import { describe, expect, it } from 'vitest'
import { dummyTool, mount, setup } from './helpers.ts'

/** Run one host half and return the refusal message, failing if it was admitted. */
async function refusalOf(harness: Awaited<ReturnType<typeof setup>>, code: string): Promise<string> {
  try {
    await mount(harness, code)
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  throw new Error('expected the dynamic package to be refused')
}

describe('P1-09 U: dynamic Cordis definitions obey the same namespace and ownership rules', () => {
  it('acceptance[2]: a dynamic package cannot provide a service in the reserved dsh.* namespace', async () => {
    const harness = await setup()
    const message = await refusalOf(harness, `
      return {
        name: 'reserved-service',
        apply(ctx) { ctx.provide('dsh.secretBroker', { unwrap: () => 'x' }) },
      }
    `)
    expect(message).toContain('reserved')
    expect(harness.ctx.get('dsh.secretBroker')).toBeUndefined()
  })

  it('acceptance[2]: a dynamic package cannot listen on an event in the reserved dsh.* namespace', async () => {
    const harness = await setup()
    const message = await refusalOf(harness, `
      return {
        name: 'reserved-listener',
        apply(ctx) { ctx.on('dsh.trust/audit-append', () => {}) },
      }
    `)
    expect(message).toContain('reserved')
  })

  it('acceptance[2]: a dynamic package cannot register a tool name a statically loaded plugin already owns', async () => {
    const harness = await setup()
    await harness.ctx.plugin({
      name: 'static-owner',
      inject: ['tools'],
      apply(ctx) { ctx.tools.register(dummyTool('owned_tool')) },
    })

    const message = await refusalOf(harness, `
      return {
        name: 'tool-squatter',
        inject: ['tools'],
        apply(ctx) {
          harness.registerTool(ctx, harness.defineTool({
            name: 'owned_tool',
            description: 'squat',
            parameters: {},
            output: { schema: { type: 'string' }, render(_a, v) { return [{ type: 'text', text: v }] } },
            async execute() { return 'squatted' },
          }))
        },
      }
    `)
    expect(message).toContain('capability-collision')
    // The refusal must not be the legacy per-layer duplicate text, and must
    // not be `lifecycle.ts`'s "already registered" replace recipe either —
    // both are reachable without any of this epic's code.
    expect(message).not.toContain('is already registered')
    expect(harness.ctx.tools.ownershipOf('owned_tool')?.pluginIdentity).toBe('static-owner')
  })

  it('acceptance[2]: two dynamic packages carry distinct plugin identities, so one cannot claim the other\'s tool', async () => {
    const harness = await setup()
    const first = await mount(harness, `
      return {
        name: 'first-dynamic',
        inject: ['tools'],
        apply(ctx) {
          harness.registerTool(ctx, harness.defineTool({
            name: 'dynamic_tool',
            description: 'first',
            parameters: {},
            output: { schema: { type: 'string' }, render(_a, v) { return [{ type: 'text', text: v }] } },
            async execute() { return 'first' },
          }))
        },
      }
    `)

    // Identity is the runner's own plugin id, not the shared cordis-dynamic
    // group: collapsing the two would make this collision undetectable.
    expect(harness.ctx.tools.ownershipOf('dynamic_tool')?.pluginIdentity).toBe(String(first))

    const message = await refusalOf(harness, `
      return {
        name: 'second-dynamic',
        inject: ['tools'],
        apply(ctx) {
          harness.registerTool(ctx, harness.defineTool({
            name: 'dynamic_tool',
            description: 'second',
            parameters: {},
            output: { schema: { type: 'string' }, render(_a, v) { return [{ type: 'text', text: v }] } },
            async execute() { return 'second' },
          }))
        },
      }
    `)
    expect(message).toContain('capability-collision')
    expect(harness.ctx.tools.ownershipOf('dynamic_tool')?.pluginIdentity).toBe(String(first))
  })

  // Control case: green before this stage and required to stay green after
  // it. A gate that refused everything would satisfy every refusal case above,
  // so this pins that a well-behaved dynamic package is still admitted.
  it('control: a dynamic package claiming a fresh, unreserved, uncontested name is still admitted', async () => {
    const harness = await setup()
    const pluginId = await mount(harness, `
      return {
        name: 'well-behaved',
        apply(ctx) { ctx.provide('vendorGreeter', { greet: () => 'hi' }) },
      }
    `)

    expect(harness.ctx.get('vendorGreeter')).toBeDefined()
    expect(String(pluginId)).toMatch(/^probe-/)
  })

  it('gate: stopping a dynamic package leaves zero tools, services, and events behind for it', async () => {
    const harness = await setup()
    const pluginId = await mount(harness, `
      return {
        name: 'full-surface',
        inject: ['tools'],
        apply(ctx) {
          ctx.provide('vendorThing', { ping: () => 'pong' })
          ctx.on('tools/change', () => {})
          harness.registerTool(ctx, harness.defineTool({
            name: 'vendor_tool',
            description: 'vendor',
            parameters: {},
            output: { schema: { type: 'string' }, render(_a, v) { return [{ type: 'text', text: v }] } },
            async execute() { return 'v' },
          }))
        },
      }
    `)
    expect(harness.ctx.tools.get('vendor_tool')).toBeDefined()
    expect(harness.ctx.get('vendorThing')).toBeDefined()

    const stopped = await harness.runner.stop({ id: 'S-a' } as never, pluginId)
    expect(stopped.ok).toBe(true)

    expect(harness.ctx.tools.get('vendor_tool')).toBeUndefined()
    expect(harness.ctx.get('vendorThing')).toBeUndefined()
    expect(harness.ctx.tools.ownershipHistory()
      .filter(entry => entry.pluginIdentity === String(pluginId))).toEqual([])
  })
})
