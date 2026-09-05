/**
 * Bridging a workflow's agent events into a journal (Epic P4-08 must[4]).
 *
 * The worker host already reports every `agent()` call starting and settling.
 * This adapter turns that existing stream into journal entries, so a run
 * becomes journalable without the host learning what a journal is and without
 * the journal learning how a worker reports.
 *
 * The adapter is deliberately thin: it maps one event shape to another and
 * decides nothing. Every judgement -- what may be skipped, what must be
 * reconciled, whether a resume is allowed at all -- belongs to `./types.ts`,
 * where it can be tested without a running worker.
 *
 * @module @deepseek-ai/dsh-workflow-journal/observer
 */

import type { JournalRecorder } from './recorder.ts'
import type { StepEffectClass } from './types.ts'

/** The agent-start shape the workflow host reports. */
export interface AgentStartEvent {
  readonly seq: number
  readonly label: string
  readonly phase?: string
  readonly childId: string
}

/** The agent-end shape, carrying how the call settled. */
export interface AgentEndEvent extends AgentStartEvent {
  readonly outcome: 'completed' | 'failed' | 'cancelled'
}

/**
 * Decide which journal outcome an agent outcome corresponds to.
 *
 * `cancelled` maps to `failed` rather than to its own journal outcome. A
 * cancelled step did not produce a result, so a resume must re-run it, and
 * that is exactly what `failed` already means to `decideResume`. Adding a
 * third outcome would create a state every consumer has to handle while no
 * consumer would treat it differently.
 * @param outcome - how the agent call settled.
 * @returns the journal outcome to record.
 */
export function journalOutcomeOf(outcome: AgentEndEvent['outcome']): 'completed' | 'failed' {
  return outcome === 'completed' ? 'completed' : 'failed'
}

/**
 * Attach a recorder to a host's agent event stream.
 *
 * `classify` is supplied by the caller because effect class is the SCRIPT's
 * declaration, not something an observer can see. An adapter that guessed --
 * by label, by phase, by whether a result came back -- would be inferring
 * whether an effect escaped from outside the process that produced it, which
 * is the one thing this epic establishes cannot be done.
 * @param recorder - the recorder to append to.
 * @param classify - the script's effect class for a given step.
 * @returns handlers to call from the host's agent-start and agent-end paths.
 */
export function journalingObserver(
  recorder: JournalRecorder,
  classify: (event: AgentStartEvent) => StepEffectClass,
): {
    readonly onAgentStart: (event: AgentStartEvent) => void
    readonly onAgentEnd: (event: AgentEndEvent) => void
  } {
  return {
    onAgentStart(event) {
      recorder.stepStarted(
        {
          seq: event.seq,
          label: event.label,
          childId: event.childId,
          ...(event.phase === undefined ? {} : { phase: event.phase }),
        },
        classify(event),
      )
    },
    onAgentEnd(event) {
      recorder.stepEnded({
        seq: event.seq,
        label: event.label,
        childId: event.childId,
        ...(event.phase === undefined ? {} : { phase: event.phase }),
        outcome: journalOutcomeOf(event.outcome),
        ...(event.outcome === 'completed' ? { output: `agent-result-${event.seq}` } : {}),
      })
    },
  }
}
