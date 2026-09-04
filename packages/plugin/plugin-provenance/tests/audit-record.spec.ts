/**
 * Epic P1-02's Usage stage, acceptance[2] ("Inventory 和审计事件记录验证结果而
 * 不记录密钥"): the audit record must be able to state the verification state a
 * package actually has. Every package installed in this repository today ships
 * no `PackageProvenanceClaim` at all, so the true state of each is "no claim
 * was presented" — a state the Contract stage's `'trusted' | 'rejected'`
 * record cannot represent. Recording those packages as `'rejected'` would name
 * a refusal that never happened, under a `ProvenanceRejectionReason` none of
 * whose members is true of them.
 *
 * These cases exercise the record surface only. The Inventory half of
 * acceptance[2] — a real producer walking a live Cordis `Context` — is
 * `packages/host/plugin-inventory/tests/provenance-record.spec.ts`.
 */

import { describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import { recordProvenanceAudit, recordUnverifiedProvenance } from '../src/index.ts'
import type { PackageDigest, TrustAnchorId } from '../src/signature.ts'

const DECIDED_AT = '2026-09-04T00:00:00.000Z'
const SUBJECT_DIGEST = brandString<PackageDigest>('sha256:0f'.repeat(1))

describe('recordUnverifiedProvenance (acceptance[2]: record the verification result a package actually has)', () => {
  it('records the unverified state a package shipping no provenance claim actually has, naming no-provenance-claim and carrying no package digest', () => {
    const record = recordUnverifiedProvenance('no-provenance-claim', DECIDED_AT)
    expect(record.trust).toBe('unverified')
    expect(record.reason).toBe('no-provenance-claim')
    // No claim was presented, so there is no claimed digest to have checked
    // anything against; asserting one would invent a fact.
    expect(record.packageDigest).toBeUndefined()
    expect(record.verifiedAt).toBe(DECIDED_AT)
  })

  it('carries no trust anchor id on an unverified record, so an unverified package cannot be read as anchored to anything', () => {
    const record = recordUnverifiedProvenance('no-provenance-claim', DECIDED_AT)
    expect(record.trustAnchorId).toBeUndefined()
    expect(Object.keys(record)).not.toContain('trustAnchorId')
  })

  it('distinguishes an unverified package from a rejected one, so no claim was presented is never recorded as a refusal', () => {
    const unverified = recordUnverifiedProvenance('no-provenance-claim', DECIDED_AT)
    const rejected = recordProvenanceAudit(
      SUBJECT_DIGEST,
      { trust: 'rejected', reason: 'package-digest-mismatch' },
      DECIDED_AT,
    )
    expect(unverified.trust).not.toBe(rejected.trust)
    expect(unverified.reason).not.toBe(rejected.reason)
  })

  it('CONTROL (passes at RED, and is meant to): still names the anchor on a trusted record, so widening the record for the unverified state does not weaken what a real verdict reports', () => {
    const anchorId = brandString<TrustAnchorId>('trust-anchor-sigstore-example')
    const record = recordProvenanceAudit(SUBJECT_DIGEST, { trust: 'trusted', trustAnchorId: anchorId }, DECIDED_AT)
    expect(record.trust).toBe('trusted')
    expect(record.packageDigest).toBe(SUBJECT_DIGEST)
    expect(record.trustAnchorId).toBe(anchorId)
  })
})
