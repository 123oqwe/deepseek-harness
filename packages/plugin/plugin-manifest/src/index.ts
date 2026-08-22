/**
  * Plugin Manifest v2: declare capabilities, permissions, and side effects.
  *
  * @module @deepseek-ai/dsh-plugin-manifest
  */

export type {
  SideEffectClass,
  DataClassification,
  FilesystemPermission,
  NetworkPermission,
  ProcessPermission,
  SecretsPermission,
  ManifestTool,
  ManifestMCPServer,
  ManifestService,
  ExecutionMode,
  PluginManifestV2,
  LegacyBundleV1,
  ManifestValidationResult,
} from './types.ts'

export { ManifestValidationError } from './types.ts'

export {
  isLegacyBundle,
  legacyToManifest,
  validateManifest,
  validateLegacyBundle,
  compareDeclaredVsObserved,
} from './validate.ts'
export { checkWildcardPermissions } from './validate.ts'
