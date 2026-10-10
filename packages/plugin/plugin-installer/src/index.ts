/**
 * Plugin-package installer (Epic P1-04 (A)): verify a package's provenance
 * (P1-02) and safely unpack it in a private quarantine, published as
 * `ctx.pluginInstaller`.
 *
 * Sub-slice 1 is the capability and its quarantine/extract/verify logic; it has
 * no factory consumer yet, so it does not by itself satisfy acceptance[0]/[1]
 * on the shipped `dsh plugin add` path (the CLI is still a thin pnpm forwarder).
 * Wiring the CLI to this installer, atomic promotion into the profile, and the
 * plugin lock are sub-slice 2 (after P1-03), where acceptance[0]/[1] reach the
 * factory path and are signed. `must[2]`'s build sandbox is out of scope: `dsh`
 * installs prebuilt packages and does not build plugins from source.
 * @module @deepseek-ai/dsh-plugin-installer
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { PluginInstallError } from './errors.ts'
import { safeExtract } from './extract.ts'
import { createQuarantine } from './quarantine.ts'
import { verifyPackage } from './verify.ts'
import type { Config, ExtractionPolicy, InstallRequest, InstalledPlugin } from './types.ts'

export { PluginInstallError } from './errors.ts'
export { createQuarantine } from './quarantine.ts'
export { safeExtract } from './extract.ts'
export { verifyPackage } from './verify.ts'
export type {
  Config,
  ExtractionPolicy,
  InstallRefusalCode,
  InstallRequest,
  InstalledPlugin,
  ProvenanceAssertion,
} from './types.ts'

/** Default largest total-uncompressed to compressed ratio before an archive reads as a bomb. */
export const DEFAULT_MAX_DECOMPRESSION_RATIO = 100
/** Default largest total uncompressed byte size an archive may expand to (512 MiB). */
export const DEFAULT_MAX_UNCOMPRESSED_BYTES = 512 * 1024 * 1024

declare module '@deepseek-ai/cordis' {
  interface Context {
    pluginInstaller: PluginInstaller
  }
}

/**
 * Install one plugin package from untrusted `.tgz` bytes. A deployment mounts
 * one provider; its absence is capability absence — no caller installs a plugin
 * — not a silent pass.
 */
export abstract class PluginInstaller extends Service {
  /** @param ctx - the plugin context the service registers `pluginInstaller` on. */
  constructor(ctx: Context) {
    super(ctx, 'pluginInstaller')
  }

  /**
   * Verify the package's provenance and safely extract it into a fresh
   * quarantine.
   * @param request - the untrusted tarball and the provenance to verify it against.
   * @returns the quarantine extraction path and the trust anchor it verified against.
   * @throws PluginInstallError on a provenance rejection or a refused/oversized archive.
   */
  abstract install(request: InstallRequest): Promise<InstalledPlugin>
}

/**
 * The local plugin installer. It verifies provenance FIRST, so an unsigned or
 * tampered package is never unpacked; both the provenance check and the
 * extract-time structural checks run regardless, but refusing authenticity
 * before touching the archive's contents is the safer order.
 */
export class LocalPluginInstaller extends PluginInstaller {
  /** The decompression bounds, as `cordis.yml` configures them. */
  static Config: z<Config> = z.object({
    maxDecompressionRatio: z.number().step(1).min(1).default(DEFAULT_MAX_DECOMPRESSION_RATIO),
    maxUncompressedBytes: z.number().step(1).min(1).default(DEFAULT_MAX_UNCOMPRESSED_BYTES),
  })

  private readonly policy: ExtractionPolicy

  /**
   * @param ctx - the plugin context.
   * @param config - the resolved installer configuration.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx)
    this.policy = {
      maxDecompressionRatio: config.maxDecompressionRatio ?? DEFAULT_MAX_DECOMPRESSION_RATIO,
      maxUncompressedBytes: config.maxUncompressedBytes ?? DEFAULT_MAX_UNCOMPRESSED_BYTES,
    }
  }

  /**
   * Verify provenance against the mounted trust kernel's roots, then safely
   * extract into a private quarantine.
   * @param request - the untrusted tarball and the provenance to verify it against.
   * @returns the quarantine extraction path and the trust anchor it verified against.
   * @throws PluginInstallError when no trust kernel is mounted, on a provenance rejection, or on a refused/oversized archive.
   */
  async install(request: InstallRequest): Promise<InstalledPlugin> {
    const kernel = this.ctx.get('trustKernel')
    if (kernel === undefined) {
      throw new PluginInstallError('provenance-rejected', 'no trust kernel is mounted, so no package can be verified')
    }
    const trustAnchorId = verifyPackage(request.tarball, request.provenance, kernel.signatureRoots)
    const quarantine = createQuarantine()
    await safeExtract(request.tarball, quarantine.root, quarantine.extractDir, this.policy)
    return { extractedPath: quarantine.extractDir, trustAnchorId }
  }
}

export default LocalPluginInstaller
