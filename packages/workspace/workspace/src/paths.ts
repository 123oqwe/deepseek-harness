/**
 * Path canonicalization and filesystem identity observation for workspaces.
 * @module @deepseek-ai/dsh-workspace/src/paths
 */

import { realpath, stat } from 'node:fs/promises'
import { posix, win32 } from 'node:path'
import type { WorkspaceIdentity } from '@deepseek-ai/dsh-workspace-trust/types'

/**
 * Check whether a path names one fixed Host location without process cwd or
 * current-drive resolution.
 * @param path - Candidate Workspace path.
 * @param platform - Host platform; injectable for deterministic path tests.
 * @returns Whether the path is fully qualified on that platform.
 */
export function fullyQualifiedWorkspacePath(
  path: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (platform !== 'win32') return posix.isAbsolute(path)
  const root = win32.parse(path).root
  return win32.isAbsolute(path) && root !== '\\' && root !== '/'
}

/**
 * Derive a non-empty default title from a canonical Workspace path.
 * @param path - Canonical Workspace path.
 * @param platform - Host platform; injectable for deterministic path tests.
 * @returns The final segment when present, otherwise the complete root spelling.
 */
export function defaultWorkspaceTitle(
  path: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const pathApi = platform === 'win32' ? win32 : posix
  return pathApi.basename(path) || pathApi.parse(path).root
}

/**
 * Canonicalize a fully qualified directory path via `fs.realpath`: trailing
 * slashes, `..` segments, and symlinks are all resolved. This is the ONE
 * uniqueness canon of the package — workspace paths are stored canonicalized,
 * uniqueness is string equality of canonicalized paths (a symlink to an
 * existing workspace's directory collides), and attach-time session `cwd`
 * checks go through the same canon. Relative paths reject before `realpath` can
 * resolve them from the Host cwd or current Windows drive. A path that does not
 * exist rejects with the original `ENOENT` — this is `create`'s reject path (a
 * workspace must point at an existing directory).
 * @param path - The path to canonicalize.
 * @returns the canonical absolute path.
 */
export async function realpathNormalize(path: string): Promise<string> {
  if (!fullyQualifiedWorkspacePath(path)) {
    throw new TypeError(`Workspace path is not fully qualified: '${path}'`)
  }
  return await realpath(path)
}

/**
 * Observe the filesystem identity a workspace's trust binds to (Epic P1-07
 * must[0]): the {@link realpathNormalize} canonical path of `path` together
 * with the `fs.Stats.dev`/`fs.Stats.ino` pair `fs.stat` reports for that same
 * canonical path. `@deepseek-ai/dsh-workspace-trust` decides what an identity
 * change means; this function is the only thing that produces one from a real
 * directory.
 *
 * Both halves are read in one call so that neither can be supplied
 * independently of the other: a caller holding a path string cannot mint an
 * identity, and the device/inode pair always describes the directory the path
 * resolved to. The canonical path alone does not identify a directory — it is
 * unchanged when the directory is replaced in place or a symlink on the way to
 * it is retargeted — and the device/inode pair alone does not either, since it
 * survives a rename.
 *
 * @param path - Directory path in any spelling; resolved before it is stat'd.
 * @returns the canonical path and the volume/inode identity observed for it.
 * @throws the original `fs.realpath`/`fs.stat` rejection when `path` does not
 * resolve to an existing entry — an unobservable directory has no identity,
 * and callers treat that as untrusted rather than as unchanged.
 */
export async function observeWorkspaceIdentity(path: string): Promise<WorkspaceIdentity> {
  const canonicalPath = await realpathNormalize(path)
  const stats = await stat(canonicalPath)
  return { canonicalPath, volume: { device: stats.dev, inode: stats.ino, createdAtMs: stats.birthtimeMs } }
}
