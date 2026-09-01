/**
 * F-stage runtime proof of Epic P0-02 acceptance clause 1's "unload" and
 * "dynamic mount" halves -- the halves neither C-stage's `boundary.spec.ts`
 * (structural, type-level only, over `src/types.ts` alone) nor U-stage's
 * `boot.spec.ts` (proves only the "override via a second `ctx.provide`" half,
 * at initial boot) cover.
 *
 * "Unload" is real, not vacuous: `ReflectService.provide()`
 * (`vendor/cordis/src/reflect.ts`) ties a provided service's cleanup to its
 * OWNING FIBER's disposal via `this.ctx.fiber.effect(() => { ...; return
 * async () => { delete this.store[key]; ... } })` -- a provided service
 * really is removed when that fiber unloads. The Trust Kernel is safe from
 * this only because `apps/cli/src/profile-boot.ts` pins it with
 * `hostCtx.provide('trustKernel', kernel)` inside `boot()`'s `prepare`
 * closure, which runs against the freshly constructed ROOT `Context` before
 * any config-tree entry mounts (`packages/boot/app-boot/src/index.ts`,
 * `ctx = new Context(); ...; await prepare?.(ctx); ...; await
 * mountRootInclude(...)`) -- so the kernel's owning fiber is the root fiber
 * (`uid === 0`, no plugin `runtime`), never a fiber an ordinary plugin
 * unload can reach. A refactor that moved the `ctx.provide` call inside a
 * plugin's own scope would silently reintroduce exactly the vulnerability
 * must[3] forbids; nothing else in this repository would catch that
 * regression.
 *
 * "Dynamic mount" investigation: this codebase has no Loader-level mount
 * mechanism distinct from ordinary mount at the plugin-activation level -- a
 * plugin row inserted into the tree after boot still mounts through the same
 * `ctx.plugin()`/`ctx.provide()` machinery as one present at initial boot.
 * The one genuinely post-boot insertion path this codebase supports is
 * `Entry.update()` (`vendor/loader/src/config/entry.ts`) applied to the root
 * Include entry's `config.patches` -- exactly what
 * `packages/boot/app-boot/src/index.ts`'s `watchUserPatches` calls from its
 * live `cordis.patch.yml` file-watch callback (proved end to end, through
 * the file watcher, in `packages/boot/app-boot/tests/user-patches.spec.ts`,
 * "watches add, failure, recovery, and removal through transactional HMR").
 * This test calls that same `Entry.update()` primitive directly instead of
 * routing through the file watcher: the watcher is only a trigger, the
 * mount itself happens in `Entry.update()`, and driving it directly keeps
 * this test deterministic rather than depending on this sandbox's fsevents
 * latency. It proves the live-insert path specifically cannot override the
 * pin either -- reducing, as expected, to the exact same
 * `ctx.provide()`-double-call rejection U-stage's malicious-plugin test
 * already proved at initial boot, applied through this narrower, genuinely
 * distinct, post-boot code path (a row absent from the tree at boot,
 * inserted into the already-running tree afterward).
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { boot } from '@deepseek-ai/dsh-app-boot'
import { createTrustKernel } from '../src/index.ts'

const NAME = 'trust-kernel-dispose-test'

const tmp = (): string => mkdtempSync(join(tmpdir(), 'dsh-trust-kernel-dispose-'))

function findEntry(ctx: Context, predicate: (options: { id?: string; name?: string }) => boolean) {
  return [...ctx.loader.entries()].find(entry => predicate(entry.options))
}

describe('an ordinary plugin unload cannot remove the root-pinned Trust Kernel (Epic P0-02 must[3], "卸载" half)', () => {
  it('leaves the kernel present after disposing an unrelated plugin, and shows the kernel is owned by the root fiber, not a plugin fiber', async () => {
    const dir = tmp()
    writeFileSync(join(dir, 'provider.mjs'), [
      'export const name = "provider"',
      'export function apply(ctx) {',
      '  ctx.provide("unrelatedService", 42)',
      '}',
      '',
    ].join('\n'))
    writeFileSync(join(dir, 'cordis.yml'), '- id: provider\n  name: ./provider.mjs\n')
    const kernel = createTrustKernel()
    const ctx = await boot(NAME, join(dir, 'cordis.yml'), undefined, (hostCtx) => {
      hostCtx.provide('trustKernel', kernel)
    })
    try {
      expect(ctx.get('unrelatedService')).toBe(42)
      expect(ctx.get('trustKernel')).toBe(kernel)

      // The kernel's registration is genuinely owned by the root fiber
      // (uid 0, no plugin `runtime`) -- the real Cordis introspection API
      // for "which fiber provided this service", not an assumed one.
      const key = ctx.root[Context.isolate]['trustKernel']
      const impl = key === undefined ? undefined : ctx.reflect.store[key]
      expect(impl?.fiber.uid).toBe(0)
      expect(impl?.fiber.runtime).toBeNull()
      expect(impl?.fiber).toBe(ctx.fiber)

      const provider = findEntry(ctx, options => options.id === 'provider')
      expect(provider).toBeDefined()
      await provider!.update({ disabled: true })

      // The unrelated plugin's own service is really gone -- proves the
      // unload actually ran, not merely that the test asserted nothing.
      expect(ctx.get('unrelatedService')).toBeUndefined()
      // The pinned kernel, owned by the root fiber, is unaffected by an
      // ordinary plugin fiber's disposal.
      expect(ctx.get('trustKernel')).toBe(kernel)
    } finally {
      await ctx.fiber.dispose()
    }
  })
})

describe('a plugin dynamically inserted into the already-booted tree cannot override the pinned kernel (Epic P0-02 must[3], "动态 mount" half)', () => {
  it('rejects a plugin row applied to the root Include entry after boot exactly as it rejects one present at initial boot', async () => {
    const dir = tmp()
    writeFileSync(join(dir, 'cordis.yml'), '[]\n')
    writeFileSync(join(dir, 'malicious.mjs'), [
      'export const name = "malicious"',
      'export function apply(ctx) {',
      '  ctx.provide("trustKernel", { forged: true })',
      '}',
      '',
    ].join('\n'))
    const kernel = createTrustKernel()
    const ctx = await boot(NAME, join(dir, 'cordis.yml'), undefined, (hostCtx) => {
      hostCtx.provide('trustKernel', kernel)
    })
    try {
      // The tree finished booting with no plugin rows at all -- `malicious`
      // is not present in the initial composition.
      expect(findEntry(ctx, options => options.id === 'malicious')).toBeUndefined()

      const includeEntry = findEntry(ctx, options => options.name === 'cordis:include')
      expect(includeEntry).toBeDefined()
      // The same `Entry.update({ config: { ...includeConfig, patches } })`
      // call `watchUserPatches`'s file-watch callback makes -- inserting a
      // plugin row into the running tree, not the initial static tree.
      await expect(includeEntry!.update({
        config: {
          ...includeEntry!.options.config as object,
          patches: [{ insert: [{ id: 'malicious', name: './malicious.mjs' }] }],
        },
      })).rejects.toThrow(/service "trustKernel" has been registered/)

      // The transactional apply rolled back: the malicious row never became
      // a live entry, and the pin never moved.
      expect(findEntry(ctx, options => options.id === 'malicious')).toBeUndefined()
      expect(ctx.get('trustKernel')).toBe(kernel)
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
