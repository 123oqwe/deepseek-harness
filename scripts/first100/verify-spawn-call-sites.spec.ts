/**
 * P3-10 R5: a production call site of `ctx.subprocess` that the table does not
 * classify is a red, so wiring ceilings call site by call site cannot silently
 * miss one. The first case reads the real table against the real tree; the
 * rest break one input at a time and name the finding each must produce.
 */

import { describe, expect, it } from 'vitest'
import {
  countCallSites,
  isScannedSource,
  loadSpawnCallSiteInputs,
  spawnCallSiteFindings,
} from './verify-spawn-call-sites.mjs'
import type { SpawnCallSiteTable } from './verify-spawn-call-sites.d.mts'

const BASH = 'packages/shell/bash-local/src/index.ts'

/** A table classifying only the bash executor's two calls. */
function table(rows: SpawnCallSiteTable['callSites'] = [{ path: BASH, calls: 2, class: 'limited', reason: 'wired' }]): SpawnCallSiteTable {
  return { callSites: rows }
}

describe('P3-10 R5 — every call site of ctx.subprocess is classified', () => {
  it('classifies every call site in this tree, and the table lists nothing the tree lacks', () => {
    const { counts, table: real } = loadSpawnCallSiteInputs()
    expect(counts.get(BASH)).toBe(2)
    expect(spawnCallSiteFindings(counts, real)).toEqual([])
  })

  it('counts calls to spawn and spawnTerminal and a lookup by name, and skips comment lines', () => {
    expect(countCallSites([
      'const handle = this.ctx.subprocess.spawn(spec)',
      '  = spec => ctx.subprocess.spawnTerminal(spec),',
      "const runtime = ctx.get('subprocess')",
      ' * execute through `ctx.subprocess.spawn()` with fixed argv',
      '// ctx.subprocess.spawn(spec) is how the old path worked',
      'const other = child.spawn(spec)',
    ].join('\n'))).toBe(3)
  })

  it('scans production sources only, and not the seam\'s own providers or the generated catalog', () => {
    expect(isScannedSource(BASH)).toBe(true)
    expect(isScannedSource('apps/cli/src/main.ts')).toBe(true)
    expect(isScannedSource('packages/shell/bash-local/tests/executor.spec.ts')).toBe(false)
    expect(isScannedSource('packages/subprocess/subprocess-local/src/index.ts')).toBe(false)
    expect(isScannedSource('packages/extensions/tool-cordis/src/api-catalog.ts')).toBe(false)
  })

  it('passes a tree whose every call site the table classifies', () => {
    expect(spawnCallSiteFindings(new Map([[BASH, 2]]), table())).toEqual([])
  })

  it('REDDENS on a call site the table does not list', () => {
    expect(spawnCallSiteFindings(new Map([[BASH, 2], ['packages/new/tool/src/index.ts', 1]]), table()))
      .toEqual(['UNCLASSIFIED packages/new/tool/src/index.ts: 1 call site(s) the table does not list'])
  })

  it('REDDENS when a listed file gained a call site the table does not count', () => {
    expect(spawnCallSiteFindings(new Map([[BASH, 3]]), table())).toEqual([`COUNT ${BASH}: the table says 2, the tree has 3`])
  })

  it('REDDENS on a row whose file no longer reaches the seam', () => {
    expect(spawnCallSiteFindings(new Map(), table())).toEqual([`STALE ${BASH}: listed, but the tree has no call site there`])
  })

  it('REDDENS on a row that does not say why, or names no known class, or appears twice', () => {
    expect(spawnCallSiteFindings(new Map([[BASH, 2]]), table([{ path: BASH, calls: 2, class: 'exempt', reason: ' ' }])))
      .toEqual([`MALFORMED ${BASH}: a exempt row states its reason`])
    expect(spawnCallSiteFindings(new Map([[BASH, 2]]), table([{ path: BASH, calls: 2, class: 'deferred', reason: 'later' }])))
      .toEqual([`MALFORMED ${BASH}: a deferred row states its until`])
    expect(spawnCallSiteFindings(new Map([[BASH, 2]]), table([{ path: BASH, calls: 2, class: 'unlimited', reason: 'no' }])))
      .toEqual([`MALFORMED ${BASH}: class "unlimited" is not one of limited, deferred, exempt, opt-in-mount, spawns-nothing`])
    const row = { path: BASH, calls: 2, class: 'limited', reason: 'wired' }
    expect(spawnCallSiteFindings(new Map([[BASH, 2]]), table([row, row]))).toEqual([`MALFORMED ${BASH}: listed twice`])
  })
})
