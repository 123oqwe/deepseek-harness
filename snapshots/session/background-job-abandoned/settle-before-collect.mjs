/**
 * Scenario-local barrier for background-job-abandoned: hold the second model step
 * until background job `bash-1` has settled.
 *
 * The completion notice for a settled background job is spliced into the owner's
 * next-step inbox when the registry settles it. Replay reaches step 2 without
 * waiting for that, so the notice lands before `step/start(2)` or inside step 2
 * depending on which finishes first. `agent/pre-step` is awaited after the step's
 * inbox claim and before `step/start` is appended (agent-loop `preStep`), so a
 * notice spliced while this barrier waits lands between `step/end(1)` and
 * `step/start(2)` and is claimed at step 3, which is the recorded order. The
 * barrier observes the registry only and appends no session event.
 */

export const name = 'bja-settle-before-collect'
export const inject = ['jobs']

const JOB_ID = 'bash-1'

/** Terminal job statuses (`@deepseek-ai/dsh-jobs` `JobStatus`); `running` and `stopping` are not. */
const TERMINAL = new Set(['completed', 'killed', 'failed'])

/** Whether a job snapshot has reached a terminal status. */
function isTerminal(snapshot) {
  return snapshot !== undefined && TERMINAL.has(snapshot.status)
}

/** Install the step-2 barrier on the scenario's root agent. */
export function apply(ctx) {
  let disposed = false
  const waits = new Set()
  ctx.effect(() => () => {
    disposed = true
    for (const wait of waits) wait.reject(new Error('bja-settle-before-collect barrier disposed'))
    waits.clear()
  })

  ctx.on('agent/pre-step', async ({ turn, step, signal }, next) => {
    if (turn !== 1 || step !== 2) return next()
    signal.throwIfAborted()
    if (disposed) throw new Error('bja-settle-before-collect barrier disposed')
    const wait = Promise.withResolvers()
    waits.add(wait)
    // Register before reading so a settlement between the two cannot be missed.
    const stop = ctx.jobs.onJobDone((snapshot) => {
      if (snapshot.id === JOB_ID) wait.resolve()
    })
    const abort = () => { wait.reject(signal.reason) }
    signal.addEventListener('abort', abort, { once: true })
    try {
      let current
      try {
        current = ctx.jobs.get(JOB_ID)
      } catch {
        // The job does not exist yet only if step 1 did not launch it; nothing to wait for.
        current = { status: 'missing' }
      }
      if (!isTerminal(current)) await wait.promise
    } finally {
      stop()
      signal.removeEventListener('abort', abort)
      waits.delete(wait)
    }
    signal.throwIfAborted()
    if (disposed) throw new Error('bja-settle-before-collect barrier disposed')
    return next()
  })
}
