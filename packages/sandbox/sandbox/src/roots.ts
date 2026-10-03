/**
 * The writable-root derivation shared by every enforcement dialect that
 * expresses a mode as a canonical allow-list: `workspace-write` means "the
 * workspace root plus the platform temp areas, less the harness home", and
 * this module is that meaning's one home. The Seatbelt profile
 * (`@deepseek-ai/dsh-sandbox-local`) and the in-process filesystem fence
 * (`@deepseek-ai/dsh-fs-sandbox`) both derive their allow-list here, so "the
 * write tool cannot write /tmp but bash can" asymmetries cannot arise between
 * them. The bwrap and Landlock dialects keep their own grant spellings (an
 * ephemeral `/tmp` mount, launcher-owned flags) — the honest per-runner
 * differences recorded in the sandbox RFC — with parity pinned by test.
 *
 * @module dsh-sandbox/roots
 */

import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type { SandboxExecutionPolicy } from './index.ts'

/**
 * Resolve a granted root to the path the enforcement layer actually compares:
 * canonical (symlinks resolved), because both Seatbelt filters and the fs
 * fence's containment check match resolved paths — `/tmp` IS `/private/tmp`
 * on darwin, and an as-spelled grant would match nothing.
 * @param path - the root as configured or platform-reported.
 * @returns the canonical path, or the spelling as-is when resolution fails
 *   (a missing root matches nothing until it exists — the conservative
 *   outcome; inventing a fallback would grant a path the caller never named).
 */
export function canonicalPath(path: string): string {
  try {
    // Node's JavaScript realpath implementation lexically collapses `..`
    // before resolving a preceding symlink on some platforms. The native
    // implementation follows the filesystem's component-by-component lookup,
    // matching chdir/spawn and the enforcement layers this identity feeds.
    return realpathSync.native(path)
  } catch {
    // realpathSync.native failed: the path (or a prefix) is missing or unreadable.
    return path
  }
}

/**
 * The roots one confined execution may WRITE under — the mode's meaning as a
 * canonical, deduplicated allow-list. `read-only` allows nothing;
 * `workspace-write` allows the policy's workspace root, the host `/tmp`, and
 * the per-user platform temp dir (`os.tmpdir()` — the real temp area for
 * mkstemp-family tools; omitting it would deny what the mode promises).
 * @param policy - the file-effect policy to derive the allow-list from.
 * @returns the canonical writable roots; empty exactly under `read-only`.
 */
export function writableRoots(policy: SandboxExecutionPolicy): string[] {
  if (policy.mode !== 'workspace-write') return []
  return [...new Set([policy.workspaceRoot, '/tmp', tmpdir()].map(canonicalPath))]
}

/**
 * The roots one confined execution may not write even where they lie under a
 * {@link writableRoots} entry: under `workspace-write`, the harness home
 * (`$DSH_HOME`), which holds the harness's own configuration and state —
 * profiles and patch layers, the settings document the enforced policy set
 * comes from, trust anchors, saved workflows, the action ledger and the
 * credential store. A workspace at or above `~` contains the default home
 * `~/.dsh`. Every backend that confines writes takes this set from here; one
 * that can only grant writable roots refuses a policy whose protected root
 * lies under one of them.
 * @param policy - the file-effect policy to derive the set from.
 * @returns the canonical protected roots; empty unless the mode is `workspace-write`.
 */
export function protectedRoots(policy: SandboxExecutionPolicy): string[] {
  if (policy.mode !== 'workspace-write') return []
  return [canonicalPath(dshHomePath())]
}

/**
 * The files no confined command and no search tool may read: the harness's
 * own credential store, which `@deepseek-ai/dsh-credentials-local` keeps as
 * `$DSH_HOME/.credentials.yaml` (its `CREDENTIALS_FILENAME`) and
 * `@deepseek-ai/dsh-app-boot` reads as the home-level `$DSH_HOME/.env` layer.
 * The names are written here rather than imported because both packages are
 * providers this capability definition must not depend on; a deployment that
 * points the credential provider's `path` elsewhere is not covered. Each path
 * is canonical whether or not the file exists yet.
 * @returns the canonical credential-store paths.
 */
export function unreadableFiles(): string[] {
  const home = canonicalPath(dshHomePath())
  return ['.credentials.yaml', '.env'].map(name => canonicalPath(join(home, name)))
}
