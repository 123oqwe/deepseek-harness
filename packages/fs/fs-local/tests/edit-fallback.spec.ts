/**
 * P9-04 Contract — the graded edit-fallback ladder.
 *
 * The epic names three fixture classes: trailing whitespace, CRLF/LF, and a
 * uniform indent shift. Only two of them are tested as fallbacks. `fsio.ts`
 * normalizes line endings on both sides before matching, so a CRLF difference
 * already matches at the exact tier; the case below asserts that it does, which
 * is a different claim from asserting a CRLF tier works.
 */
import { describe, expect, it } from 'vitest'

import {
  applyLocatedEdit,
  locateEdit,
  nearestRegion,
  uniformIndentDelta,
} from '../src/edit-fallback.ts'

const FILE = [
  'function greet(name) {',
  '  const greeting = `hello ${name}`',
  '  return greeting',
  '}',
].join('\n')

describe('P9-04 Contract — graded edit fallback', () => {
  it('must[0]: an exact match is located at the exact tier, so the ladder never runs for text that already matches', () => {
    const outcome = locateEdit(FILE, '  return greeting')
    expect(outcome.located).toBe(true)
    if (!outcome.located) return
    expect(outcome.match.tier).toBe('exact')
    expect(outcome.match.startLine).toBe(2)
  })

  it('must[0]: a trailing-whitespace difference falls to the trailing-whitespace tier', () => {
    const outcome = locateEdit(FILE, '  return greeting   ')
    expect(outcome.located).toBe(true)
    if (!outcome.located) return
    expect(outcome.match.tier).toBe('trailing-whitespace')
    expect(outcome.match.startLine).toBe(2)
  })

  it('must[0]: a uniform indent shift falls to the indentation tier and reports the delta', () => {
    const outcome = locateEdit(FILE, '    return greeting')
    expect(outcome.located).toBe(true)
    if (!outcome.located) return
    expect(outcome.match.tier).toBe('indentation')
    expect(outcome.match.indentDelta).toBe(-2)
  })

  it('CRLF is already handled by normalization, NOT by a fallback tier — the tier stays exact', () => {
    const crlfSearch = '  return greeting\r\n}'.replace(/\r\n/g, '\n')
    const outcome = locateEdit(FILE, crlfSearch)
    expect(outcome.located).toBe(true)
    if (!outcome.located) return
    expect(outcome.match.tier).toBe('exact')
  })

  it('must[0]: multiple exact hits fail closed rather than choosing one', () => {
    const repeated = ['x = 1', 'y = 2', 'x = 1'].join('\n')
    const outcome = locateEdit(repeated, 'x = 1')
    expect(outcome.located).toBe(false)
    if (outcome.located) return
    expect(outcome.failure.reason).toBe('ambiguous')
    if (outcome.failure.reason !== 'ambiguous') return
    expect(outcome.failure.tier).toBe('exact')
    expect(outcome.failure.startLines).toStrictEqual([0, 2])
  })

  it('must[0]: an ambiguity at a looser tier also fails closed, so a fallback cannot resolve what it cannot tell apart', () => {
    const repeated = ['  a = 1  ', 'b = 2', '  a = 1'].join('\n')
    const outcome = locateEdit(repeated, '  a = 1 ')
    expect(outcome.located).toBe(false)
    if (outcome.located) return
    expect(outcome.failure.reason).toBe('ambiguous')
    if (outcome.failure.reason !== 'ambiguous') return
    expect(outcome.failure.tier).toBe('trailing-whitespace')
  })

  it('an ambiguous stricter tier does NOT fall through to a looser one that would pick a single region', () => {
    // Both lines match exactly, so the exact tier is ambiguous. The indentation
    // tier would also see both. Falling through must not turn "two candidates"
    // into a confident edit.
    const repeated = ['  a = 1', '  a = 1'].join('\n')
    const outcome = locateEdit(repeated, '  a = 1')
    expect(outcome.located).toBe(false)
    if (outcome.located) return
    expect(outcome.failure.reason).toBe('ambiguous')
    if (outcome.failure.reason !== 'ambiguous') return
    expect(outcome.failure.tier).toBe('exact')
  })

  it('must[3]: text found nowhere reports the nearest region with a similarity, to locate the near miss', () => {
    const outcome = locateEdit(FILE, '  return farewell')
    expect(outcome.located).toBe(false)
    if (outcome.located) return
    expect(outcome.failure.reason).toBe('not-found')
    if (outcome.failure.reason !== 'not-found') return
    expect(outcome.failure.nearest).not.toBeNull()
    expect(outcome.failure.nearest?.similarity).toBe(0)
  })

  it('must[3]: a multi-line near miss reports the region where most lines did match', () => {
    const outcome = locateEdit(FILE, ['  const greeting = `bye ${name}`', '  return greeting'].join('\n'))
    expect(outcome.located).toBe(false)
    if (outcome.located) return
    if (outcome.failure.reason !== 'not-found') return
    expect(outcome.failure.nearest?.startLine).toBe(1)
    expect(outcome.failure.nearest?.similarity).toBe(0.5)
  })

  it('an empty search string is not found rather than matching everywhere', () => {
    const outcome = locateEdit(FILE, '')
    expect(outcome.located).toBe(false)
  })

  it('must[1]: replacing through the indentation tier re-indents to the FILE, not to the search text', () => {
    const outcome = locateEdit(FILE, '    return greeting')
    expect(outcome.located).toBe(true)
    if (!outcome.located) return
    const edited = applyLocatedEdit(FILE, outcome.match, '    return greeting.toUpperCase()')
    expect(edited.split('\n')[2]).toBe('  return greeting.toUpperCase()')
  })

  it('must[1]: an exact-tier replacement is written verbatim', () => {
    const outcome = locateEdit(FILE, '  return greeting')
    expect(outcome.located).toBe(true)
    if (!outcome.located) return
    expect(applyLocatedEdit(FILE, outcome.match, '  return greeting!').split('\n')[2]).toBe('  return greeting!')
  })

  it('re-indenting leaves blank lines empty rather than padding them with spaces', () => {
    const file = ['    a', '', '    b'].join('\n')
    const outcome = locateEdit(file, ['a', '', 'b'].join('\n'))
    expect(outcome.located).toBe(true)
    if (!outcome.located) return
    expect(outcome.match.indentDelta).toBe(4)
    expect(applyLocatedEdit(file, outcome.match, ['a', '', 'b'].join('\n'))).toBe(file)
  })
})

describe('uniformIndentDelta', () => {
  it('requires ONE delta across every line, so a region with different internal structure is not a match', () => {
    const haystack = ['  a', '      b']
    expect(uniformIndentDelta(haystack, ['a', 'b'], 0)).toBeNull()
  })

  it('accepts a region every line of which shifted by the same amount', () => {
    expect(uniformIndentDelta(['    a', '    b'], ['a', 'b'], 0)).toBe(4)
  })

  it('skips blank lines rather than letting them force a delta of their own', () => {
    expect(uniformIndentDelta(['    a', '', '    b'], ['a', '', 'b'], 0)).toBe(4)
  })

  it('rejects lines whose text differs, however the indentation lines up', () => {
    expect(uniformIndentDelta(['    a', '    c'], ['a', 'b'], 0)).toBeNull()
  })

  it('reports a negative delta when the file is LESS indented than the search text', () => {
    expect(uniformIndentDelta(['a'], ['    a'], 0)).toBe(-4)
  })
})

describe('nearestRegion', () => {
  it('returns null when the search text is longer than the file', () => {
    expect(nearestRegion(['a'], ['a', 'b'])).toBeNull()
  })

  it('scores a fully matching region at 1', () => {
    expect(nearestRegion(['a', 'b'], ['a', 'b'])?.similarity).toBe(1)
  })

  it('ignores indentation when scoring, since that is what the caller most often gets wrong', () => {
    expect(nearestRegion(['      a'], ['a'])?.similarity).toBe(1)
  })
})
