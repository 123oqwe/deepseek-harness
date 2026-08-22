/**
 * Schema fingerprint for protocol type verification.
 *
 * @module @deepseek-ai/dsh-sdk-protocol/schema-fingerprint
 */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

export function computeSchemaFingerprint(): string {
  const typesPath = join(__dirname, 'types.ts')
  const content = readFileSync(typesPath, 'utf8')
  return createHash('sha256').update(content).digest('hex')
}

export function verifySchemaFingerprint(expected: string): boolean {
  return computeSchemaFingerprint() === expected
}
