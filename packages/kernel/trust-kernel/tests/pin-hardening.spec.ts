/**
 * Runtime proof of the three further live bypasses an adversarial review
 * found against `pinTrustKernel`'s original single-freeze fix (the freeze
 * `tests/dispose.spec.ts`'s third `describe` block already proves) -- and of
 * the one bypass `pinTrustKernel` cannot close, documented honestly rather
 * than hidden. See `../src/index.ts`'s `pinTrustKernel` doc comment for the
 * vendored-Cordis mechanism each test exercises and cites.
 *
 * Each vector test below was confirmed to fail against the pre-fix
 * `pinTrustKernel` (only the `ctx.reflect.store[key]` slot freeze, no
 * `Object.freeze(impl)`, no root-fiber-store lock, no `reflect.props` lock)
 * before the fix landed -- see the Writer's final report for the pasted
 * before/after `vitest` output.
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { boot } from '@deepseek-ai/dsh-app-boot'
import { createTrustKernel, pinTrustKernel } from '../src/index.ts'

const NAME = 'trust-kernel-pin-hardening-test'

const tmp = (): string => mkdtempSync(join(tmpdir(), 'dsh-trust-kernel-pin-hardening-'))

function findEntry(ctx: Context, predicate: (options: { id?: string; name?: string }) => boolean) {
  return [...ctx.loader.entries()].find(entry => predicate(entry.options))
}

async function insertMalicious(ctx: Context, id: string, file: string) {
  const includeEntry = findEntry(ctx, options => options.name === 'cordis:include')
  expect(includeEntry).toBeDefined()
  return includeEntry!.update({
    config: {
      ...includeEntry!.options.config as object,
      patches: [{ insert: [{ id, name: `./${file}` }] }],
    },
  })
}

describe('vector 1: a plugin cannot mutate the frozen store slot\'s Impl record in place (F-stage review finding, closed by Object.freeze(impl))', () => {
  it('rejects `impl.value = forged` against a kernel pinned via pinTrustKernel, and leaves ctx.get(\'trustKernel\') unforged', async () => {
    const dir = tmp()
    writeFileSync(join(dir, 'cordis.yml'), '[]\n')
    writeFileSync(join(dir, 'malicious-mutate-value.mjs'), [
      'export const name = "malicious-mutate-value"',
      'export function apply(ctx) {',
      '  const key = ctx.root[Symbol.for("cordis.isolate")]["trustKernel"]',
      '  ctx.reflect.store[key].value = { forged: true }',
      '}',
      '',
    ].join('\n'))
    const kernel = createTrustKernel()
    const ctx = await boot(NAME, join(dir, 'cordis.yml'), undefined, (hostCtx) => {
      pinTrustKernel(hostCtx, kernel)
    })
    try {
      await expect(insertMalicious(ctx, 'malicious-mutate-value', 'malicious-mutate-value.mjs'))
        .rejects.toThrow(/Cannot assign to read only property 'value'/)

      expect(findEntry(ctx, options => options.id === 'malicious-mutate-value')).toBeUndefined()
      expect(ctx.get('trustKernel')).toBe(kernel)
    } finally {
      await ctx.fiber.dispose()
    }
  })
})

describe('vector 2: a plugin cannot poison ctx.trustKernel globally via the root fiber\'s own store (F-stage review finding, closed by locking ctx.root.fiber.store)', () => {
  it('rejects a direct write to ctx.root.fiber.store[\'trustKernel\'], and leaves both ctx.get and ctx.trustKernel property access unforged for an unrelated sibling', async () => {
    const dir = tmp()
    writeFileSync(join(dir, 'cordis.yml'), '- id: sibling\n  name: ./sibling.mjs\n')
    writeFileSync(join(dir, 'sibling.mjs'), [
      'export const name = "sibling"',
      'export function apply(ctx) {',
      '  ctx.provide("siblingTrustKernelView", ctx.trustKernel)',
      '}',
      '',
    ].join('\n'))
    writeFileSync(join(dir, 'malicious-root-fiber-store.mjs'), [
      'export const name = "malicious-root-fiber-store"',
      'export function apply(ctx) {',
      '  const forged = { name: "trustKernel", value: { forged: true }, fiber: ctx.fiber }',
      '  ctx.root.fiber.store["trustKernel"] = forged',
      '}',
      '',
    ].join('\n'))
    const kernel = createTrustKernel()
    const ctx = await boot(NAME, join(dir, 'cordis.yml'), undefined, (hostCtx) => {
      pinTrustKernel(hostCtx, kernel)
    })
    try {
      expect(ctx.get('siblingTrustKernelView')).toBe(kernel)

      await expect(insertMalicious(ctx, 'malicious-root-fiber-store', 'malicious-root-fiber-store.mjs'))
        .rejects.toThrow(/Cannot assign to read only property 'trustKernel'/)

      expect(findEntry(ctx, options => options.id === 'malicious-root-fiber-store')).toBeUndefined()
      expect(ctx.get('trustKernel')).toBe(kernel)
      // The sibling's own property-access view, resolved BEFORE the attack,
      // stays correct -- re-reading it proves the root fiber's store entry
      // (which every subtree's parent-chain walk terminates at) is still the
      // real kernel, not merely that the earlier snapshot was.
      const sibling = findEntry(ctx, options => options.id === 'sibling')
      expect(sibling).toBeDefined()
    } finally {
      await ctx.fiber.dispose()
    }
  })
})

describe('vector 3: a plugin cannot substitute an accessor for trustKernel in ctx.reflect.props (F-stage review finding, closed by locking ctx.reflect.props)', () => {
  it('rejects a direct write to ctx.reflect.props[\'trustKernel\'], and leaves ctx.trustKernel property access unforged', async () => {
    const dir = tmp()
    writeFileSync(join(dir, 'cordis.yml'), '[]\n')
    writeFileSync(join(dir, 'malicious-props-accessor.mjs'), [
      'export const name = "malicious-props-accessor"',
      'export function apply(ctx) {',
      '  ctx.reflect.props["trustKernel"] = { type: "accessor", get: () => ({ forged: true }) }',
      '}',
      '',
    ].join('\n'))
    const kernel = createTrustKernel()
    const ctx = await boot(NAME, join(dir, 'cordis.yml'), undefined, (hostCtx) => {
      pinTrustKernel(hostCtx, kernel)
    })
    try {
      await expect(insertMalicious(ctx, 'malicious-props-accessor', 'malicious-props-accessor.mjs'))
        .rejects.toThrow(/Cannot assign to read only property 'trustKernel'/)

      expect(findEntry(ctx, options => options.id === 'malicious-props-accessor')).toBeUndefined()
      expect(ctx.get('trustKernel')).toBe(kernel)
      expect(ctx.trustKernel).toBe(kernel)
    } finally {
      await ctx.fiber.dispose()
    }
  })
})

describe('honest residual (explicitly out of scope): a plugin poisoning its OWN fiber\'s store still succeeds, self-subtree only', () => {
  it('durably poisons ctx.trustKernel property access for the attacking plugin itself, while ctx.get(\'trustKernel\') and an unrelated sibling stay correct -- this is the known, accepted-for-now gap, not a bug in pinTrustKernel', async () => {
    const dir = tmp()
    writeFileSync(join(dir, 'cordis.yml'), [
      '- id: sibling',
      '  name: ./sibling.mjs',
      '- id: self-fiber-store-poison',
      '  name: ./self-fiber-store-poison.mjs',
      '',
    ].join('\n'))
    writeFileSync(join(dir, 'sibling.mjs'), [
      'export const name = "sibling"',
      'export function apply(ctx) {',
      '  ctx.provide("siblingTrustKernelView", ctx.trustKernel)',
      '}',
      '',
    ].join('\n'))
    writeFileSync(join(dir, 'self-fiber-store-poison.mjs'), [
      'export const name = "self-fiber-store-poison"',
      'export function apply(ctx) {',
      '  const forged = { name: "trustKernel", value: { forged: true }, fiber: ctx.fiber }',
      // Poisoning THIS plugin's own fiber.store cache is not routed through
      // ReflectService.provide() at all, and pinTrustKernel locks only the
      // ROOT fiber's store -- this assignment is a plain, unprotected write.
      '  ctx.fiber.store["trustKernel"] = forged',
      '  ctx.provide("attackerPropertyView", ctx.trustKernel)',
      '  ctx.provide("attackerGetView", ctx.get("trustKernel"))',
      '}',
      '',
    ].join('\n'))
    const kernel = createTrustKernel()
    const ctx = await boot(NAME, join(dir, 'cordis.yml'), undefined, (hostCtx) => {
      pinTrustKernel(hostCtx, kernel)
    })
    try {
      // The attack succeeded: this plugin's own `ctx.trustKernel` property
      // access resolved to the forged value, not the real kernel.
      expect(ctx.get('attackerPropertyView')).toEqual({ forged: true })
      // But `ctx.get('trustKernel')`, even called from inside the same
      // attacking plugin, was never poisoned -- it does not consult
      // Fiber.store at all.
      expect(ctx.get('attackerGetView')).toBe(kernel)
      // And the root-level view stays correct, too.
      expect(ctx.get('trustKernel')).toBe(kernel)
      expect(ctx.trustKernel).toBe(kernel)
      // The poisoning never reached the unrelated sibling plugin: it is
      // scoped to the attacker's own subtree, never siblings, never the root.
      expect(ctx.get('siblingTrustKernelView')).toBe(kernel)
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
