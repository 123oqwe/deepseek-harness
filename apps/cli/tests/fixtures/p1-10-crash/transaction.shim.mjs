/**
 * `@deepseek-ai/dsh-plugin-migrations/transaction` as the P1-10 crash
 * campaign's instrumented child sees it: the real module, with `runUpgrade`
 * given two instrument settings.
 * - `P1_10_KILL_AT=<phase>` fills the request's `onPhase`, the hook
 *   `UpgradeRequest` declares so a campaign can kill the process at a named
 *   phase; it SIGKILLs this process as that phase completes. The production
 *   caller passes no `onPhase`.
 * - `P1_10_HEALTH=fail` replaces the request's `healthCheck` with one that
 *   answers false.
 * With neither set, the request runs unchanged apart from an `onPhase` that
 * does nothing.
 */
import { runUpgrade as runRealUpgrade } from '@deepseek-ai/dsh-plugin-migrations/transaction'

export * from '@deepseek-ai/dsh-plugin-migrations/transaction'

export function runUpgrade(request) {
  const killAt = process.env.P1_10_KILL_AT
  return runRealUpgrade({
    ...request,
    onPhase: (phase) => {
      if (phase === killAt) process.kill(process.pid, 'SIGKILL')
    },
    ...process.env.P1_10_HEALTH === 'fail' ? { healthCheck: () => Promise.resolve(false) } : {},
  })
}
