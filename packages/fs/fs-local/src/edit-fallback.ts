/**
 * Graded fallback for literal edits (Epic P9-05's sibling P9-04).
 *
 * `applyLiteralEdit` in `./fsio.ts` matches `old_string` exactly. A model that
 * reproduces a region from memory usually gets the text right and the
 * whitespace slightly wrong, so an exact matcher rejects an edit that is
 * unambiguous to any reader. This module decides WHICH region an approximate
 * `old_string` refers to, and refuses when that question has more than one
 * answer.
 *
 * **CRLF is deliberately not a tier.** `./fsio.ts` normalizes line endings on
 * both the content and the search text before matching, so a CRLF/LF difference
 * already matches exactly. A tier for it would be a branch no input can reach —
 * it would report success for work the exact tier had already done, which is
 * indistinguishable from a fallback that works.
 *
 * @module @deepseek-ai/dsh-fs-local/edit-fallback
 */

/**
 * How an `old_string` was matched against the file.
 *
 * The order is the search order, and it is also a confidence ordering: each
 * tier ignores strictly more of the text than the one before it.
 */
export type EditMatchTier =
  /** Byte-for-byte after line-ending normalization; what `applyLiteralEdit` does. */
  | 'exact'
  /** Matched once trailing whitespace on every line is ignored. */
  | 'trailing-whitespace'
  /** Matched once every line is shifted by one common indent delta. */
  | 'indentation'

/** Where a match landed, and how much had to be ignored to find it. */
export interface EditMatch {
  readonly tier: EditMatchTier
  /** 0-based index of the first content line the match covers. */
  readonly startLine: number
  /** How many lines the match covers. */
  readonly lineCount: number
  /**
   * Columns of indentation the file's text carries relative to `old_string`;
   * negative when the file is less indented. Always 0 below the `indentation`
   * tier.
   */
  readonly indentDelta: number
}

/** Why no single region could be chosen. */
export type EditMatchFailure =
  /** No tier found the text at all. */
  | { readonly reason: 'not-found'; readonly nearest: NearestRegion | null }
  /** A tier found the text in more than one place, so the edit is ambiguous. */
  | { readonly reason: 'ambiguous'; readonly tier: EditMatchTier; readonly startLines: readonly number[] }

/** The closest thing to `old_string` the file contains, for a diagnostic. */
export interface NearestRegion {
  readonly startLine: number
  /** Fraction of lines that matched, ignoring leading and trailing whitespace. */
  readonly similarity: number
}

/** The outcome of locating an `old_string`. */
export type EditMatchOutcome =
  | { readonly located: true; readonly match: EditMatch }
  | { readonly located: false; readonly failure: EditMatchFailure }

/** Strip trailing whitespace from a line. */
function withoutTrailing(line: string): string {
  return line.replace(/[ \t]+$/, '')
}

/** The leading-whitespace prefix of a line. */
function leadingWhitespace(line: string): string {
  return line.match(/^[ \t]*/)?.[0] ?? ''
}

/**
 * Every start line where `needle` occurs under a per-line comparison.
 * @param haystack - the file's lines.
 * @param needle - the search text's lines.
 * @param equal - how two lines are compared at this tier.
 * @returns each 0-based start line, in order.
 */
function findAll(
  haystack: readonly string[],
  needle: readonly string[],
  equal: (fileLine: string, searchLine: string) => boolean,
): number[] {
  const starts: number[] = []
  if (needle.length === 0 || needle.length > haystack.length) return starts
  for (let start = 0; start + needle.length <= haystack.length; start += 1) {
    let matched = true
    for (let offset = 0; offset < needle.length; offset += 1) {
      const fileLine = haystack[start + offset] ?? ''
      const searchLine = needle[offset] ?? ''
      if (!equal(fileLine, searchLine)) {
        matched = false
        break
      }
    }
    if (matched) starts.push(start)
  }
  return starts
}

/**
 * The single indent delta that turns `needle` into the region at `start`, or
 * null when the lines do not share one.
 *
 * A uniform delta is required rather than per-line freedom: allowing each line
 * its own shift would match text whose internal structure differs from the
 * search text, which is a different region rather than the same one re-indented.
 * Blank lines carry no indentation and are skipped instead of forcing a delta.
 * @param haystack - the file's lines.
 * @param needle - the search text's lines.
 * @param start - the candidate start line.
 * @returns the common delta in columns, or null.
 */
export function uniformIndentDelta(
  haystack: readonly string[],
  needle: readonly string[],
  start: number,
): number | null {
  let delta: number | null = null
  for (let offset = 0; offset < needle.length; offset += 1) {
    const fileLine = haystack[start + offset] ?? ''
    const searchLine = needle[offset] ?? ''
    if (fileLine.trim().length === 0 && searchLine.trim().length === 0) continue
    if (fileLine.trim() !== searchLine.trim()) return null
    const lineDelta = leadingWhitespace(fileLine).length - leadingWhitespace(searchLine).length
    if (delta === null) delta = lineDelta
    else if (delta !== lineDelta) return null
  }
  return delta ?? 0
}

/**
 * The region most similar to `old_string`, to point a caller at the near miss.
 * @param haystack - the file's lines.
 * @param needle - the search text's lines.
 * @returns the closest region, or null when the file is shorter than the search.
 */
export function nearestRegion(haystack: readonly string[], needle: readonly string[]): NearestRegion | null {
  if (needle.length === 0 || needle.length > haystack.length) return null
  let best: NearestRegion | null = null
  for (let start = 0; start + needle.length <= haystack.length; start += 1) {
    let hits = 0
    for (let offset = 0; offset < needle.length; offset += 1) {
      if ((haystack[start + offset] ?? '').trim() === (needle[offset] ?? '').trim()) hits += 1
    }
    const similarity = hits / needle.length
    if (best === null || similarity > best.similarity) best = { startLine: start, similarity }
  }
  return best
}

/**
 * Locate `old_string` in `content`, descending the tiers until one matches.
 *
 * Each tier is tried in full before the next, and a tier that finds MORE THAN
 * ONE region fails closed rather than falling through. Falling through would let
 * a looser tier pick a single region out of text the stricter tier already found
 * twice, turning an ambiguity into a confident wrong edit — the opposite of what
 * a fallback is for.
 * @param content - the file's content, LF-normalized.
 * @param oldString - the search text, LF-normalized.
 * @returns the located region, or why none could be chosen.
 */
export function locateEdit(content: string, oldString: string): EditMatchOutcome {
  const haystack = content.split('\n')
  const needle = oldString.split('\n')
  if (oldString.length === 0) {
    return { located: false, failure: { reason: 'not-found', nearest: null } }
  }

  const exact = findAll(haystack, needle, (fileLine, searchLine) => fileLine === searchLine)
  if (exact.length === 1) {
    return { located: true, match: { tier: 'exact', startLine: exact[0] ?? 0, lineCount: needle.length, indentDelta: 0 } }
  }
  if (exact.length > 1) {
    return { located: false, failure: { reason: 'ambiguous', tier: 'exact', startLines: exact } }
  }

  const trimmedNeedle = needle.map(withoutTrailing)
  const trailing = findAll(haystack, trimmedNeedle, (fileLine, searchLine) => withoutTrailing(fileLine) === searchLine)
  if (trailing.length === 1) {
    return {
      located: true,
      match: { tier: 'trailing-whitespace', startLine: trailing[0] ?? 0, lineCount: needle.length, indentDelta: 0 },
    }
  }
  if (trailing.length > 1) {
    return { located: false, failure: { reason: 'ambiguous', tier: 'trailing-whitespace', startLines: trailing } }
  }

  const indentStarts: number[] = []
  const deltas: number[] = []
  for (let start = 0; start + needle.length <= haystack.length; start += 1) {
    const delta = uniformIndentDelta(haystack, needle, start)
    if (delta !== null) {
      indentStarts.push(start)
      deltas.push(delta)
    }
  }
  if (indentStarts.length === 1) {
    return {
      located: true,
      match: { tier: 'indentation', startLine: indentStarts[0] ?? 0, lineCount: needle.length, indentDelta: deltas[0] ?? 0 },
    }
  }
  if (indentStarts.length > 1) {
    return { located: false, failure: { reason: 'ambiguous', tier: 'indentation', startLines: indentStarts } }
  }

  return { located: false, failure: { reason: 'not-found', nearest: nearestRegion(haystack, needle) } }
}

/**
 * Replace the located region, preserving the file's own whitespace.
 *
 * The replacement is re-indented by the match's `indentDelta` so an edit found
 * through the indentation tier lands at the file's indentation rather than the
 * search text's. Writing `newString` verbatim would silently re-indent the
 * region to whatever the caller happened to type.
 * @param content - the file's content, LF-normalized.
 * @param match - the located region.
 * @param newString - the replacement text, LF-normalized.
 * @returns the edited content.
 */
export function applyLocatedEdit(content: string, match: EditMatch, newString: string): string {
  const lines = content.split('\n')
  const shift = match.indentDelta
  const replacement = newString.split('\n').map((line) => {
    if (shift === 0 || line.trim().length === 0) return line
    if (shift > 0) return ' '.repeat(shift) + line
    const removable = Math.min(-shift, leadingWhitespace(line).length)
    return line.slice(removable)
  })
  return [...lines.slice(0, match.startLine), ...replacement, ...lines.slice(match.startLine + match.lineCount)].join('\n')
}
