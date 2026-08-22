 /**
  * Type definitions for Plugin Manifest v2.
  *
  * A manifest declares what a plugin can access, expose, and modify before
  * it is loaded. This enables installers, policy engines, and administrators
  * to make production-grade least-privilege decisions.
  *
  * @module @deepseek-ai/dsh-plugin-manifest/types
  */

 /** Side-effect classification for tools and capabilities. */
 export type SideEffectClass =
   | 'none'        // Read-only, no external state change
   | 'local-write' // Writes to local filesystem within workspace
   | 'network'     // Makes network requests
   | 'process'     // Spawns or manages processes
   | 'external'    // Modifies external systems (APIs, databases, payments)
   | 'irreversible'// Cannot be undone (e.g., real payment, irreversible delete)

 /** Data classification for tool inputs/outputs. */
   export type DataClassification =
   | 'public'
   | 'internal'
   | 'confidential'
   | 'restricted'  // PII, PHI, financial, credentials

 /** Filesystem permission declaration. */
 export interface FilesystemPermission {
   readonly path: string
   readonly access: 'read' | 'write' | 'read-write'
   readonly recursive?: boolean
 }

 /** Network permission declaration. */
 export interface NetworkPermission {
   readonly destinations: string[]
   readonly methods: string[]
   readonly authAudience?: string
 }

 /** Process permission declaration. */
 export interface ProcessPermission {
   readonly allowedCommands?: string[]
   readonly shell: boolean
   readonly timeout?: number
 }

 /** Secrets permission. */
 export interface SecretsPermission {
   readonly requestedSecrets: string[]
   readonly access: 'read' | 'write'
 }

 /** A tool declared in the manifest. */
 export interface ManifestTool {
   readonly name: string
   readonly description: string
   readonly sideEffect: SideEffectClass
   readonly dataClassification: DataClassification
   readonly authAudience?: string
   readonly allowedDestinations?: string[]
 }

 /** An MCP server declared in the manifest. */
   export interface ManifestMCPServer {
   readonly name: string
   readonly transport: 'stdio' | 'sse' | 'websocket'
   readonly auth: 'none' | 'bearer' | 'oauth'
   readonly networkDestinations?: string[]
   readonly sideEffect: SideEffectClass
   readonly tools: ManifestTool[]
 }

 /** A service declared in the manifest. */
   export interface ManifestService {
   readonly name: string
   readonly role: 'definition' | 'provider' | 'consumer'
   readonly capabilities?: string[]
 }

 /** Execution mode for the plugin. */
   export type ExecutionMode =
   | 'in-process'     // Runs in the main process
   | 'worker-thread'  // Runs in a worker thread
   | 'out-of-process' // Runs in a separate process

 /** Plugin Manifest v2. */
   export interface PluginManifestV2 {
   readonly manifestVersion: 2
   readonly name: string
   readonly version: string
   readonly description: string
   readonly author?: string
   readonly license?: string
   readonly services: ManifestService[]
   readonly tools: ManifestTool[]
   readonly skills?: string[]
   readonly mcpServers?: ManifestMCPServer[]
   readonly events?: string[]
   readonly filesystem?: FilesystemPermission[]
   readonly network?: NetworkPermission[]
   readonly process?: ProcessPermission
   readonly secrets?: SecretsPermission[]
   readonly uiSurfaces?: string[]
   readonly dataStores?: string[]
   readonly migrations?: string[]
   readonly executionMode: ExecutionMode
   readonly compatibility: { readonly minHarnessVersion: string; readonly maxHarnessVersion?: string }
 }

 /** Legacy v1 bundle (dsh.bundle). */
   export interface LegacyBundleV1 {
   readonly dsh?: { readonly bundle?: string }
   readonly name: string
   readonly version: string
 }

 /** Result of manifest validation. */
   export interface ManifestValidationResult {
   readonly valid: boolean
   readonly errors: string[]
   readonly warnings: string[]
   readonly trustLevel: 'L0-unknown' | 'L1-inspected' | 'L2-signed' | 'L3-verified' | 'L4-production' | 'L5-kernel-trusted'
   readonly legacy: boolean
 }

 /** Error thrown when a manifest is invalid. */
   export class ManifestValidationError extends Error {
   readonly errors: string[]
   constructor(errors: string[]) {
     super(`Plugin manifest validation failed:\n${errors.map(e => `  - ${e}`).join('\n')}`)
     this.name = 'ManifestValidationError'
     this.errors = errors
   }
 }
