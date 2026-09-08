/**
 * The session log as an action-manifest sink (Epic P2-03 must[1], must[2]).
 *
 * `appendManifestThenGate` fixes must[1]'s order — construct, durably append,
 * only then decide whether execution may proceed — in one implementation, so
 * that a path cannot perform the steps out of order or skip one. It needs a
 * `ManifestAppender`, and this is the real one: the session log both execution
 * paths already write to.
 *
 * **Why it lives here rather than in `@deepseek-ai/dsh-action-manifest`.** That
 * package defines what a manifest IS and may not depend on a session — a
 * capability definition reaching for a provider is the edge BLOCKED-136
 * records. `dsh-tools` is already the runtime side both dispatch paths import,
 * so the sink lives here and the rule stays where it was.
 *
 * @module @deepseek-ai/dsh-tools/manifest-log
 */

import type { ActionManifest, AppendedManifest, ManifestAppender } from '@deepseek-ai/dsh-action-manifest'
import type { Session } from '@deepseek-ai/dsh-session'
import type { ActionManifestAppendedEventData } from './index.ts'

/**
 * Read one appended manifest back out of its event.
 *
 * Possible only because the event inlines every must[0] field (§12.33). While
 * five of them were left "reconstructable", the log could not answer what an
 * action had declared, and a gate reading the log could not rebuild the record
 * it was deciding about.
 * @param data - the event payload.
 * @param actorOf - rebuilds the actor principal from its logged id.
 * @returns the manifest as it was appended.
 */
function manifestOf(
  data: ActionManifestAppendedEventData,
  actorOf: (id: string) => ActionManifest['actor'],
): ActionManifest {
  return {
    actionId: data.actionId as ActionManifest['actionId'],
    runId: data.runId as ActionManifest['runId'],
    actor: actorOf(data.actor),
    capability: data.capability as ActionManifest['capability'],
    origin: data.origin,
    target: data.target,
    argumentsHash: data.argumentsHash as ActionManifest['argumentsHash'],
    sideEffectClass: data.sideEffectClass as ActionManifest['sideEffectClass'],
    classified: data.classified,
    requiresApproval: data.requiresApproval,
    idempotencyKey: data.idempotencyKey as ActionManifest['idempotencyKey'],
    preconditions: data.preconditions,
    expectedDiff: data.expectedDiff,
    compensation: data.compensation,
    evidenceRequirements: data.evidenceRequirements,
  }
}

/**
 * A {@link ManifestAppender} backed by one session's durable log.
 *
 * `append` writes the `action/manifest-appended` event and returns the record
 * with the position the session assigned it; `appended` reads every manifest
 * this session has logged, which is what the gate decides against. The
 * position comes from the session's own count rather than from a counter this
 * function keeps: two paths write into one log, and two counters would make
 * one field mean two things.
 * @param session - the session whose log is the sink.
 * @param actorOf - rebuilds an actor principal from its logged id, for reads.
 * @param leaseEpochOf - the lease epoch to record, or `undefined` when the run holds none.
 * @returns the appender both execution paths write through.
 */
export function createSessionManifestAppender(
  session: Session,
  actorOf: (id: string) => ActionManifest['actor'],
  leaseEpochOf: () => number | undefined,
): ManifestAppender {
  return {
    append(manifest: ActionManifest): AppendedManifest {
      const sequence = session.countEventsOfType('action/manifest-appended') + 1
      const leaseEpoch = leaseEpochOf()
      session.append('action/manifest-appended', {
        actionId: manifest.actionId,
        origin: manifest.origin,
        capability: manifest.capability,
        argumentsHash: manifest.argumentsHash,
        sideEffectClass: manifest.sideEffectClass,
        classified: manifest.classified,
        requiresApproval: manifest.requiresApproval,
        runId: manifest.runId,
        actor: manifest.actor.id,
        idempotencyKey: manifest.idempotencyKey,
        sequence,
        target: manifest.target,
        preconditions: manifest.preconditions,
        expectedDiff: manifest.expectedDiff,
        compensation: manifest.compensation,
        evidenceRequirements: manifest.evidenceRequirements,
        ...leaseEpoch === undefined ? {} : { leaseEpoch },
      })
      return { manifest, sequence }
    },
    appended(): readonly AppendedManifest[] {
      const entries: AppendedManifest[] = []
      for (const event of session.snapshotEvents()) {
        if (event.type !== 'action/manifest-appended') continue
        // No cast: the `type` guard above narrows `event` to its own member of
        // `SessionEventMap`, so `data` is already this event's payload.
        entries.push({ manifest: manifestOf(event.data, actorOf), sequence: event.data.sequence })
      }
      return entries
    },
  }
}
