export type RunCommand = 'pause' | 'resume' | 'cancel' | 'fork' | 'retry' | 'reconcile' | 'close'

export interface CommandRequest {
  readonly commandId: string
  readonly idempotencyKey: string
  readonly runId: string
  readonly command: RunCommand
  readonly expectedRevision: number
  readonly reason: string
  readonly forkOptions?: {
    readonly copyContext: boolean
    readonly copyArtifacts: boolean
    readonly inheritSecrets: boolean
  } | undefined
}

export interface CommandResponse {
  readonly accepted: boolean
  readonly commandId: string
  readonly currentState: string
  readonly revision: number
  readonly reason: string
}

export interface CommandStateTransition {
  readonly from: string
  readonly to: string
  readonly command: RunCommand
  readonly valid: boolean
}

const VALID_TRANSITIONS: Record<string, string[]> = {
  running: ['paused', 'cancelled', 'completed'],
  paused: ['running', 'cancelled', 'completed'],
  cancelled: [],
  completed: ['closed'],
  closed: [],
}

export function validateTransition(from: string, command: RunCommand): CommandStateTransition {
  const targetMap: Record<RunCommand, string> = {
    pause: 'paused',
    resume: 'running',
    cancel: 'cancelled',
    fork: 'running',
    retry: 'running',
    reconcile: 'running',
    close: 'closed',
  }
  if (command === 'fork') {
    return { from, to: 'forked', command, valid: ['running', 'paused'].includes(from) }
  }
  const target = targetMap[command]
  const valid = VALID_TRANSITIONS[from]?.includes(target) ?? false
  return { from, to: target, command, valid }
}

export function isIdempotent(
  processedCommandIds: ReadonlySet<string>,
  commandId: string,
): boolean {
  return processedCommandIds.has(commandId)
}
