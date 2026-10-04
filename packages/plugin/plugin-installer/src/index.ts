/**
 * Epic P1-04's isolated-install security core. A caller downloads an untrusted
 * plugin tarball into a quarantine, calls {@link extractQuarantined} to refuse a
 * malicious archive and extract a safe one without running any lifecycle script,
 * then verifies provenance through the existing P1-02 path
 * (`@deepseek-ai/dsh-plugin-provenance`) before a later slice promotes it into
 * the profile. This package never touches the profile or its lock.
 * @module @deepseek-ai/dsh-plugin-installer
 */

export { extractQuarantined, inspectTarball } from './extract.ts'
export { PluginInstallError } from './types.ts'
export type { PluginInstallErrorCode, UnpackPolicy, UnpackThreatKind } from './types.ts'

/** Default largest total declared uncompressed size an archive may reach before it reads as a bomb (512 MiB). */
export const DEFAULT_MAX_TOTAL_BYTES = 512 * 1024 * 1024
/** Default largest number of entries an archive may hold. */
export const DEFAULT_MAX_ENTRIES = 20_000
