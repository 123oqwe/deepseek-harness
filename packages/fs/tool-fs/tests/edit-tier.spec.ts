/**
 * P9-04 Usage — what the model is told when an edit matched approximately.
 *
 * The consumer's half of the seam: `fs-local` decides WHICH tier matched, and
 * this decides whether the model hears about it. An exact match is silent
 * because it is what the caller asked for; a fallback is reported because the
 * caller's `old_string` did not appear as written, and a caller that believes
 * it did will keep sending text that only works by luck.
 */
import { describe, expect, it } from 'vitest'

import { formatEditOutput } from '../src/edit.ts'

describe('P9-04 Usage — what the model is told about the tier', () => {
  it('must[1]: an exact match adds NOTHING, so an ordinary edit spends no tokens reporting the absence of news', () => {
    expect(formatEditOutput('a.ts', false, 'exact')).toBe('The file a.ts has been updated successfully.')
  })

  it('must[1]: a trailing-whitespace match tells the model its old_string did not match as written', () => {
    expect(formatEditOutput('a.ts', false, 'trailing-whitespace')).toBe(
      'The file a.ts has been updated successfully. Note: old_string did not match exactly; it was located by ignoring trailing whitespace.',
    )
  })

  it('must[1]: an indentation match names indentation as what was ignored', () => {
    expect(formatEditOutput('a.ts', false, 'indentation')).toContain('ignoring indentation')
  })

  it('the tier note is added to the replace_all sentence too, not only the single-edit one', () => {
    const text = formatEditOutput('a.ts', true, 'indentation')
    expect(text).toContain('All occurrences were successfully replaced.')
    expect(text).toContain('ignoring indentation')
  })

  it('defaults to exact when a backend reports no tier, so an older result is not annotated with a guess', () => {
    expect(formatEditOutput('a.ts', false)).toBe('The file a.ts has been updated successfully.')
  })
})
