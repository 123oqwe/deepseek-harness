/**
 * Report whether this host can run the confinement `dsh-sandbox-local` needs.
 *
 * The point is that it asks the PRODUCT what it needs rather than restating it.
 * Two hand-written controls preceded this one and both were wrong in the same
 * way — they tested what `bwrap` can do on a machine instead of what dsh asks
 * `bwrap` to do. The first over-asked (`--unshare-all`, which needs a network
 * namespace dsh never requests) and failed on loopback setup; the second matched
 * the profile by hand, which is correct until `bwrapProfileArgs` changes and
 * nothing makes the copy follow.
 *
 * Importing the profile builder removes the copy. A CI step that runs this is
 * asking the same question `defaultProbeBwrap` asks at runtime, by construction.
 *
 * Exits 0 when the backend is usable, 1 when it is not, and prints the failure
 * `bwrap` reported — that message is what says whether the host is missing the
 * binary, the kernel permission, or something else, and every repair so far has
 * come from reading it rather than from predicting it.
 */
import { spawnSync } from 'node:child_process'

import { bwrapProfileArgs } from '../packages/sandbox/sandbox-local/src/profiles.ts'

const PROBE_TIMEOUT_MS = 10_000

const args = [...bwrapProfileArgs({ mode: 'read-only', workspaceRoot: '/' }), '--', 'true']
process.stdout.write(`probing: bwrap ${args.join(' ')}\n`)

const probe = spawnSync('bwrap', args, { timeout: PROBE_TIMEOUT_MS, encoding: 'utf8' })

if (probe.error !== undefined) {
  process.stdout.write(`sandbox backend unusable: ${probe.error.message}\n`)
  process.exit(1)
}
if (probe.status !== 0) {
  process.stdout.write(`sandbox backend unusable (exit ${String(probe.status)}): ${probe.stderr.trim()}\n`)
  process.exit(1)
}
process.stdout.write('sandbox backend usable: dsh-sandbox-local can confine a command on this host\n')
