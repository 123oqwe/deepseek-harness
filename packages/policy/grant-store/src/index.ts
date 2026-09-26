/**
 * The grant-store library's public surface for Epic P2-08's first slice: the
 * grant vocabulary, the pure validate and match decisions, and the in-process
 * store and worker view.
 *
 * This slice is a library, not a mounted seam: it registers no Cordis service,
 * tool, prompt or session event. The Provider and Use stages that wire a grant
 * store into the permission stack come with P2-07's approval queue in a later
 * slice; nothing here reaches a model request on its own.
 *
 * @module @deepseek-ai/dsh-grant-store
 */

export type * from './types.ts'
export { GRANT_NO_EXPIRY, GRANT_UNSCOPED, GrantError, matchGrants, validateGrantDraft } from './match.ts'
export { createMemoryGrantStore, openGrantView } from './store.ts'
