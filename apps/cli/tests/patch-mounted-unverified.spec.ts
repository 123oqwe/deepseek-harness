import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Entry, EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import { recordUnverifiedProvenance } from '@deepseek-ai/dsh-plugin-provenance'
import { pathMountedUnverified, warnPathMountedAtMount, warnUnsignedDevPlugins } from '../src/profile-boot.ts'

const FILE = 'file:///home/user/plugins/probe.mjs'
const BASE = 'file:///home/user/.dsh/profiles/work/'

describe('pathMountedUnverified: the plugins the composed tree mounts by path (P1-02 must[4], question 30 (b), B-707, B-707b)', () => {
  it('names each path row, inside a group too, by its id and file: URL, and a relative or absolute path as the Loader resolves it', () => {
    const composed: EntryOptions[] = [
      { id: 'from-profile', name: FILE },
      { id: 'grouped', name: 'cordis:group', group: true, config: [{ id: 'inner', name: '/home/user/inner.mjs' }] },
      { id: 'relative', name: './local.mjs' },
      { id: '', name: 'file:///tmp/overlay.mjs' },
    ]
    expect(pathMountedUnverified(composed, [], BASE)).toEqual([
      `from-profile (${FILE})`,
      'inner (file:///home/user/inner.mjs)',
      `relative (${BASE}local.mjs)`,
      'file:///tmp/overlay.mjs',
    ])
  })

  it('names no package row, no builtin and no bundle-layer path row, and a repeated row once', () => {
    const bundleRow: EntryOptions = { id: 'inspector', name: 'file:///opt/dsh/inspector/lib/index.js' }
    const composed: EntryOptions[] = [
      { id: 'package', name: '@deepseek-ai/dsh-tool-fs' },
      { id: 'empty-group', name: 'cordis:group', group: true, config: [] },
      bundleRow,
      { id: 'twice', name: FILE },
      { id: 'twice', name: FILE },
    ]
    expect(pathMountedUnverified(composed, [bundleRow], BASE)).toEqual([`twice (${FILE})`])
  })
})

/**
 * One Loader entry as `loader/patch-context` hands it over: its options and the base URL of the tree holding it.
 * @param options - the entry's options.
 * @param baseUrl - the base URL of the tree holding the entry.
 * @returns the entry.
 */
function entryOf(options: EntryOptions, baseUrl: string | undefined): Entry {
  return { options, parent: { tree: { ctx: { baseUrl } } } } as unknown as Entry
}

describe('warnPathMountedAtMount: a path row that appears only as the tree mounts is named before it applies (B-707b)', () => {
  it('names an included row once, before the entry applies, and never a row the composed tree holds or a package row', async () => {
    const ctx = new Context()
    const lines: string[] = []
    warnPathMountedAtMount(ctx, [{ id: 'overlay', name: FILE }], BASE, (line) => { lines.push(line) })
    const mount = async (entry: Entry): Promise<void> => {
      await ctx.waterfall('loader/patch-context', entry, () => { lines.push(`applied ${entry.options.id}`) })
    }

    await mount(entryOf({ id: 'included', name: '/home/user/included.mjs' }, 'file:///home/user/'))
    await mount(entryOf({ id: 'included', name: '/home/user/included.mjs' }, 'file:///home/user/'))
    await mount(entryOf({ id: 'generated-id', name: FILE }, BASE))
    await mount(entryOf({ id: 'package', name: '@deepseek-ai/dsh-tool-fs' }, BASE))
    await mount(entryOf({ id: 'group', name: 'cordis:group', group: true }, BASE))
    await mount(entryOf({ id: 'relative', name: './rel.mjs' }, 'file:///srv/include/'))
    await mount(entryOf({ id: 'no-base', name: './rel.mjs' }, undefined))

    expect(lines).toEqual([
      'dsh: WARNING: plugins with no verified provenance: included (file:///home/user/included.mjs).\n',
      'applied included',
      'applied included',
      'applied generated-id',
      'applied package',
      'applied group',
      'dsh: WARNING: plugins with no verified provenance: relative (file:///srv/include/rel.mjs).\n',
      'applied relative',
      'applied no-base',
    ])
  })
})

describe('warnUnsignedDevPlugins names path-mounted plugins with the unverified dependencies (B-707)', () => {
  it('names an unverified dependency and a path-mounted plugin on one line', () => {
    const lines: string[] = []
    const records = new Map([['some-plugin', recordUnverifiedProvenance('no-provenance-claim', '2026-10-03T00:00:00.000Z')]])
    warnUnsignedDevPlugins('work', false, records, [`probe (${FILE})`], (line) => { lines.push(line) })
    expect(lines).toEqual([`dsh: WARNING: plugins with no verified provenance: some-plugin, probe (${FILE}).\n`])
  })

  it('names a path-mounted plugin on a profile with no unverified dependency, and writes nothing with neither', () => {
    const lines: string[] = []
    warnUnsignedDevPlugins('work', false, new Map(), [`probe (${FILE})`], (line) => { lines.push(line) })
    warnUnsignedDevPlugins('work', false, new Map(), [], (line) => { lines.push(line) })
    expect(lines).toEqual([`dsh: WARNING: plugins with no verified provenance: probe (${FILE}).\n`])
  })
})
