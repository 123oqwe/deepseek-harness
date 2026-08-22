import type { SchemaDefinition, ParityCheckResult } from './types.ts'

export type { SchemaDefinition, ParityCheckResult, SchemaField } from './types.ts'

const CANONICAL_SCHEMA: SchemaDefinition = {
  version: '1.0.0',
  fields: [
    { name: 'serverInfo.name', type: 'string', required: true, defaultValue: 'deepseek-harness-sdk-runtime' },
    { name: 'serverInfo.version', type: 'string', required: true },
    { name: 'sessionId', type: 'string', required: true },
    { name: 'prompt', type: 'string', required: true },
    { name: 'provider', type: 'string', required: true },
    { name: 'model', type: 'string', required: true },
    { name: 'maxTokens', type: 'number', required: false },
    { name: 'cwd', type: 'string', required: true },
    { name: 'commandId', type: 'string', required: true },
    { name: 'idempotencyKey', type: 'string', required: true },
    { name: 'expectedRevision', type: 'number', required: true },
    { name: 'reason', type: 'string', required: true },
  ],
}

export function getCanonicalSchema(): SchemaDefinition {
  return CANONICAL_SCHEMA
}

export function checkParity(
  sdk: string,
  version: string,
  actualFields: Record<string, { type: string; required: boolean; defaultValue?: unknown }>,
): ParityCheckResult {
  const mismatches: { field: string; expected: string; actual: string }[] = []
  let matched = 0

  for (const field of CANONICAL_SCHEMA.fields) {
    const actual = actualFields[field.name]
    if (!actual) {
      mismatches.push({ field: field.name, expected: `${field.type} (required: ${field.required})`, actual: 'missing' })
      continue
    }
    if (actual.type !== field.type) {
      mismatches.push({ field: field.name, expected: field.type, actual: actual.type })
      continue
    }
    if (actual.required !== field.required) {
      mismatches.push({ field: field.name, expected: `required: ${field.required}`, actual: `required: ${actual.required}` })
      continue
    }
    if (field.defaultValue !== undefined && actual.defaultValue !== undefined && actual.defaultValue !== field.defaultValue) {
      // eslint-disable-next-line no-base-to-string
      mismatches.push({ field: field.name, expected: String(field.defaultValue), actual: String(actual.defaultValue ?? 'none') })
      continue
    }
    matched++
  }

  return {
    sdk,
    version,
    fieldsMatched: matched,
    fieldsMismatched: mismatches.length,
    mismatches,
    passed: mismatches.length === 0,
  }
}
