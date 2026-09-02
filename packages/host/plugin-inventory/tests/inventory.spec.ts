import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, FiberState, type Plugin } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import type { AgentPresets } from '@deepseek-ai/dsh-agent-presets'
import PluginInventoryGateway, {
  buildObservedPluginCapabilities,
  buildPluginPermissionStates,
  mcpServerNameOf,
  resolveEntryPackageDir,
} from '../src/index.ts'

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

const activePlugin: Plugin.Function = () => {}
const pendingPlugin: Plugin.Object = {
  inject: ['neverReady'],
  apply() {},
}

async function harness(): Promise<{
  ctx: Context
  inventory: PluginInventoryGateway
}> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Loader)
  ctx.loader.builtins.active = activePlugin
  ctx.loader.builtins.pending = pendingPlugin
  await ctx.plugin(PluginInventoryGateway)
  const inventory = ctx.get('pluginInventory') as PluginInventoryGateway
  return { ctx, inventory }
}

describe('PluginInventoryGateway', () => {
  it('publishes one direct list method under the pluginInventory namespace', async () => {
    const { inventory } = await harness()
    expect(inventory.typertRemote).toMatchObject({
      serviceKey: 'pluginInventory',
      namespace: 'pluginInventory',
    })
    expect(remoteMethods(inventory)).toEqual([
      { method: 'list', invocation: { kind: 'direct' } },
    ])
  })

  it('projects current non-group Loader entries without a second cache', async () => {
    const { ctx, inventory } = await harness()
    const activeId = await ctx.loader.create({ name: 'cordis:active' })
    const pendingId = await ctx.loader.create({ name: 'cordis:pending' })
    const disabledId = await ctx.loader.create({
      name: 'cordis:not-installed',
      disabled: true,
    })
    await ctx.loader.create({ name: 'cordis:active', group: true })

    const snapshot = await inventory.list()
    // No agent-preset roster is composed, so the snapshot carries no presets.
    expect(snapshot.agentPresets).toBeUndefined()
    expect(snapshot.entries).toHaveLength(3)
    expect(snapshot.entries).toEqual(expect.arrayContaining([
      {
        entryId: activeId,
        moduleName: 'cordis:active',
        enabled: true,
        fiberPhase: 'active',
      },
      {
        entryId: pendingId,
        moduleName: 'cordis:pending',
        enabled: true,
        fiberPhase: 'pending',
      },
      {
        entryId: disabledId,
        moduleName: 'cordis:not-installed',
        enabled: false,
        fiberPhase: null,
      },
    ]))

    await ctx.loader.update(activeId, { disabled: true })
    expect((await inventory.list()).entries.find(entry => entry.entryId === activeId)).toEqual({
      entryId: activeId,
      moduleName: 'cordis:active',
      enabled: false,
      fiberPhase: null,
    })

    await ctx.loader.remove(pendingId)
    expect((await inventory.list()).entries.some(entry => entry.entryId === pendingId)).toBe(false)
  })

  it('carries each composed preset with root-fiber states mapped to phases', async () => {
    const { ctx, inventory } = await harness()
    ctx.provide('agentPresets', {
      compositionInventory: async () => [
        {
          id: 'standard',
          trust: 'system',
          name: '标准模式',
          isDefault: true,
          rows: [
            { entryId: 'alpha', moduleName: 'pkg-alpha', enabled: true, fiberState: FiberState.ACTIVE },
            { entryId: null, moduleName: 'pkg-file', enabled: 'conditional', condition: 'x' },
          ],
        },
        { id: 'damaged', trust: 'user', isDefault: false, broken: 'the composition file is missing', rows: [] },
      ],
    } as Partial<AgentPresets> as never)

    const snapshot = await inventory.list()
    expect(snapshot.agentPresets).toEqual([
      {
        id: 'standard',
        trust: 'system',
        name: '标准模式',
        isDefault: true,
        rows: [
          { entryId: 'alpha', moduleName: 'pkg-alpha', enabled: true, fiberPhase: 'active' },
          { entryId: null, moduleName: 'pkg-file', enabled: 'conditional', condition: 'x', fiberPhase: null },
        ],
      },
      { id: 'damaged', trust: 'user', isDefault: false, broken: 'the composition file is missing', rows: [] },
    ])
  })
})

/** A plugin that registers one of each observable capability category directly through `ctx`'s own primitives. */
const probePlugin: Plugin.Function = (ctx) => {
  ctx.provide('exampleObservedService', 42)
  // A synthetic test-only event name, not a real declared `Events` member.
  ctx.on('example/observed-event' as never, (() => {}) as never)
  ctx.effect(function* () { yield () => {} }, 'tools.register("example-observed-tool")')
  ctx.effect(function* () { yield () => {} }, 'skills.register("example-observed-skill")')
  // An effect this parser must ignore: no registered name is recoverable from it.
  ctx.effect(function* () { yield () => {} }, 'some.other.effect()')
}

describe('buildObservedPluginCapabilities', () => {
  it('reports every capability category a plugin actually registered through real Cordis primitives', async () => {
    const { ctx } = await harness()
    ctx.loader.builtins.probe = probePlugin
    const entryId = await ctx.loader.create({ name: 'cordis:probe' })
    const entry = [...ctx.loader.entries()].find(candidate => candidate.id === entryId)
    expect(entry?.fiber).toBeDefined()
    const observed = buildObservedPluginCapabilities(ctx, entry!.fiber!)
    expect(observed).toEqual({
      ctxKeys: ['exampleObservedService'],
      toolNames: ['example-observed-tool'],
      skillNames: ['example-observed-skill'],
      mcpServerNames: [],
      eventNames: ['example/observed-event'],
    })
  })

  it('stops observing once the fiber disposes (registrations are effects, undone on disposal)', async () => {
    const { ctx } = await harness()
    ctx.loader.builtins.probe = probePlugin
    const entryId = await ctx.loader.create({ name: 'cordis:probe' })
    const entry = [...ctx.loader.entries()].find(candidate => candidate.id === entryId)
    const fiber = entry!.fiber!
    await fiber.dispose()
    expect(buildObservedPluginCapabilities(ctx, fiber)).toEqual({
      ctxKeys: [], toolNames: [], skillNames: [], mcpServerNames: [], eventNames: [],
    })
  })

  it('ignores effect labels that are not a JSON string argument (a non-string JSON value or unparseable content)', async () => {
    const oddPlugin: Plugin.Function = (ctx) => {
      ctx.effect(function* () { yield () => {} }, 'tools.register("real-tool")')
      // A JSON-valid but non-string argument.
      ctx.effect(function* () { yield () => {} }, 'tools.register(123)')
      // Not valid JSON at all.
      ctx.effect(function* () { yield () => {} }, 'tools.register(not valid json)')
    }
    const { ctx } = await harness()
    ctx.loader.builtins.odd = oddPlugin
    const entryId = await ctx.loader.create({ name: 'cordis:odd' })
    const entry = [...ctx.loader.entries()].find(candidate => candidate.id === entryId)
    expect(buildObservedPluginCapabilities(ctx, entry!.fiber!).toolNames).toEqual(['real-tool'])
  })

  it('skips a disabled subtree entry with no live fiber and still surfaces a live MCP-client entry\'s real serverName', async () => {
    // A real `cordis-plugin-include` group nests its own child entries'
    // fibers inside its own root fiber's subtree — the mechanism a plugin
    // package's own patch layer uses to mount further plugins underneath it.
    const Include = (await import('@deepseek-ai/cordis-plugin-include')).default
    const ctx = new Context()
    contexts.push(ctx)
    ctx.baseUrl = 'file:///dsh-plugin-inventory-test/'
    await ctx.plugin(Loader)
    ctx.loader.builtins['nested-active'] = activePlugin
    // A bare, non-`cordis:` specifier bypasses `builtins` (that map only
    // intercepts `cordis:`-prefixed names); `internal.import` is the real
    // hook for a literal module name like the real MCP-client package.
    ctx.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (specifier === '@deepseek-ai/dsh-mcp-client') return { apply() {} } satisfies Plugin.Object
        throw new Error(`unexpected Loader import in test: ${specifier}`)
      },
    } as unknown as NonNullable<typeof ctx.loader.internal>
    ctx.loader.builtins.include = Include
    const configDir = mkdtempSync(join(tmpdir(), 'dsh-plugin-inventory-include-'))
    const configPath = join(configDir, 'cordis.yml')
    writeFileSync(configPath, [
      '- id: disabled-child',
      '  name: cordis:nested-active',
      '  disabled: true',
      '- id: mcp-child',
      '  name: "@deepseek-ai/dsh-mcp-client"',
      '  config:',
      '    serverName: example-live-server',
      '',
    ].join('\n'))
    const rootId = await ctx.loader.create({
      name: 'cordis:include',
      config: { path: pathToFileURL(configPath).href },
    })
    await ctx.loader.await()
    const rootEntry = [...ctx.loader.entries()].find(candidate => candidate.id === rootId)
    const disabledEntry = [...ctx.loader.entries()].find(candidate => candidate.options.name === 'cordis:nested-active')
    expect(disabledEntry?.fiber).toBeUndefined()
    const observed = buildObservedPluginCapabilities(ctx, rootEntry!.fiber!)
    expect(observed.mcpServerNames).toEqual(['example-live-server'])
  })
})

describe('mcpServerNameOf', () => {
  it('reads a live MCP-client entry\'s real serverName from its resolved config', () => {
    expect(mcpServerNameOf({
      options: { name: '@deepseek-ai/dsh-mcp-client' },
      fiber: { config: { serverName: 'example-docs' } },
    })).toBe('example-docs')
  })

  it('ignores a non-MCP-client entry even when its config happens to carry a serverName field', () => {
    expect(mcpServerNameOf({
      options: { name: 'cordis:probe' },
      fiber: { config: { serverName: 'not-really-mcp' } },
    })).toBeUndefined()
  })

  it('ignores an MCP-client entry with no live fiber or no resolved serverName', () => {
    expect(mcpServerNameOf({ options: { name: '@deepseek-ai/dsh-mcp-client' } })).toBeUndefined()
    expect(mcpServerNameOf({ options: { name: '@deepseek-ai/dsh-mcp-client' }, fiber: { config: {} } })).toBeUndefined()
  })
})

describe('resolveEntryPackageDir', () => {
  it('returns undefined immediately for a cordis: builtin, with no filesystem probing', () => {
    expect(resolveEntryPackageDir('cordis:active')).toBeUndefined()
  })

  it('finds a real installed workspace package by its own package.json', () => {
    const dir = resolveEntryPackageDir('@deepseek-ai/dsh-brand')
    expect(dir).toBeDefined()
    expect(dir).toMatch(/dsh-brand$/)
  })

  it('returns undefined for a Node builtin (resolve.paths returns null, not a search-path array)', () => {
    expect(resolveEntryPackageDir('fs')).toBeUndefined()
  })

  it('returns undefined once every search path is exhausted with no match', () => {
    expect(resolveEntryPackageDir('dsh-totally-bogus-unresolvable-package-name-xyz')).toBeUndefined()
  })
})

/** Stage a real on-disk package directory (`package.json` only — the fake resolver never imports it). */
function stagePackage(dsh: unknown, name = 'example-plugin-package', version = '1.0.0'): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-plugin-inventory-'))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version, ...dsh === undefined ? {} : { dsh } }))
  return dir
}

/** Declares exactly `probePlugin`'s real registrations (service, tool, skill, event) — a clean, matching manifest. */
const BENIGN_DSH_FIELD = {
  manifestVersion: 2,
  services: [{ ctxKey: 'exampleObservedService', role: 'provides' }],
  tools: [{
    name: 'example-observed-tool',
    sideEffectClass: 'none',
    authAudience: ['model'],
    allowedDestinations: [],
    dataClassification: 'internal',
  }],
  skills: [{ name: 'example-observed-skill', sideEffectClass: 'none', dataClassification: 'internal' }],
  events: [{ name: 'example/observed-event', mode: 'emit' }],
  executionMode: 'in-process',
  compatibility: { dshVersionRange: '>=0.1.0 <1.0.0' },
}

describe('buildPluginPermissionStates', () => {
  it('builds an active permission state for a manifest-v2 plugin whose registrations exactly match', async () => {
    const { ctx } = await harness()
    ctx.loader.builtins['probe-manifest'] = probePlugin
    const entryId = await ctx.loader.create({ name: 'cordis:probe-manifest' })
    const dir = stagePackage(BENIGN_DSH_FIELD, 'example-manifest-plugin')
    const states = buildPluginPermissionStates(ctx, {
      resolvePackageDir: moduleName => (moduleName === 'cordis:probe-manifest' ? dir : undefined),
    })
    const state = states.find(candidate => candidate.entryId === entryId)
    expect(state).toBeDefined()
    expect(state?.packageIdentity).toEqual({ name: 'example-manifest-plugin', version: '1.0.0' })
    expect(state?.provenance).toEqual({ kind: 'built-in' })
    expect(state?.declaration.kind).toBe('manifest-v2')
    expect(state?.trustDecision).toBe('active')
    expect(state?.comparison?.mismatches).toEqual([])
  })

  it('marks bundle provenance for a module named in bundlePackageNames', async () => {
    const { ctx } = await harness()
    ctx.loader.builtins['probe-bundle'] = probePlugin
    await ctx.loader.create({ name: 'cordis:probe-bundle' })
    const dir = stagePackage(undefined, 'example-bundle-plugin')
    const states = buildPluginPermissionStates(ctx, {
      bundlePackageNames: ['cordis:probe-bundle'],
      resolvePackageDir: moduleName => (moduleName === 'cordis:probe-bundle' ? dir : undefined),
    })
    expect(states.find(state => state.packageIdentity.name === 'example-bundle-plugin')?.provenance).toEqual({
      kind: 'bundle',
      source: 'cordis:probe-bundle',
    })
  })

  it('carries a missing declaration and no comparison/trustDecision for a plugin with no dsh field', async () => {
    const { ctx } = await harness()
    ctx.loader.builtins['probe-undeclared'] = probePlugin
    await ctx.loader.create({ name: 'cordis:probe-undeclared' })
    const dir = stagePackage(undefined, 'example-undeclared-plugin')
    const states = buildPluginPermissionStates(ctx, {
      resolvePackageDir: moduleName => (moduleName === 'cordis:probe-undeclared' ? dir : undefined),
    })
    const state = states.find(candidate => candidate.packageIdentity.name === 'example-undeclared-plugin')
    expect(state?.declaration).toEqual({ kind: 'missing' })
    expect(state?.comparison).toBeUndefined()
    expect(state?.trustDecision).toBeUndefined()
  })

  it('quarantines a plugin that registered a tool its manifest never declared', async () => {
    const { ctx } = await harness()
    const undeclaredToolPlugin: Plugin.Function = (pluginCtx) => {
      pluginCtx.provide('exampleObservedService', 1)
      pluginCtx.effect(function* () { yield () => {} }, 'tools.register("example-observed-tool")')
      pluginCtx.effect(function* () { yield () => {} }, 'tools.register("undeclared-tool")')
    }
    ctx.loader.builtins['probe-mismatch'] = undeclaredToolPlugin
    await ctx.loader.create({ name: 'cordis:probe-mismatch' })
    const dir = stagePackage(BENIGN_DSH_FIELD, 'example-mismatch-plugin')
    const states = buildPluginPermissionStates(ctx, {
      resolvePackageDir: moduleName => (moduleName === 'cordis:probe-mismatch' ? dir : undefined),
    })
    const state = states.find(candidate => candidate.packageIdentity.name === 'example-mismatch-plugin')
    expect(state?.trustDecision).toBe('quarantined')
    expect(state?.comparison?.mismatches).toEqual(expect.arrayContaining([
      { kind: 'undeclared-registration', category: 'tool', name: 'undeclared-tool' },
    ]))
  })

  it('skips an entry with no resolvable package (the real resolver never finds a cordis: builtin on disk)', async () => {
    const { ctx } = await harness()
    ctx.loader.builtins.probe = probePlugin
    const entryId = await ctx.loader.create({ name: 'cordis:probe' })
    const states = buildPluginPermissionStates(ctx)
    expect(states.some(state => state.entryId === entryId)).toBe(false)
  })

  it('skips a resolved package whose package.json is not valid JSON', async () => {
    const { ctx } = await harness()
    ctx.loader.builtins['probe-bad-json'] = probePlugin
    await ctx.loader.create({ name: 'cordis:probe-bad-json' })
    const dir = mkdtempSync(join(tmpdir(), 'dsh-plugin-inventory-'))
    writeFileSync(join(dir, 'package.json'), '{ not valid json')
    const states = buildPluginPermissionStates(ctx, {
      resolvePackageDir: moduleName => (moduleName === 'cordis:probe-bad-json' ? dir : undefined),
    })
    expect(states).toEqual([])
  })

  it('falls back to the module name and version 0.0.0 when package.json omits them', async () => {
    const { ctx } = await harness()
    ctx.loader.builtins['probe-no-identity'] = probePlugin
    await ctx.loader.create({ name: 'cordis:probe-no-identity' })
    const dir = mkdtempSync(join(tmpdir(), 'dsh-plugin-inventory-'))
    writeFileSync(join(dir, 'package.json'), '{}')
    const states = buildPluginPermissionStates(ctx, {
      resolvePackageDir: moduleName => (moduleName === 'cordis:probe-no-identity' ? dir : undefined),
    })
    expect(states[0]?.packageIdentity).toEqual({ name: 'cordis:probe-no-identity', version: '0.0.0' })
  })

  it('skips a group entry entirely, regardless of resolvability', async () => {
    const { ctx } = await harness()
    ctx.loader.builtins.active = activePlugin
    const groupId = await ctx.loader.create({ name: 'cordis:active', group: true })
    const dir = stagePackage(undefined, 'cordis:active')
    const states = buildPluginPermissionStates(ctx, {
      resolvePackageDir: () => dir,
    })
    expect(states.some(state => state.entryId === groupId)).toBe(false)
  })

  it('reports empty observed capabilities for a resolvable but disabled (fiber-less) entry', async () => {
    const { ctx } = await harness()
    ctx.loader.builtins['probe-disabled'] = probePlugin
    const entryId = await ctx.loader.create({ name: 'cordis:probe-disabled', disabled: true })
    const dir = stagePackage(BENIGN_DSH_FIELD, 'example-disabled-plugin')
    const states = buildPluginPermissionStates(ctx, {
      resolvePackageDir: moduleName => (moduleName === 'cordis:probe-disabled' ? dir : undefined),
    })
    const state = states.find(candidate => candidate.entryId === entryId)
    expect(state?.observed).toEqual({ ctxKeys: [], toolNames: [], skillNames: [], mcpServerNames: [], eventNames: [] })
  })
})
