/**
 * The installer's one refusal error. Every quarantine/extract/verify refusal
 * throws this with a {@link InstallRefusalCode}, so a caller distinguishes an
 * attack it rejected from an unrelated failure by the code, not by string
 * matching.
 * @module @deepseek-ai/dsh-plugin-installer/errors
 */

import type { InstallRefusalCode } from './types.ts'

/** A package the installer refused, carrying the structural or provenance reason. */
export class PluginInstallError extends Error {
  /** The refusal code the acceptance clauses name. */
  readonly code: InstallRefusalCode

  /**
   * @param code - which refusal this is.
   * @param message - the operator-facing reason, naming the offending entry or fact.
   */
  constructor(code: InstallRefusalCode, message: string) {
    super(message)
    this.name = 'PluginInstallError'
    this.code = code
  }
}
