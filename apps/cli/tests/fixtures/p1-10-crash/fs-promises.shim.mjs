/**
 * `node:fs/promises` as storage-json's source sees it in the P1-10 crash
 * campaign's instrumented child. With `P1_10_KILL_AT=inside-switch`, `rename`
 * SIGKILLs the process before it moves a `.migrated-` copy into place. In
 * `switchIn` that is the second of its two renames, after the live unit was
 * moved aside (packages/storage/storage-json/src/index.ts:140-141); no other
 * rename in that file moves a `.migrated-` copy.
 */
import * as fsPromises from 'node:fs/promises'
import { basename } from 'node:path'

export * from 'node:fs/promises'

export function rename(oldPath, newPath) {
  if (process.env.P1_10_KILL_AT === 'inside-switch' && basename(String(oldPath)).includes('.migrated-')) {
    process.kill(process.pid, 'SIGKILL')
  }
  return fsPromises.rename(oldPath, newPath)
}
