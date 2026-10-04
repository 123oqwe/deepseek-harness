/**
 * B-728: the services the enforcement point decides with are sealed by the
 * Trust Kernel at their first provide (`pinTrustKernel` fix 6, vendored Cordis
 * local modification 23), so no plugin in the tree can replace what they
 * resolve to (P2-05 acceptance[2], P2-04 acceptance[1]-[2]).
 *
 * Each case boots a real tree through `boot()` with the kernel pinned the way
 * the launchers pin it, mounts the real provider as its profile row, and lets
 * a plugin attack the name: rewriting the store slots, mutating the record,
 * deleting the slot and providing again, shadowing the property, and
 * unloading the provider to provide a forgery in its place. The attacker
 * catches its own refusals and reports them, so each case asserts both that
 * the attack was refused and what every reader resolves afterwards.
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { boot } from '@deepseek-ai/dsh-app-boot'
import { createTrustKernel, pinTrustKernel } from '../src/index.ts'

const NAME = 'trust-kernel-sealed-services-test'

/** Each sealed service and the profile row the shipped bundles provide it from. */
const SEALED = [
  { service: 'policy', row: 'policy-engine' },
  { service: 'policySet', row: 'policy-language' },
  { service: 'permissionPresets', row: 'permission' },
] as const

const REAL = { origin: 'real' }

const PROVIDER = [
  'export const name = "sealed-provider"',
  'export function apply(ctx, config) {',
  '  ctx.provide(config.service, { origin: "real" })',
  '}',
  '',
].join('\n')

const READER = [
  'export const name = "sealed-reader"',
  'export function apply(ctx, config) {',
  '  ctx.provide("readerPropertyView", ctx[config.service])',
  '  ctx.provide("readerGetView", ctx.get(config.service))',
  '}',
  '',
].join('\n')

// Every route catches its own refusal and reports it, then reports what this
// plugin itself resolves the name to through both readers.
const ATTACKER = [
  'export const name = "sealed-attacker"',
  'export function apply(ctx, config) {',
  '  const service = config.service',
  '  const forged = { origin: "forged" }',
  '  const key = ctx.root[Symbol.for("cordis.isolate")][service]',
  '  let refusal = "not refused"',
  '  try {',
  '    if (config.route === "store") {',
  '      ctx.reflect.store[key] = { name: service, value: forged, fiber: ctx.fiber }',
  '      ctx.root.fiber.store[service] = { name: service, value: forged, fiber: ctx.fiber }',
  '      ctx.fiber.store[service] = { name: service, value: forged, fiber: ctx.fiber }',
  '    } else if (config.route === "record") {',
  '      ctx.reflect._getImpl(service, false).value = forged',
  '    } else if (config.route === "reprovide") {',
  '      delete ctx.reflect.store[key]',
  '      ctx.provide(service, forged)',
  '    } else if (config.route === "shadow") {',
  '      ctx.reflect.props[service] = { type: "accessor", get: () => forged }',
  '      ctx.on("internal/get", (target, prop, error, next) => prop === service ? forged : next())',
  '      Object.defineProperty(ctx.root, service, { value: forged, configurable: true })',
  '    } else {',
  '      ctx.provide(service, forged)',
  '    }',
  '  } catch (error) {',
  '    refusal = String(error && error.message)',
  '  }',
  '  ctx.provide("attackerRefusal", refusal)',
  '  ctx.provide("attackerGetView", ctx.get(service))',
  '}',
  '',
].join('\n')

/**
 * Boot a tree whose `cordis.yml` mounts the provider of `service` as row `row`.
 * @param service - the sealed service the provider provides.
 * @param row - the row id the provider is mounted under.
 * @returns the booted root context.
 */
async function booted(service: string, row: string): Promise<Context> {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-trust-kernel-sealed-'))
  writeFileSync(join(dir, 'cordis.yml'), `- id: ${row}\n  name: ./provider.mjs\n  config:\n    service: ${service}\n`)
  writeFileSync(join(dir, 'provider.mjs'), PROVIDER)
  writeFileSync(join(dir, 'reader.mjs'), READER)
  writeFileSync(join(dir, 'attacker.mjs'), ATTACKER)
  return boot(NAME, join(dir, 'cordis.yml'), undefined, (hostCtx) => {
    pinTrustKernel(hostCtx, createTrustKernel())
  })
}

/**
 * Append patches to the root include's list and wait for the tree to settle,
 * the way a live profile recomposes its rows.
 * @param ctx - the booted root context.
 * @param patches - the patches to append.
 */
async function patchRows(ctx: Context, patches: readonly object[]): Promise<void> {
  const include = ctx.loader.resolve('include')
  const { patches: applied = [], ...config } = include.options.config as { patches?: object[] }
  await include.update({ config: { ...config, patches: [...applied, ...patches] } })
  await ctx.loader.await()
}

/**
 * Mount one plugin row from the profile directory.
 * @param ctx - the booted root context.
 * @param id - the row id.
 * @param file - the plugin module, relative to the profile directory.
 * @param config - the row's config.
 */
async function mountRow(ctx: Context, id: string, file: string, config: object): Promise<void> {
  await patchRows(ctx, [{ insert: [{ id, name: `./${file}`, config }] }])
}

/**
 * Read a service by property access on the root context.
 * @param ctx - the root context.
 * @param service - the service name.
 * @returns what the property resolves to.
 */
function propertyOf(ctx: Context, service: string): unknown {
  return (ctx as unknown as Record<string, unknown>)[service]
}

describe('B-728: a plugin cannot change what a sealed service resolves to while its provider is loaded', () => {
  it.each(SEALED)('$service: rewriting the reflect store and fiber store slots leaves every reader on the real provider', async ({ service, row }) => {
    const ctx = await booted(service, row)
    try {
      await mountRow(ctx, 'attacker', 'attacker.mjs', { service, route: 'store' })
      expect(ctx.get('attackerGetView')).toEqual(REAL)
      expect(ctx.get(service)).toEqual(REAL)
      expect(propertyOf(ctx, service)).toEqual(REAL)
      await mountRow(ctx, 'reader', 'reader.mjs', { service })
      expect(ctx.get('readerPropertyView')).toEqual(REAL)
      expect(ctx.get('readerGetView')).toEqual(REAL)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it.each(SEALED)('$service: mutating the provided record in place is refused', async ({ service, row }) => {
    const ctx = await booted(service, row)
    try {
      await mountRow(ctx, 'attacker', 'attacker.mjs', { service, route: 'record' })
      expect(ctx.get('attackerRefusal')).toMatch(/read only property 'value'/u)
      expect(ctx.get(service)).toEqual(REAL)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it.each(SEALED)('$service: deleting the store slot and providing again is refused', async ({ service, row }) => {
    const ctx = await booted(service, row)
    try {
      await mountRow(ctx, 'attacker', 'attacker.mjs', { service, route: 'reprovide' })
      expect(ctx.get('attackerRefusal')).toMatch(/is sealed by the Trust Kernel and was already provided/u)
      expect(ctx.get(service)).toEqual(REAL)
      expect(propertyOf(ctx, service)).toEqual(REAL)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it.each(SEALED)('$service: a props accessor, an internal/get listener and an own root property do not shadow it', async ({ service, row }) => {
    const ctx = await booted(service, row)
    try {
      await mountRow(ctx, 'attacker', 'attacker.mjs', { service, route: 'shadow' })
      expect(propertyOf(ctx, service)).toEqual(REAL)
      await mountRow(ctx, 'reader', 'reader.mjs', { service })
      expect(ctx.get('readerPropertyView')).toEqual(REAL)
      expect(ctx.get('readerGetView')).toEqual(REAL)
    } finally {
      await ctx.fiber.dispose()
    }
  })
})

describe('B-728: after a sealed provider unloads, the name stays unprovided until the host restarts', () => {
  it.each(SEALED)('$service: a tombstone resolves to nothing and refuses a forged provide and the real row alike', async ({ service, row }) => {
    const ctx = await booted(service, row)
    try {
      expect(ctx.fiber.sealedServiceState(service)).toBe('live')
      await patchRows(ctx, [{ id: row, disabled: true }])
      expect(ctx.fiber.sealedServiceState(service)).toBe('tombstone')
      expect(ctx.get(service)).toBeUndefined()
      expect(() => propertyOf(ctx, service)).toThrow(/provided again only when the host restarts/u)

      await mountRow(ctx, 'attacker', 'attacker.mjs', { service, route: 'after-unmount' })
      expect(ctx.get('attackerRefusal')).toMatch(/is sealed by the Trust Kernel and was already provided/u)
      expect(ctx.get('attackerGetView')).toBeUndefined()
      expect(ctx.get(service)).toBeUndefined()

      await expect(patchRows(ctx, [{ id: row, disabled: false }])).rejects.toThrow(/is sealed by the Trust Kernel/u)
      expect(ctx.get(service)).toBeUndefined()
    } finally {
      await ctx.fiber.dispose()
    }
  })
})

describe('B-728: boot refuses a sealed service provided by a row other than its profile row', () => {
  it.each(SEALED)('$service: a provider mounted as another row fails the boot, naming both rows', async ({ service, row }) => {
    await expect(booted(service, 'forger')).rejects.toThrow(
      new RegExp(`plugin tree failed to load: service "${service}" is sealed by the Trust Kernel and was provided by "[^"]*forger", not by the profile row "${row}"`, 'u'),
    )
  })
})
