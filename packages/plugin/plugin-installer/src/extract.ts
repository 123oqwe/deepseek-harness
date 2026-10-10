/**
 * Safe extraction of an untrusted plugin `.tgz` into the quarantine.
 *
 * acceptance[0]: the installer only unpacks — it invokes no package manager, so
 * no npm lifecycle script (preinstall/postinstall) ever runs. tar executes
 * nothing, and nothing here shells out.
 *
 * acceptance[1]: every entry is validated before a single byte is written, so a
 * refused archive leaves the extraction directory empty. Refusals: an absolute
 * or `..`-traversing entry path, a symbolic-link or hard-link entry (either can
 * point outside the extraction root), an unsupported entry type, and a
 * decompression bomb — bounded at the gzip layer by {@link gunzipSync}'s
 * `maxOutputLength` (tar.gz is sequential, so a bomb cannot be measured without
 * decompressing it; the cap aborts decompression instead) and by the
 * uncompressed-to-compressed ratio.
 * @module @deepseek-ai/dsh-plugin-installer/extract
 */

import { writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { extract, list } from 'tar'
import { PluginInstallError } from './errors.ts'
import type { ExtractionPolicy } from './types.ts'

/**
 * Decompress, validate, and unpack one quarantined package.
 * @param tarball - the untrusted `.tgz` bytes.
 * @param quarantineRoot - the quarantine directory the decompressed tar is staged in.
 * @param extractDir - the directory under the quarantine to unpack the validated package into.
 * @param policy - the decompression bounds.
 * @throws PluginInstallError on a bomb, a refused entry, or an empty archive.
 */
export async function safeExtract(
  tarball: Uint8Array,
  quarantineRoot: string,
  extractDir: string,
  policy: ExtractionPolicy,
): Promise<void> {
  // The bomb is bounded here: gunzip stops at the byte cap rather than
  // expanding a 1 KiB archive to gigabytes in memory.
  let tar: Buffer
  try {
    tar = gunzipSync(tarball, { maxOutputLength: policy.maxUncompressedBytes })
  } catch (error: unknown) {
    if (error instanceof RangeError) {
      throw new PluginInstallError('decompression-bomb',
        `the archive decompresses past the ${policy.maxUncompressedBytes}-byte limit`)
    }
    throw error
  }
  if (tarball.length > 0 && tar.length / tarball.length > policy.maxDecompressionRatio) {
    throw new PluginInstallError('decompression-bomb',
      `the archive declares a ${Math.round(tar.length / tarball.length)}:1 decompression ratio, over the ${policy.maxDecompressionRatio}:1 limit`)
  }

  const tarPath = join(quarantineRoot, 'package.tar')
  writeFileSync(tarPath, tar, { mode: 0o600 })

  // Validation pass: read the (now size-bounded) tar's headers and refuse the
  // whole archive on the first bad entry, before anything is extracted. Only
  // the first refusal is kept, so a hostile entry count cannot grow this.
  let firstRefusal: PluginInstallError | undefined
  let entryCount = 0
  await list({
    file: tarPath,
    onentry: (entry) => {
      entryCount += 1
      if (firstRefusal === undefined) firstRefusal = entryRefusal(entry.path, entry.type)
    },
  })
  if (firstRefusal !== undefined) throw firstRefusal
  if (entryCount === 0) throw new PluginInstallError('empty-archive', 'the package archive contains no entries')

  // Validated above; tar's own path protections stay on as defence in depth
  // (`preservePaths: false` strips absolute and `..`, and `strict` turns a
  // warning tar would otherwise skip into a thrown error).
  await extract({ file: tarPath, cwd: extractDir, preservePaths: false, strict: true })
}

/**
 * The refusal one entry's path and type earn, or `undefined` when the entry is
 * a plain file or directory confined to the extraction root.
 * @param path - the entry's archive path.
 * @param type - the entry's tar type name.
 * @returns the refusal, or `undefined` when the entry is admitted.
 */
function entryRefusal(path: string, type: string): PluginInstallError | undefined {
  if (isAbsolute(path) || /^[A-Za-z]:/.test(path)) {
    return new PluginInstallError('absolute-path', `entry "${path}" is an absolute path`)
  }
  if (path.split(/[/\\]/).includes('..')) {
    return new PluginInstallError('path-traversal', `entry "${path}" escapes the extraction root with ".."`)
  }
  if (type === 'SymbolicLink') return new PluginInstallError('symlink-entry', `entry "${path}" is a symbolic link`)
  if (type === 'Link') return new PluginInstallError('hardlink-entry', `entry "${path}" is a hard link`)
  if (type !== 'File' && type !== 'Directory') {
    return new PluginInstallError('unsupported-entry', `entry "${path}" is an unsupported ${type} entry`)
  }
  return undefined
}
