/**
 * The quarantine: a private temporary directory an untrusted package is
 * verified and extracted inside, never a profile directory or the plugin lock.
 * This is acceptance[2]'s zero-side-effect guarantee for sub-slice 1 — a
 * refused or failed install leaves the profile untouched because nothing this
 * slice does reaches it. (Atomic promotion out of the quarantine into the
 * profile is sub-slice 2, once the CLI consumer and the plugin lock exist.)
 * @module @deepseek-ai/dsh-plugin-installer/quarantine
 */

import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** One quarantine's directories. The caller disposes {@link Quarantine.root} when the install ends. */
export interface Quarantine {
  /** The quarantine root, created private under the OS temp directory (or a given parent). */
  readonly root: string
  /** The directory a verified package extracts into, inside {@link Quarantine.root}. */
  readonly extractDir: string
}

/**
 * Create a private quarantine directory tree. The root is owner-only, so the
 * untrusted contents are never world-readable while the install runs.
 * @param parentDir - the directory to create the quarantine under; defaults to the OS temp directory.
 * @returns the quarantine root and its extraction directory.
 */
export function createQuarantine(parentDir: string = tmpdir()): Quarantine {
  const root = mkdtempSync(join(parentDir, 'dsh-plugin-install-'))
  const extractDir = join(root, 'extracted')
  mkdirSync(extractDir, { mode: 0o700 })
  return { root, extractDir }
}
