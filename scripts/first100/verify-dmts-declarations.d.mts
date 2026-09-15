/**
 * Types for `verify-dmts-declarations.mjs`: imported exports missing from their `.d.mts`.
 */

/** One gap, phantom or unparsed module, with the files that import from it. */
export interface DmtsFinding {
  module: string
  name?: string
  users: string[]
  /** The `.d.mts` that exists but omits the name; `undefined` when the module has none. */
  declarationFile?: string
}

/** A whole directory's result. */
export interface DmtsResult {
  gaps: DmtsFinding[]
  phantoms: DmtsFinding[]
  unparsed: DmtsFinding[]
  imported: number
}

/**
 * Declaration gaps across one directory's files.
 * @param files - file name -> text.
 * @returns gaps, phantom imports, unparsed modules, and the count of imported bindings.
 */
export function dmtsDeclarationGaps(files: ReadonlyMap<string, string>): DmtsResult

/**
 * The exit code for one run.
 * @param result - from `dmtsDeclarationGaps`.
 * @returns 1 for a gap or phantom, otherwise 2 for an unparsed module, otherwise 0.
 */
export function dmtsExitCode(result: DmtsResult): 0 | 1 | 2
