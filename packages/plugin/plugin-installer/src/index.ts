/**
 * Plugin-package installer (Epic P1-04 (A)).
 *
 * Scaffold only: this module currently mounts nothing. The dispatched P1-04 (A)
 * build fills the quarantined extract (`tar` with install scripts disabled and
 * path-traversal, symlink and decompression-ratio rejection), provenance
 * verification (P1-02), the `Config` surface and atomic promotion, published as
 * `ctx.pluginInstaller`.
 * @module @deepseek-ai/dsh-plugin-installer
 */

/** The plugin's loader name. */
export const name = 'dsh-plugin-installer'

/** Mount the plugin installer. Scaffold: no effect until the P1-04 (A) build. */
export function apply(): void {}
