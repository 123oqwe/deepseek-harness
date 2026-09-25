/**
 * A stand-in for `apps/cli/src/bin.ts`, given to `HarnessClient` as its
 * `dshBin` for BLOCKED-310 condition 4's case: it starts the real bin named by
 * `A409_REAL_BIN` with the same arguments and environment, and forwards every
 * byte the client writes to it after appending the same bytes to the file
 * `A409_STDIN_OUT` names. The real bin's stdout and stderr are inherited, so
 * the client reads the shipped runtime's own output. The stand-in exits with
 * the real bin's exit code and forwards SIGTERM and SIGINT to it.
 * @module tests/first100/fixtures/loader/p0-06-client-schema-version/recording-bin
 */

import { spawn } from 'node:child_process'
import { appendFileSync } from 'node:fs'

const realBin = process.env.A409_REAL_BIN
const recording = process.env.A409_STDIN_OUT
if (realBin === undefined || recording === undefined) {
  throw new Error('recording-bin needs A409_REAL_BIN and A409_STDIN_OUT')
}

const child = spawn(process.execPath, [realBin, ...process.argv.slice(2)], { stdio: ['pipe', 'inherit', 'inherit'] })
// An EPIPE here means the real bin has exited; its exit code, forwarded below, is the outcome.
child.stdin.on('error', () => undefined)
process.stdin.on('data', (chunk: Buffer) => {
  appendFileSync(recording, chunk)
  child.stdin.write(chunk)
})
process.stdin.on('end', () => {
  child.stdin.end()
})
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    child.kill(signal)
  })
}
child.on('exit', (code: number | null) => {
  process.exit(code ?? 1)
})
