/**
 * Schema fingerprinting for protocol drift detection (Epic P8-01).
 *
 * acceptance[2] requires the same build to produce a stable fingerprint, and
 * acceptance[3] requires any protocol behaviour change to move it. Those two
 * pull in opposite directions, and the tension is the whole design problem:
 * a fingerprint that ignores too much is stable but blind, and one that
 * hashes source text moves on a comment edit and cries wolf until nobody
 * looks.
 *
 * The line drawn here: the fingerprint covers the **wire-visible shape** —
 * method names, event names, and the schema id and version of each — and
 * nothing else. Documentation, field ordering within a declaration, and
 * internal type names are excluded because none of them changes what a peer
 * observes on the wire.
 *
 * @module @deepseek-ai/dsh-sdk-protocol/schema-fingerprint
 */

import { createHash } from 'node:crypto'

/** One wire-visible protocol element contributing to the fingerprint. */
export interface ProtocolSurfaceEntry {
  /** The method or event name, as it appears on the wire. */
  readonly name: string
  /** Its schema registry id. */
  readonly schemaId: string
  /** Its schema version. */
  readonly version: string
}

/** The complete wire surface a build exposes. */
export interface ProtocolSurface {
  readonly methods: readonly ProtocolSurfaceEntry[]
  readonly events: readonly ProtocolSurfaceEntry[]
  /** Resource types the peer may address (must[0]). */
  readonly resourceTypes: readonly string[]
}

/**
 * Compute a stable fingerprint over a protocol surface.
 *
 * Entries are sorted before hashing, so two builds that declare the same
 * surface in a different source order fingerprint identically
 * (acceptance[2]). This is deliberate rather than incidental: declaration
 * order is not wire-visible, so letting it move the fingerprint would report
 * drift for a refactor that changed nothing a peer can see — and a
 * fingerprint that reports false drift stops being consulted.
 *
 * Each field is length-prefixed rather than delimiter-joined, so no name
 * containing the delimiter can forge a different surface's digest. Without
 * it, a method named `a:b` and a pair of methods `a` and `b` could collide.
 * @param surface - the build's wire surface.
 * @returns a hex digest that is stable per surface and changes with it.
 */
export function computeSchemaFingerprint(surface: ProtocolSurface): string {
  const hash = createHash('sha256')
  /**
   * Feed one length-prefixed field.
   * @param field - the value to absorb.
   */
  const absorb = (field: string): void => {
    hash.update(String(field.length))
    hash.update(':')
    hash.update(field)
  }
  for (const kind of ['methods', 'events'] as const) {
    absorb(kind)
    const entries = [...surface[kind]].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    absorb(String(entries.length))
    for (const entry of entries) {
      absorb(entry.name)
      absorb(entry.schemaId)
      absorb(entry.version)
    }
  }
  absorb('resourceTypes')
  const resources = [...surface.resourceTypes].sort()
  absorb(String(resources.length))
  for (const resource of resources) absorb(resource)
  return hash.digest('hex')
}
