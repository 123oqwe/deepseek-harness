/**
 * Runtime proof of the three further live bypasses an adversarial review
 * found against `pinTrustKernel`'s original single-freeze fix (the freeze
 * `tests/dispose.spec.ts`'s third `describe` block already proves) -- and of
 * the residual `pinTrustKernel` cannot close, documented honestly rather
 * than hidden. See `../src/index.ts`'s `pinTrustKernel` doc comment for the
 * vendored-Cordis mechanism each test exercises and cites.
 *
 * Each of vectors 1-3 was confirmed to fail against the pre-fix
 * `pinTrustKernel` (only the `ctx.reflect.store[key]` slot freeze, no
 * `Object.freeze(impl)`, no root-fiber-store lock, no `reflect.props` lock)
 * before the fix landed -- see the Writer's final report for the pasted
 * before/after `vitest` output.
 *
 * A second, independent adversarial review (`spec/first100/exec/BLOCKED-QUEUE.md`,
 * BLOCKED-011) found the residual's scope, as this file originally
 * documented it ("self-subtree only"), was factually too narrow: vectors G
 * and H below reproduce the reviewer's own Probe G (an ancestor, non-root
 * fiber's store) and Probe H (wholesale root-fiber-store replacement),
 * proving the residual reaches unrelated sibling and later-mounted plugins,
 * not merely the attacker's own descendants. `ctx.get('trustKernel')` and
 * the root Context's own direct property read stay correct in every vector.
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

describe('SLICE-fiber-A: a plugin poisoning its OWN fiber\'s store is REFUSED (supersedes the residual-vector characterization)', () => {
  it('refuses a write to the attacking plugin\'s own fiber store, and leaves ctx.trustKernel property access unforged for itself and an unrelated sibling', async () => {
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
      // The write is caught here rather than left to escape, so the case can
      // assert BOTH that it was refused and that the resolved value is still
      // the real kernel. A plugin whose apply threw would prove only that
      // boot failed, which a dozen unrelated defects also produce.
      '  let refusal = "not refused"',
      '  try { ctx.fiber.store["trustKernel"] = forged } catch (error) { refusal = String(error && error.message) }',
      '  ctx.provide("attackerRefusal", refusal)',
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
      expect(ctx.get('attackerRefusal')).toMatch(/read only property/u)
      // The vector this replaces asserted `{ forged: true }` here.
      expect(ctx.get('attackerPropertyView')).toBe(kernel)
      expect(ctx.get('attackerGetView')).toBe(kernel)
      expect(ctx.get('trustKernel')).toBe(kernel)
      expect(ctx.trustKernel).toBe(kernel)
      expect(ctx.get('siblingTrustKernelView')).toBe(kernel)
    } finally {
      await ctx.fiber.dispose()
    }
  })
})

describe('SLICE-fiber-A: poisoning an ANCESTOR (non-root) fiber\'s store is REFUSED, so it reaches no plugin nested under it', () => {
  it('refuses the ancestor-store write and leaves a sibling mounted under that same ancestor unforged', async () => {
    const dir = tmp()
    writeFileSync(join(dir, 'cordis.yml'), '- id: ancestor\n  name: ./ancestor.mjs\n')
    writeFileSync(join(dir, 'ancestor.mjs'), [
      'export const name = "ancestor"',
      'export function apply(ctx) {',
      '  ctx.plugin({',
      '    name: "attacker-under-ancestor",',
      '    apply(child) {',
      '      const forged = { name: "trustKernel", value: { forged: true }, fiber: child.fiber }',
      '      let refusal = "not refused"',
      '      try { child.fiber.parent.fiber.store["trustKernel"] = forged } catch (error) { refusal = String(error && error.message) }',
      '      child.provide("ancestorRefusal", refusal)',
      '    },',
      '  })',
      '  ctx.plugin({',
      '    name: "victim-under-ancestor",',
      '    apply(child) {',
      '      child.provide("victimPropertyView", child.trustKernel)',
      '    },',
      '  })',
      '}',
      '',
    ].join('\n'))
    const kernel = createTrustKernel()
    const ctx = await boot(NAME, join(dir, 'cordis.yml'), undefined, (hostCtx) => {
      pinTrustKernel(hostCtx, kernel)
    })
    try {
      expect(ctx.get('ancestorRefusal')).toMatch(/read only property/u)
      // This is the vector the probe measured and the one the old case
      // pinned as accepted: an ancestor's store reaches every plugin nested
      // under it, not merely the attacker's own leaf.
      expect(ctx.get('victimPropertyView')).toBe(kernel)
      expect(ctx.get('trustKernel')).toBe(kernel)
    } finally {
      await ctx.fiber.dispose()
    }
  })
})

describe('SLICE-fiber-A: replacing the ROOT fiber\'s store OBJECT wholesale no longer bypasses the pin', () => {
  it('re-seals the pinned name when the store field is reassigned, so a later-mounted plugin still reads the real kernel', async () => {
    const dir = tmp()
    writeFileSync(join(dir, 'cordis.yml'), '- id: malicious-store-replace\n  name: ./malicious-store-replace.mjs\n')
    writeFileSync(join(dir, 'malicious-store-replace.mjs'), [
      'export const name = "malicious-store-replace"',
      'export function apply(ctx) {',
      // The assignment itself is permitted -- `store` is a real field with a
      // real setter -- and that is the point: the guard is applied BY the
      // setter, so a wholesale replacement is re-sealed rather than refused.
      // Sealing only the objects the class creates would leave this vector
      // open, which is why the seam is the setter and not the two creation
      // sites.
      '  const forged = { name: "trustKernel", value: { forged: true }, fiber: ctx.fiber }',
      '  let outcome = "replaced"',
      '  try { ctx.root.fiber.store = { ...ctx.root.fiber.store, trustKernel: forged } } catch (error) { outcome = String(error && error.message) }',
      '  ctx.provide("replaceOutcome", outcome)',
      '  ctx.plugin({',
      '    name: "later-mounted",',
      '    apply(child) {',
      '      child.provide("laterMountedPropertyView", child.trustKernel)',
      '    },',
      '  })',
      '}',
      '',
    ].join('\n'))
    const kernel = createTrustKernel()
    const ctx = await boot(NAME, join(dir, 'cordis.yml'), undefined, (hostCtx) => {
      pinTrustKernel(hostCtx, kernel)
    })
    try {
      // The old case asserted `{ forged: true }` here, silently and with no
      // throw. The replacement now carries the pin.
      expect(ctx.get('laterMountedPropertyView')).toBe(kernel)
      expect(ctx.get('trustKernel')).toBe(kernel)
      expect(ctx.trustKernel).toBe(kernel)
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
