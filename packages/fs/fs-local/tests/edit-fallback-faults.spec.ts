/**
 * P9-04 Fault — the ladder against the backend, where a rescue could do harm.
 *
 * The unit-level ladder is covered by `edit-fallback.spec.ts`. What is only
 * observable through the backend is whether the fallback INTERACTS with
 * anything it must not: the version guard above it, and the ambiguity rule that
 * must survive a tier finding a match the literal search could not.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'
import { FsVersion } from '@deepseek-ai/dsh-fs'

let dir: string
let ctx: Context
let fs: LocalFileSystem
let fiber: Awaited<ReturnType<Context['plugin']>>

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dsh-p904-'))
  ctx = new Context()
  fiber = await ctx.plugin(LocalFileSystem, { cwd: dir })
  fs = ctx.fs as LocalFileSystem
})
afterEach(async () => {
  await fiber.dispose()
  await rm(dir, { recursive: true, force: true })
})

describe('P9-04 Fault — the fallback must not weaken the version guard (must[2])', () => {
  it('a stale version is refused even when the fallback WOULD have matched', async () => {
    // The dangerous shape: an edit that the literal search rejects but a tier
    // accepts. If the guard were consulted after the match, this rescue would
    // become a write against content the caller never read.
    await writeFile(join(dir, 'a.ts'), 'a = 1\n')
    const target = await fs.resolve('a.ts')
    await expect(fs.editText(
      target,
      { oldString: '    a = 1', newString: '    a = 2', replaceAll: false },
      { version: FsVersion('definitely-stale') },
    )).rejects.toMatchObject({ code: 'FS_STALE_VERSION' })
    expect(await readFile(join(dir, 'a.ts'), 'utf8')).toBe('a = 1\n')
  })

  it('the same edit succeeds at the current version, so the guard bounds rather than blocks', async () => {
    await writeFile(join(dir, 'a.ts'), 'a = 1\n')
    const target = await fs.resolve('a.ts')
    const info = await fs.stat(target)
    const outcome = await fs.editText(
      target,
      { oldString: '    a = 1', newString: '    a = 2', replaceAll: false },
      { version: info!.version },
    )
    expect(outcome.matchTier).toBe('indentation')
    expect(await readFile(join(dir, 'a.ts'), 'utf8')).toBe('a = 2\n')
  })
})

describe('P9-04 Fault — acceptance[0], indentation in both directions', () => {
  it('a search text indented +2 relative to the file is rescued and re-indented down', async () => {
    await writeFile(join(dir, 'a.ts'), '  keep()\n  target()\n')
    const target = await fs.resolve('a.ts')
    const outcome = await fs.editText(target, { oldString: '    target()', newString: '    changed()', replaceAll: false })
    expect(outcome.matchTier).toBe('indentation')
    expect(await readFile(join(dir, 'a.ts'), 'utf8')).toBe('  keep()\n  changed()\n')
  })

  it('a search text indented -2 relative to the file is an exact SUBSTRING hit, not a fallback', async () => {
    // Recorded rather than smoothed over: applyLiteralEdit matches substrings,
    // so a less-indented needle sits inside a more-indented line and never
    // reaches the ladder. The tier is the assertion — without it this case
    // would look like a fallback success and prove nothing.
    await writeFile(join(dir, 'a.ts'), '    target()\n')
    const target = await fs.resolve('a.ts')
    const outcome = await fs.editText(target, { oldString: '  target()', newString: '  changed()', replaceAll: false })
    expect(outcome.matchTier).toBe('exact')
    // The file's EXTRA two spaces survive: a substring replacement rewrites only
    // the matched text, so the unmatched indentation in front of it is
    // untouched. That is the right outcome and the reason no tier is needed.
    expect(await readFile(join(dir, 'a.ts'), 'utf8')).toBe('    changed()\n')
  })

  it('acceptance[0]: a trailing-whitespace difference is rescued and reports its tier', async () => {
    await writeFile(join(dir, 'a.ts'), 'value = 1\n')
    const target = await fs.resolve('a.ts')
    const outcome = await fs.editText(target, { oldString: 'value = 1   ', newString: 'value = 2', replaceAll: false })
    expect(outcome.matchTier).toBe('trailing-whitespace')
  })

  it('acceptance[0]: a CRLF/LF difference resolves at the EXACT tier, because both sides are normalized first', async () => {
    await writeFile(join(dir, 'a.ts'), 'one\r\ntwo\r\n')
    const target = await fs.resolve('a.ts')
    const outcome = await fs.editText(target, { oldString: 'one\r\ntwo', newString: 'one\r\nTWO', replaceAll: false })
    expect(outcome.matchTier).toBe('exact')
    // The file keeps its CRLF endings: the ladder never sees storage bytes.
    expect(await readFile(join(dir, 'a.ts'), 'utf8')).toBe('one\r\nTWO\r\n')
  })
})

describe('P9-04 Fault — acceptance[1], ambiguity still fails closed', () => {
  it('two approximate matches are refused rather than resolved by position', async () => {
    await writeFile(join(dir, 'a.ts'), 'x = 1\nmiddle\nx = 1\n')
    const target = await fs.resolve('a.ts')
    await expect(fs.editText(target, { oldString: '    x = 1', newString: '    x = 2', replaceAll: false }))
      .rejects.toMatchObject({ code: 'FS_AMBIGUOUS_EDIT' })
    expect(await readFile(join(dir, 'a.ts'), 'utf8')).toBe('x = 1\nmiddle\nx = 1\n')
  })

  it('a refused ambiguous edit leaves the file byte-identical, so a failed rescue is not a partial write', async () => {
    const original = 'x = 1\nmiddle\nx = 1\n'
    await writeFile(join(dir, 'a.ts'), original)
    const target = await fs.resolve('a.ts')
    await expect(fs.editText(target, { oldString: '  x = 1', newString: 'z', replaceAll: false })).rejects.toThrow()
    expect(await readFile(join(dir, 'a.ts'), 'utf8')).toBe(original)
  })

  it('must[3]: a genuine miss names the closest region and its similarity', async () => {
    await writeFile(join(dir, 'a.ts'), 'alpha\nbeta\ngamma\n')
    const target = await fs.resolve('a.ts')
    await expect(fs.editText(target, { oldString: 'beta\nDELTA', newString: 'x', replaceAll: false }))
      .rejects.toThrow(/closest region begins at line 2 \(50%/)
  })
})
