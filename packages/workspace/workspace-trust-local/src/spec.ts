/**
 * The durable form of this provider's trust records.
 *
 * Trust has to survive a restart or it is not a boundary: before this domain
 * existed the binding lived in a process-local Map, so a second process
 * re-read the operator's grants against whatever directory then stood at the
 * granted path, and a directory replaced while nothing was running came back
 * trusted (BLOCKED-199).
 *
 * Records are KEYED by canonical path and DECIDED by identity. The path is an
 * index — it is how a later boot finds the record to reconcile — and the
 * `identity` inside the record is what the decision is made against, so a
 * directory that replaced the one a grant named fails reconciliation instead
 * of inheriting its state.
 * @module @deepseek-ai/dsh-workspace-trust-local/spec
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'

/** The volume/inode identity a binding was made against. */
const workspaceVolumeIdentity = z.object({
  device: z.number(),
  inode: z.number(),
  createdAtMs: z.number(),
})

/** The canonical path and volume identity one record is bound to. */
const workspaceIdentity = z.object({
  canonicalPath: z.string(),
  volume: workspaceVolumeIdentity,
})

/**
 * One persisted `TrustRecord`.
 *
 * `grantedBy` stays optional because the vocabulary makes it optional: a
 * workspace that has never been upgraded, and one demoted back to
 * `'untrusted'`, both carry no grantor.
 *
 * **Every field the vocabulary carries is declared here, because zod strips
 * what it does not declare.** A stored record is parsed on load
 * (`@deepseek-ai/dsh-storage-domain`'s `open`), and an undeclared key does not
 * survive that parse — so `source`, which names the entry point a grant was
 * written through, was being written and then silently lost at the next open,
 * leaving an audit that could not attribute a trusted workspace to anything.
 * `loweredExplicitly` would have gone the same way, and it decides whether a
 * launch argument may raise a workspace a human lowered: dropped, the rule
 * would hold within one mount and quietly stop holding across a reload, which
 * is precisely the case it exists for.
 */
const trustRecord = z.object({
  identity: workspaceIdentity,
  state: z.enum(['untrusted', 'trusted-read', 'trusted-execute']),
  at: z.string(),
  grantedBy: z.string().optional(),
  source: z.enum(['launch-argument', 'command', 'configured-grant']).optional(),
  loweredExplicitly: z.literal(true).optional(),
})

/**
 * The stored row, as the schema validates it.
 *
 * Structurally `TrustRecord` with two compile-time differences the
 * validator cannot express: `grantedBy` is a branded `PrincipalId` in the
 * vocabulary and a plain string on disk, and `exactOptionalPropertyTypes`
 * distinguishes an absent optional from one set to `undefined` while a parsed
 * document cannot. Declaring the row and converting once at the table handle
 * keeps the schema honest about what it actually checks.
 */
export type StoredTrustRecord = z.infer<typeof trustRecord>

/**
 * A grant that has already been spent, keyed by the path spelling the operator
 * configured.
 *
 * Records alone do not make a grant one-shot. They are keyed by CANONICAL
 * path, so a retargeted symlink resolves to a canonical path that has no
 * record — and the grant, re-resolved, would bind the attacker's directory as
 * a first binding. This marker is what makes "consumed once" true: a grant
 * whose configured spelling appears here is never resolved again, whatever it
 * now points at.
 */
const consumedGrant = z.object({
  /** The canonical path this grant bound when it was spent. */
  canonicalPath: z.string(),
  /** ISO-8601 instant it was spent. */
  at: z.string(),
})

/** A spent grant as stored. */
export type StoredConsumedGrant = z.infer<typeof consumedGrant>

/** One record per canonical workspace path, and one marker per spent grant. */
export const workspaceTrustDomainSpec = defineDomain({
  name: 'workspace_trust',
  version: 0,
  tables: {
    records: domainTable<string, StoredTrustRecord>(trustRecord),
    consumed_grants: domainTable<string, StoredConsumedGrant>(consumedGrant),
  },
})
