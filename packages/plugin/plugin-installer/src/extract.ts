/** Quarantine staging and refuse-not-strip safe extraction (Epic P1-04). @module @deepseek-ai/dsh-plugin-installer/extract */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, normalize } from 'node:path'
import { extract, list } from 'tar'
import { PluginInstallError } from './types.ts'
import type { UnpackPolicy } from './types.ts'

/** The threat an entry path poses, or undefined when it stays inside the package root. */
function pathThreat(entryPath: string): 'absolute-path' | 'path-traversal' | undefined {
  if (isAbsolute(entryPath)) return 'absolute-path'
  if (normalize(entryPath).split(/[/\\]+/u).includes('..')) return 'path-traversal'
  return undefined
}

/**
 * Inspect every entry of a quarantined tarball and REFUSE the first unsafe one
 * (Epic P1-04 acceptance[1]): a path that escapes the package root, a symlink or
 * hardlink entry, more entries than the limit, or a cumulative declared size
 * past the bomb limit. The listing reads the archive without extracting; it
 * records the first unsafe entry and throws after the walk — it does not
 * silently strip the entry. Recording and re-throwing after the walk, rather
 * than throwing inside the entry callback, is deliberate: an in-callback throw
 * escapes node-tar's asynchronous stream without settling the walk, so the
 * refusal must be carried out by the recorded violation. Nothing is written to
 * disk during inspection, so a refused size-bomb never expands onto the
 * filesystem. A clean pass means the archive is safe to extract.
 * @param tarballPath - path to the quarantined `.tgz`.
 * @param policy - the deployment-resolved unpack limits.
 * @throws PluginInstallError (`MALICIOUS_PACKAGE`) when any entry is unsafe.
 */
export async function inspectTarball(tarballPath: string, policy: UnpackPolicy): Promise<void> {
  let totalBytes = 0
  let entries = 0
  let violation: PluginInstallError | undefined
  const refuse = (message: string, threat: PluginInstallError['threat']): void => {
    violation ??= new PluginInstallError(message, 'MALICIOUS_PACKAGE', threat)
  }
  await list({
    file: tarballPath,
    onentry: (entry) => {
      if (violation !== undefined) return
      entries += 1
      if (entries > policy.maxEntries) refuse(`archive declares more than ${policy.maxEntries} entries`, 'entry-count')
      const threat = pathThreat(entry.path)
      if (threat !== undefined) refuse(`entry '${entry.path}' escapes the package root`, threat)
      if (entry.type === 'SymbolicLink') refuse(`entry '${entry.path}' is a symlink`, 'symlink')
      if (entry.type === 'Link') refuse(`entry '${entry.path}' is a hardlink`, 'hardlink')
      totalBytes += entry.size
      if (totalBytes > policy.maxTotalBytes) refuse(`archive expands past the ${String(policy.maxTotalBytes)}-byte limit`, 'decompression-ratio')
    },
  })
  if (violation !== undefined) throw violation
}

/**
 * Stage a plugin tarball in a fresh quarantine directory and extract it there,
 * running no lifecycle script (extraction never invokes npm), only after
 * {@link inspectTarball} clears every entry. The profile is never touched, so a
 * refused or failed install leaves it byte-for-byte unchanged (acceptance[2]);
 * a failed extraction removes the quarantine it created.
 * @param tarballPath - path to the quarantined `.tgz`.
 * @param policy - the deployment-resolved unpack limits.
 * @returns the directory the package was extracted into.
 * @throws PluginInstallError when an entry is refused.
 */
export async function extractQuarantined(tarballPath: string, policy: UnpackPolicy): Promise<string> {
  await inspectTarball(tarballPath, policy)
  const dir = await mkdtemp(join(tmpdir(), 'dsh-plugin-quarantine-'))
  try {
    await extract({ file: tarballPath, cwd: dir, preservePaths: false })
  } catch (error: unknown) {
    await rm(dir, { recursive: true, force: true })
    throw error
  }
  return dir
}
