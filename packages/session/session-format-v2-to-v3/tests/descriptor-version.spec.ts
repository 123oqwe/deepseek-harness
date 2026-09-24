/**
 * P0-06 N5: which `subagent/descriptor` versions the v2 to v3 edge keeps. A
 * descriptor of an earlier version comes only from a log migrated from v0 or
 * v1, whose edges keep it without field validation; one of a version above
 * the current 3 was written by no released writer, so the edge refuses it.
 */

import { describe, expect, it } from 'vitest'
import { SessionFormatEventCollector } from '@deepseek-ai/dsh-session-format'
import type { SessionFormatArtifact, SessionFormatEvent, SessionFormatHeader } from '@deepseek-ai/dsh-session-format'
import { restoreReleasedV3Artifact, sessionFormatV2ToV3 } from '../src/index.ts'

const header: SessionFormatHeader = { version: 2, id: 'identity', createdAt: 1, isSeeded: false, delegationDepth: 0 }
const event = (type: string, data: SessionFormatEvent['data']): SessionFormatEvent => ({ type, seq: 0, time: 42, data })

/**
 * Migrate v2 events across the v2 to v3 edge and restore the result.
 * @param events - the v2 events, renumbered densely from 0.
 * @returns the restored v3 artifact.
 */
function migrate(events: readonly SessionFormatEvent[]): SessionFormatArtifact {
  const target = sessionFormatV2ToV3.migrateHeader(header)
  const stage = sessionFormatV2ToV3.createStage({ sourceHeader: header, targetHeader: target, sourceInheritedEventCount: 0, sourceKind: 'decoded' })
  const collector = new SessionFormatEventCollector()
  for (const [seq, e] of events.entries()) stage.transformEvent({ ...e, seq }, collector)
  const artifact = { header: target, inheritedEventCount: stage.finish(collector), events: collector.values }
  return restoreReleasedV3Artifact(artifact, new Set(['feedback/message-put', 'feedback/message-delete']))
}

/**
 * A one-shot descriptor of one version.
 * @param version - the descriptor's version.
 * @returns the event.
 */
const descriptor = (version: number): SessionFormatEvent =>
  event('subagent/descriptor', { version, mode: 'one-shot', provider: 'spawn', label: 'child' })

describe('P0-06 N5: the subagent descriptor versions the v2 to v3 edge keeps', () => {
  it('refuses a descriptor of a version above the current 3, which no released writer produced', () => {
    for (const version of [4, 10]) {
      expect(() => migrate([descriptor(version)]), `version ${String(version)}`).toThrow(/version/u)
    }
  })

  it('guard: keeps a descriptor of the earlier version 2, which a log migrated from v0 carries', () => {
    const earlier = descriptor(2)
    expect(migrate([earlier]).events).toMatchObject([{ type: 'subagent/descriptor', data: earlier.data }])
  })

  it('guard: keeps a descriptor of the current version 3 once it validates', () => {
    const current = descriptor(3)
    expect(migrate([current]).events).toMatchObject([{ type: 'subagent/descriptor', data: current.data }])
  })
})
