/**
 * Names the P1-01 quarantine composition (A-558b) shares between its driver and
 * spec: a base-free profile of five self-contained test bundle layers through
 * the shipped `runProfile` admission + post-mount quarantine, isolating the
 * 甲/乙 comparison fix without base's Q27 dependency (Epic P1-01 must[3],
 * acceptance[0]; BLOCKED-322).
 * @module tests/first100/fixtures/loader/p1-01-quarantine/shared
 */

/**
 * The five test bundle layers, each a self-contained bundle whose entry (or
 * patch) registers only its own capability — depending on nothing from base, so
 * the tree activates without `@deepseek-ai/dsh-base`. Staged into the profile's
 * own node_modules the way `dsh plugin add` installs a bundle.
 */

/** Declares exactly what its entry registers → admitted and not quarantined (STAYS; the positive control). */
export const MATCH_STAYS_LAYER = 'dsh-p1-01b-match-stays'
/** `dsh.bundle.patch` with no manifestVersion → denied at admission (legacy-untrusted). */
export const MISSING_MANIFEST_LAYER = 'dsh-p1-01b-missing-manifest'
/** manifest-v2 declares a capability its entry does NOT register (declared-not-observed) → must be quarantined. */
export const DECLARES_UNREGISTERED_LAYER = 'dsh-p1-01b-declares-unregistered'
/** A subpath entry (`/startup`) that registers a name its manifest does NOT declare (observed-not-declared) → must be quarantined. */
export const SUBPATH_UNDECLARED_LAYER = 'dsh-p1-01b-subpath-undeclared'
/** A patch-only (non-entry) layer whose composed rows register a capability its manifest does NOT declare → must be quarantined. */
export const NON_ENTRY_MISMATCH_LAYER = 'dsh-p1-01b-non-entry-mismatch'

/** The tool name the match-stays layer both declares in its manifest and registers in its entry. */
export const MATCH_TOOL = 'p1-01b-match-tool'
/** A capability name a mismatching layer registers but does not declare (or declares but does not register). */
export const MISMATCH_NAME = 'p1-01b-undeclared'
