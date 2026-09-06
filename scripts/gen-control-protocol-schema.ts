/**
 * Generate `spec/control-protocol.schema.json` from the server's real wire
 * surface (Epic P8-01, must[4]).
 *
 * must[4] asks for the protocol schema artifact to enter release evidence and
 * golden compatibility fixtures. This produces that artifact, and the `--check`
 * mode is what makes it a golden fixture rather than a report: a committed file
 * that must match a fresh generation, so acceptance[3] — any protocol behaviour
 * change triggers a fixture diff — is enforced instead of asserted.
 *
 * **Generated from the surface, never transcribed beside it.** The document is
 * built from `SERVER_PROTOCOL_SURFACE`, the same value `initialize` fingerprints
 * for a peer. A hand-maintained schema file would be a second declaration of the
 * surface, free to disagree with the one peers actually meet — and a golden
 * fixture pinning a disagreeing copy reports drift that is not there while
 * missing drift that is.
 *
 * The artifact carries the fingerprint alongside the surface. That is redundant
 * by construction, and deliberately so: the digest is what a peer compares, so
 * a reader of the file can check the fingerprint they were given without
 * re-running this generator, and `--check` proves the two still agree.
 *
 * CLI:
 *   `pnpm run gen-control-protocol-schema`           write the artifact
 *   `pnpm run gen-control-protocol-schema --check`   fail if it has drifted
 *
 * @module scripts/gen-control-protocol-schema
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { computeSchemaFingerprint } from '@deepseek-ai/dsh-sdk-protocol'
import { SERVER_PROTOCOL_SURFACE } from '@deepseek-ai/dsh-sdk-jsonrpc-server'

const REPO_ROOT = resolve(import.meta.dirname, '..')
const ARTIFACT_PATH = join(REPO_ROOT, 'spec/control-protocol.schema.json')

/**
 * Render the artifact's exact bytes.
 *
 * Entries are emitted in the surface's own order rather than sorted: the
 * fingerprint sorts internally, so ordering here is presentational, and a
 * document that reorders what the source declares is harder to read against the
 * code it describes.
 * @returns the artifact JSON, newline-terminated.
 */
export function renderControlProtocolSchema(): string {
  const document = {
    schema: { name: 'deepseek-harness-control-protocol', version: '1.0' },
    generatedBy: 'scripts/gen-control-protocol-schema.ts',
    source: 'packages/sdk/server/src/server.ts SERVER_PROTOCOL_SURFACE',
    fingerprint: computeSchemaFingerprint(SERVER_PROTOCOL_SURFACE),
    surface: SERVER_PROTOCOL_SURFACE,
  }
  return `${JSON.stringify(document, null, 2)}\n`
}

function main(): void {
  const rendered = renderControlProtocolSchema()
  if (!process.argv.includes('--check')) {
    writeFileSync(ARTIFACT_PATH, rendered, 'utf8')
    const written = JSON.parse(rendered) as { fingerprint: string }
    console.log(`gen-control-protocol-schema: wrote spec/control-protocol.schema.json (fingerprint ${written.fingerprint})`)
    return
  }
  const committed = readFileSync(ARTIFACT_PATH, 'utf8')
  if (committed === rendered) {
    console.log('gen-control-protocol-schema: the committed artifact matches the live protocol surface.')
    return
  }
  console.error(
    'gen-control-protocol-schema: spec/control-protocol.schema.json no longer matches the server\'s wire surface. '
    + 'This is the fixture diff acceptance[3] requires — a protocol change reached the surface. '
    + 'Run `pnpm run gen-control-protocol-schema` and review the diff before committing it.',
  )
  process.exit(1)
}

main()
