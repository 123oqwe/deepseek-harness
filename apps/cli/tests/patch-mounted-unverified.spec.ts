import { describe, expect, it } from 'vitest'
import { recordUnverifiedProvenance } from '@deepseek-ai/dsh-plugin-provenance'
import { patchMountedUnverified, warnUnsignedDevPlugins } from '../src/profile-boot.ts'

const FILE = 'file:///home/user/plugins/probe.mjs'

describe('patchMountedUnverified: the plugins the user patch layers mount by path (P1-02 must[4], question 30 (b), B-707)', () => {
  it('names each path-mounted row of every layer, inside an inserted group too, by its id and file: URL', () => {
    expect(patchMountedUnverified([
      [{ insert: [{ id: 'from-profile', name: FILE }] }],
      [{ insert: [{ id: 'grouped', name: 'cordis:group', group: true, config: [{ id: 'inner', name: 'file:///home/user/inner.mjs' }] }] }],
      [{ insert: [{ id: '', name: 'file:///tmp/overlay.mjs' }] }],
    ])).toEqual([`from-profile (${FILE})`, 'inner (file:///home/user/inner.mjs)', 'file:///tmp/overlay.mjs'])
  })

  it('names no package row, no builtin and no id-targeted patch, and a repeated row once', () => {
    expect(patchMountedUnverified([
      [{
        insert: [
          { id: 'package', name: '@deepseek-ai/dsh-tool-fs' },
          { id: 'empty-group', name: 'cordis:group', group: true, config: [] },
        ],
      }],
      [{ id: 'package', config: { enabled: true } }, { insert: [{ id: 'twice', name: FILE }] }],
      [{ insert: [{ id: 'twice', name: FILE }] }],
    ])).toEqual([`twice (${FILE})`])
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
