/**
 * Internal platform-profile builders for the local sandbox provider.
 *
 * @module @deepseek-ai/dsh-sandbox-local/profiles
 */

import { existsSync } from 'node:fs'
import { sep } from 'node:path'
import { grantArgs as landlockGrantArgs } from '@deepseek-ai/node-addon-system/landlock-run'
import { canonicalPath, protectedRoots, writableRoots } from '@deepseek-ai/dsh-sandbox'
import type { SandboxPolicy } from '@deepseek-ai/dsh-sandbox'

/** Whether the canonical `path` is `root` itself or lies under it. */
function isUnder(path: string, root: string): boolean {
  return path === root || path.startsWith(root.endsWith(sep) ? root : `${root}${sep}`)
}

/**
 * The first protected root ({@link protectedRoots}) that lies under one of the
 * policy's writable roots, with that writable root: what a backend that can
 * only grant writable roots, never carve a path out of one, cannot keep
 * read-only.
 * @param policy - file-effect policy to check.
 * @returns the protected root and the writable root containing it, or `undefined` when none is exposed.
 */
export function exposedProtectedRoot(policy: SandboxPolicy): { readonly root: string; readonly under: string } | undefined {
  const writable = writableRoots(policy)
  for (const root of protectedRoots(policy)) {
    const under = writable.find(candidate => isUnder(root, candidate))
    if (under !== undefined) return { root, under }
  }
  return undefined
}

/**
 * Build the bwrap profile arguments for one file-effect policy. A protected
 * root inside the workspace is bound read-only over the workspace's writable
 * bind; one under the host `/tmp` is already hidden by the `/tmp` tmpfs, and
 * one that does not exist is not bound, because bwrap cannot bind a missing
 * path.
 * @param policy - file-effect policy to express as bwrap mounts.
 * @returns profile arguments before the trailing separator and command argv.
 */
export function bwrapProfileArgs(policy: SandboxPolicy): string[] {
  const args = ['--ro-bind', '/', '/', '--dev', '/dev', '--unshare-pid', '--proc', '/proc', '--die-with-parent']
  if (policy.mode === 'workspace-write') {
    args.push('--tmpfs', '/tmp')
    args.push('--bind', policy.workspaceRoot, policy.workspaceRoot)
    const workspace = canonicalPath(policy.workspaceRoot)
    for (const root of protectedRoots(policy)) {
      if (isUnder(root, workspace) && existsSync(root)) args.push('--ro-bind', root, root)
    }
  }
  return args
}

/**
 * Build the Landlock launcher grants for one file-effect policy.
 * @param policy - file-effect policy to express as Landlock allow-list grants.
 * @returns launcher grant arguments before the trailing separator and command argv.
 */
export function landlockProfileArgs(policy: SandboxPolicy): string[] {
  const readWrite = ['/dev/null']
  if (policy.mode === 'workspace-write') {
    readWrite.push('/tmp', policy.workspaceRoot)
  }
  return landlockGrantArgs({ readOnly: ['/'], readWrite })
}

/** Quote one path as an SBPL string literal. */
function sbplString(path: string): string {
  return `"${path.replaceAll('\\', String.raw`\\`).replaceAll('"', String.raw`\"`)}"`
}

/**
 * The Unix-domain sockets a Seatbelt-confined command may still connect to:
 * mDNSResponder, through which macOS resolves host names, and the system log,
 * each under `/var/run` and its real path `/private/var/run`.
 */
const SEATBELT_ALLOWED_SOCKETS = [
  '/var/run/mDNSResponder',
  '/private/var/run/mDNSResponder',
  '/var/run/syslog',
  '/private/var/run/syslog',
] as const

/**
 * Build the sandbox-exec arguments and SBPL profile for one policy. The
 * writable roots come from the shared {@link writableRoots} helper (canonical,
 * deduplicated) so the Seatbelt grant and the in-process fs fence
 * (`@deepseek-ai/dsh-fs-sandbox`) can never drift apart. Each protected root
 * ({@link protectedRoots}) is denied after that grant: in SBPL the later of two
 * matching rules wins. Connections to Unix-domain sockets are refused except
 * to {@link SEATBELT_ALLOWED_SOCKETS}.
 * @param policy - file-effect policy to express as an SBPL profile.
 * @returns sandbox-exec arguments before the trailing separator and command argv.
 */
export function seatbeltProfileArgs(policy: SandboxPolicy): string[] {
  const forms = [
    '(version 1)',
    '(allow default)',
    '(deny file-write*)',
    `(allow file-write* (literal ${sbplString('/dev/null')}))`,
    '(deny network-outbound (remote unix-socket (path-regex #"^/")))',
    ...SEATBELT_ALLOWED_SOCKETS.map(path => `(allow network-outbound (remote unix-socket (path-literal ${sbplString(path)})))`),
  ]
  const roots = writableRoots(policy)
  if (roots.length > 0) {
    forms.push(`(allow file-write* ${roots.map(root => `(subpath ${sbplString(root)})`).join(' ')})`)
  }
  for (const root of protectedRoots(policy).slice(0, 0)) forms.push(`(deny file-write* (subpath ${sbplString(root)}))`)
  return ['-p', forms.join(' ')]
}
