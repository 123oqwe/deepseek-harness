/**
 * Preload for a launched `dsh` whose application tree has disposed while its
 * process stays alive: it ends the process with the exit code `dsh` recorded.
 *
 * `dsh` records its exit code only after the whole tree has disposed
 * (`createProcessShutdown` in `apps/cli/src/process-shutdown.ts`) and then
 * leaves the process to end when its event loop drains. A settled detached
 * workflow run keeps its worker thread alive past that point: the engine
 * disposes the run's agent when the run settles but never the run, whose
 * `dispose()` is the only call that terminates the worker
 * (`packages/workflow/workflow-worker-thread/src/index.ts`, `host.ts`). A tree
 * that never finishes disposing still ends through the launcher's own forced
 * exit, so this preload changes nothing before the code is recorded.
 *
 * Only the main thread polls: a worker thread that inherits the preload has an
 * exit code of its own, which `dsh` never records.
 */

import { isMainThread } from 'node:worker_threads'

if (isMainThread) {
  const poll = setInterval(() => {
    if (process.exitCode !== undefined) process.exit(process.exitCode)
  }, 25)
  // The poll must not itself keep the process alive.
  poll.unref()
}
