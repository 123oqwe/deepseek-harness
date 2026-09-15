/**
 * Controls for the rename register as the greening path and the cell verifiers
 * read it: a retired rename resolves nothing (§12.68).
 *
 * Every control reads the live register, so a later entry is measured against
 * real data rather than a hand-built sample.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { frozenTitlePresent, registeredRenames } from './frozen-title-renames.mjs'

interface RenameEntry {
  epic: string
  stage: string
  oldTitle: string
  newTitle: string
  retired?: object
}

const root = resolve(import.meta.dirname, '..', '..')
const registerPath = resolve(root, 'spec/first100/exec/frozen-title-renames.json')
const entries = (JSON.parse(readFileSync(registerPath, 'utf8')) as { entries: RenameEntry[] }).entries
const retired = entries.filter(entry => entry.retired !== undefined)
const live = entries.filter(entry => entry.retired === undefined)
const key = (entry: RenameEntry): string => `${entry.epic}|${entry.stage}|${entry.oldTitle}`

describe('rename register controls (2026-09-15)', () => {
  it('reads a register holding both retired and live entries, so neither control below is vacuous', () => {
    expect(retired.length).toBeGreaterThan(0)
    expect(live.length).toBeGreaterThan(0)
  })

  it('(a) holds no key for a retired entry', () => {
    const renames = registeredRenames()
    expect(retired.filter(entry => renames.has(key(entry))).map(key)).toStrictEqual([])
  })

  it('(b) maps every live entry to its new title, and nothing else', () => {
    expect(registeredRenames()).toStrictEqual(new Map(live.map(entry => [key(entry), entry.newTitle])))
  })

  it('(c) does not report a retired entry\'s old title as present when only its new title was observed', () => {
    const renames = registeredRenames()
    for (const entry of retired) {
      expect(frozenTitlePresent(entry.oldTitle, new Set([entry.newTitle]), renames, entry.epic, entry.stage)).toBe(false)
    }
  })

  it('(d) still resolves a live entry\'s old title through its new title', () => {
    const renames = registeredRenames()
    for (const entry of live) {
      expect(frozenTitlePresent(entry.oldTitle, new Set([entry.newTitle]), renames, entry.epic, entry.stage)).toBe(true)
    }
  })
})
